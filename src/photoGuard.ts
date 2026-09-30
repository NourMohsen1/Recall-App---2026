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

/** Two cutoffs, MEASURED on Nour's library — not the model card's.
 *
 *  0.35 was the first cutoff and it was wrong for real life: on his phone
 *  it removed 26 ordinary photos, scoring 0.35–0.84, that then vanished from
 *  the app. Clearly explicit photos score near 1. So:
 *
 *   · ≥ 0.9  PRIVATE — never enters Recall.
 *   · ≥ 0.6  SENSITIVE — kept and shown like any photo, but never sent to
 *            an AI service. A borderline photo stays on the phone either
 *            way, and nothing is lost to a wrong guess.
 */
export const PRIVATE_THRESHOLD = 0.9;
export const SENSITIVE_THRESHOLD = 0.6;

export type PhotoClass = 'private' | 'sensitive' | 'ok';

function classify(score: number, apple: boolean): PhotoClass {
  if (apple || score >= PRIVATE_THRESHOLD) return 'private';
  if (score >= SENSITIVE_THRESHOLD) return 'sensitive';
  return 'ok';
}

export { photoGuardAvailable };

const isLibraryPhoto = (uri: string) => uri.startsWith('ph://') || isLibraryPath(uri);

/** Each library photo (by Photos id) that is not plainly fine, with its
 *  class. Photos not in the map are 'ok'. */
export async function classifyAssets(ids: string[]): Promise<Map<string, Exclude<PhotoClass, 'ok'>>> {
  const out = new Map<string, Exclude<PhotoClass, 'ok'>>();
  if (!photoGuardAvailable || ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 20) {
    for (const r of await checkAssets(ids.slice(i, i + 20))) {
      const c = classify(r.score ?? 0, !!r.apple);
      if (c === 'ok') continue;
      out.set(r.id, c);
      // Scores only, never the photo — so the cutoffs can be tuned.
      console.log(`[privacy] ${c} ${r.id.slice(0, 8)}… score ${(r.score ?? 0).toFixed(3)}${r.apple ? ' (Apple)' : ''}`);
    }
  }
  return out;
}

/** Of these library photos, the ones that must never enter Recall. */
export async function privateAssetIds(ids: string[]): Promise<Set<string>> {
  const classes = await classifyAssets(ids);
  return new Set([...classes].filter(([, c]) => c === 'private').map(([id]) => id));
}

/** A file the user picked by hand. 'ok' when it can't be checked on this
 *  build (logged). */
export async function classifyFile(uri: string): Promise<PhotoClass> {
  if (!photoGuardAvailable) {
    console.warn('[privacy] this build cannot check photos yet');
    return 'ok';
  }
  try {
    const r = await checkFile(localFile(uri));
    return classify(r.score, r.apple);
  } catch (e) {
    console.warn('[privacy] could not check a picked photo:', e);
    return 'ok';
  }
}

export async function isPrivateFile(uri: string): Promise<boolean> {
  return (await classifyFile(uri)) === 'private';
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
    for (let i = 0; i < unchecked.length; i += 40) {
      const page = unchecked.slice(i, i + 40);
      const classes = await classifyAssets(page.map(([, m]) => m.assetId!));
      const done: [string, { privacyChecked: true; sensitive?: boolean }][] = [];
      for (const [uri, m] of page) {
        const c = classes.get(m.assetId!);
        if (c === 'private') privateUris.push(uri);
        else done.push([uri, c === 'sensitive' ? { privacyChecked: true, sensitive: true } : { privacyChecked: true }]);
      }
      await setPhotoMetaBatch(done);
    }
    for (const uri of ownFiles) {
      const c = await classifyFile(uri);
      if (c === 'private') privateUris.push(uri);
      else await setPhotoMetaBatch([[uri, c === 'sensitive' ? { privacyChecked: true, sensitive: true } : { privacyChecked: true }]]);
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

/** The day-story path's last check: only photos known to be fine go out —
 *  never a private one, never a borderline one. */
export async function onlyCheckedPhotos<T extends { uri: string }>(photos: T[]): Promise<T[]> {
  if (!photoGuardAvailable) return photos;
  const meta = await getAllPhotoMeta();
  photos = photos.filter((p) => !meta[p.uri]?.sensitive);
  const unchecked = photos.filter((p) => !meta[p.uri]?.privacyChecked);
  if (unchecked.length === 0) return photos;
  const flagged = new Set<string>();
  const sensitive = new Set<string>();
  const byAsset = unchecked.filter((p) => meta[p.uri]?.assetId);
  const classes = await classifyAssets(byAsset.map((p) => meta[p.uri]!.assetId!));
  for (const p of byAsset) {
    const c = classes.get(meta[p.uri]!.assetId!);
    if (c === 'private') flagged.add(p.uri);
    if (c === 'sensitive') sensitive.add(p.uri);
  }
  for (const p of unchecked) {
    if (meta[p.uri]?.assetId) continue;
    const c = await classifyFile(p.uri);
    if (c === 'private') flagged.add(p.uri);
    if (c === 'sensitive') sensitive.add(p.uri);
  }
  await setPhotoMetaBatch(
    unchecked
      .filter((p) => !flagged.has(p.uri))
      .map((p) => [p.uri, sensitive.has(p.uri) ? { privacyChecked: true, sensitive: true } : { privacyChecked: true }]),
  );
  if (flagged.size > 0) await removePhotos([...flagged], 'private');
  return photos.filter((p) => !flagged.has(p.uri) && !sensitive.has(p.uri));
}
