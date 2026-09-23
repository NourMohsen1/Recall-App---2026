import * as SQLite from 'expo-sqlite';
import { dateKey, getLoggedMemories } from './memoryLog';
import { getAllPhotoSources, getAllPhotoTimestamps } from './photoMeta';

// Every face the app has ever seen, as numbers.
//
// THE WHOLE IDEA, because it is the opposite of what came before: a face is
// turned into a list of 192 numbers — a fingerprint of that face's geometry —
// and two faces are compared by measuring the distance between their
// fingerprints. Nothing is described, nothing is reasoned about, nothing is
// sent anywhere. It is arithmetic.
//
// That is why this scales and the previous attempt could not. Reading a photo
// happens ONCE, ever, and produces a row here. Finding someone afterwards is
// a sweep over rows of numbers: no network, no cost, no slower at ten
// thousand photos than at ten. The old design re-read photos on every search
// and uploaded each one to do it, so it got worse the more the user had.
//
// SQLite rather than AsyncStorage because this is the one part of Recall with
// a real row count. Ten thousand faces is ten thousand rows to scan, and
// AsyncStorage's answer to that is to parse a single enormous JSON blob.

const DB_NAME = 'recall-faces.db';

// Fingerprints are stored as base64 of the raw Float32 bytes, not as JSON.
//
// A 192-number vector is 768 bytes raw and about 1KB in base64. The same
// vector written as a JSON array of decimals is nearer 4KB, and at ten
// thousand faces that difference is 40MB against 10MB — in a database that
// gets read into memory for every search.
function packEmbedding(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return globalThis.btoa(s);
}

