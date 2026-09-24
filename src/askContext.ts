import { getAllAssumedMemories } from './assumedMemory';
import { PLACES, WEEKDAYS } from './data';
import { getLoggedMemories } from './memoryLog';
import { getAllGuesses } from './guessedPeople';
import { getAllPersonMeta, getPeopleSummaries } from './peopleTags';
import { getAllDayPlaces } from './placesFromPhotos';
import { formatDueTime, getTasks } from './tasks';
import { getUserProfile, identityForPrompt } from './userProfile';
import { ResolvedEvent, daysOfEvent } from './worldEvents';

// Builds the text the AI reads before answering.
//
// This used to dump EVERYTHING — every logged memory and every day of photo
// analysis — into one giant prompt and hope the model found the right line.
// With a year of photos (280+ days) that reliably failed: answers came back
// about the wrong day, because picking one line out of hundreds of similar
// ones is exactly what small models are worst at.
//
// Now it retrieves instead: the days the question is actually about (by
// resolved date, by resolved real-world event, and by keyword) get pulled
// out and written in full, clearly delimited, at the top. Everything else
// stays as a compact one-line index, and months older than that index get a
// single rollup line each — so no part of the log is ever completely
// invisible to a broad question.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// What the question is actually asking for, resolved before we build
// context. Produced by planQuery() in askAI.ts — dates are already resolved
// to YYYY-MM-DD, keywords are already translated to English (the user often
// writes in Arabic or franco-Arabic, which would never string-match the
// English summaries otherwise), and `events` are real-world events that
// have already been turned into date ranges (see worldEvents.ts).
export type QueryPlan = {
  dates: string[];
  keywords: string[];
  ranges?: { start: string; end: string }[];
  events?: ResolvedEvent[];
  // Real-world events the question hangs on that could NOT be dated — the
  // model didn't know, and the web lookup either failed or isn't available.
  // Passed through so the answer can say that honestly instead of quietly
  // answering a question it never actually resolved.
  unresolved?: string[];
};

// How many keyword-matched days get written out in full.
const MAX_KEYWORD_DAYS = 8;
// Days either side of a directly-asked-about date, for "around then" context.
const NEIGHBOUR_DAYS = 1;
// Cap on the compact day-by-day index, newest first.
const MAX_INDEX_DAYS = 90;
// A resolved event can span a whole month (Ramadan). Only this many of its
// days get written out in full; the rest become index lines, so "what did I
// do in Ramadan" still sees the whole month without a 30-block prompt.
const MAX_RANGE_FULL_DAYS = 12;

function longDate(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string) {
  return `${longDate(new Date(`${key}T00:00:00`))} (${key})`;
}

