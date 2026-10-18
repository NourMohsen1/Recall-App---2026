import AsyncStorage from '@react-native-async-storage/async-storage';
// SDK 56 made the redesigned ("next") media-library API the package's
// default entry. That one calls requireNativeModule() at import time and
// ships no web implementation, so merely importing it crashed the app on
// web. The classic API this file uses now lives on the /legacy subpath —
// same arrangement as expo-file-system/legacy elsewhere in the project —
// and it binds to the module that does have a web shim.
import * as MediaLibrary from 'expo-media-library/legacy';
import { dateKey, deleteMemory, getLoggedMemories, isManualLog, saveMemory, updateMemory } from './memoryLog';
import { logDayKey, logTakenAt } from './logicalDay';
import { PhotoMeta, getAllPhotoMeta, setPhotoMetaBatch } from './photoMeta';
import { detectPhotoSource } from './photoSource';
import { classifyAssets, photoGuardAvailable } from './photoGuard';
import { indexNewPhotos } from './faceIndexing';
import { startPlaceIndexing, toLocation } from './places';

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
  /** The Photos id: how a photo is recognised under another path. */
  id: string;
  uri: string;
  creationTime: number;
  location?: { latitude: number; longitude: number } | null;
};

export type ImportProgress = { scanned: number; imported: number };
export type ImportResult = { imported: number; days: number; privateSkipped: number };

async function getImportedIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(IMPORTED_IDS_KEY);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

async function saveImportedIds(ids: Set<string>) {
  await AsyncStorage.setItem(IMPORTED_IDS_KEY, JSON.stringify([...ids]));
}

// "Sync photos" on the import screen: once on, it stays on, and new photos
// are brought in quietly each time the app opens.
const SYNC_ON_KEY = 'photoSyncOn';
export const SYNC_DAYS = 365;

export async function getPhotoSync(): Promise<boolean> {
  return (await AsyncStorage.getItem(SYNC_ON_KEY)) === '1';
}

export async function setPhotoSync(on: boolean): Promise<void> {
  await AsyncStorage.setItem(SYNC_ON_KEY, on ? '1' : '0');
}

let quietSync: Promise<ImportResult | null> | null = null;

// Who is watching the quiet sync: the Home card shows its progress while
// the user's past comes in (src/components/ExplorePastCard.tsx).
const syncWatchers = new Set<(p: ImportProgress) => void>();
export function watchQuietSync(fn: (p: ImportProgress) => void): () => void {
  syncWatchers.add(fn);
  return () => syncWatchers.delete(fn);
}
export function quietSyncRunning(): boolean {
  return quietSync !== null;
}

/** Brings in photos taken since the last sync, when Sync photos is on.
 *  Silent: nothing on screen waits for it. */
export function syncNewPhotosIfOn(): Promise<ImportResult | null> {
  if (quietSync) return quietSync;
  quietSync = (async () => {
    if (!(await getPhotoSync())) return null;
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return null;
    const started = Date.now();
    const res = await importRecentPhotos(SYNC_DAYS, (p) => syncWatchers.forEach((fn) => fn(p)));
    if (res.imported > 0) {
      console.log(`[photos] synced ${res.imported} new photos across ${res.days} days in ${Math.round((Date.now() - started) / 1000)}s`);
    }
    return res;
  })()
    .catch((e) => {
      console.warn('[photos] background sync failed:', e);
      return null;
    })
    .finally(() => {
      quietSync = null;
    });
  return quietSync;
}

// Brings back photos removed by mistake. The first private-photo cutoff
// (0.35) removed ordinary photos, and hidden photos looked deleted; both
// were then remembered as "imported", so they could never come back.
// Forgetting which photos were imported — only for those no longer in
// Recall — lets the next import look at them again, under the fixed rules.
// Photos genuinely deleted from Photos are simply not found. Once only.
const RECOVERY_KEY = 'photoRecovery_v1';

