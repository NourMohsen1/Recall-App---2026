import AsyncStorage from '@react-native-async-storage/async-storage';
import { AnySourceKey } from './photoSource';

// What Recall knows about one imported/logged photo file, keyed by the
// photo's URI so it stays attached to that exact file regardless of which
// LoggedMemory it ends up grouped under.
// `source` may come from auto-detection or from the user tagging it by
// hand; `customLabel` only applies when source is 'other' — a free-text
// name for an app not in the known list.
// `takenAt` is the photo's own capture time (epoch ms, from EXIF/asset
// metadata) — finer-grained than a memory's day-level `takenAt`, so the
// assumed-memory feature can sequence a day's photos chronologically.
export type PhotoMeta = {
  source?: AnySourceKey | 'other';
  customLabel?: string;
  takenAt?: number;
  // The OS asset id this photo came from, when it was imported from the
  // library. Kept because a photo whose original lives in iCloud has no
  // usable file path until it's actually fetched — the id is what lets
  // src/photoUri.ts resolve one on demand, for just the photo being
  // looked at. See the note there.
  assetId?: string;
  // A file path resolved from assetId, cached once so the same photo isn't
  // re-fetched every time it's shown.
  localUri?: string;
};

const PHOTO_META_KEY = 'photoMeta';

async function readAll(): Promise<Record<string, PhotoMeta>> {
  const raw = await AsyncStorage.getItem(PHOTO_META_KEY);
  return raw ? (JSON.parse(raw) as Record<string, PhotoMeta>) : {};
}

export async function getAllPhotoMeta(): Promise<Record<string, PhotoMeta>> {
  return readAll();
}

export async function getPhotoMeta(uri: string): Promise<PhotoMeta | null> {
  const all = await readAll();
  return all[uri] ?? null;
}

// Sets (merges into) one photo's meta — used by the manual "tag this photo"
// picker in the viewer. Merges rather than overwrites so, e.g., tagging a
// photo's source by hand never wipes out its already-recorded takenAt.
export async function setPhotoMeta(uri: string, meta: Partial<PhotoMeta>): Promise<void> {
  const all = await readAll();
  all[uri] = { ...all[uri], ...meta } as PhotoMeta;
  await AsyncStorage.setItem(PHOTO_META_KEY, JSON.stringify(all));
}

// Removes a label entirely — "this is just a normal photo, not saved from
// anywhere." No entry means no pill, same as never having been detected.
export async function clearPhotoMeta(uri: string): Promise<void> {
  const all = await readAll();
  if (!(uri in all)) return;
  delete all[uri];
  await AsyncStorage.setItem(PHOTO_META_KEY, JSON.stringify(all));
}

// Records meta for a batch of photos at once — used right after import/log
// so every new URI's provenance/timestamp is saved in a single write. Merges
// per-photo, same as setPhotoMeta.
export async function setPhotoMetaBatch(entries: [string, Partial<PhotoMeta>][]): Promise<void> {
  if (entries.length === 0) return;
  const all = await readAll();
  for (const [uri, meta] of entries) all[uri] = { ...all[uri], ...meta } as PhotoMeta;
  await AsyncStorage.setItem(PHOTO_META_KEY, JSON.stringify(all));
}

// Every known photo timestamp in one read — used by the bulk analysis pass,
// which would otherwise re-read this whole blob once per day (hundreds of
// full reads for a year of photos).
export async function getAllPhotoTimestamps(): Promise<Record<string, number>> {
  const all = await readAll();
  const out: Record<string, number> = {};
  for (const [uri, meta] of Object.entries(all)) {
    if (meta?.takenAt) out[uri] = meta.takenAt;
  }
  return out;
}

// Every known photo SOURCE label in one read (screenshot / saved-from-app).
// The analysis needs these to tell apart 'a photo you took that day' from
// 'an image you saved that day', which are very different evidence about
// what actually happened.
export async function getAllPhotoSources(): Promise<Record<string, string>> {
  const all = await readAll();
  const out: Record<string, string> = {};
  for (const [uri, meta] of Object.entries(all)) {
    const label = meta?.source === 'other' ? (meta.customLabel || 'other app') : meta?.source;
    if (label) out[uri] = label;
  }
  return out;
}

// Timestamps for a set of URIs, when known — the primary lookup the
// assumed-memory feature uses to sequence a day's photos chronologically.
export async function getPhotoTimestamps(uris: string[]): Promise<Record<string, number>> {
  const all = await readAll();
  const out: Record<string, number> = {};
  for (const uri of uris) {
    const t = all[uri]?.takenAt;
    if (t) out[uri] = t;
  }
  return out;
}
