import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textAvailable, textProviders } from './aiProviders';
import { getAllAssumedMemories } from './assumedMemory';
import { getAllDayMarkers } from './dayMarkers';
import { getAllGuesses } from './guessedPeople';
import { dateKey, getMemoriesByDay, memoryDisplayText, type LoggedMemory } from './memoryLog';
import { getAllPhotoSources } from './photoMeta';
import { getAllDayPlaces } from './places';
import { getPeopleForDay } from './peopleTags';

// Recap: the key events of a week, a month or a year, a few lines each —
// not every detail. Weekly shows each day; monthly shows each week; yearly
// shows each month. Every line is written from what the app knows about
// those days: what the user logged, who and where, the moments they
// marked, and — when they allowed it — what their photos showed.
//
// A GUESS IS NEVER PASSED OFF AS FACT. What the photos "showed" is Recall's
// reading of them, and people recognised by face are not confirmed. Each
// line records whether it leaned on either, and the page says so at the
// bottom when any did.
//
// Only text goes to the AI here — the words already written about each
// day. No photo is sent to make a recap.

export type RecapKind = 'week' | 'month' | 'year';

/** One row of a recap: a day (in a week), a week (in a month), a month (in
 *  a year). */
export type RecapUnit = {
  key: string;
  /** "Monday", "Week of 1 Sep", "January". */
  title: string;
  /** "OCT 01", "SEP 1–7", "JAN". */
  chip: string;
  /** Short label for the photo strip: "01", "08", "JAN". */
  tile: string;
  from: string;
  to: string;
  /** A photo from inside the unit, for its tile. */
  photo?: string;
};

export type RecapLine = {
  summary: string;
  /** Leaned on something the app guessed (photo reading, recognised faces). */
  guessed: boolean;
};