function shiftDay(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

function monthLabel(key: string) {
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

type DayRecord = {
  logged: string[];
  assumed?: string;
  people: string[];
  /** People the app RECOGNISED in that day's photos but the user has not
   *  confirmed. Kept apart from `people` all the way to the prompt: spoken
   *  aloud or written down, a guess and a fact read identically, and being
   *  told you saw someone is uncomfortably close to remembering that you
   *  did. */
  guessed: string[];
  places: string[];
  // How many real photos that day holds. Kept separately from `assumed` so
  // the model can tell "nothing happened" apart from "there are 14 photos
  // the app hasn't read yet" — two very different answers.
  photoCount: number;
};

async function buildDayIndex(): Promise<Map<string, DayRecord>> {
  const days = new Map<string, DayRecord>();
  const get = (key: string): DayRecord => {
    const existing = days.get(key);
    if (existing) return existing;
    const fresh: DayRecord = { logged: [], people: [], guessed: [], places: [], photoCount: 0 };
    days.set(key, fresh);
    return fresh;
  };

  for (const m of await getLoggedMemories()) {
    const key = isoDate(new Date(m.takenAt));
    const rec = get(key);
    if (m.kind === 'text' && m.text) rec.logged.push(m.text);
    else if (m.kind === 'voice') rec.logged.push(m.text ?? '(voice memory, no transcript)');
    else if (m.kind === 'photo') {
      if (m.text) rec.logged.push(m.text);
      rec.photoCount += m.photoUris?.length ?? 0;
    }
  }

  const assumed = await getAllAssumedMemories();
  for (const [key, record] of Object.entries(assumed)) {
    get(key).assumed = record.summary;
  }

  for (const person of await getPeopleSummaries()) {
    for (const day of person.days) get(day).people.push(person.name);
  }

  // Faces the app matched, which the user has not agreed to yet.
  for (const [day, guesses] of Object.entries(await getAllGuesses())) {
    const rec = get(day);
    for (const g of guesses) {
      if (!rec.people.some((n) => n.toLowerCase() === g.name.toLowerCase())) {
        rec.guessed.push(g.name);
      }
    }
  }

  for (const [key, places] of Object.entries(await getAllDayPlaces())) {
    const rec = get(key);
    for (const p of places) rec.places.push(p.label);
  }

  return days;
}

// Everything about one day, written out in full and clearly delimited so
// the model can't blur it into a neighbouring day.
function fullDayBlock(key: string, rec: DayRecord): string {
  const lines = [`=== ${dayLabel(key)} ===`];
  if (rec.logged.length > 0) {
    lines.push(`What the user logged themselves: ${rec.logged.join(' | ')}`);
  }
  if (rec.assumed) {
    lines.push(`From their photos that day (AI photo analysis, not their own words): ${rec.assumed}`);
  } else if (rec.photoCount > 0) {
    lines.push(
      `${rec.photoCount} photo(s) exist for this day but haven't been read by the photo analysis yet — so what's IN them is genuinely unknown right now. Don't guess at their content; say the photos are there but not read yet.`,
    );
  }
  if (rec.people.length > 0) lines.push(`People tagged that day: ${rec.people.join(', ')}`);
  if (rec.guessed.length > 0) {
    lines.push(
      `Faces RECOGNISED in that day's photos, NOT confirmed by the user: ${rec.guessed.join(', ')}. ` +
        `Say these as recognition, never as fact — "it looks like you saw X" or "X appears in your photos", ` +
        `never "you saw X". If the user asks whether that is certain, say plainly that the app matched a face and they have not confirmed it.`,
    );
  }
  if (rec.places.length > 0) lines.push(`Places that day: ${rec.places.join(', ')}`);
  if (lines.length === 1) lines.push('Nothing at all recorded for this day — no photos, no notes.');
  return lines.join('\n');
}

function indexLine(key: string, rec: DayRecord): string {
  const gist =
    rec.logged[0] ??
    rec.assumed ??
    (rec.photoCount > 0 ? `(${rec.photoCount} photos, not read yet)` : '');
  // A guessed name carries its "?" into the one-line index too. This list
  // is how the model decides which days to look at, and a day where someone
  // MIGHT appear is worth looking at — but it must not arrive here looking
  // like a day where they definitely did.
  const extras = [...rec.places, ...rec.people, ...rec.guessed.map((n) => `${n}?`)].join(', ');
  const text = [gist.slice(0, 70), extras.slice(0, 60)].filter(Boolean).join(' — ');
  return `- ${key}: ${text || '(nothing)'}`;
}

// One line per month for the stretch of the log that's older than the
// day-by-day index. Without this, anything more than MAX_INDEX_DAYS ago was
// invisible unless the question happened to name its exact date — which is
// how "what did I do in Ramadan?" came back as "no data" while the app had
// a full month of photos from it.
function monthRollup(month: string, records: [string, DayRecord][]): string {
  const withContent = records.filter(
    (r) => r[1].logged.length > 0 || r[1].assumed || r[1].photoCount > 0,
  );
  const places = [...new Set(records.flatMap((r) => r[1].places))].slice(0, 5);
  const people = [...new Set(records.flatMap((r) => r[1].people))].slice(0, 5);
  const bits = [`${withContent.length} day(s) with something recorded`];
  if (places.length > 0) bits.push(`places: ${places.join(', ')}`);
  if (people.length > 0) bits.push(`people: ${people.join(', ')}`);
  return `- ${month} (${monthLabel(month)}): ${bits.join('; ')}`;
}

function scoreDay(rec: DayRecord, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = [
    ...rec.logged,
    rec.assumed ?? '',
    ...rec.people,
    ...rec.places,
  ]
    .join(' ')
    .toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const term = kw.trim().toLowerCase();
    if (term.length < 3) continue;
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

// Every day the plan points at directly — named dates plus their immediate
// neighbours. Pure date math, no storage: askAI.ts calls this before
// building context, to check whether those days still need their photos
// read (see analyzeDaysNow in assumedMemory.ts).
export function focusDaysOf(plan?: QueryPlan): string[] {
  const named = (plan?.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  // Insertion order IS the priority order, and both callers depend on it:
  // it decides which day leads the context (the model answers from the
  // first block it reads) and which days get their photos read on the spot
  // when only a couple can be. Every day they actually named comes before
  // any merely-adjacent day.
  const keys = new Set<string>(named);
  for (const date of named) {
    for (let i = 1; i <= NEIGHBOUR_DAYS; i++) {
      keys.add(shiftDay(date, i));
      keys.add(shiftDay(date, -i));
    }
  }
  return [...keys];
}

// Every day covered by a resolved event or an explicit range in the plan.
// Ordered oldest-first so the first day of an event stays identifiable —
// "the first day of Ramadan" depends on it.
function rangeDaysOf(plan?: QueryPlan): string[] {
  const keys = new Set<string>();
  for (const event of plan?.events ?? []) {
    for (const day of daysOfEvent(event)) keys.add(day);
  }
  for (const range of plan?.ranges ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start)) continue;
    for (const day of daysOfEvent({ ...range, name: '', via: 'model' })) keys.add(day);
  }
  return [...keys].sort();
}

// How much a day is worth writing out in full — the user's own words beat a
// photo guess, which beats bare photos.
function contentWeight(rec: DayRecord): number {
  return rec.logged.join(' ').length * 3 + (rec.assumed?.length ?? 0) + rec.photoCount;
}

// How much each date can be leaned on. A calendar-table or web-verified
// date is solid; one the model produced from its own memory is not, and
// saying so is what stops a confabulated date being reported to the user
// as established fact.
const VIA_TRUST: Record<string, string> = {
  calendar: '',
  web: '',
  model: ' — from general knowledge, NOT verified, so say roughly/if I remember right',
};

function eventSection(events: ResolvedEvent[], days: Map<string, DayRecord>): string {
  const lines = events.map((e) => {
    const covered = daysOfEvent(e).filter((d) => days.has(d));
    const span =
      e.start === e.end
        ? dayLabel(e.start)
        : `${dayLabel(e.start)} through ${dayLabel(e.end)}`;
    const recorded =
      covered.length > 0
        ? `The user has something recorded on ${covered.length} of those days.`
        : 'The user has nothing recorded on any of those days.';
    const note = e.note ? ` (${e.note})` : '';
    return `- ${e.name}: ${span}${note}${VIA_TRUST[e.via] ?? ''}. ${recorded}`;
  });
  return `WHEN THE EVENT(S) IN THE QUESTION ACTUALLY HAPPENED — use these dates, and tell the user the date rather than asking them for it:\n${lines.join('\n')}`;
}

export async function buildMemoryContext(
  plan?: QueryPlan,
  // 'compact' drops the day index, the month rollups and the
  // People/Places/Tasks directories, keeping only the days actually
  // retrieved for this question. Used to retry after a token-limit
  // rejection: resending the same oversized payload could never have
  // worked, a much smaller one usually does.
  mode: 'full' | 'compact' = 'full',
): Promise<string> {
  const sections: string[] = [];
  const today = new Date();
  sections.push(`Today's date is ${longDate(today)} (${isoDate(today)}).`);

  // Who's asking. Without this the assistant is describing a life it can't
  // name — it can't tell that "I" and the user's own name are the same
  // person, and it has no standing context about their work or family.
  const identity = identityForPrompt(await getUserProfile());
  if (identity) sections.push(`WHO YOU ARE TALKING TO: ${identity}`);

  const days = await buildDayIndex();

  // 0 — What the real-world event in the question resolves to. Goes first
  // because it's the thing that makes the rest of the retrieval make sense.
  if ((plan?.events?.length ?? 0) > 0) {
    sections.push(eventSection(plan!.events!, days));
  }

  if ((plan?.unresolved?.length ?? 0) > 0) {
    sections.push(
      `COULDN'T DATE THIS: ${plan!.unresolved!.join('; ')}. You do not know when that happened, and guessing a date would send the user to the wrong day. Say plainly that you couldn't pin down the date, and ask them for it — once they give you a date you can look that day up properly.`,
    );
  }

  // 1 — Days the question named directly, plus their immediate neighbours,
  // in the priority order focusDaysOf established.
  const focusOrder = focusDaysOf(plan);
  const focusKeys = new Set(focusOrder);

  // 2 — Days inside a resolved event or range. The richest ones get written
  // out in full (always including the event's own first day, since "the
  // first day of X" is a question people actually ask); the rest become
  // index lines so the whole span is still visible.
  const rangeAll = rangeDaysOf(plan).filter((k) => days.has(k) && !focusKeys.has(k));
  const rangeFull = new Set<string>();
  if (rangeAll.length > 0) {
    rangeFull.add(rangeAll[0]);
    const byWeight = [...rangeAll]
      .sort((a, b) => contentWeight(days.get(b)!) - contentWeight(days.get(a)!))
      .slice(0, MAX_RANGE_FULL_DAYS);
    for (const k of byWeight) rangeFull.add(k);
  }
  const rangeIndexed = rangeAll.filter((k) => !rangeFull.has(k));

  // 3 — Days whose content matches the question's keywords.
  const keywordKeys: string[] = [];
  if ((plan?.keywords?.length ?? 0) > 0) {
    const scored = [...days.entries()]
      .map(([key, rec]) => ({ key, score: scoreDay(rec, plan!.keywords) }))
      .filter((s) => s.score > 0 && !focusKeys.has(s.key) && !rangeFull.has(s.key))
      .sort((a, b) => b.score - a.score || b.key.localeCompare(a.key))
      .slice(0, MAX_KEYWORD_DAYS);
    for (const s of scored) keywordKeys.push(s.key);
  }

  const askedAbout = focusOrder.filter((k) => days.has(k));
  const rangeBlocks = [...rangeFull].sort();
  const primary = [...askedAbout, ...rangeBlocks];

  if (primary.length > 0) {
    sections.push(
      `THE DAY(S) THE USER IS ASKING ABOUT — answer from these first:\n\n${primary
        .map((k) => fullDayBlock(k, days.get(k)!))
        .join('\n\n')}`,
    );
  } else if ((plan?.dates?.length ?? 0) > 0 || rangeAll.length > 0) {
    const asked = [...(plan?.dates ?? []), ...rangeDaysOf(plan).slice(0, 3)];
    sections.push(
      `The user is asking about ${asked.join(', ')}${rangeAll.length > 0 ? ' and the days around them' : ''}, and there is genuinely nothing recorded for any of those days — no photos, no notes.`,
    );
  }

  if (rangeIndexed.length > 0) {
    sections.push(
      `THE REST OF THAT PERIOD (one line each, oldest first):\n${rangeIndexed
        .map((k) => indexLine(k, days.get(k)!))
        .join('\n')}`,
    );
  }

  if (keywordKeys.length > 0) {
    sections.push(
      `OTHER DAYS THAT MATCH WHAT THEY ASKED:\n\n${keywordKeys
        .map((k) => fullDayBlock(k, days.get(k)!))
        .join('\n\n')}`,
    );
  }

  // 4 — Compact index of everything else, so broad questions still work.
  if (mode === 'compact') return sections.join('\n\n');

  const detailed = new Set([...primary, ...rangeIndexed, ...keywordKeys]);
  const remaining = [...days.keys()].filter((k) => !detailed.has(k)).sort().reverse();
  const indexKeys = remaining.slice(0, MAX_INDEX_DAYS);
  if (indexKeys.length > 0) {
    sections.push(
      `INDEX OF RECENT DAYS (one line each, newest first — use these only to spot a day worth mentioning; the detail above is what you answer from):\n${indexKeys
        .map((k) => indexLine(k, days.get(k)!))
        .join('\n')}`,
    );
  }

  // 5 — One line per month for everything older than that index, grouped
  // newest month first. Enough for the model to know a period exists and
  // is worth asking about, without any of its detail.
  const older = remaining.slice(MAX_INDEX_DAYS);
  if (older.length > 0) {
    const byMonth = new Map<string, [string, DayRecord][]>();
    for (const key of older) {
      const month = key.slice(0, 7);
      const bucket = byMonth.get(month) ?? [];
      bucket.push([key, days.get(key)!]);
      byMonth.set(month, bucket);
    }
    const monthLines = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, records]) => monthRollup(month, records));
    sections.push(
      `MONTHS FURTHER BACK (summary only — if the answer is in one of these, say which month and that you can look closer):\n${monthLines.join('\n')}`,
    );
  }

  // People directory — real people the user tagged on their days, so the
  // assistant can resolve "when did I last see X" / "who was I with".
  const people = await getPeopleSummaries();
  if (people.length > 0) {
    const personMeta = await getAllPersonMeta();
    const peopleLines = people.map((p) => {
      const meta = personMeta[p.name];
      const who = meta?.descriptor ? ` (${meta.descriptor})` : '';
      const notes =
        meta && meta.mentions.length > 0
          ? ` Notes: ${meta.mentions
              .slice(0, 5)
              .map((m) => `[${m.day}] ${m.text}`)
              .join(' | ')}`
          : '';
      // A person the user added by hand may not be on any day yet — saying
      // "last on undefined" would be nonsense for the model to reason from.
      const seen = p.lastSeenDay
        ? `seen on ${p.days.length} day(s); last on ${p.lastSeenDay}.`
        : 'not on any logged day yet.';
      return `- ${p.name}${who}: ${seen}${notes}`;
    });
    sections.push(`People the user has tagged in their days:\n${peopleLines.join('\n')}`);
  }

  sections.push(`Places the user frequents:\n${PLACES.map((p) => `- ${p.name}`).join('\n')}`);

  const tasks = await getTasks();
  if (tasks.length > 0) {
    const taskLines = tasks.map((t) => {
      const due = t.dueDate
        ? `, due ${t.dueDate}${t.dueTime ? ` at ${formatDueTime(t.dueTime)}` : ''}`
        : '';
      return `- ${t.title} (${t.done ? 'done' : 'not done'})${due}`;
    });
    sections.push(`Tasks:\n${taskLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
