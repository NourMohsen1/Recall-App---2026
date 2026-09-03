import * as MediaLibrary from 'expo-media-library/legacy';
import { getPhotoMeta, setPhotoMeta } from './photoMeta';

// Turns a stored photo URI into one that can actually be rendered or
// manipulated.
//
// Why this exists: the bulk photo sync deliberately does NOT download
// iCloud originals (doing so for a whole library is what got the app killed
// mid-sync — see photoImport.ts). For photos whose original lives in the
// cloud that means the OS gives us no file path at import time, only its
// own asset URI (`ph://…` on iOS). That URI is not a file: React Native's
// <Image> won't render it, and expo-image-manipulator can't read it, which
// is why older days — the ones most likely to be offloaded — failed while
// recent days worked.
//
// So the download is deferred to the moment a specific photo is actually
// needed, and paid for one photo at a time instead of a library at a time.
// The resolved path is cached in photoMeta so it only happens once.

// Schemes that are OS asset references rather than readable files.
const ASSET_SCHEMES = ['ph://', 'assets-library://', 'content://'];

export function needsResolving(uri: string): boolean {
  return ASSET_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

// In-flight resolutions, so a day showing the same photo in several places
// at once only fetches it once.
const inFlight = new Map<string, Promise<string | null>>();

export async function resolvePhotoUri(uri: string): Promise<string | null> {
  // Already a readable file (or a data URI) — nothing to do. This is the
  // common case: anything still stored on the device resolved at sync time.
  if (!uri || !needsResolving(uri)) return uri || null;

  const existing = inFlight.get(uri);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    try {
      const meta = await getPhotoMeta(uri);
      if (meta?.localUri) return meta.localUri;

      const assetId = meta?.assetId;
      if (!assetId) return null;

      // Download allowed here, unlike the bulk sync — this is one photo the
      // user is looking at right now.
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      const resolved = info.localUri ?? null;
      if (resolved) await setPhotoMeta(uri, { localUri: resolved });
      return resolved;
    } catch {
      return null;
    } finally {
      inFlight.delete(uri);
    }
  })();

  inFlight.set(uri, task);
  return task;
}
