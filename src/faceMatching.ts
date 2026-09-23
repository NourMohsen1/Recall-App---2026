import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { chatCompletion, visionAvailable, visionProviders } from './aiProviders';
import * as FileSystem from 'expo-file-system/legacy';
import { dateKey, getLoggedMemories } from './memoryLog';
import { backfillFaceCrops, referenceFaceUri } from './faceCrop';
import { getAllPersonMeta } from './peopleTags';
import { getAllPhotoSources, getAllPhotoTimestamps } from './photoMeta';
import { resolvePhotoUri } from './photoUri';
import {
  addSuggestion,
  decidedDaysFor,
  getAllSuggestions,
  getExaminedDays,
  markDayExaminedFor,
  markDaysExamined,
} from './personSuggestions';
import { getPeopleForDay } from './peopleTags';

// Looks for a person in the user's photos, once they've pointed at a face.
//
// WHAT THIS IS: the reference photo and a batch of candidate photos are sent
// to a vision model together, and it says which candidates show the same
// person. It is NOT face recognition in the biometric sense — there are no
// embeddings and no distance threshold, because neither iOS's face data nor
// an on-device model is reachable from Expo Go (see faceRegions.ts).
//
// WHAT THAT MEANS: it is good at obvious matches and will get some wrong.
// That's designed for rather than hidden — every result is a SUGGESTION the
// user confirms, stored apart from what they logged themselves, and drawn
// differently on screen. The feature's value is that confirming a correct
// guess is one tap; its cost when wrong is one tap to dismiss.

// TURNED OFF, deliberately, until the real thing replaces it.
//
// Everything below asks a language model to compare faces, and a language
// model does not compare faces — it looks at a picture and writes a
// plausible sentence about it. The failure that settled it: told in the
// prompt, in as many words, that glasses are shared by millions of people
// and prove nothing, it returned two strangers for the same person and gave
// "round glasses, similar" as its reason for both.
//
// That is not a tuning problem. Recognition needs a face turned into a
// numeric fingerprint and two fingerprints measured against each other, and
// that is a different operation from anything this can do. Leaving it
// running would keep writing wrong people into the user's memories and keep
// spending on calls that cannot come good.
//
// The code stays because the plumbing around it is sound and reused: the
// suggestion store, the confirm/reject flow, the day screen's questions, the
// scan state. Only the thing doing the comparing is being replaced.
const FACE_MATCHING_ENABLED = false;

export function faceMatchingAvailable(): boolean {
  return FACE_MATCHING_ENABLED && visionAvailable();
}

// Faces need more pixels than scene analysis does — the assumed-memory pass
// runs at 512px wide and low detail, which is fine for "a table of food" but
// too coarse to tell two people apart.
//
// The first version got essentially nothing right, and these three numbers
// are why:
//   · candidates went in at `detail: 'low'`, which downsamples to roughly
//     512px total. A face in a group shot is then ~40px across — not enough
//     to identify anyone, so the model was guessing from clothing and build.
//   · six candidates rode in one call, and the model lost track of which
//     index it was talking about.
//   · the reference went in at 640px, which is small for the one image
//     everything is compared against.
const REFERENCE_WIDTH = 900;
// Candidates go in far bigger than they used to.
//
// 'detail: high' does not mean "look closely at the photo you sent" — the
// provider tiles the image it is GIVEN. Handing it 768px wide meant the
// tiling had nothing to work with: a face inside a wider shot was already
// destroyed by the resize before the model ever saw it, so the only photos
// it could say anything confident about were the ones with a single big
// frontal face. That is exactly the reported symptom — the same couple of
// clear-faced photos coming back as a match for every different person.
const CANDIDATE_WIDTH = 1400;
// Fewer per call, so each one actually gets looked at and the index in the
// answer still refers to the photo it meant.
const BATCH_SIZE = 3;

