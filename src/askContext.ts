import { getAllAssumedMemories } from './assumedMemory';
import { PLACES, WEEKDAYS } from './data';
import { getLoggedMemories } from './memoryLog';
import { getAllPersonMeta, getPeopleSummaries } from './peopleTags';
import { getAllDayPlaces } from './placesFromPhotos';
import { formatDueTime, getTasks } from './tasks';

// Builds the text the AI reads before answering.
//
// This used to dump EVERYTHING — every logged memory and every day of photo
// analysis — into one giant prompt and hope the model found the right line.
// With a year of photos (280+ days) that reliably failed: answers came back
// about the wrong day, because picking one line out of hundreds of similar
// ones is exactly what small models are worst at.
//
// Now it retrieves instead: the days the question is actually about (by
// resolved date and by keyword) get pulled out and written in full, clearly
// delimited, at the top. Everything else stays as a compact one-line index
// so broad questions ("did I ever…") still have something to match on.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// What the question is actually asking for, resolved before we build
// context. Produced by planQuery() in askAI.ts — dates are already resolved
// to YYYY-MM-DD, keywords are already translated to English (the user often
// writes in Arabic or franco-Arabic, which would never string-match the
// English summaries otherwise).
export type QueryPlan = { dates: string[]; keywords: string[] };

// How many keyword-matched days get written out in full.
const MAX_KEYWORD_DAYS = 8;
// Days either side of a directly-asked-about date, for "around then" context.
const NEIGHBOUR_DAYS = 1;
// Cap on the compact index, newest first.
const MAX_INDEX_DAYS = 90;

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

type DayRecord = {
  logged: string[];
  assumed?: string;
  people: string[];
  places: string[];
};

async function buildDayIndex(): Promise<Map<string, DayRecord>> {
  const days = new Map<string, DayRecord>();
  const get = (key: string): DayRecord => {
    const existing = days.get(key);
    if (existing) return existing;
    const fresh: DayRecord = { logged: [], people: [], places: [] };
    days.set(key, fresh);
    return fresh;
  };

  for (const m of await getLoggedMemories()) {
    const key = isoDate(new Date(m.takenAt));
    const rec = get(key);
    if (m.kind === 'text' && m.text) rec.logged.push(m.text);
    else if (m.kind === 'voice') rec.logged.push(m.text ?? '(voice memory, no transcript)');
    else if (m.kind === 'photo' && m.text) rec.logged.push(m.text);
  }

  const assumed = await getAllAssumedMemories();
  for (const [key, record] of Object.entries(assumed)) {
    get(key).assumed = record.summary;
  }

  for (const person of await getPeopleSummaries()) {
    for (const day of person.days) get(day).people.push(person.name);
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
  }
  if (rec.people.length > 0) lines.push(`People tagged that day: ${rec.people.join(', ')}`);
  if (rec.places.length > 0) lines.push(`Places that day: ${rec.places.join(', ')}`);
  if (lines.length === 1) lines.push('Nothing recorded for this day.');
  return lines.join('\n');
}

function indexLine(key: string, rec: DayRecord): string {
  const gist = rec.logged[0] ?? rec.assumed ?? '';
  const extras = [...rec.places, ...rec.people].join(', ');
  const text = [gist.slice(0, 70), extras.slice(0, 60)].filter(Boolean).join(' — ');
  return `- ${key}: ${text || '(photos only)'}`;
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

export async function buildMemoryContext(
  plan?: QueryPlan,
  // 'compact' drops the day index and the People/Places/Tasks directories,
  // keeping only the days actually retrieved for this question. Used to
  // retry after a token-limit rejection: resending the same oversized
  // payload could never have worked, a much smaller one usually does.
  mode: 'full' | 'compact' = 'full',
): Promise<string> {
  const sections: string[] = [];
  const today = new Date();
  sections.push(`Today's date is ${longDate(today)} (${isoDate(today)}).`);

  const days = await buildDayIndex();

  // 1 — Days the question named directly, plus their immediate neighbours.
  const focusKeys = new Set<string>();
  for (const date of plan?.dates ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    focusKeys.add(date);
    for (let i = 1; i <= NEIGHBOUR_DAYS; i++) {
      focusKeys.add(shiftDay(date, -i));
      focusKeys.add(shiftDay(date, i));
    }
  }

  // 2 — Days whose content matches the question's keywords.
  const keywordKeys: string[] = [];
  if ((plan?.keywords?.length ?? 0) > 0) {
    const scored = [...days.entries()]
      .map(([key, rec]) => ({ key, score: scoreDay(rec, plan!.keywords) }))
      .filter((s) => s.score > 0 && !focusKeys.has(s.key))
      .sort((a, b) => b.score - a.score || b.key.localeCompare(a.key))
      .slice(0, MAX_KEYWORD_DAYS);
    for (const s of scored) keywordKeys.push(s.key);
  }

  const askedAbout = [...focusKeys].filter((k) => days.has(k)).sort().reverse();
  if (askedAbout.length > 0) {
    sections.push(
      `THE DAY(S) THE USER IS ASKING ABOUT — answer from these first:\n\n${askedAbout
        .map((k) => fullDayBlock(k, days.get(k)!))
        .join('\n\n')}`,
    );
  } else if ((plan?.dates?.length ?? 0) > 0) {
    sections.push(
      `The user asked about ${plan!.dates.join(', ')}, but there is nothing recorded for those days.`,
    );
  }

  if (keywordKeys.length > 0) {
    sections.push(
      `OTHER DAYS THAT MATCH WHAT THEY ASKED:\n\n${keywordKeys
        .map((k) => fullDayBlock(k, days.get(k)!))
        .join('\n\n')}`,
    );
  }

  // 3 — Compact index of everything else, so broad questions still work.
  if (mode === 'compact') return sections.join('\n\n');

  const detailed = new Set([...askedAbout, ...keywordKeys]);
  const indexKeys = [...days.keys()]
    .filter((k) => !detailed.has(k))
    .sort()
    .reverse()
    .slice(0, MAX_INDEX_DAYS);
  if (indexKeys.length > 0) {
    sections.push(
      `INDEX OF EVERY OTHER DAY (one line each, newest first — use these only to spot a day worth mentioning; the detail above is what you answer from):\n${indexKeys
        .map((k) => indexLine(k, days.get(k)!))
        .join('\n')}`,
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
      return `- ${p.name}${who}: seen on ${p.days.length} day(s); last on ${p.lastSeenDay}.${notes}`;
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
