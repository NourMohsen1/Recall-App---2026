import { noticePeople } from './facePeople';
import { clearAllGuesses } from './guessedPeople';
import { faceEmbedderAvailable, getFaceEmbedder } from './faceEmbedder';
import {
  candidatePhotos,
  clearFaceIndex,
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
  // Always logged, not behind a trace flag. "Nothing is happening" is the
  // hardest failure to diagnose in this whole feature, and it has three
  // very different causes — no photo permission, no photos, or everything
  // already read — that are indistinguishable from the outside.
  console.log(
    `[faces] pass: ${candidates.length} photos visible, ${already.size} already read, ${todo.length} to do`,
  );
  if (todo.length === 0) {
    const status = await getIndexStatus();
    console.log(`[faces] library already read — ${status.faces} faces stored`);
    return { status: 'up-to-date' };
  }

  const batch = todo.slice(0, opts.limit ?? PHOTOS_PER_PASS);
  setState({ running: true, done: 0, total: batch.length, faces: 0 });

  let faces = 0;
  let read = 0;
  let failed = 0;
  try {
    for (const photo of batch) {
      if (cancelled) break;
      try {
        const found = await embedder.detectAndEmbed(photo.uri);
        await recordPhotoFaces(photo.uri, photo.day, found);
        faces += found.length;
      } catch (e) {
        // A photo that cannot be read — deleted, an iCloud fetch that
        // failed, something that isn't really an image — is recorded as read
        // with no faces rather than retried forever. It costs one wrong
        // "nobody here"; the alternative is a pass that never advances past
        // the same broken file.
        //
        // But it is recorded LOUDLY now. Swallowed silently, this same line
        // filed 2,389 photos as "nobody here" and left the feature looking
        // like a model that could not see faces. A failure that marks data
        // as permanently known has to be visible.
        failed += 1;
        if (failed <= 3) {
          console.warn(
            `[faces] could not read ${photo.uri.slice(0, 60)} — ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
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
  console.log(
    `[faces] pass done: read ${read}, found ${faces} faces` +
      (failed > 0 ? `, ${failed} UNREADABLE` : '') +
      `, ${status.remaining} photos left`,
  );
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

// After reading photos, look for the people the user has told us about.
//
// This used to group every face in the library into anonymous clusters and
// ask the user to name them. That put the work on the wrong side: the user
// already says who someone is when they add a profile photo, and the app
// should use that rather than run its own naming exercise.
async function group(): Promise<void> {
  try {
    await noticePeople();
  } catch (e) {
    console.warn('[faces] matching people failed:', e);
  }
}

// Called once per app launch. Does nothing at all without a model.
//
// Runs until the library is FINISHED, not for one pass. It used to stop
// after 200 photos and wait for the next launch, which meant a library of
// any size crawled forward a few hundred photos a day and the feature built
// on top of it appeared to be broken — faces would be found, a couple of
// people would surface, and then nothing more would happen no matter how
// long the app was left open.
//
// Each pass still commits as it goes, so stopping is free and nothing is
// half-recorded. The difference is only that it starts the next one itself.
/** Forget everything the app worked out about faces and work it out again.
 *
 *  For when the rules changed rather than the photos: a quality gate that
 *  did not exist when these faces were read, a threshold that turned out to
 *  be too loose, a grouping that went wrong. None of that can be repaired
 *  in place — the bad fingerprints are already stored and the bad groups
 *  are already built on them.
 *
 *  Deliberately does NOT touch days the user confirmed. Those stopped being
 *  the app's opinion the moment they were agreed to. */
export async function resetFaceRecognition(
  onProgress?: (s: IndexingState) => void,
): Promise<void> {
  stopIndexing();
  await clearAllGuesses();
  await clearFaceIndex();
  started = false;
  const off = onProgress ? onIndexingStateChange(onProgress) : undefined;
  try {
    await indexUntilDone();
    await group();
  } finally {
    off?.();
  }
}

export function startBackgroundIndexing(): void {
  if (started) return;
  if (!faceEmbedderAvailable()) {
    console.warn('[faces] no model registered — indexing will not run');
    return;
  }
  started = true;
  (async () => {
    for (;;) {
      const outcome = await runIndexingPass();
      if (outcome.status !== 'done') break;
      // Group as we go, so people appear while the library is still being
      // worked through rather than only at the end.
      await group();
      if (cancelled || outcome.remaining === 0) break;
    }

    // And group once more, unconditionally.
    //
    // This is not belt and braces, it is the whole thing working at all on
    // the second run onwards. When every photo has already been read the
    // first pass returns 'up-to-date', the loop above breaks before it
    // groups anything, and faces sit in the database ungrouped forever —
    // no people to name, nothing on any day, a feature that silently does
    // nothing. Reading photos and grouping faces are two jobs; finishing
    // the first must not cancel the second.
    await group();
  })().catch(() => {});
}