async function toDataUri(uri: string, width: number): Promise<string | null> {
  try {
    const resolved = await resolvePhotoUri(uri);
    if (!resolved) return null;
    const shrunk = await manipulateAsync(resolved, [{ resize: { width } }], {
      compress: 0.7,
      format: SaveFormat.JPEG,
    });
    const base64 = await FileSystem.readAsStringAsync(shrunk.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
}


// One photo from one day, waiting to be looked at.
type Candidate = { uri: string; day: string };

// Only a confident match becomes something the user is asked about.
// Raised from 0.7: the real-world complaint was random guesses, not missed
// people, and a false positive costs more than a miss — a miss you never
// notice, a wrong face you have to spot and undo.
const MIN_CONFIDENCE = 0.8;
// Pacing between batches — the same shared token budget the photo analysis
// and the chat both draw on, so this stays deliberately unhurried.
// Pause between waves.
//
// This was 4000ms, and it was the whole problem. Measured against the real
// API at the payload the matcher now sends — five reference faces plus three
// candidates — a call comes back in about 650ms. The old pause was therefore
// roughly six times longer than the work it was pacing, and a full run spent
// a minute doing nothing at all while covering about six days.
const BATCH_PACE_MS = 600;
// A single pass never walks the entire library. It covers the most recent
// days first and stops; the next run picks up where it left off, because
// days already decided are skipped.
// A manual run's budget: 40 batches, 120 photos.
//
// Paired with breadth-first ordering and two calls at a time, that reaches
// two months back on the first press rather than the week the old
// depth-first walk managed — and, because the pause is no longer six times
// the work, it does so in less wall-clock time than the old run took to
// cover six days. It is a bigger spend in calls, and it is meant to be: this
// is the button someone presses when they want their history searched, not a
// background tick.
const MAX_BATCHES_PER_RUN = 40;
// Photos taken from any one day. Kept low on purpose: the budget buys reach
// across days, and a person who is in a day at all is usually in more than
// one of its photos.
const PHOTOS_PER_DAY = 2;
const CONCURRENT_BATCHES = 2;
// How many OTHER known faces ride along in a search for one person, so the
// model has somewhere to put a face that isn't them.
const ALTERNATES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A scan outlives the screen that started it.
//
// This state used to live in the profile screen's own useState, which meant
// walking away from the page destroyed it: the scan carried on and kept the
// "running" flag set, so every other profile refused with "already running",
// and the page you came back to showed nothing at all. It belongs to the
// module doing the work, not to whichever screen happened to start it.
export type ScanState = {
  /** Who is being scanned, or null when nothing is running. */
  person: string | null;
  /** Which day is being read for faces, or null. Both passes share one
   *  machine, so both have to be visible to anyone asking if it is free. */
  day: string | null;
  done: number;
  total: number;
  /** Matches found so far this run, so a screen can show a hit the moment it
   *  turns up instead of only when the whole search ends. */
  found: number;
  /** The oldest day reached so far, so a screen can say how far back the
   *  search has actually got, not just how many photos it has seen. */
  oldestDay: string | null;
};

const IDLE: ScanState = { person: null, day: null, done: 0, total: 0, found: 0, oldestDay: null };
let scanState: ScanState = IDLE;
const scanListeners = new Set<(s: ScanState) => void>();

export function getScanState(): ScanState {
  return scanState;
}

// Screens subscribe so progress keeps rendering after a remount, and so the
// suggestions appear the moment a scan finishes rather than on the next
// manual refresh.
export function onScanStateChange(listener: (s: ScanState) => void): () => void {
  scanListeners.add(listener);
  return () => {
    scanListeners.delete(listener);
  };
}

function setScanState(next: ScanState): void {
  scanState = next;
  for (const l of scanListeners) l(next);
}

function running(): boolean {
  return scanState.person !== null || scanState.day !== null;
}

// Screens that have to wait their turn — a manual scan needs the machine
// free, and free now means neither pass is holding it.
export function isScanBusy(): boolean {
  return running();
}

// Set when the user starts a scan of their own, so a background pass drops
// what it's doing between batches instead of making them wait behind it.
let cancelBackground = false;

// Why a scan produced nothing, so the screen can say so instead of looking
// broken. A button that silently does nothing is worse than one that says
// "already running" — that exact silence is what made this feature seem
// dead when a background scan happened to hold the flag.
export type ScanOutcome =
  | { status: 'done'; found: number; searched: number }
  | { status: 'busy' }
  | { status: 'no-photo' }
  | { status: 'unavailable' }
  | { status: 'nothing-to-search' };

// Scans for one person, newest days first, reporting progress as it goes.
export async function scanForPerson(
  name: string,
  opts: {
    /** Cap on vision calls this run — background passes take small bites. */
    maxBatches?: number;
    /** Background passes skip days already searched so they walk backwards
     *  through the library. A manual run re-checks them, because the user
     *  asked and the matching may have improved since. */
    skipExamined?: boolean;
    /** Background work stands aside for anything the user started. */
    background?: boolean;
  } = {},
): Promise<ScanOutcome> {
  if (!faceMatchingAvailable()) return { status: 'unavailable' };
  if (running()) return { status: 'busy' };
  const meta = (await getAllPersonMeta())[name];
  if (!meta?.photoUri) return { status: 'no-photo' };

  setScanState({ ...IDLE, person: name });
  try {
    // The person being searched for goes in first, and every other face the
    // app knows goes in beside them.
    //
    // WHY: asked "is this Tarek?", the only answers on offer are yes and no.
    // The answer that is usually right — it's somebody else — isn't one of
    // them, so a face that is actually Omar has nowhere to go except into a
    // yes/no about Tarek. Put Omar in the line-up and the face lands on Omar
    // instead. Only the target's matches are recorded; the others are there
    // purely to take the wrong ones away.
    //
    // The face, not the photo, for the target — see faceCrop.ts.
    const targetData = await toDataUri(
      await referenceFaceUri(name, meta.photoUri),
      REFERENCE_WIDTH,
    );
    if (!targetData) return { status: 'no-photo' };
    const references: { name: string; data: string }[] = [{ name, data: targetData }];
    for (const [other, om] of Object.entries(await getAllPersonMeta())) {
      if (references.length >= ALTERNATES + 1) break;
      if (other === name || !om.photoUri) continue;
      // build=false: a search for Tarek doesn't pay to cut everybody else's
      // face. Whoever already has one contributes it, the rest come as they
      // are, and their own turn comes round soon enough.
      const data = await toDataUri(
        await referenceFaceUri(other, om.photoUri, false),
        REFERENCE_WIDTH,
      );
      if (data) references.push({ name: other, data });
    }

    const timestamps = await getAllPhotoTimestamps();
    const sources = await getAllPhotoSources();
    const memories = await getLoggedMemories();

    // Group this library's photos by day, newest day first — skipping only
    // SCREENSHOTS.
    //
    // Screenshots are reliably face-free: app captures, receipts, documents,
    // the calendar grid. Worth excluding — they burn a vision call on an
    // image with nobody in it.
    //
    // But nothing else is. This briefly skipped every photo carrying any
    // provenance label, which threw away everything saved from WhatsApp and
    // Instagram too — and those are overwhelmingly photos OF people, often
    // the very ones a friend sent you. On a library where a lot arrives
    // through chat apps that removes most of the real candidates, which is
    // exactly how a scan ends up reporting "no new matches" for days that
    // obviously contain the person.
    const byDay = new Map<string, string[]>();
    for (const m of memories) {
      if (m.kind !== 'photo') continue;
      const day = dateKey(new Date(m.takenAt));
      const uris = (m.photoUris ?? []).filter(
        (u) => timestamps[u] && sources[u] !== 'screenshot',
      );
      if (uris.length === 0) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), ...uris]);
    }

    const decided = await decidedDaysFor(name);
    const examined = opts.skipExamined ? await getExaminedDays(name) : new Set<string>();
    // Newest first, always — recent days are the ones worth knowing about.
    const days = [...byDay.keys()].sort().reverse();

    // Which photos are eligible, day by day, newest day first.
    const perDay = new Map<string, string[]>();
    for (const day of days) {
      if (decided.has(day) || examined.has(day)) continue;
      // A day the user already tagged them on needs no guessing.
      const tagged = await getPeopleForDay(day);
      if (tagged.includes(name)) continue;
      const uris = (byDay.get(day) ?? []).slice(0, PHOTOS_PER_DAY);
      if (uris.length > 0) perDay.set(day, uris);
    }

    // ACROSS the days, not down into them.
    //
    // This is what made a search cover barely a week. The list was built a
    // day at a time, four photos deep — so a run's whole budget went on the
    // handful of most recent days, and anyone not photographed in the last
    // week simply could not be found no matter how many times you ran it.
    //
    // Taking the first photo of every day first, then the second of every
    // day, spends the same budget on months instead of days. Depth still
    // happens, it just happens after breadth rather than instead of it.
    const candidates: Candidate[] = [];
    for (let round = 0; round < PHOTOS_PER_DAY; round++) {
      for (const [day, uris] of perDay) {
        if (uris[round]) candidates.push({ uri: uris[round], day });
      }
    }
    if (candidates.length === 0) return { status: 'nothing-to-search' };

    let added = 0;
    const cap = opts.maxBatches ?? MAX_BATCHES_PER_RUN;
    const batchCount = Math.min(cap, Math.ceil(candidates.length / BATCH_SIZE));
    const planned = candidates.slice(0, batchCount * BATCH_SIZE);
    const batches: Candidate[][] = [];
    for (let i = 0; i < planned.length; i += BATCH_SIZE) {
      batches.push(planned.slice(i, i + BATCH_SIZE));
    }

    // Progress is counted in PHOTOS, because that is the thing the user has
    // a feel for. "Batch 3 of 8" says nothing to anybody.
    const totalPhotos = planned.length;
    let photosDone = 0;
    const seenDays = new Set<string>();
    // How many of each day's eligible photos this run actually got through,
    // so a day is only retired once it has been covered — see below.
    const coveredPerDay = new Map<string, number>();

    // One batch, start to finish.
    const runBatch = async (batch: Candidate[]): Promise<void> => {
      const datas: string[] = [];
      const usable: Candidate[] = [];
      for (const cand of batch) {
        const data = await toDataUri(cand.uri, CANDIDATE_WIDTH);
        if (!data) continue;
        datas.push(data);
        usable.push(cand);
      }
      const matches = datas.length > 0 ? await matchDayBatch(references, datas) : [];
      for (const m of matches) {
        // Reference 1 is the person being searched for. Anything else is the
        // line-up doing its job — a face that belongs to somebody else.
        if (m.person !== 1) continue;
        if (m.confidence < MIN_CONFIDENCE) continue;
        const hit = usable[m.photo - 1];
        if (!hit) continue;
        if (
          await addSuggestion({
            name,
            day: hit.day,
            photoUri: hit.uri,
            confidence: m.confidence,
            why: m.why,
          })
        )
          added += 1;
      }
      for (const c of batch) {
        seenDays.add(c.day);
        coveredPerDay.set(c.day, (coveredPerDay.get(c.day) ?? 0) + 1);
      }
      photosDone += batch.length;
    };

    // Two calls in the air at once. Reaching months back means many more
    // batches than before, and the time is almost all spent waiting on the
    // network — running a pair together roughly halves the wall clock
    // without asking the API for anything like a burst.
    for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
      // A manual run takes the machine back off a background one.
      if (opts.background && cancelBackground) break;
      const wave = batches.slice(i, i + CONCURRENT_BATCHES);
      await Promise.all(wave.map(runBatch));
      // Progress goes through the shared state, which every screen watches —
      // no per-caller callback to keep in sync. A rising found count is what
      // lets a screen show a hit the moment it turns up, rather than making
      // the user wait out the whole run to see anything.
      setScanState({
        person: name,
        day: null,
        done: photosDone,
        total: totalPhotos,
        found: added,
        oldestDay: [...seenDays].sort()[0] ?? null,
      });
      // No pause after the last wave — the user is waiting on this now.
      if (i + CONCURRENT_BATCHES < batches.length) await sleep(BATCH_PACE_MS);
    }

    // Only days whose eligible photos were ALL looked at are retired.
    //
    // Marking a day done after seeing one of its photos is what would make
    // breadth-first quietly lossy: the first pass would skim one photo from
    // sixty days and then never come back for the rest of them.
    const finished = [...coveredPerDay.entries()]
      .filter(([day, n]) => n >= (perDay.get(day)?.length ?? 0))
      .map(([day]) => day);
    await markDaysExamined(name, finished);
    return { status: 'done', found: added, searched: seenDays.size };
  } finally {
    setScanState(IDLE);
  }
}

