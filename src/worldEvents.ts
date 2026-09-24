import AsyncStorage from '@react-native-async-storage/async-storage';

// Turns a real-world event named in a question into actual calendar dates,
// so the Ask feature can go look those days up in the user's own memory.
//
// This is the missing half of a question like "what did I do on the first
// day of Ramadan?" — the app has the photos from that day, but it had no
// idea which day that was, so it answered "nothing recorded". Same for
// "where did I watch the last Clasico?": the memory log never says
// "Clasico", it says whatever was in the photos that evening. The event
// has to become a DATE before any of the personal data is reachable.
//
// Three tiers, cheapest and most certain first:
//   1. LOCAL TABLE — the recurring dates this user actually asks about
//      (Ramadan, both Eids, Coptic Christmas, Egyptian national days).
//      Exact, free, offline, and no model can second-guess it.
//   2. MODEL — the chat model's own general knowledge, with an explicit
//      "am I sure?" flag. Free: it rides along on the search-plan call.
//   3. WEB — only for what tier 2 said it wasn't sure about. Costs an
//      OpenAI search call, so every lookup is cached.

export type EventVia = 'calendar' | 'model' | 'web';

export type ResolvedEvent = {
  // How to name it back to the user: "Ramadan 2026", "El Clasico".
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD — same as start for a single-day event
  // Surfaced to the model so it can hedge honestly when the date itself
  // is approximate (moon sighting, or a web result that was vague).
  note?: string;
  // Days of tolerance either side when looking for the user's days. Kept
  // separate from start/end on purpose: the date we TELL the user has to
  // stay the real one ("Ramadan started 17 Feb"), while the window we
  // SEARCH can be a day wider to absorb a sighting that ran late.
  slack?: number;
  via: EventVia;
};

// ---------------------------------------------------------------------------
// Tier 1 — the local calendar
// ---------------------------------------------------------------------------

// Islamic-calendar dates as actually OBSERVED in Egypt, not as computed by
// any one algorithm: the start of a lunar month depends on a moon sighting,
// so published tables disagree with each other by a day, and with reality
// by a day. Rather than pretend to a precision that doesn't exist, every
// lookup here is widened by a day at each end (see occurrencesOf) and
// carries a note saying so. Correcting a row is just editing the string.
//
// Ramadan: first day, and the last day before Eid al-Fitr.
const RAMADAN: Record<number, [string, string]> = {
  2019: ['2019-05-06', '2019-06-03'],
  2020: ['2020-04-24', '2020-05-23'],
  2021: ['2021-04-13', '2021-05-12'],
  2022: ['2022-04-02', '2022-05-01'],
  2023: ['2023-03-23', '2023-04-20'],
  2024: ['2024-03-11', '2024-04-09'],
  2025: ['2025-03-01', '2025-03-30'],
  2026: ['2026-02-17', '2026-03-18'],
  2027: ['2027-02-07', '2027-03-08'],
  2028: ['2028-01-27', '2028-02-25'],
  2029: ['2029-01-15', '2029-02-13'],
  2030: ['2030-01-05', '2030-02-03'],
};

// Eid al-Fitr — three days, first day listed.
const EID_FITR: Record<number, string> = {
  2019: '2019-06-04',
  2020: '2020-05-24',
  2021: '2021-05-13',
  2022: '2022-05-02',
  2023: '2023-04-21',
  2024: '2024-04-10',
  2025: '2025-03-31',
  2026: '2026-03-19',
  2027: '2027-03-09',
  2028: '2028-02-26',
  2029: '2029-02-14',
  2030: '2030-02-04',
};

// Eid al-Adha — four days, first day (10 Dhul-Hijjah) listed.
const EID_ADHA: Record<number, string> = {
  2019: '2019-08-11',
  2020: '2020-07-31',
  2021: '2021-07-20',
  2022: '2022-07-09',
  2023: '2023-06-28',
  2024: '2024-06-16',
  2025: '2025-06-06',
  2026: '2026-05-27',
  2027: '2027-05-16',
  2028: '2028-05-05',
  2029: '2029-04-24',
  2030: '2030-04-13',
};

const ISLAMIC_NEW_YEAR: Record<number, string> = {
  2022: '2022-07-30',
  2023: '2023-07-19',
  2024: '2024-07-07',
  2025: '2025-06-26',
  2026: '2026-06-16',
  2027: '2027-06-06',
  2028: '2028-05-25',
  2029: '2029-05-14',
};