export async function recoverWronglyRemovedPhotos(): Promise<void> {
  if (await AsyncStorage.getItem(RECOVERY_KEY)) return;
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return;
    const [ids, meta] = await Promise.all([getImportedIds(), getAllPhotoMeta()]);
    const present = new Set(Object.values(meta).map((m) => m.assetId).filter(Boolean) as string[]);
    const missing = [...ids].filter((id) => !present.has(id));
    for (const id of missing) ids.delete(id);
    await saveImportedIds(ids);
    console.log(`[photos] recovery: looking again at ${missing.length} photos no longer in Recall`);
    const res = await importRecentPhotos(SYNC_DAYS);
    console.log(`[photos] recovery: brought back ${res.imported} photos (${res.privateSkipped} still private)`);
    await AsyncStorage.setItem(RECOVERY_KEY, '1');
  } catch (e) {
    console.warn('[photos] recovery failed — tried again next launch:', e);
  }
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

/** Photos ids that are already in Recall under another id (found again
 *  on a restored phone, src/photoGuard.ts): never imported again. */
export async function markAssetsImported(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const known = await getImportedIds();
  for (const id of ids) known.add(id);
  await saveImportedIds(known);
}

// One import at a time, whoever starts it. Three callers used to start
// their own — the quiet sync, the one-time recovery pass and the Import
// Photos screen — and on a new install the first two ran together: both
// read the same "already imported" list (empty) and both filed every
// photo, so testers saw each photo two or three times on a day (Oct 2026).
// A second caller now joins the import already running.
let importing: Promise<ImportResult> | null = null;
const importWatchers = new Set<(p: ImportProgress) => void>();

export function importRecentPhotos(
  days: number,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  if (onProgress) importWatchers.add(onProgress);
  if (importing) {
    console.log('[photos] an import is already running; joining it');
    return importing.finally(() => onProgress && importWatchers.delete(onProgress));
  }
  importing = importRecentPhotosNow(days, (p) => importWatchers.forEach((fn) => fn(p))).finally(() => {
    importing = null;
    importWatchers.clear();
  });
  return importing;
}

async function importRecentPhotosNow(
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
  let privateSkipped = 0;
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
            infoRead: true,
          };
        } catch {
          const source = detectPhotoSource({ filename: a.filename, mediaSubtypes: a.mediaSubtypes });
          return {
            id: a.id,
            uri: a.uri,
            creationTime: a.creationTime,
            location: undefined,
            source: source?.key,
            infoRead: false,
          };
        }
    });

    const pageByDay = new Map<string, PhotoEntry[]>();
    const pageMeta: [string, PhotoMeta][] = [];

    // Private photos are checked for on the phone before anything is kept
    // (src/photoGuard.ts). A flagged photo is still marked as seen below, so
    // it is never looked at again, but nothing about it is stored.
    const classes = await classifyAssets(resolved.map((r) => r.id)).catch((e) => {
      console.warn('[privacy] could not check new photos — they are not imported this time:', e);
      return null;
    });
    if (classes === null) break;

    for (const item of resolved) {
      const privacy = classes.get(item.id);
      if (privacy === 'private') {
        privateSkipped += 1;
        continue;
      }
      // After midnight it is still the night before (src/logicalDay.ts),
      // so a night out stays on one day.
      const key = logDayKey(new Date(item.creationTime));
      const bucket = pageByDay.get(key);
      if (bucket) bucket.push(item);
      else pageByDay.set(key, [item]);
      allDays.add(key);
      // Always record the capture time (drives the assumed-memory feature's
      // day sequencing) and the asset id (lets src/photoUri.ts fetch a real
      // file path later for photos whose original is still in iCloud); the
      // source label only when one was detected.
      const meta: PhotoMeta = {
        takenAt: item.creationTime,
        assetId: item.id,
        privacyChecked: photoGuardAvailable,
        ...(privacy === 'sensitive' ? { sensitive: true } : {}),
      };
      if (item.source) meta.source = item.source;
      // Where it was taken, per photo. This used to keep ONE location per
      // day — the first photo with GPS — so a day at college, then a café,
      // then the gym could only ever show one place. Every photo's own spot
      // is kept now, on the device; src/places.ts turns them into places.
      // An asset whose info could not be read is left for the places sweep
      // to ask about again rather than marked as having no location.
      if (item.infoRead) {
        meta.locationRead = true;
        const where = toLocation(item.location);
        if (where) {
          meta.latitude = where.latitude;
          meta.longitude = where.longitude;
        }
      }
      pageMeta.push([item.uri, meta]);
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

  // File the new photos under their places and read them for faces, in the
  // background.
  if (importedCount > 0) {
    startPlaceIndexing();
    indexNewPhotos();
  }
  if (privateSkipped > 0) console.log(`[privacy] ${privateSkipped} private photos skipped during import`);
  return { imported: importedCount, days: allDays.size, privateSkipped };
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
  // A photo already on a day is never filed again, by its path or by its
  // Photos id — whatever ran before, or alongside.
  const meta = await getAllPhotoMeta();
  const haveUri = new Set<string>();
  const haveAsset = new Set<string>();
  for (const m of existing) {
    if (m.kind !== 'photo') continue;
    for (const u of m.photoUris ?? []) {
      haveUri.add(u);
      const id = meta[u]?.assetId;
      if (id) haveAsset.add(id);
    }
  }
  let count = 0;
  for (const [key, all] of byDay) {
    const items = all.filter((i) => {
      if (haveUri.has(i.uri) || haveAsset.has(i.id)) return false;
      haveUri.add(i.uri);
      haveAsset.add(i.id);
      return true;
    });
    if (items.length === 0) continue;
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
        takenAt: logTakenAt(new Date(earliest.creationTime)),
      });
    }
    count += uris.length;
  }
  return count;
}