// Quietly keeps looking, the way the Photos app does.
//
// The rules that make this bearable rather than a runaway bill:
//   · newest days first, always — recent photos are what the user cares
//     about, and they're what they can still verify from memory.
//   · small bites. A run covers a few batches per person and stops; the
//     next app open picks up further back, because days already searched
//     are remembered. Old photos get reached eventually without any single
//     run taking forever.
//   · it steps aside instantly for a scan the user started themselves.
//   · people with the least coverage go first, so one person with a huge
//     library can't starve everybody else.
const BACKGROUND_CROPS_PER_RUN = 3;
const BACKGROUND_BATCHES_PER_PERSON = 3;
const BACKGROUND_PEOPLE_PER_RUN = 3;

let backgroundStarted = false;

export async function runBackgroundFaceScan(): Promise<number> {
  if (!faceMatchingAvailable()) return 0;
  cancelBackground = false;

  // Profiles that already had a photo before any of this existed have no
  // face cut from them, and would only get one the next time that person
  // happened to be searched for. A few per launch clears the backlog on its
  // own, and the crop is what every later match is judged against, so it is
  // worth doing before any searching.
  await backfillFaceCrops(BACKGROUND_CROPS_PER_RUN);

  const meta = await getAllPersonMeta();
  const withFaces = Object.entries(meta)
    .filter(([, m]) => !!m.photoUri)
    .map(([name]) => name);
  if (withFaces.length === 0) return 0;

  // Fewest days searched so far goes first.
  const coverage = await Promise.all(
    withFaces.map(async (name) => ({ name, done: (await getExaminedDays(name)).size })),
  );
  const order = coverage.sort((a, b) => a.done - b.done).map((c) => c.name);

  let found = 0;
  for (const name of order.slice(0, BACKGROUND_PEOPLE_PER_RUN)) {
    if (cancelBackground) break;
    const outcome = await scanForPerson(name, {
      maxBatches: BACKGROUND_BATCHES_PER_PERSON,
      skipExamined: true,
      background: true,
    });
    if (outcome.status === 'done') found += outcome.found;
    // 'busy' means the user is scanning — leave them to it.
    if (outcome.status === 'busy') break;
  }
  return found;
}