const MAWLID: Record<number, string> = {
  2022: '2022-10-08',
  2023: '2023-09-27',
  2024: '2024-09-15',
  2025: '2025-09-04',
  2026: '2026-08-25',
  2027: '2027-08-14',
  2028: '2028-08-03',
  2029: '2029-07-23',
};

// Sham El-Nessim — the Monday after Coptic Easter, so it moves too.
const SHAM_EL_NESSIM: Record<number, string> = {
  2022: '2022-04-25',
  2023: '2023-04-17',
  2024: '2024-05-06',
  2025: '2025-04-21',
  2026: '2026-04-13',
  2027: '2027-05-03',
  2028: '2028-04-17',
  2029: '2029-04-09',
};

type Alias = { aliases: string[]; label: string };

// The question text, flattened so one alias can cover the many ways the
// same thing gets typed. The big win is dropping the Arabic definite
// article: "eid el kbeer", "eid al-kbeer" and "eid kbeer" all become the
// same string, so the alias lists stay short instead of trying to
// enumerate every spelling. Only standalone el/al are dropped, so words
// that merely start with those letters ("al3a" = castle) survive.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\b3eed\b/g, 'eid')
    .replace(/\b(el|al|le)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Everything the user might type for each event, in the three ways they
// actually write: English, Arabic script, and franco-Arabic (Arabic in
// Latin letters). Matched against normalize()d text, so every alias here
// is written in normalized form too — no "el"/"al", no hyphens.
//
// `moon` marks the events whose start depends on a moon sighting: those
// get a day of search tolerance and an honest note. Sham El-Nessim
// follows Coptic Easter, so its date is fixed once the year is known.
const MOVABLE: (Alias & {
  table: Record<number, string | [string, string]>;
  days: number;
  moon: boolean;
})[] = [
  {
    label: 'Ramadan',
    aliases: ['ramadan', 'ramdan', 'ramadaan', 'رمضان'],
    table: RAMADAN,
    days: 0, // the range comes from the table itself
    moon: true,
  },
  {
    label: 'Eid al-Fitr',
    aliases: [
      'eid fitr',
      'eid fetr',
      'small eid',
      'eid soghayar',
      'عيد الفطر',
      'العيد الصغير',
    ],
    table: EID_FITR,
    days: 3,
    moon: true,
  },
  {
    label: 'Eid al-Adha',
    aliases: [
      'eid adha',
      'big eid',
      'eid kebir',
      'eid kbeer',
      'eid kabir',
      'bayram',
      'عيد الاضحى',
      'عيد الأضحى',
      'العيد الكبير',
    ],
    table: EID_ADHA,
    days: 4,
    moon: true,
  },
  {
    label: 'Islamic New Year',
    aliases: ['islamic new year', 'hijri new year', 'muharram', 'رأس السنة الهجرية', 'محرم'],
    table: ISLAMIC_NEW_YEAR,
    days: 1,
    moon: true,
  },
  {
    label: "Prophet's Birthday (Mawlid)",
    aliases: ['mawlid', 'mouled', 'moulid', 'المولد النبوي', 'المولد'],
    table: MAWLID,
    days: 1,
    moon: true,
  },
  {
    label: 'Sham El-Nessim',
    aliases: ['sham nessim', 'shamelnessim', 'شم النسيم'],
    table: SHAM_EL_NESSIM,
    days: 1,
    moon: false,
  },
];

// Same day every year, so no table needed — just month and day.
const FIXED: (Alias & { month: number; day: number; days: number })[] = [
  {
    label: 'New Year',
    // "ras el sana" is written without the "el": normalize() strips the
    // article from the question before matching, so an alias that still
    // carries one can never match.
    aliases: ['new year', 'ras sana', 'ras sena', 'رأس السنة'],
    month: 1,
    day: 1,
    days: 1,
  },
  {
    label: 'Coptic Christmas',
    aliases: ['coptic christmas', 'orthodox christmas', 'عيد الميلاد المجيد'],
    month: 1,
    day: 7,
    days: 1,
  },
  {
    label: '25 January Revolution Day',
    aliases: ['25 january', 'january 25', 'police day', 'ثورة يناير'],
    month: 1,
    day: 25,
    days: 1,
  },
  {
    label: 'Sinai Liberation Day',
    aliases: ['sinai liberation', 'تحرير سيناء'],
    month: 4,
    day: 25,
    days: 1,
  },
  {
    label: 'Labour Day',
    aliases: ['labour day', 'labor day', 'عيد العمال'],
    month: 5,
    day: 1,
    days: 1,
  },
  {
    label: '30 June Revolution',
    aliases: ['30 june', 'june 30', '٣٠ يونيو'],
    month: 6,
    day: 30,
    days: 1,
  },
  {
    label: '23 July Revolution Day',
    aliases: ['23 july', 'july 23', 'ثورة يوليو'],
    month: 7,
    day: 23,
    days: 1,
  },
  {
    label: 'Armed Forces Day (6 October)',
    aliases: ['6 october', 'october 6', 'october war', 'نصر اكتوبر'],
    month: 10,
    day: 6,
    days: 1,
  },
  {
    label: 'Christmas',
    aliases: ['christmas', 'xmas', 'كريسماس'],
    month: 12,
    day: 25,
    days: 1,
  },
];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shift(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}

const HAS_YEAR = /\b(19|20)\d{2}\b/;

// Which year of a recurring event the question means. An explicit year in
// the text wins. Otherwise we walk back from this year — occurrencesOf
// drops anything still in the future, so "Ramadan" asked in September
// resolves to this year's, while "Ramadan" asked in January resolves to
// last year's rather than to one that hasn't happened yet.
function yearsToTry(text: string, today: Date): number[] {
  const explicit = text.match(/\b(19|20)\d{2}\b/g);
  if (explicit) return [...new Set(explicit.map(Number))];
  const thisYear = today.getFullYear();
  return [thisYear, thisYear - 1, thisYear - 2];
}

const MOON_NOTE = 'the start depends on the moon sighting, so it can be a day off either way';

// A bare "eid" / "عيد" with nothing to say which one. Both are worth
// resolving — the user's own photos from those days will make it obvious
// which they meant, and asking them back "which Eid?" is exactly the kind
// of unhelpful reply this whole change is meant to stop.
const BARE_EID = /(^|\s)(eid|عيد|العيد)(\s|$|\?)/;

function movableOccurrence(
  ev: (typeof MOVABLE)[number],
  years: number[],
  todayIso: string,
  named: boolean,
): ResolvedEvent | null {
  for (const year of years) {
    const row = ev.table[year];
    if (!row) continue;
    const [start, end] = Array.isArray(row) ? row : [row, shift(row, Math.max(0, ev.days - 1))];
    // Never resolve to something that hasn't happened, unless the user
    // named that year themselves.
    if (!named && start > todayIso) continue;
    return {
      name: `${ev.label} ${year}`,
      start,
      end,
      note: ev.moon ? MOON_NOTE : undefined,
      slack: ev.moon ? 1 : 0,
      via: 'calendar',
    };
  }
  return null;
}

// The longest alias of this event that appears in the text, or null if
// none does. Length matters: it's what tells "coptic christmas" apart from
// plain "christmas" below.
function matchedAlias(aliases: string[], text: string): string | null {
  let best: string | null = null;
  for (const a of aliases) {
    if (!text.includes(a)) continue;
    if (!best || a.length > best.length) best = a;
  }
  return best;
}

function occurrencesOf(text: string, today: Date): ResolvedEvent[] {
  const todayIso = isoOf(today);
  const years = yearsToTry(text, today);
  const named = HAS_YEAR.test(text);
  const hits: { alias: string; event: ResolvedEvent }[] = [];

  for (const ev of MOVABLE) {
    const alias = matchedAlias(ev.aliases, text);
    if (!alias) continue;
    const occurrence = movableOccurrence(ev, years, todayIso, named);
    if (occurrence) hits.push({ alias, event: occurrence });
  }

  for (const ev of FIXED) {
    const alias = matchedAlias(ev.aliases, text);
    if (!alias) continue;
    for (const year of years) {
      const start = `${year}-${String(ev.month).padStart(2, '0')}-${String(ev.day).padStart(2, '0')}`;
      if (!named && start > todayIso) continue;
      hits.push({
        alias,
        event: {
          name: `${ev.label} ${year}`,
          start,
          end: shift(start, Math.max(0, ev.days - 1)),
          via: 'calendar',
        },
      });
      break;
    }
  }

  // One phrase can match two events because one alias contains the other:
  // "coptic christmas" contains "christmas", "islamic new year" contains
  // "new year". The longer alias is what the user actually typed, so the
  // event matched only by the shorter one is a false positive — drop it,
  // or the answer ends up about a day in the wrong month.
  const found = hits
    .filter(({ alias }) => !hits.some((o) => o.alias !== alias && o.alias.includes(alias)))
    .map(({ event }) => event);

  // Neither Eid named specifically, but they did say "eid" — resolve both
  // and let the day's own content settle which one they meant.
  if (found.length === 0 && BARE_EID.test(text)) {
    for (const ev of MOVABLE) {
      if (!ev.label.startsWith('Eid')) continue;
      const occurrence = movableOccurrence(ev, years, todayIso, named);
      if (occurrence) found.push(occurrence);
    }
  }

  return found;
}

// Public entry for tier 1. Synchronous, free, and safe to call on every
// question — it's a substring scan over a couple of hundred strings.
export function matchLocalEvents(question: string): ResolvedEvent[] {
  return occurrencesOf(normalize(question), new Date());
}

// ---------------------------------------------------------------------------
// Tier 3 — web lookup, cached
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'worldEvent:';
// A lookup that came back empty is cached too, so a question about
// something genuinely unfindable doesn't pay for a search every time it's
// asked — but not forever, since "the next election" becomes findable.
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

type CacheEntry = { at: number; event: ResolvedEvent | null };

function cacheKey(phrase: string): string {
  return CACHE_PREFIX + phrase.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function readCache(phrase: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(phrase));
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

async function writeCache(phrase: string, event: ResolvedEvent | null): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(phrase), JSON.stringify({ at: Date.now(), event }));
  } catch {
    // A cache that can't be written just means the next ask looks it up again.
  }
}

