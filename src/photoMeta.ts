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
  // No longer written or read: a path resolved from assetId is only valid
  // for the app session that asked for it (see src/photoUri.ts). Old
  // entries may still carry one; it is ignored.
  localUri?: string;
  // Where the photo was taken, from its own GPS. Stays on the device: this
  // is what Places are built from (see src/places.ts).
  latitude?: number;
  longitude?: number;
  // True once the photo's location has been looked for — including when it
  // had none — so the background sweep never asks the OS about it again.
  locationRead?: boolean;
  // The place this photo was taken at, once places.ts has filed it.
  placeId?: string;
  // The photo's cross-device id (PHCloudIdentifier). assetId is per device
  // and changes on a restored or new phone; this is how the photo is found
  // again there. See src/photoGuard.ts.
  cloudId?: string;
  // Checked on the phone for nudity (src/photoGuard.ts) and found fine.
  privacyChecked?: boolean;
  // The place the user NAMED in the log these photos came with ("coffee at
  // Dunkin" + a photo). The strongest evidence there is of what a spot is
  // called, because the user said it about these exact pictures.
  saidPlaceId?: string;
};

const PHOTO_META_KEY = 'photoMeta';

// Parsed once and kept. Every read and write of this store goes through
// this file, so the copy in memory is always what storage holds — and a
// library of 20,000 photos (about 6 MB here) is not re-read from disk and
// re-parsed on every call, which several background passes make hundreds
// of times. Callers get the live object: change it only on the way to
// writing it back, as every caller does.
let cache: Record<string, PhotoMeta> | null = null;
let loading: Promise<Record<string, PhotoMeta>> | null = null;

async function readAll(): Promise<Record<string, PhotoMeta>> {
  if (cache) return cache;
  if (!loading) {
    loading = AsyncStorage.getItem(PHOTO_META_KEY)
      .then((raw) => {
        cache = raw ? (JSON.parse(raw) as Record<string, PhotoMeta>) : {};
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

async function writeAll(all: Record<string, PhotoMeta>): Promise<void> {
  cache = all;
  await AsyncStorage.setItem(PHOTO_META_KEY, JSON.stringify(all));
}

// Photo → library asset id, kept in memory. Every photo on screen asks for
// its id (see src/photoUri.ts), and reading this whole store once per photo
// would be hundreds of reads for one scroll of the Timeline.
let assetIndex: Promise<Map<string, string>> | null = null;

function loadAssetIndex(): Promise<Map<string, string>> {
  if (!assetIndex) {
    assetIndex = readAll().then(
      (all) => new Map(Object.entries(all).flatMap(([uri, m]) => (m.assetId ? [[uri, m.assetId] as const] : []))),
    );
    assetIndex.catch(() => {
      assetIndex = null;
    });
  }
  return assetIndex;
}

function noteAssetIds(entries: [string, Partial<PhotoMeta>][]) {
  if (!assetIndex) return;
  assetIndex.then((index) => {
    for (const [uri, m] of entries) if (m.assetId) index.set(uri, m.assetId);
  });
}

/** The library asset a stored photo came from, when it came from one. */
export async function assetIdForUri(uri: string): Promise<string | undefined> {
  if (uri.startsWith('ph://')) return uri.slice('ph://'.length);
  return (await loadAssetIndex()).get(uri);
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
  await writeAll(all);
  noteAssetIds([[uri, meta]]);
}

// Removes a label entirely — "this is just a normal photo, not saved from
// anywhere." No entry means no pill, same as never having been detected.
export async function clearPhotoMeta(uri: string): Promise<void> {
  const all = await readAll();
  if (!(uri in all)) return;
  delete all[uri];
  await writeAll(all);
}

/** Forgets these photos entirely. */
export async function removePhotoMeta(uris: Set<string>): Promise<void> {
  const all = await readAll();
  let changed = false;
  for (const uri of uris) {
    if (uri in all) {
      delete all[uri];
      changed = true;
    }
  }
  if (!changed) return;
  await writeAll(all);
  assetIndex = null;
}

// Records meta for a batch of photos at once — used right after import/log
// so every new URI's provenance/timestamp is saved in a single write. Merges
// per-photo, same as setPhotoMeta.
export async function setPhotoMetaBatch(entries: [string, Partial<PhotoMeta>][]): Promise<void> {
  if (entries.length === 0) return;
  const all = await readAll();
  for (const [uri, meta] of entries) all[uri] = { ...all[uri], ...meta } as PhotoMeta;
  await writeAll(all);
  noteAssetIds(entries);
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