// Called once per app launch, after the photo analysis has had its turn.
export function startBackgroundFaceScan(): void {
  if (backgroundStarted) return;
  backgroundStarted = true;
  runBackgroundFaceScan().catch(() => {});
}

// A user-started scan preempts whatever the background pass was doing.
export function stopBackgroundFaceScan(): void {
  cancelBackground = true;
}

// ---------------------------------------------------------------------------
// The other direction: "who, of the people I know, is in THIS day's photos?"
// ---------------------------------------------------------------------------
//
// Everything above searches person-first: pick one face, walk the library
// looking for it. That is the right shape for "find me every photo of Tarek",
// and the wrong shape for a day screen — and it is also, on its own, why the
// guesses were bad.
//
// Asked one person at a time, the question is "is this Tarek?" and the only
// answers are yes or no. Nothing in that question offers the model the answer
// that is almost always correct: it is somebody else. So it falls back on the
// one thing it can always judge — whether the photo contains a clear,
// well-lit face — and the photos with the clearest faces come back as a match
// for whoever is being searched for. That is the reported symptom exactly:
// the same two photos returned for every different profile.
//
// Asking day-first fixes that structurally. Every known face goes into the
// same call, numbered, and the model has to say WHICH of them a face is, or
// none. The people now compete with each other, so a clear frontal face can
// no longer be claimed by everybody: naming someone means ruling the others
// out.

