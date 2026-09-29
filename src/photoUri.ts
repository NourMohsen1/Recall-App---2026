import * as MediaLibrary from 'expo-media-library/legacy';
import { localFile } from './memoryLog';
import { assetIdForUri } from './photoMeta';

// Turns a stored photo URI into something that can be shown or read.
//
// WHY THIS EXISTS. A photo imported from the library is stored under the
// path the OS handed over at import time — `file:///var/mobile/Media/DCIM/…`
// — or, for a photo whose original is in iCloud, as `ph://…`. Neither is a
// file the app owns:
//
//   · A DCIM path is only readable while the app process that was given it
//     is alive. iOS lends access for the session. After the app is closed
//     and reopened every such path reads as nothing, and every imported photo
//     went blank until an import asked the library again. The simulator does
//     not enforce this, which is why it was never seen there.
//   · A `ph://` reference is not a file at all.
//
// So a library photo is never shown from its path. It is shown through the
// Photos library itself by its asset id (`ph://<id>`, which expo-image loads
// directly and which never expires), and when its pixels are needed — face
// reading, photo analysis — a fresh path is asked for in THIS session.

// Schemes that are OS asset references rather than readable files.
const ASSET_SCHEMES = ['ph://', 'assets-library://', 'content://'];

/** A path into the Photos library rather than into the app's own files. */
export function isLibraryPath(uri: string): boolean {
  return uri.startsWith('file://') && (uri.includes('/Media/DCIM/') || uri.includes('/Media/PhotoData/'));
}

export function needsResolving(uri: string): boolean {
  return ASSET_SCHEMES.some((scheme) => uri.startsWith(scheme)) || isLibraryPath(uri);
}

let saidByIdOnce = false;

/** What to hand an image view: the library reference for library photos,
 *  the repaired path for the app's own files. */
export async function displayUriFor(uri: string): Promise<string | null> {
  if (uri.startsWith('ph://')) return uri;
  if (!needsResolving(uri)) return localFile(uri) || null;
  const assetId = await assetIdForUri(uri);
  if (assetId) {
    if (!saidByIdOnce) {
      saidByIdOnce = true;
      console.log(`[photos] showing library photos by their Photos id (e.g. ph://${assetId.slice(0, 8)}…)`);
    }
    return `ph://${assetId}`;
  }
  console.warn('[photos] a library photo has no asset id — shown from its path, which may not last');
  // A library path with no asset id recorded: nothing durable to go on.
  return uri;
}

// Readable paths, for this app session only — never stored, because a
// stored one is exactly what stopped working after a restart.
const sessionPaths = new Map<string, Promise<string | null>>();

/** A file that can be read right now, for code that needs the pixels. */
export async function resolvePhotoUri(uri: string): Promise<string | null> {
  // Repair first. A path saved by a previous install points into a
  // container that no longer exists; see localFile.
  const repaired = localFile(uri) || uri;
  if (!repaired || !needsResolving(repaired)) return repaired || null;

  const existing = sessionPaths.get(repaired);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    const assetId = await assetIdForUri(repaired);
    if (!assetId) return isLibraryPath(repaired) ? repaired : null;
    try {
      // Download allowed here, unlike the bulk sync — this is one photo
      // that is actually needed right now. Asking the library for it is
      // also what grants read access to its path for this session.
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      return info.localUri ?? null;
    } catch (e) {
      console.warn('[photos] could not get a readable copy of a photo:', e);
      return null;
    }
  })();

  sessionPaths.set(repaired, task);
  // A failure is not remembered: the next ask may succeed (network back).
  task.then((r) => {
    if (!r) sessionPaths.delete(repaired);
  });
  return task;
}