import { backendToken, backendUrl, ENDPOINTS } from './backend';
// The app's own server holds the provider key; this is only what gets the
// app through its door. See src/backend.ts.
function openAiKey(): string | undefined {
  return backendToken();
}

export function eventSearchAvailable(): boolean {
  return !!openAiKey();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Three outcomes, and keeping them apart matters more than it looks:
//   found    — cache it forever, the date of a past event never changes.
//   notFound — cache it briefly; the event may not be findable yet.
//   error    — cache NOTHING. A rate limit or a dropped connection says
//              nothing about whether the event is findable, and writing it
//              down as "not found" would poison the cache for days over a
//              hiccup that cleared in seconds.
type SearchOutcome =
  | { status: 'found'; event: ResolvedEvent }
  | { status: 'notFound' }
  | { status: 'error' };

// This model is metered tightly — a single search sends the fetched page
// context along with the prompt, which is ~17k tokens against a per-minute
// budget that can be as low as 6k on a new account. So one search can use
// more than a minute's allowance, and a second one straight after gets a
// 429. Hence: one retry on the delay the API itself asks for, and never a
// cached failure.
const RETRY_CAP_MS = 10_000;

function retryDelayMs(body: string): number {
  // "Please try again in 1.54s" / "in 240ms"
  const secs = body.match(/try again in ([\d.]+)s/);
  if (secs) return Math.min(RETRY_CAP_MS, Math.ceil(Number(secs[1]) * 1000) + 500);
  const ms = body.match(/try again in (\d+)ms/);
  if (ms) return Math.min(RETRY_CAP_MS, Number(ms[1]) + 500);
  return 2500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Looks up when one specific event happened. Only called for events the
// chat model itself said it wasn't sure about — the web search is the one
// part of this that costs real money, so it's the last resort and a
// successful answer is kept for good.
async function searchEventDate(phrase: string): Promise<SearchOutcome> {
  const key = openAiKey();
  if (!key) return { status: 'error' };

  const today = isoOf(new Date());
  const prompt = `Today is ${today}. Search the web and find the exact calendar date of this event: "${phrase}".

If the phrase is relative ("the last X", "the most recent X"), find the most recent one that has ALREADY happened, on or before ${today}.

Respond with ONLY a JSON object, no other text:
{"found": true, "name": "<short name for the event, max 6 words>", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "note": "<only if the date is uncertain or approximate, else omit>"}
or
{"found": false}

"end" is the same as "start" unless it genuinely spanned several days.`;

  const body = JSON.stringify({
    // The web-search model. NOT gpt-4o-mini-search-preview — that one is
    // deprecated and now returns 404, which is why a lookup used to fail
    // silently and the answer fell back to "I couldn't date it".
    model: 'gpt-5-search-api',
    web_search_options: { search_context_size: 'low' },
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    let res = await fetch(backendUrl(ENDPOINTS.openAiChat) ?? '', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
    });

    if (res.status === 429) {
      const text = await res.text();
      // Out of money is not something waiting fixes.
      if (/insufficient_quota|credit_balance|billing/i.test(text)) return { status: 'error' };
      await sleep(retryDelayMs(text));
      res = await fetch(backendUrl(ENDPOINTS.openAiChat) ?? '', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      });
    }

    if (!res.ok) return { status: 'error' };

    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    const match = content.match(/\{[\s\S]*\}/);
    // A 200 that didn't parse is the model's problem, not a real "no such
    // event" — don't write it down as one.
    if (!match) return { status: 'error' };
    const parsed = JSON.parse(match[0]) as {
      found?: boolean;
      name?: string;
      start?: string;
      end?: string;
      note?: string;
    };
    if (!parsed.found || !parsed.start || !ISO.test(parsed.start)) return { status: 'notFound' };
    return {
      status: 'found',
      event: {
        name: parsed.name?.trim() || phrase,
        start: parsed.start,
        end: parsed.end && ISO.test(parsed.end) ? parsed.end : parsed.start,
        note: parsed.note?.trim() || undefined,
        via: 'web',
      },
    };
  } catch {
    return { status: 'error' };
  }
}

// At most this many paid searches per question, so one rambling question
// can't fan out into a dozen calls.
const MAX_LOOKUPS = 2;

// Resolves the events the chat model couldn't date itself. Cached hits
// cost nothing.
//
// Returns the failures alongside the successes, per phrase. That matters:
// the answer has to be able to say "I couldn't work out when X was" about
// the specific thing it couldn't date — reporting failure whenever ANY
// lookup came back empty would make it disown dates it actually has.
export async function resolveUnknownEvents(
  phrases: string[],
): Promise<{ events: ResolvedEvent[]; unresolved: string[] }> {
  const events: ResolvedEvent[] = [];
  const unresolved: string[] = [];
  let searched = 0;

  for (const phrase of phrases) {
    if (!phrase.trim()) continue;
    const cached = await readCache(phrase);
    if (cached) {
      if (cached.event) {
        events.push(cached.event);
        continue;
      }
      // A cached miss is respected until it goes stale.
      if (Date.now() - cached.at < MISS_TTL_MS) {
        unresolved.push(phrase);
        continue;
      }
    }
    if (searched >= MAX_LOOKUPS) {
      unresolved.push(phrase);
      continue;
    }
    searched += 1;
    const outcome = await searchEventDate(phrase);
    if (outcome.status === 'found') {
      await writeCache(phrase, outcome.event);
      events.push(outcome.event);
      continue;
    }
    // Only a real "searched and it isn't there" gets remembered. An error
    // is left uncached so the next question tries again.
    if (outcome.status === 'notFound') await writeCache(phrase, null);
    unresolved.push(phrase);
  }

  return { events, unresolved };
}

// Merges the tiers into one list, local table first (it's the most
// trustworthy), dropping anything malformed and any duplicate date range.
export function mergeEvents(...groups: ResolvedEvent[][]): ResolvedEvent[] {
  const order: EventVia[] = ['calendar', 'model', 'web'];
  const all = groups.flat().filter((e) => ISO.test(e.start) && ISO.test(e.end) && e.start <= e.end);
  all.sort((a, b) => order.indexOf(a.via) - order.indexOf(b.via));
  const seen = new Set<string>();
  return all
    .filter((e) => {
      const k = `${e.start}..${e.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

// Every day to SEARCH for an event, slack included — a photo taken on the
// real first night of Ramadan can land a day either side of whatever a
// table says. Capped so a long event (a whole Ramadan, a two-week
// tournament) can't blow up the prompt.
export function daysOfEvent(event: ResolvedEvent, cap = 40): string[] {
  const slack = event.slack ?? 0;
  const days: string[] = [];
  let cursor = shift(event.start, -slack);
  const last = shift(event.end, slack);
  while (cursor <= last && days.length < cap) {
    days.push(cursor);
    cursor = shift(cursor, 1);
  }
  return days;
}

// The days most likely to be the one the user meant, best first: the
// event's own opening day, then its slack neighbours, then the rest. Used
// to decide which days are worth reading photos for on the spot, where
// only a couple get done — so spending one of them on a slack day before
// the event even started would be a waste.
export function eventFocusDays(event: ResolvedEvent, cap = 6): string[] {
  const slack = event.slack ?? 0;
  const ordered: string[] = [event.start];
  for (let i = 1; i <= slack; i++) {
    ordered.push(shift(event.start, i), shift(event.start, -i));
  }
  let cursor = shift(event.start, slack + 1);
  const last = shift(event.end, slack);
  while (cursor <= last && ordered.length < cap) {
    ordered.push(cursor);
    cursor = shift(cursor, 1);
  }
  return [...new Set(ordered)].slice(0, cap);
}