// How many known faces ride along in one call. Past this the reference strip
// gets long enough that the model starts losing track of which name is which
// — the same indexing failure that made batches of six candidates useless.
const DAY_REFERENCES = 8;
// How many of a day's photos get read. A day the user actually lived through
// has the same people in several shots; reading all forty adds cost, not
// answers.
const DAY_CANDIDATES = 6;
// Faces are cut once per person and kept forever, but the very first time a
// day is read that could be eight cuts before a single photo gets looked at.
// A few per run keeps the wait honest; the rest are cut the next time round,
// and the background crawl gets to them on its own anyway.
const CROPS_PER_DAY_SCAN = 3;

const DAY_PROMPT = `You are identifying which of several KNOWN people appear in some photos.

You are given, in order:
- REFERENCE photos, numbered, one per known person, each labelled with their name.
- CANDIDATE photos, numbered, from the user's camera roll.

For each candidate photo, find every face in it. For each face, decide whether it is one of the named people above, or someone else entirely.

Most faces are SOMEBODY ELSE. Strangers, passers-by, staff, people at the next table, friends who are not in the reference set. "None of them" is the correct answer far more often than any name, and it costs nothing to give.

Glasses, a beard, a haircut, a cap: people change these and millions of people share them. They are evidence of NOTHING in either direction. Two men in glasses are not the same man. The same man with his glasses off is still the same man. Judge the face itself — the shape of the eyes, nose, mouth, jaw and brow, and how they sit in relation to each other.

These are NOT matches:
- a family resemblance, or someone who merely looks similar
- the same hair, clothes, build, age or gender
- the same glasses, beard or hairstyle
- a face too small, too blurred or too turned away to actually compare
- "this is a clear, well-lit portrait, so it is probably one of them" — how good a photo is tells you NOTHING about who is in it. A sharp close-up of a stranger is still a stranger.

Before you name anyone, check that face against EVERY reference, not just the first that looks close. If two of the references are equally plausible, that means you cannot tell them apart: name neither.

For every claim you make you must state which face you mean (where it is in the frame) and which specific features agree with that person's reference. If you cannot write that sentence from what you can actually see, it is not a match.

Respond with ONLY a JSON object:
{"matches": [{"photo": <1-based candidate number>, "person": <1-based reference number>, "face": "<where in the frame>", "reason": "<the specific features that agree>", "confidence": <0.0-1.0>}]}

Return {"matches": []} when none of the named people appear.`;

