import * as FileSystem from 'expo-file-system/legacy';
import {
  checkAssets,
  checkFile,
  cloudIds,
  existingAssets,
  libraryAccess,
  localIdsForCloudIds,
  photoGuardAvailable,
} from '../modules/photo-guard';
import { noticePeople } from './facePeople';
import { forgetPhotos } from './faceIndex';
import { dropGuessesFromPhotos } from './guessedPeople';
import { localFile, removePhotosFromMemories } from './memoryLog';
import { getAllPhotoMeta, removePhotoMeta, setPhotoMetaBatch } from './photoMeta';
import { getPhotoReading } from './photoReading';
import { isLibraryPath } from './photoUri';
import { forgetPlaceCovers } from './places';

// Two rules about photos, both enforced on the phone:
//
// 1. PRIVATE PHOTOS NEVER ENTER RECALL. Every photo is checked for nudity on
//    the device (modules/photo-guard) before it is saved. A private photo is
//    not stored, not shown, not read for faces or places, and never sent to
//    an AI service. Photos imported before this existed are checked once and
//    removed if private. The day-story path checks again before sending.
//
// 2. A PHOTO DELETED FROM PHOTOS LEAVES RECALL — the photos Recall imported
//    on its own. What the user added by hand (Add Photos, a place's cover, a
//    screenshot they attached) is a copy the app owns and stays: they chose
//    to keep it here.
//
// Removing a photo takes everything that came from it: its place on the
// day, the day's photo memory if nothing else is left, its faces and any
// guess made from them, a place cover, and the day's story (rewritten
// without it when the user's choice allows).

/** How sure the model must be that a photo is private. Strict on purpose:
 *  at 0.35 the model's own tests catch ~98.5% of private photos, at the
 *  cost of skipping ~2.5% of ordinary ones. A beach photo left out is a
 *  small loss; a private photo let in is not acceptable. */
export const PRIVATE_THRESHOLD = 0.35;

export { photoGuardAvailable };

const isLibraryPhoto = (uri: string) => uri.startsWith('ph://') || isLibraryPath(uri);

/** Of these library photos (by Photos id), the ones that are private. */
export async function privateAssetIds(ids: string[]): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (!photoGuardAvailable || ids.length === 0) return flagged;
  for (let i = 0; i < ids.length; i += 20) {
    for (const r of await checkAssets(ids.slice(i, i + 20))) {
      if (r.apple || (r.score ?? 0) >= PRIVATE_THRESHOLD) {
        flagged.add(r.id);
        // Scores only, never the photo — so the cutoff can be tuned.
        console.log(`[privacy] flagged ${r.id.slice(0, 8)}… score ${(r.score ?? 0).toFixed(3)}${r.apple ? ' (Apple)' : ''}`);
      }
    }
  }
  return flagged;
}

/** Is a file the user picked by hand private? False when it can't be
 *  checked on this build (logged) — see the note on photoGuardAvailable. */
export async function isPrivateFile(uri: string): Promise<boolean> {
  if (!photoGuardAvailable) {
    console.warn('[privacy] this build cannot check photos yet');
    return false;
  }
  try {
    const r = await checkFile(localFile(uri));
    return r.apple || r.score >= PRIVATE_THRESHOLD;
  } catch (e) {
    console.warn('[privacy] could not check a picked photo:', e);
    return false;
  }
}

/** Takes photos out of Recall with everything that came from them. */
export async function removePhotos(uris: string[], why: 'deleted' | 'private'): Promise<void> {
  if (uris.length === 0) return;
  const set = new Set(uris);
  const days = await removePhotosFromMemories(set);
  await removePhotoMeta(set);
  await forgetPhotos(uris);
  const guesses = await dropGuessesFromPhotos(set);
  await forgetPlaceCovers(set);
  // Loaded here rather than at the top: the story code imports this file
  // for its own last check, and a two-way import at load time is a cycle.
  const { forgetAssumedMemory } = await import('./assumedMemory');
  for (const day of days) await forgetAssumedMemory(day);
  // Files the app owns (a private photo picked by hand) are deleted too.
  for (const uri of uris) {
    if (!isLibraryPhoto(uri)) await FileSystem.deleteAsync(localFile(uri), { idempotent: true }).catch(() => {});
  }
  console.log(
    `[privacy] removed ${uris.length} ${why === 'deleted' ? 'photos deleted from Photos' : 'private photos'}` +
      ` from ${days.length} days (${guesses} face guesses with them)`,
  );
  // Guesses come back from the day's other photos, if there are any.
  noticePeople().catch((e) => console.warn('[faces] re-matching after removal failed:', e));
  if (days.length > 0 && (await getPhotoReading()) === 'all') {
    (await import('./photoAnalysisQueue')).runPhotoAnalysisNow();
  }
}

let syncing = false;

/** Called when the app opens or comes back: removes photos deleted from
 *  Photos, and checks any photo not yet checked for privacy. */