// Takes out the copies the overlapping imports made (above), once per
// install. Only photos Recall imported by itself: a photo the user added by
// hand is their own copy and is never touched. A photo counts as a copy
// when the same path, or the same Photos id under another path, is already
// on a day; the first one stays. Logged with what it removed.
// (Nour, Oct 2026: the tester's library had ONE copy of each photo; the
// copies were Recall's own, made by the overlapping imports above.)
// v2: v1 (one update earlier) could leave the second of two photo
// memories for a day empty; this one deletes those too.
const DEDUPE_KEY = 'photoDuplicatesRemoved:v2';

export async function removeDuplicatePhotos(): Promise<void> {
  if (await AsyncStorage.getItem(DEDUPE_KEY)) return;
  try {
    const [memories, meta] = await Promise.all([getLoggedMemories(), getAllPhotoMeta()]);
    const seenUri = new Set<string>();
    const seenAsset = new Set<string>();
    // A second copy under another path is a photo of its own as far as the
    // app knows (its details, faces, place): it leaves everywhere, with
    // all of that (removePhotos). The same path twice on a day is one photo
    // listed twice: only the extra listing goes.
    const otherPath = new Set<string>();
    let listedTwice = 0;
    let days = 0;
    // Hand-added photos first, so they always win over an imported copy.
    const ordered = [...memories].sort((a, b) => Number(!isManualLog(a)) - Number(!isManualLog(b)));
    for (const m of ordered) {
      if (m.kind !== 'photo') continue;
      const uris = m.photoUris ?? [];
      const manual = isManualLog(m);
      // Emptied by v1: an imported photo memory with no photos is nothing.
      if (!manual && uris.length === 0) {
        days += 1;
        await deleteMemory(m.id);
        continue;
      }
      const keep: string[] = [];
      for (const u of uris) {
        const id = meta[u]?.assetId;
        if (!manual && seenUri.has(u)) {
          listedTwice += 1;
          continue;
        }
        if (!manual && id && seenAsset.has(id)) {
          otherPath.add(u);
          keep.push(u);
          continue;
        }
        seenUri.add(u);
        if (id) seenAsset.add(id);
        keep.push(u);
      }
      if (keep.length !== uris.length) {
        days += 1;
        // Two imports at once each made their own photo memory for a day
        // with none: the second, emptied, goes rather than showing as an
        // empty "Photos" row.
        if (keep.length === 0) await deleteMemory(m.id);
        else await updateMemory(m.id, { photoUris: keep });
      }
    }
    if (otherPath.size) {
      const { removePhotos } = await import('./photoGuard');
      await removePhotos([...otherPath], 'duplicate');
    }
    await AsyncStorage.setItem(DEDUPE_KEY, new Date().toISOString());
    console.log(`[photos] duplicates: ${listedTwice} listed twice on ${days} days, ${otherPath.size} second copies`);
  } catch (e) {
    console.warn('[photos] could not remove duplicates, trying again next launch:', e);
  }
}