type DayMatch = { photo: number; person: number; confidence: number; why: string };

async function matchDayBatch(
  references: { name: string; data: string }[],
  candidates: string[],
): Promise<DayMatch[]> {
  const result = await chatCompletion(visionProviders(), (model) => ({
    model,
    messages: [
      { role: 'system', content: DAY_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'The known people:' },
          ...references.flatMap((r, i) => [
            { type: 'text', text: `Reference ${i + 1} — ${r.name}:` },
            { type: 'image_url', image_url: { url: r.data, detail: 'high' } },
          ]),
          { type: 'text', text: 'The photos to read:' },
          ...candidates.flatMap((data, i) => [
            { type: 'text', text: `Candidate ${i + 1}:` },
            { type: 'image_url', image_url: { url: data, detail: 'high' } },
          ]),
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }));
  if (!result.ok) return [];

  try {
    const parsed = JSON.parse(result.content) as {
      matches?: {
        photo?: number;
        person?: number;
        confidence?: number;
        face?: string;
        reason?: string;
      }[];
    };
    return (parsed.matches ?? [])
      .filter(
        (m) =>
          typeof m.photo === 'number' &&
          m.photo >= 1 &&
          m.photo <= candidates.length &&
          typeof m.person === 'number' &&
          m.person >= 1 &&
          m.person <= references.length &&
          typeof m.confidence === 'number' &&
          // Same rule as the person-first pass: a claim with no face named
          // is the confabulation the prompt exists to stop.
          !!m.face?.trim(),
      )
      .map((m) => ({
        photo: m.photo as number,
        person: m.person as number,
        confidence: m.confidence as number,
        why: [m.face, m.reason].filter(Boolean).join(' — '),
      }));
  } catch {
    return [];
  }
}

export type DayScanOutcome =
  | { status: 'done'; found: number; people: number }
  | { status: 'busy' }
  | { status: 'unavailable' }
  | { status: 'nothing-to-search' };

// Reads one day's photos against every face the app knows.
//
// Skips anyone the user already tagged on this day (nothing left to guess),
// anyone already asked about there (pending or rejected), and anyone this day
// has already been read for — so re-opening a day costs nothing, while adding
// a NEW person later makes the day worth reading again, for them alone.
export async function scanDayForFaces(day: string): Promise<DayScanOutcome> {
  if (!faceMatchingAvailable()) return { status: 'unavailable' };
  if (running()) return { status: 'busy' };

  const meta = await getAllPersonMeta();
  const tagged = await getPeopleForDay(day);
  // One read of the suggestion store, rather than one per person.
  const decidedHere = new Set(
    (await getAllSuggestions()).filter((s) => s.day === day).map((s) => s.name),
  );

  const wanted: { name: string; photoUri: string; hasFace: boolean }[] = [];
  for (const [name, m] of Object.entries(meta)) {
    if (!m.photoUri) continue;
    if (tagged.includes(name)) continue;
    if (decidedHere.has(name)) continue;
    if ((await getExaminedDays(name)).has(day)) continue;
    wanted.push({ name, photoUri: m.photoUri, hasFace: !!m.faceUri });
    if (wanted.length >= DAY_REFERENCES) break;
  }
  if (wanted.length === 0) return { status: 'nothing-to-search' };

  const timestamps = await getAllPhotoTimestamps();
  const sources = await getAllPhotoSources();
  const memories = await getLoggedMemories();
  const uris: string[] = [];
  for (const m of memories) {
    if (m.kind !== 'photo') continue;
    if (dateKey(new Date(m.takenAt)) !== day) continue;
    for (const u of m.photoUris ?? []) {
      // Screenshots are reliably face-free — app captures, receipts, maps.
      if (timestamps[u] && sources[u] !== 'screenshot') uris.push(u);
    }
  }
  if (uris.length === 0) return { status: 'nothing-to-search' };

  setScanState({ ...IDLE, day });
  try {
    const references: { name: string; data: string }[] = [];
    let cropsLeft = CROPS_PER_DAY_SCAN;
    for (const w of wanted) {
      // Budget is spent on the attempt, not on the result — a photo with no
      // findable face costs exactly as much as one with a face in it.
      const attempting = !w.hasFace && cropsLeft > 0;
      if (attempting) cropsLeft -= 1;
      const face = await referenceFaceUri(w.name, w.photoUri, attempting);
      const data = await toDataUri(face, REFERENCE_WIDTH);
      if (data) references.push({ name: w.name, data });
    }
    if (references.length === 0) return { status: 'nothing-to-search' };

    const chosen = uris.slice(0, DAY_CANDIDATES);
    const batches: { uri: string; data: string }[][] = [];
    let current: { uri: string; data: string }[] = [];
    for (const uri of chosen) {
      const data = await toDataUri(uri, CANDIDATE_WIDTH);
      if (!data) continue;
      current.push({ uri, data });
      if (current.length === BATCH_SIZE) {
        batches.push(current);
        current = [];
      }
    }
    if (current.length > 0) batches.push(current);
    if (batches.length === 0) return { status: 'nothing-to-search' };

    let added = 0;
    const totalPhotos = batches.reduce((n, x) => n + x.length, 0);
    let photosDone = 0;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const matches = await matchDayBatch(
        references,
        batch.map((c) => c.data),
      );
      for (const m of matches) {
        if (m.confidence < MIN_CONFIDENCE) continue;
        const hit = batch[m.photo - 1];
        const who = references[m.person - 1];
        if (!hit || !who) continue;
        if (
          await addSuggestion({
            name: who.name,
            day,
            photoUri: hit.uri,
            confidence: m.confidence,
            why: m.why,
          })
        )
          added += 1;
      }
      photosDone += batch.length;
      setScanState({ ...IDLE, day, done: photosDone, total: totalPhotos, found: added });
      if (b < batches.length - 1) await sleep(BATCH_PACE_MS);
    }

    // The day is now read for everyone who was in the reference set, so
    // opening it again is free. Someone added tomorrow will not be in that
    // set, and the day becomes worth reading once more, for them.
    await markDayExaminedFor(references.map((r) => r.name), day);
    return { status: 'done', found: added, people: references.length };
  } finally {
    setScanState(IDLE);
  }
}

// Days already being read, so a screen that mounts, unmounts and mounts again
// — which is every time the user taps back into it — doesn't start the same
// work twice.
const dayScansInFlight = new Set<string>();

// What the day screen calls: read this day once, quietly, and report whether
// anything new came out of it.
export async function ensureDayScanned(day: string): Promise<DayScanOutcome> {
  if (dayScansInFlight.has(day)) return { status: 'busy' };
  dayScansInFlight.add(day);
  try {
    // The user is looking at this day right now, so it goes ahead of the
    // background crawl. That only stands aside a background pass — a scan the
    // user started on a profile is theirs and keeps the machine.
    stopBackgroundFaceScan();
    for (let i = 0; i < 32 && running(); i++) await sleep(250);
    return await scanDayForFaces(day);
  } finally {
    dayScansInFlight.delete(day);
    // The machine is handed back. Standing aside was for the duration of
    // this read, not for the rest of the session — leaving the flag set
    // would silently retire the background crawl the first time the user
    // opened any day.
    cancelBackground = false;
  }
}