export async function syncPhotosWithLibrary(): Promise<void> {
  if (syncing || !photoGuardAvailable) return;
  syncing = true;
  try {
    const meta = await getAllPhotoMeta();
    const library = Object.entries(meta).filter(([uri, m]) => isLibraryPhoto(uri) && m.assetId);

    // 1 — Deleted from Photos (or in Recently Deleted).
    //
    // Two things look exactly like "deleted" and are not, and either would
    // wipe the user's photos if believed: limited photo access (most of the
    // library is hidden), and a restored or new phone (the same photos with
    // new ids). So: nothing is removed without full access; missing photos
    // are first looked for by their cross-device id; and a sudden large
    // loss is never acted on.
    // Photos visible right now. Stays empty without full access, so nothing
    // hidden is judged — neither deleted nor checked for privacy.
    let still = new Set<string>();
    if (libraryAccess() !== 'full') {
      console.log('[photos] photo access is not full — not checking for deleted photos');
    } else {
      still = new Set(await existingAssets(library.map(([, m]) => m.assetId!)));
      let missing = library.filter(([, m]) => !still.has(m.assetId!));

      // Found again under a new id? (restored or new phone)
      const withCloud = missing.filter(([, m]) => m.cloudId);
      if (withCloud.length > 0) {
        const found = await localIdsForCloudIds(withCloud.map(([, m]) => m.cloudId!));
        const moved: [string, { assetId: string }][] = [];
        for (const [uri, m] of withCloud) {
          const local = found[m.cloudId!];
          if (local) {
            moved.push([uri, { assetId: local }]);
            still.add(local);
            m.assetId = local;
          }
        }
        if (moved.length > 0) {
          await setPhotoMetaBatch(moved);
          console.log(`[photos] found ${moved.length} photos again under new ids`);
        }
        missing = missing.filter(([, m]) => !still.has(m.assetId!));
      }

      const gone = missing.map(([uri]) => uri);
      const tooMany = gone.length > 25 && gone.length > library.length * 0.2;
      if (tooMany) {
        console.warn(
          `[photos] ${gone.length} of ${library.length} photos look deleted at once — not removing anything, ` +
            'this is far more likely a restored phone or a library problem than a real deletion',
        );
      } else if (gone.length > 0) {
        await removePhotos(gone, 'deleted');
      }

      // Remember the cross-device id of photos that don't have one yet.
      const needCloud = library.filter(([, m]) => !m.cloudId && still.has(m.assetId!));
      for (let i = 0; i < needCloud.length; i += 200) {
        const page = needCloud.slice(i, i + 200);
        const map = await cloudIds(page.map(([, m]) => m.assetId!));
        await setPhotoMetaBatch(
          page.filter(([, m]) => map[m.assetId!]).map(([uri, m]) => [uri, { cloudId: map[m.assetId!] }]),
        );
      }
    }


    // 2 — Never checked for privacy: photos from before this existed.
    const unchecked = library.filter(([uri, m]) => !m.privacyChecked && still.has(m.assetId!));
    const ownFiles = Object.entries(meta)
      .filter(([uri, m]) => !isLibraryPhoto(uri) && !m.privacyChecked)
      .map(([uri]) => uri);
    if (unchecked.length === 0 && ownFiles.length === 0) return;

    const started = Date.now();
    const privateUris: string[] = [];
    const safe: string[] = [];
    for (let i = 0; i < unchecked.length; i += 40) {
      const page = unchecked.slice(i, i + 40);
      const flagged = await privateAssetIds(page.map(([, m]) => m.assetId!));
      for (const [uri, m] of page) (flagged.has(m.assetId!) ? privateUris : safe).push(uri);
      await setPhotoMetaBatch(safe.splice(0).map((u) => [u, { privacyChecked: true }]));
    }
    for (const uri of ownFiles) {
      if (await isPrivateFile(uri)) privateUris.push(uri);
      else await setPhotoMetaBatch([[uri, { privacyChecked: true }]]);
    }
    console.log(
      `[privacy] checked ${unchecked.length + ownFiles.length} photos in ${Math.round((Date.now() - started) / 1000)}s,` +
        ` ${privateUris.length} private`,
    );
    if (privateUris.length > 0) await removePhotos(privateUris, 'private');
  } catch (e) {
    console.warn('[privacy] photo sync failed:', e);
  } finally {
    syncing = false;
  }
}

/** The day-story path's last check: only photos known to be fine go out. */
export async function onlyCheckedPhotos<T extends { uri: string }>(photos: T[]): Promise<T[]> {
  if (!photoGuardAvailable) return photos;
  const meta = await getAllPhotoMeta();
  const unchecked = photos.filter((p) => !meta[p.uri]?.privacyChecked);
  if (unchecked.length === 0) return photos;
  const flagged = new Set<string>();
  const byAsset = unchecked.filter((p) => meta[p.uri]?.assetId);
  const privateIds = await privateAssetIds(byAsset.map((p) => meta[p.uri]!.assetId!));
  for (const p of byAsset) if (privateIds.has(meta[p.uri]!.assetId!)) flagged.add(p.uri);
  for (const p of unchecked) if (!meta[p.uri]?.assetId && (await isPrivateFile(p.uri))) flagged.add(p.uri);
  await setPhotoMetaBatch(
    unchecked.filter((p) => !flagged.has(p.uri)).map((p) => [p.uri, { privacyChecked: true }]),
  );
  if (flagged.size > 0) await removePhotos([...flagged], 'private');
  return photos.filter((p) => !flagged.has(p.uri));
}
