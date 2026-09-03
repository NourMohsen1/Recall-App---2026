import AsyncStorage from '@react-native-async-storage/async-storage';
// SDK 56 made the redesigned ("next") media-library API the package's
// default entry. That one calls requireNativeModule() at import time and
// ships no web implementation, so merely importing it crashed the app on
// web. The classic API this file uses now lives on the /legacy subpath —
// same arrangement as expo-file-system/legacy elsewhere in the project —
// and it binds to the module that does have a web shim.
import * as MediaLibrary from 'expo-media-library/legacy';
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

// How many photos we ask the OS about at once.
//
// This used to be the whole page (100) via a single Promise.all, which is
// what crashed the app mid-sync on larger libraries: each
// getAssetInfoAsync resolves a full-resolution image, so a hundred of them
// in flight together is enough memory pressure for iOS to kill the process
// outright (no JS error, the app just closes). A small window is barely
// slower in practice and keeps peak memory flat.
const INFO_CONCURRENCY = 6;

// Never let getAssetInfoAsync pull an iCloud original down over the
// network. It defaults to true, so on a library whose photos are offloaded
// to iCloud — the common case on a phone that's low on space — a sync was
// silently downloading full-size originals for every single photo. That's
// both the main source of the memory pressure above and enormously slow.
// Without the download we may not get a localUri for cloud-only assets,
// which is fine: the ph:// asset URI is still renderable.
const ASSET_INFO_OPTIONS = { shouldDownloadFromNetwork: false } as const;

// Runs an async mapper over items a few at a time, instead of all at once.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit);
    results.push(...(await Promise.all(slice.map(mapper))));
  }
  return results;
}

type PhotoEntry = {
  uri: string;
  creationTime: number;
  location?: { latitude: number; longitude: number } | null;
};

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
      await mapWithConcurrency(page.assets, INFO_CONCURRENCY, async (a) => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(a.id, ASSET_INFO_OPTIONS);
            const uri = info.localUri ?? a.uri;
            const already = existingMeta[uri];
            // Also needs an assetId now, so a photo labelled by an earlier
            // version still gets one recorded on this pass.
            if (already?.takenAt && already?.assetId) return;
            const source = detectPhotoSource({
              filename: info.filename ?? a.filename,
              mediaSubtypes: info.mediaSubtypes ?? a.mediaSubtypes,
              exif: info.exif,
            });
            const takenAt = info.creationTime ?? a.creationTime;
            const meta: PhotoMeta = { ...already, assetId: a.id };
            if (source) meta.source = source.key;
            if (takenAt) meta.takenAt = takenAt;
            entries.push([uri, meta]);
          } catch {
            // Skip what we can't resolve — never block the rest of the scan.
          }
      });

      // Flush each page rather than holding a whole library's worth of
      // entries until the end — if the process is killed mid-sync, the
      // pages already scanned stay saved instead of being lost.
      await setPhotoMetaBatch(entries.splice(0, entries.length));

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

  // Each page is scanned, filed onto its days, and marked done as a unit —
  // nothing is held across the whole library. That keeps peak memory flat
  // on a big sync, and means a sync that's interrupted keeps everything it
  // already committed and resumes from there rather than starting over.
  let importedCount = 0;
  const allDays = new Set<string>();
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
    const resolved = await mapWithConcurrency(fresh, INFO_CONCURRENCY, async (a) => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(a.id, ASSET_INFO_OPTIONS);
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
    });

    // One location per day, not per photo. This used to fire an
    // un-awaited recordLocationForDay() for EVERY photo with GPS, which on
    // a big sync meant hundreds of overlapping read-modify-write cycles
    // against the same storage key — a lost-update race that also piled up
    // unresolved promises. One awaited write per distinct day instead.
    const dayLocations = new Map<string, { latitude: number; longitude: number }>();
    const pageByDay = new Map<string, PhotoEntry[]>();
    const pageMeta: [string, PhotoMeta][] = [];

    for (const item of resolved) {
      const key = dateKey(new Date(item.creationTime));
      const bucket = pageByDay.get(key);
      if (bucket) bucket.push(item);
      else pageByDay.set(key, [item]);
      allDays.add(key);
      if (item.location && !dayLocations.has(key)) dayLocations.set(key, item.location);
      // Always record the capture time (drives the assumed-memory feature's
      // day sequencing) and the asset id (lets src/photoUri.ts fetch a real
      // file path later for photos whose original is still in iCloud); the
      // source label only when one was detected.
      const meta: PhotoMeta = { takenAt: item.creationTime, assetId: item.id };
      if (item.source) meta.source = item.source;
      pageMeta.push([item.uri, meta]);
    }

    for (const [key, loc] of dayLocations) {
      try {
        await recordLocationForDay(key, loc.latitude, loc.longitude);
      } catch {
        // A place we couldn't record is never worth failing the sync over.
      }
    }

    // Commit the page: meta first, then the day memories, and only then
    // mark these assets imported. That order matters — marking them first
    // would let an interrupted sync skip photos forever that never
    // actually made it onto a day.
    await setPhotoMetaBatch(pageMeta);
    importedCount += await fileDayPhotos(pageByDay);
    for (const item of resolved) importedIds.add(item.id);
    await saveImportedIds(importedIds);

    scanned += page.assets.length;
    onProgress?.({ scanned, imported: importedIds.size });

    if (!page.hasNextPage || page.assets.length === 0) break;
    after = page.endCursor;
  }

  return { imported: importedCount, days: allDays.size };
}

// Files one page's worth of photos onto their days — merging into that
// day's existing photo memory when there is one, creating it when there
// isn't. Kept separate from the scan loop so each page can be committed on
// its own.
async function fileDayPhotos(
  byDay: Map<string, PhotoEntry[]>,
): Promise<number> {
  if (byDay.size === 0) return 0;
  const existing = await getLoggedMemories();
  let count = 0;
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
    count += uris.length;
  }
  return count;
}
