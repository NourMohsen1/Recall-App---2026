import { faceEmbedderAvailable, getFaceEmbedder } from './faceEmbedder';
import {
  candidatePhotos,
  getIndexStatus,
  initFaceIndex,
  readPhotoUris,
  recordPhotoFaces,
} from './faceIndex';

// Reading the library, once.
//
// Every photo gets looked at a single time, ever, and leaves behind the
// fingerprints of the faces in it. After that the photo is never opened
// again — searching happens entirely over the numbers.
//
// That is why this can afford to be slow and quiet. It is not something the
// user waits for; it is something that finishes over a few sittings and then
// never runs again except on new photos. The previous design had the opposite
// shape: nothing was remembered, so every search paid the full cost again.

export type IndexingState = {
  running: boolean;
  /** Photos read in THIS pass. */
  done: number;
  /** Photos this pass set out to read. */
  total: number;
  /** Faces found in this pass. */
  faces: number;
};

const IDLE: IndexingState = { running: false, done: 0, total: 0, faces: 0 };
let state: IndexingState = IDLE;
const listeners = new Set<(s: IndexingState) => void>();

export function getIndexingState(): IndexingState {
  return state;
}

export function onIndexingStateChange(fn: (s: IndexingState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(next: IndexingState): void {
  state = next;
  for (const fn of listeners) fn(next);
}

let cancelled = false;

export function stopIndexing(): void {
  cancelled = true;
}

// How many photos one pass will read before stopping.
//
// Capped rather than unbounded so the work can never hold the app hostage:
// a pass ends, the next one picks up exactly where it left off because read
// photos are remembered, and a library gets through in however many sittings
// it takes. Nothing is lost by stopping early.
const PHOTOS_PER_PASS = 200;
// A breath between photos so the UI stays responsive — this runs alongside
// whatever the user is actually doing.
const PACE_MS = 30;

export type IndexingOutcome =
  | { status: 'done'; read: number; faces: number; remaining: number }
  | { status: 'busy' }
  | { status: 'no-embedder' }
  | { status: 'up-to-date' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reads up to a pass-worth of photos that have never been read.
export async function runIndexingPass(
  opts: { limit?: number } = {},
): Promise<IndexingOutcome> {
  if (state.running) return { status: 'busy' };
  if (!faceEmbedderAvailable()) return { status: 'no-embedder' };
  const embedder = getFaceEmbedder();
  if (!embedder) return { status: 'no-embedder' };

  cancelled = false;
  await initFaceIndex();

  const candidates = await candidatePhotos();
  const already = await readPhotoUris();
  const todo = candidates.filter((c) => !already.has(c.uri));
  if (todo.length === 0) return { status: 'up-to-date' };

  const batch = todo.slice(0, opts.limit ?? PHOTOS_PER_PASS);
  setState({ running: true, done: 0, total: batch.length, faces: 0 });

  let faces = 0;
  let read = 0;
  try {
    for (const photo of batch) {
      if (cancelled) break;
      try {
        const found = await embedder.detectAndEmbed(photo.uri);
        await recordPhotoFaces(photo.uri, photo.day, found);
        faces += found.length;
      } catch {
        // A photo that cannot be read — deleted, an iCloud fetch that
        // failed, something that isn't really an image — is recorded as read
        // with no faces rather than retried forever. It costs one wrong
        // "nobody here"; the alternative is a pass that never advances past
        // the same broken file.
        await recordPhotoFaces(photo.uri, photo.day, []);
      }
      read += 1;
      setState({ running: true, done: read, total: batch.length, faces });
      if (PACE_MS > 0) await sleep(PACE_MS);
    }
  } finally {
    setState(IDLE);
  }

  const status = await getIndexStatus();
  return { status: 'done', read, faces, remaining: status.remaining };
}

// Keeps going until the library is read, a pass at a time.
//
// Split into passes rather than one long loop so that stopping is always
// cheap and nothing is ever half-recorded: each photo is either read and
// filed or not read at all.
export async function indexUntilDone(): Promise<IndexingOutcome> {
  let last: IndexingOutcome = { status: 'up-to-date' };
  for (;;) {
    const outcome = await runIndexingPass();
    if (outcome.status !== 'done') return outcome.status === 'up-to-date' ? last : outcome;
    last = outcome;
    if (cancelled || outcome.remaining === 0) return outcome;
  }
}

let started = false;

// Called once per app launch. Does nothing at all without a model, which is
// every launch until the installed build exists.
export function startBackgroundIndexing(): void {
  if (started || !faceEmbedderAvailable()) return;
  started = true;
  runIndexingPass().catch(() => {});
}