export type RecapPeriod = {
  kind: RecapKind;
  /** "This Week", "Last Week", "September", "2026". */
  title: string;
  /** "OCT 1–7", "2026", "". */
  range: string;
  units: RecapUnit[];
};

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-first, like the Tasks page. */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function span(a: Date, b: Date): string {
  return a.getMonth() === b.getMonth()
    ? `${MONTHS_SHORT[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
    : `${MONTHS_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTHS_SHORT[b.getMonth()]} ${b.getDate()}`;
}

/** The header's two lines, as in the design: "OCT" over "1–7"; across two
 *  months "SEP–OCT" over "28–4". */
function headerRange(a: Date, b: Date): string {
  return a.getMonth() === b.getMonth()
    ? `${MONTHS_SHORT[a.getMonth()]}\n${a.getDate()}–${b.getDate()}`
    : `${MONTHS_SHORT[a.getMonth()]}–${MONTHS_SHORT[b.getMonth()]}\n${a.getDate()}–${b.getDate()}`;
}

/** The period `offset` steps back from now (0 = this one). */
export function recapPeriod(kind: RecapKind, offset: number, now = new Date()): RecapPeriod {
  if (kind === 'week') {
    const start = addDays(mondayOf(now), offset * 7);
    const end = addDays(start, 6);
    const units: RecapUnit[] = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const k = dateKey(d);
      return {
        key: k,
        title: WEEKDAYS[d.getDay()],
        chip: `${MONTHS_SHORT[d.getMonth()]} ${pad(d.getDate())}`,
        tile: pad(d.getDate()),
        from: k,
        to: k,
      };
    });
    return {
      kind,
      title: offset === 0 ? 'This\nWeek' : offset === -1 ? 'Last\nWeek' : 'Earlier\nWeek',
      range: headerRange(start, end),
      units,
    };
  }
  if (kind === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const units: RecapUnit[] = [];
    for (let d = first; d <= last; d = addDays(d, 7)) {
      const end = addDays(d, 6) > last ? last : addDays(d, 6);
      units.push({
        key: dateKey(d),
        title: `Week ${units.length + 1}`,
        chip: span(d, end),
        tile: pad(d.getDate()),
        from: dateKey(d),
        to: dateKey(end),
      });
    }
    return { kind, title: MONTHS[first.getMonth()], range: String(first.getFullYear()), units };
  }
  const year = now.getFullYear() + offset;
  const units: RecapUnit[] = MONTHS.map((name, m) => {
    const from = new Date(year, m, 1);
    const to = new Date(year, m + 1, 0);
    return {
      key: `${year}-${pad(m + 1)}`,
      title: name,
      chip: `${MONTHS_SHORT[m]} ${year}`,
      tile: MONTHS_SHORT[m],
      from: dateKey(from),
      to: dateKey(to),
    };
  });
  return { kind, title: offset === 0 ? 'This\nYear' : 'Year', range: String(year), units };
}

// ── What the app knows about each day ─────────────────────────────────────

type DayFacts = {
  day: string;
  logged: string[];
  /** What the photos looked like — the app's reading, only when allowed. */
  photoGuess?: string;
  people: string[];
  guessedPeople: string[];
  places: string[];
  moments: string[];
  photos: string[];
};

type World = Map<string, DayFacts>;

let worldCache: { at: number; world: Promise<World> } | null = null;

async function buildWorld(): Promise<World> {
  const [byDay, stories, guesses, places, markers, sources] = await Promise.all([
    getMemoriesByDay(),
    getAllAssumedMemories(),
    getAllGuesses(),
    getAllDayPlaces(),
    getAllDayMarkers(),
    getAllPhotoSources(),
  ]);
  const days = new Set<string>([
    ...byDay.keys(),
    ...Object.keys(stories),
    ...Object.keys(places),
    ...Object.keys(markers),
  ]);
  const world: World = new Map();
  for (const day of days) {
    const memories: LoggedMemory[] = byDay.get(day) ?? [];
    const people = await getPeopleForDay(day);
    world.set(day, {
      day,
      logged: memories.map(memoryDisplayText).filter((t): t is string => !!t),
      photoGuess: stories[day]?.summary,
      people,
      guessedPeople: (guesses[day] ?? [])
        .map((g) => g.name)
        .filter((n) => !people.some((p) => p.toLowerCase() === n.toLowerCase())),
      places: (places[day] ?? []).filter((p) => p.named).map((p) => p.label),
      moments: (markers[day] ?? []).map((m) => m.label),
      photos: memories
        .filter((m) => m.kind === 'photo')
        .flatMap((m) => m.photoUris ?? [])
        .filter((u) => sources[u] !== 'screenshot'),
    });
  }
  return world;
}

async function world(): Promise<World> {
  if (worldCache && Date.now() - worldCache.at < 5000) return worldCache.world;
  const w = buildWorld();
  worldCache = { at: Date.now(), world: w };
  w.catch(() => {
    worldCache = null;
  });
  return w;
}

// Only days that have happened. A plan on a future day — an appointment's
// icon on the 8th, a flight on the 23rd — is not something that happened,
// and a recap that says it did is inventing the user's past. (It did, in
// the first test: "had a dentist appointment on the 8th" before the 8th.)
function daysIn(unit: RecapUnit, today = dateKey(new Date())): string[] {
  const out: string[] = [];
  const [y, m, d] = unit.from.split('-').map(Number);
  for (let x = new Date(y, m - 1, d); dateKey(x) <= unit.to && dateKey(x) <= today; x = addDays(x, 1)) {
    out.push(dateKey(x));
  }
  return out;
}

function hasAnything(f: DayFacts): boolean {
  return f.logged.length + f.people.length + f.places.length + f.moments.length > 0 || !!f.photoGuess;
}

/** The units that have something to tell, with a photo for each tile. */
export async function unitsWithContent(period: RecapPeriod): Promise<{ unit: RecapUnit; hasContent: boolean }[]> {
  const w = await world();
  return period.units.map((unit) => {
    const facts = daysIn(unit).map((d) => w.get(d)).filter((f): f is DayFacts => !!f);
    return {
      unit: { ...unit, photo: facts.find((f) => f.photos.length > 0)?.photos[0] },
      hasContent: facts.some(hasAnything),
    };
  });
}

/** Photos from across the whole period, shuffled — the monthly header's
 *  slideshow. Days that have not happened yet have none. */
export async function periodPhotos(period: RecapPeriod, limit = 40): Promise<string[]> {
  const w = await world();
  const all = period.units.flatMap((u) => daysIn(u).flatMap((d) => w.get(d)?.photos ?? []));
  const unique = [...new Set(all)];
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, limit);
}

// ── Writing the lines ─────────────────────────────────────────────────────

const PROMPT_VERSION = 4;
const CACHE_PREFIX = 'recap:';

type Cached = RecapLine & { signature: string; v: number };

function factsText(f: DayFacts, perDayLimit: number): { text: string; guessed: boolean } {
  const parts: string[] = [];
  if (f.logged.length) parts.push(`The user logged: ${f.logged.join(' / ')}`);
  if (f.places.length) parts.push(`Places: ${f.places.join(', ')}`);
  if (f.people.length) parts.push(`With (confirmed): ${f.people.join(', ')}`);
  if (f.moments.length) parts.push(`Marked: ${f.moments.join(', ')}`);
  let guessed = false;
  if (f.guessedPeople.length) {
    parts.push(`Faces recognised, NOT confirmed: ${f.guessedPeople.join(', ')}`);
    guessed = true;
  }
  if (f.photoGuess) {
    parts.push(`PHOTO GUESS (Recall's reading of the photos, not the user's words): ${f.photoGuess}`);
    guessed = true;
  }
  const text = parts.join('\n').slice(0, perDayLimit);
  return { text, guessed };
}

const PROMPT = `You write one entry of the user's recap in Recall, a personal memory app. The user often forgets what happened; this entry gives them back the KEY events of the stretch of time below — not every detail. The screen shows a few lines per entry.

Write AT MOST 2 short sentences, about 30 words in all, second person, past tense, in the style "Had your design class at 10 AM. Stayed after to get feedback on your project." — no "you" needed at the start of each sentence. Lead with what mattered most: people seen, places, anything unusual, moments marked. Leave out routine and repetition. For a week or a month, pick the highlights across it; do not list every day.

Only tell what happened — never talk about the records, the app, the photos as files, or what is missing ("not much was logged", "the only image"). If little is known, say that little plainly, in one sentence.

Never invent anything. Facts marked PHOTO GUESS or "NOT confirmed" are Recall's guesses: if you use them, hedge ("looks like", "seems"), and set "guessed" to true. Otherwise "guessed" is false.

Write in the language the user logged in; if they mix Arabic and English, you may too.

Respond with ONLY JSON: {"summary": "...", "guessed": true|false}`;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** The line for one unit — cached until what it is written from changes.
 *  Null when there is nothing to tell. */
export async function recapLine(kind: RecapKind, unit: RecapUnit): Promise<RecapLine | null> {
  const w = await world();
  const facts = daysIn(unit)
    .map((d) => w.get(d))
    .filter((f): f is DayFacts => !!f && hasAnything(f));
  if (facts.length === 0) return null;

  const perDay = kind === 'week' ? 2500 : kind === 'month' ? 700 : 300;
  const blocks = facts.map((f) => ({ day: f.day, ...factsText(f, perDay) }));
  const input = blocks.map((b) => `${b.day}:\n${b.text}`).join('\n\n').slice(0, 12000);
  const anyGuess = blocks.some((b) => b.guessed);
  const signature = hash(`${PROMPT_VERSION}|${kind}|${input}`);

  const key = `${CACHE_PREFIX}${kind}:${unit.key}`;
  const raw = await AsyncStorage.getItem(key);
  if (raw) {
    const cached = JSON.parse(raw) as Cached;
    if (cached.signature === signature && cached.v === PROMPT_VERSION) return cached;
  }

  if (!textAvailable()) return fallbackLine(blocks, anyGuess);
  const stretch = kind === 'week' ? 'one day' : kind === 'month' ? 'one week' : 'one month';
  const result = await chatCompletion(textProviders(), (model) => ({
    model,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `This entry covers ${stretch}: ${unit.title} (${unit.from} to ${unit.to}).\n\n${input}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  }));
  if (!result.ok) {
    console.warn(`[recap] could not write ${kind} ${unit.key}: HTTP ${result.status}`);
    return fallbackLine(blocks, anyGuess);
  }
  try {
    const parsed = JSON.parse(result.content) as { summary?: string; guessed?: boolean };
    const summary = parsed.summary?.trim();
    if (!summary) return fallbackLine(blocks, anyGuess);
    // Trust the model saying it used a guess; never trust it saying it did
    // not when there was one and it wrote from little else.
    const onlyGuess = blocks.every((b) => !b.text.includes('The user logged'));
    const line: RecapLine = { summary, guessed: anyGuess && (parsed.guessed !== false || onlyGuess) };
    await AsyncStorage.setItem(key, JSON.stringify({ ...line, signature, v: PROMPT_VERSION } satisfies Cached));
    return line;
  } catch {
    return fallbackLine(blocks, anyGuess);
  }
}

// Offline or no AI: the first thing the user wrote, unchanged. Honest and
// still useful.
function fallbackLine(blocks: { text: string; guessed: boolean }[], anyGuess: boolean): RecapLine | null {
  for (const b of blocks) {
    const m = b.text.match(/^The user logged: (.+)$/m);
    if (m) return { summary: m[1].split(' / ')[0].slice(0, 220), guessed: false };
  }
  const guess = blocks.find((b) => b.guessed)?.text.match(/PHOTO GUESS[^:]*: (.+)$/m)?.[1];
  return guess ? { summary: guess.slice(0, 220), guessed: anyGuess } : null;
}