function unpackEmbedding(packed: string): Float32Array {
  const s = globalThis.atob(packed);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

// Vectors go in with a length of 1, so comparing two of them is a dot product
// rather than a dot product plus two square roots. At ten thousand rows per
// search that is the difference between instant and noticeable.
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const len = Math.sqrt(sum);
  if (len === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / len;
  return out;
}

export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// Where a face sits in its photo, as fractions of the frame — kept so the
// app can show the user the face it means rather than the whole picture.
export type FaceBox = { x: number; y: number; w: number; h: number };

export type DetectedFace = { box: FaceBox; embedding: Float32Array };

export type FaceHit = {
  photoUri: string;
  day: string;
  box: FaceBox;
  /** 0-1. Higher is more alike; see MATCH_THRESHOLD. */
  score: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const handle = await SQLite.openDatabaseAsync(DB_NAME);
      await handle.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS faces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          photo_uri TEXT NOT NULL,
          day TEXT NOT NULL,
          x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
          embedding TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS faces_photo ON faces (photo_uri);
        CREATE INDEX IF NOT EXISTS faces_day ON faces (day);

        -- Which photos have been read, INCLUDING the ones with nobody in
        -- them. A photo of a receipt has to be remembered as read, or every
        -- pass would look at it again forever.
        CREATE TABLE IF NOT EXISTS read_photos (
          photo_uri TEXT PRIMARY KEY,
          day TEXT NOT NULL,
          faces INTEGER NOT NULL,
          at TEXT NOT NULL
        );

        -- The fingerprint of a person's own reference face, taken from the
        -- profile photo they chose. Searching for them means comparing this
        -- against every row in faces.
        CREATE TABLE IF NOT EXISTS person_faces (
          name TEXT PRIMARY KEY,
          embedding TEXT NOT NULL,
          source_uri TEXT,
          at TEXT NOT NULL
        );
      `);
      return handle;
    })();
  }
  return dbPromise;
}

export async function initFaceIndex(): Promise<void> {
  await db();
}

// Every photo worth reading: the ones in the log, with a known timestamp,
// that aren't screenshots. Screenshots are app captures, receipts, maps and
// documents — reliably face-free, and skipping them is free.
export async function candidatePhotos(): Promise<{ uri: string; day: string }[]> {
  const [timestamps, sources, memories] = await Promise.all([
    getAllPhotoTimestamps(),
    getAllPhotoSources(),
    getLoggedMemories(),
  ]);
  const out: { uri: string; day: string }[] = [];
  const seen = new Set<string>();
  for (const m of memories) {
    if (m.kind !== 'photo') continue;
    const day = dateKey(new Date(m.takenAt));
    for (const uri of m.photoUris ?? []) {
      if (seen.has(uri)) continue;
      if (!timestamps[uri] || sources[uri] === 'screenshot') continue;
      seen.add(uri);
      out.push({ uri, day });
    }
  }
  // Newest first: recent photos are the ones the user can still verify from
  // memory, so they are worth having first even though everything gets read.
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

// Files a photo's faces, and marks it read either way.
export async function recordPhotoFaces(
  photoUri: string,
  day: string,
  faces: DetectedFace[],
): Promise<void> {
  const handle = await db();
  await handle.withTransactionAsync(async () => {
    // Re-reading a photo replaces what was known about it rather than
    // doubling it — which matters when a better model comes along.
    await handle.runAsync('DELETE FROM faces WHERE photo_uri = ?', photoUri);
    for (const f of faces) {
      await handle.runAsync(
        'INSERT INTO faces (photo_uri, day, x, y, w, h, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)',
        photoUri,
        day,
        f.box.x,
        f.box.y,
        f.box.w,
        f.box.h,
        packEmbedding(normalize(f.embedding)),
      );
    }
    await handle.runAsync(
      'INSERT OR REPLACE INTO read_photos (photo_uri, day, faces, at) VALUES (?, ?, ?, ?)',
      photoUri,
      day,
      faces.length,
      new Date().toISOString(),
    );
  });
}

export async function readPhotoUris(): Promise<Set<string>> {
  const handle = await db();
  const rows = await handle.getAllAsync<{ photo_uri: string }>(
    'SELECT photo_uri FROM read_photos',
  );
  return new Set(rows.map((r) => r.photo_uri));
}

export type IndexStatus = {
  /** Photos worth reading at all. */
  total: number;
  /** Of those, how many have been read. */
  read: number;
  remaining: number;
  /** Faces found so far, across everything read. */
  faces: number;
  upToDate: boolean;
};

export async function getIndexStatus(): Promise<IndexStatus> {
  const [handle, candidates] = await Promise.all([db(), candidatePhotos()]);
  const already = await readPhotoUris();
  const faces = await handle.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM faces');
  const read = candidates.filter((c) => already.has(c.uri)).length;
  return {
    total: candidates.length,
    read,
    remaining: candidates.length - read,
    faces: faces?.n ?? 0,
    upToDate: candidates.length > 0 && read >= candidates.length,
  };
}

// How alike two fingerprints have to be before the app will claim they are
// the same person.
//
// DELIBERATELY NOT FINAL. The published figures for models of this kind put
// the same-person / different-person boundary around here, but the number
// that matters is the one measured against this user's actual photos, and
// that measurement needs the model running on a device. Treat it as a
// starting point to be calibrated, not a decision already made.
export const MATCH_THRESHOLD = 0.62;

export async function setPersonFace(
  name: string,
  embedding: Float32Array,
  sourceUri?: string,
): Promise<void> {
  const handle = await db();
  await handle.runAsync(
    'INSERT OR REPLACE INTO person_faces (name, embedding, source_uri, at) VALUES (?, ?, ?, ?)',
    name,
    packEmbedding(normalize(embedding)),
    sourceUri ?? null,
    new Date().toISOString(),
  );
}

export async function getPersonFace(name: string): Promise<Float32Array | null> {
  const handle = await db();
  const row = await handle.getFirstAsync<{ embedding: string }>(
    'SELECT embedding FROM person_faces WHERE name = ?',
    name,
  );
  return row ? unpackEmbedding(row.embedding) : null;
}

export async function forgetPersonFace(name: string): Promise<void> {
  const handle = await db();
  await handle.runAsync('DELETE FROM person_faces WHERE name = ?', name);
}

// Every face in the library that looks like this one, best first.
//
// This is the whole search. No network, no model, no per-photo cost: one
// sweep over the stored fingerprints doing a dot product each. Ten thousand
// of them is a few milliseconds.
export async function findSimilarFaces(
  target: Float32Array,
  opts: { threshold?: number; limit?: number } = {},
): Promise<FaceHit[]> {
  const handle = await db();
  const rows = await handle.getAllAsync<{
    photo_uri: string;
    day: string;
    x: number;
    y: number;
    w: number;
    h: number;
    embedding: string;
  }>('SELECT photo_uri, day, x, y, w, h, embedding FROM faces');

  const probe = normalize(target);
  const threshold = opts.threshold ?? MATCH_THRESHOLD;
  const hits: FaceHit[] = [];
  for (const r of rows) {
    const score = similarity(probe, unpackEmbedding(r.embedding));
    if (score < threshold) continue;
    hits.push({
      photoUri: r.photo_uri,
      day: r.day,
      box: { x: r.x, y: r.y, w: r.w, h: r.h },
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

// The days a person appears on, strongest evidence first.
//
// A day is only as good as its best photo: five blurred half-matches on one
// day are not better evidence than one clear one, so the day takes the
// highest score rather than a total that rewards having taken more photos.
export async function findPersonDays(
  name: string,
  opts: { threshold?: number } = {},
): Promise<{ day: string; score: number; photoUri: string; box: FaceBox }[]> {
  const face = await getPersonFace(name);
  if (!face) return [];
  const hits = await findSimilarFaces(face, opts);
  const best = new Map<string, FaceHit>();
  for (const h of hits) {
    const current = best.get(h.day);
    if (!current || h.score > current.score) best.set(h.day, h);
  }
  return [...best.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((h) => ({ day: h.day, score: h.score, photoUri: h.photoUri, box: h.box }));
}

// Every photo a person appears in — their history, for the profile.
export async function findPersonPhotos(
  name: string,
  opts: { threshold?: number; limit?: number } = {},
): Promise<FaceHit[]> {
  const face = await getPersonFace(name);
  if (!face) return [];
  return findSimilarFaces(face, opts);
}

// Wipes everything the app has worked out about faces. For when the model
// changes: fingerprints from two different models are not comparable, so
// keeping the old ones would mean silently measuring distances between
// numbers that mean different things.
export async function clearFaceIndex(): Promise<void> {
  const handle = await db();
  await handle.execAsync(
    'DELETE FROM faces; DELETE FROM read_photos; DELETE FROM person_faces;',
  );
}
