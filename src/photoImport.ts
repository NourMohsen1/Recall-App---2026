import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { dateKey, getLoggedMemories, saveMemory, updateMemory } from './memoryLog';
import { recordLocationForDay } from './placesFromPhotos';

// Bulk-imports photos from the device's library into the Timeline, grouped
// onto the day they were actually taken. Bounded by a date window (the user
// picks Last 10/20/30 days) so this is always a small, fast, native-filtered
// query — never a full-library scan — and already-imported photos are
// tracked so re-running later only picks up what's new.

const IMPORTED_IDS_KEY = 'importedPhotoAssetIds';
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
          return {
            id: a.id,
            uri: info.localUri ?? a.uri,
            creationTime: a.creationTime,
            location: info.location,
          };
        } catch {
          return { id: a.id, uri: a.uri, creationTime: a.creationTime, location: undefined };
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
    }

    scanned += page.assets.length;
    onProgress?.({ scanned, imported: importedIds.size });

    if (!page.hasNextPage || page.assets.length === 0) break;
    after = page.endCursor;
  }

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
