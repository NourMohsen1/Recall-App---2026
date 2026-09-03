import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { dateKey, getLoggedMemories, saveMemory, updateMemory } from './memoryLog';
import { PhotoMeta, getAllPhotoMeta, setPhotoMetaBatch } from './photoMeta';
import { detectPhotoSource } from './photoSource';
import { recordLocationForDay } from './placesFromPhotos';

// Bulk-imports photos from the device's library into the Timeline, grouped
// onto the day they were actually taken. Bounded by a date window (the user
// picks Last 10/20/30 days) so this is always a small, fast, native-filtered
// query — never a full-library scan — and already-imported photos are
// tracked so re-running later only picks up what's new.

const IMPORTED_IDS_KEY = 'importedPhotoAssetIds';
// v2 — the backfill now also records each photo's capture time (for the
// assumed-memory feature), not just its source label, so this key changed
// to make everyone's next sync run the fuller pass exactly once more.
const META_BACKFILL_DONE_KEY = 'photoMetaBackfillDone_v2';
const PAGE_SIZE = 100;

export type ImportProgress = { scanned: number; imported: number };
export type ImportResult = { imported: number; days: number };

async function getImportedIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(IMPORTED_IDS_KEY);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

async function saveImportedIds(ids: Set<string>) {
  await AsyncStorage.setItem(IMPORTED_IDS_KEY, JSON.stringify([...ids]));
}

export async function requestLibraryPermission(): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  return perm.granted;
}

// One-time catch-up for photos that were imported before this exact meta
// pass existed — source-label detection, and each photo's own capture time
// (used to sequence a day's photos for the assumed-memory feature). The
// normal import only re-examines genuinely new assets — by design, so a
// routine sync doesn't re-fetch AssetInfo (which can trigger iCloud
// downloads) for a whole year of photos every time. This runs the full,
// heavier scan exactly once, then never again.
export async function backfillPhotoMeta(
  days: number,
  onProgress?: (p: { scanned: number }) => void,
): Promise<{ labeled: number }> {
  const alreadyDone = await AsyncStorage.getItem(META_BACKFILL_DONE_KEY);
  if (alreadyDone) return { labeled: 0 };

  const createdAfter = Date.now() - days * 24 * 60 * 60 * 1000;
  const existingMeta = await getAllPhotoMeta();
  const entries: [string, PhotoMeta][] = [];
  let scanned = 0;
  let after: string | undefined;

  try {
    while (true) {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: 'photo',
        sortBy: [['creationTime', false]],
        createdAfter,
        first: PAGE_SIZE,
        after,
      });

      // Every asset in the window, not just ones missing from importedIds —
      // that's the whole point of a backfill.
      await Promise.all(
        page.assets.map(async (a) => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(a.id);
            const uri = info.localUri ?? a.uri;
            const already = existingMeta[uri];
            if (already?.source && already?.takenAt) return; // fully labeled already
            const source = detectPhotoSource({
              filename: info.filename ?? a.filename,
              mediaSubtypes: info.mediaSubtypes ?? a.mediaSubtypes,
              exif: info.exif,
            });
            const takenAt = info.creationTime ?? a.creationTime;
            const meta: PhotoMeta = { ...already };
            if (source) meta.source = source.key;
            if (takenAt) meta.takenAt = takenAt;
            if (meta.source || meta.takenAt) entries.push([uri, meta]);
          } catch {
            // Skip what we can't resolve — never block the rest of the scan.
          }
        }),
      );

      scanned += page.assets.length;
      onProgress?.({ scanned });

      if (!page.hasNextPage || page.assets.length === 0) break;
      after = page.endCursor;
    }

    await setPhotoMetaBatch(entries);
    await AsyncStorage.setItem(META_BACKFILL_DONE_KEY, '1');
    return { labeled: entries.length };
  } catch {
    // Didn't finish — leave the done-flag unset so it's retried next sync
    // rather than silently giving up forever.
    await setPhotoMetaBatch(entries);
    return { labeled: entries.length };
  }
}

export async function importRecentPhotos(
  days: number,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const createdAfter = Date.now() - days * 24 * 60 * 60 * 1000;
  const importedIds = await getImportedIds();

  // Group newly-found photos by the day they were taken.
  const byDay = new Map<
    string,
    { uri: string; creationTime: number; location?: { latitude: number; longitude: number } }[]
  >();
  // Every detected screenshot / saved-from-app label, written in one batch
  // at the end so a large import doesn't do hundreds of tiny AsyncStorage
  // writes.
  const photoMetaEntries: [string, PhotoMeta][] = [];
  let scanned = 0;
  let after: string | undefined;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: 'photo',
      sortBy: [['creationTime', false]],
      createdAfter,
      first: PAGE_SIZE,
      after,
    });

    const fresh = page.assets.filter((a) => !importedIds.has(a.id));
    // Resolve a directly-renderable URI for each asset (iOS returns ph://
    // from the list query, which needs resolving to a usable local path).
    // This also carries the photo's embedded GPS, when present, which is
    // how imported photos populate "real" Places for their day.
    const resolved = await Promise.all(
      fresh.map(async (a) => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(a.id);
          const uri = info.localUri ?? a.uri;
          const source = detectPhotoSource({
            filename: info.filename ?? a.filename,
            mediaSubtypes: info.mediaSubtypes ?? a.mediaSubtypes,
            exif: info.exif,
          });
          return {
            id: a.id,
            uri,
            creationTime: a.creationTime,
            location: info.location,
            source: source?.key,
          };
        } catch {
          const source = detectPhotoSource({ filename: a.filename, mediaSubtypes: a.mediaSubtypes });
          return { id: a.id, uri: a.uri, creationTime: a.creationTime, location: undefined, source: source?.key };
        }
      }),
    );

    for (const item of resolved) {
      const key = dateKey(new Date(item.creationTime));
      const bucket = byDay.get(key);
      if (bucket) bucket.push(item);
      else byDay.set(key, [item]);
      importedIds.add(item.id);
      if (item.location) {
        recordLocationForDay(key, item.location.latitude, item.location.longitude).catch(() => {});
      }
      // Always record the capture time (drives the assumed-memory feature's
      // day sequencing); the source label only when one was detected.
      const meta: PhotoMeta = { takenAt: item.creationTime };
      if (item.source) meta.source = item.source;
      photoMetaEntries.push([item.uri, meta]);
    }

    scanned += page.assets.length;
    onProgress?.({ scanned, imported: importedIds.size });

    if (!page.hasNextPage || page.assets.length === 0) break;
    after = page.endCursor;
  }

  await setPhotoMetaBatch(photoMetaEntries);

  if (byDay.size === 0) {
    return { imported: 0, days: 0 };
  }

  // Merge into any existing photo memory for that day, or create a new one.
  const existing = await getLoggedMemories();
  let importedCount = 0;
  for (const [key, items] of byDay) {
    const earliest = items.reduce((a, b) => (a.creationTime <= b.creationTime ? a : b));
    const uris = items.map((i) => i.uri);
    const existingPhotoMemory = existing.find(
      (m) => m.kind === 'photo' && dateKey(new Date(m.takenAt)) === key,
    );
    if (existingPhotoMemory) {
      await updateMemory(existingPhotoMemory.id, {
        photoUris: [...(existingPhotoMemory.photoUris ?? []), ...uris],
      });
    } else {
      await saveMemory({
        kind: 'photo',
        photoUris: uris,
        takenAt: new Date(earliest.creationTime),
      });
    }
    importedCount += uris.length;
  }

  await saveImportedIds(importedIds);
  return { imported: importedCount, days: byDay.size };
}
