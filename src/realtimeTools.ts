import { getAllAssumedMemories } from './assumedMemory';
import { WEEKDAYS } from './data';
import { LoggedMemory, dateKey, getMemoriesByDay, memoryDisplayText } from './memoryLog';
import { getAllDayPlaces } from './placesFromPhotos';
import {
  getAllPersonMeta,
  getPeopleSummaries,
  resolvePersonName,
} from './peopleTags';
import { getTasks } from './tasks';
import { getUserProfile, identityForPrompt, memoryCount } from './userProfile';

// What a live conversation is allowed to look up.
//
// WHY TOOLS AND NOT ONE BIG PROMPT: the typed Ask builds a large block of
// context up front and hands the whole thing over, which works because the
// question is already known. A conversation has no such luxury — it wanders,
// and what matters at minute four wasn't guessable at minute zero. Pouring in
// a whole life to cover that would be expensive, would not fit for long, and
// would make the model vaguer, not sharper: an assistant holding everything
// loosely answers everything approximately.
//
// So it holds almost nothing and fetches precisely, mid-sentence, the way a
// person says "hang on, let me check". Each of these returns a small, exact
// answer, which is also what keeps it honest: a model that has to go and look
// something up is far less likely to invent it than one that half-remembers
// it from an enormous prompt.
//
// Nothing here writes. Every function is a read, deliberately — see the
// session instructions.

// Spelled out here rather than imported: askContext keeps a private copy
// and data.ts exports only weekdays.
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function longDate(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function daysAgo(key: string): number {
  const d = new Date(`${key}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

// "3 days ago", "last Tuesday" — how a person would say it out loud, because
// the model is speaking rather than writing a table.
function spokenWhen(key: string): string {
  const n = daysAgo(key);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n === -1) return 'tomorrow';
  // Days ahead are not memories — a task is due, a plan is coming up. Said
  // as "3 days ago" they become things that already happened, which in a
  // memory app is the worst possible way to be wrong.
  if (n < 0) {
    const ahead = -n;
    if (ahead < 7) return `in ${ahead} days`;
    if (ahead < 14) return 'in about a week';
    if (ahead < 45) return `in about ${Math.round(ahead / 7)} weeks`;
    return longDate(key);
  }
  if (n < 7) return `${n} days ago`;
  if (n < 14) return 'about a week ago';
  if (n < 45) return `about ${Math.round(n / 7)} weeks ago`;
  if (n < 365) return `about ${Math.round(n / 30)} months ago`;
  return longDate(key);
}

// Everything known about one day, flattened into something speakable.
type DayFacts = {
  date: string;
  when: string;
  logged: string[];
  assumed?: string;
  people: string[];
  places: string[];
};

async function collectDays(): Promise<Map<string, DayFacts>> {
  const [byDay, assumed, places, summaries] = await Promise.all([
    getMemoriesByDay(),
    getAllAssumedMemories(),
    getAllDayPlaces(),
    getPeopleSummaries(),
  ]);

  const peopleByDay = new Map<string, string[]>();
  for (const person of summaries) {
    for (const day of person.days) {
      peopleByDay.set(day, [...(peopleByDay.get(day) ?? []), person.name]);
    }
  }

  const keys = new Set<string>([
    ...byDay.keys(),
    ...Object.keys(assumed),
    ...Object.keys(places),
    ...peopleByDay.keys(),
  ]);

  const out = new Map<string, DayFacts>();
  for (const key of keys) {
    const memories: LoggedMemory[] = byDay.get(key) ?? [];
    out.set(key, {
      date: key,
      when: spokenWhen(key),
      logged: memories.map(memoryDisplayText).filter((t): t is string => !!t),
      assumed: assumed[key]?.summary,
      people: peopleByDay.get(key) ?? [],
      places: (places[key] ?? []).map((p) => p.label),
    });
  }
  return out;
}

// Everything on a day as one searchable string.
function dayText(d: DayFacts): string {
  return [...d.logged, d.assumed ?? '', ...d.people, ...d.places].join(' ');
}

// Deliberately simple, and deliberately not word-boundary based: the user
// writes and speaks Arabic as well as English, and Arabic does not tokenise
// the way a naive word splitter expects. Substring matching is cruder and
// works for both.
function scoreAgainst(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  let score = 0;
  // A hit on the whole phrase is worth far more than the words scattered.
  if (haystack.includes(needle)) score += 10;
  for (const word of needle.split(/\s+/)) {
    if (word.length < 3) continue;
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

export type ToolResult = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The tools themselves
// ---------------------------------------------------------------------------

async function searchMemories(args: { query?: string; limit?: number }): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'No search text given.' };
  const days = await collectDays();
  const scored = [...days.values()]
    .map((d) => ({ d, score: scoreAgainst(dayText(d), query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.d.date.localeCompare(a.d.date))
    .slice(0, Math.min(args.limit ?? 5, 10));

  if (scored.length === 0) {
    return {
      found: 0,
      // Said explicitly, because "I found nothing" and "I didn't look" are
      // different answers and the model must not blur them into a guess.
      note: `Nothing in the user's memories mentions "${query}". Say so plainly rather than guessing.`,
    };
  }
  return {
    found: scored.length,
    days: scored.map(({ d }) => ({
      date: d.date,
      when: d.when,
      logged: d.logged,
      photos_suggest: d.assumed,
      people: d.people,
      places: d.places,
    })),
  };
}

async function getDay(args: { date?: string }): Promise<ToolResult> {
  const date = String(args.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'Give the date as YYYY-MM-DD.' };
  }
  const days = await collectDays();
  const d = days.get(date);
  if (!d) {
    return {
      date,
      when: spokenWhen(date),
      empty: true,
      note: 'Nothing was recorded on this day. That is not the same as nothing happening — say it that way.',
    };
  }
  return {
    date: d.date,
    when: d.when,
    day_name: longDate(d.date),
    logged: d.logged,
    photos_suggest: d.assumed,
    people: d.people,
    places: d.places,
  };
}

async function findPerson(args: { name?: string }): Promise<ToolResult> {
  const asked = String(args.name ?? '').trim();
  if (!asked) return { error: 'No name given.' };
  // Goes through the same name resolution the rest of the app uses, so
  // "Nayer", "Nair" and the Arabic spelling all land on one person.
  const canonical = (await resolvePersonName(asked)) ?? asked;
  const summaries = await getPeopleSummaries();
  const person = summaries.find((p) => p.name === canonical);
  if (!person) {
    return {
      found: false,
      asked,
      note: `No one called "${asked}" is in the app. Do not guess who they mean.`,
    };
  }
  const meta = (await getAllPersonMeta())[canonical];
  const days = await collectDays();
  return {
    found: true,
    name: person.name,
    how_you_know_them: meta?.descriptor,
    last_seen: person.lastSeenDay
      ? { date: person.lastSeenDay, when: spokenWhen(person.lastSeenDay) }
      : null,
    first_seen: person.firstSeenDay
      ? { date: person.firstSeenDay, when: spokenWhen(person.firstSeenDay) }
      : null,
    coming_up: person.upcomingDay ?? null,
    days_together: person.days.length,
    recent_days: person.days.slice(0, 6).map((k) => ({
      date: k,
      when: spokenWhen(k),
      what_happened: days.get(k)?.logged ?? [],
      places: days.get(k)?.places ?? [],
    })),
  };
}

async function listPeople(): Promise<ToolResult> {
  const summaries = await getPeopleSummaries();
  const meta = await getAllPersonMeta();
  return {
    count: summaries.length,
    people: summaries
      .sort((a, b) => (b.lastSeenDay ?? '').localeCompare(a.lastSeenDay ?? ''))
      .map((p) => ({
        name: p.name,
        how_you_know_them: meta[p.name]?.descriptor,
        last_seen: p.lastSeenDay ? spokenWhen(p.lastSeenDay) : 'never tagged on a day',
        days_together: p.days.length,
      })),
  };
}

async function listTasks(args: { status?: string }): Promise<ToolResult> {
  const status = args.status ?? 'open';
  const all = await getTasks();
  const filtered =
    status === 'done' ? all.filter((t) => t.done)
    : status === 'all' ? all
    : all.filter((t) => !t.done);
  return {
    count: filtered.length,
    tasks: filtered.slice(0, 30).map((t) => ({
      title: t.title,
      notes: t.notes,
      due: t.dueDate ? { date: t.dueDate, when: spokenWhen(t.dueDate), time: t.dueTime } : null,
      done: t.done,
      came_from: t.source === 'memory' ? t.sourceText : undefined,
    })),
  };
}

async function recentDays(args: { count?: number }): Promise<ToolResult> {
  const days = await collectDays();
  const keys = [...days.keys()].sort().reverse().slice(0, Math.min(args.count ?? 7, 21));
  return {
    days: keys.map((k) => {
      const d = days.get(k)!;
      return {
        date: k,
        when: d.when,
        logged: d.logged,
        photos_suggest: d.assumed,
        people: d.people,
        places: d.places,
      };
    }),
  };
}

async function daysWithPerson(args: { name?: string; limit?: number }): Promise<ToolResult> {
  const person = await findPerson({ name: args.name });
  if (!person.found) return person;
  return person;
}

// The schemas handed to the model. Names and descriptions are written for it
// to read, so they say when to reach for each one rather than only what it
// does.
export const REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'search_memories',
    description:
      "Search everything the user has recorded — notes, voice memories, what their photos showed, people and places — for a word, name or topic. Use this whenever they ask about something in their past and you don't already know which day it was.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for. A word, a name, a place.' },
        limit: { type: 'number', description: 'How many days to return. Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'get_day',
    description:
      'Everything recorded on one specific date: what they wrote, what their photos showed, who they were with, where they were. Use it once you know the date.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    type: 'function',
    name: 'find_person',
    description:
      'What the app knows about one person: how the user knows them, when they last saw them, how many days they have spent together, and what happened on the recent ones. Use it for any question about a named person.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    type: 'function',
    name: 'list_people',
    description:
      'Everyone the app knows, most recently seen first. Use it for "who have I not seen in a while" or when the user refers to someone vaguely.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'list_tasks',
    description: "The user's tasks — what is still to do, or what has been done.",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default open.' },
      },
    },
  },
  {
    type: 'function',
    name: 'recent_days',
    description:
      'The last few days that have anything recorded on them. Use it for "what have I been up to" or to orient yourself at the start of a conversation.',
    parameters: {
      type: 'object',
      properties: { count: { type: 'number', description: 'How many days. Default 7.' } },
    },
  },
] as const;

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  search_memories: searchMemories,
  get_day: getDay,
  find_person: findPerson,
  list_people: listPeople,
  list_tasks: listTasks,
  recent_days: recentDays,
  days_with_person: daysWithPerson,
};

// Runs whatever the model asked for. Never throws: a tool that fails has to
// come back as something the model can say out loud, because the alternative
// mid-conversation is dead air.
export async function runRealtimeTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `No tool called ${name}.` };
  try {
    return await handler(args);
  } catch (e) {
    return {
      error: 'That lookup failed.',
      detail: e instanceof Error ? e.message : 'unknown',
    };
  }
}

// The small amount the model is told before a word is spoken.
//
// Just enough to be oriented — who it is talking to, what today is, how much
// there is to draw on, and the names it might hear. Everything else it goes
// and fetches. Names matter here specifically: without them it mishears
// "فهمي" as a common word and searches for the wrong thing.
export async function buildVoiceBootstrap(): Promise<string> {
  const [profile, count, summaries] = await Promise.all([
    getUserProfile(),
    memoryCount(),
    getPeopleSummaries(),
  ]);
  const today = new Date();
  const lines: string[] = [
    `Today is ${longDate(dateKey(today))}.`,
    `The user has ${count} memories recorded.`,
  ];
  const identity = identityForPrompt(profile);
  if (identity) lines.push(`Who you are talking to: ${identity}`);
  if (summaries.length > 0) {
    lines.push(
      `People they know, so you recognise these names when you hear them: ${summaries
        .map((p) => p.name)
        .join(', ')}.`,
    );
  }
  return lines.join('\n');
}

// How it should behave while talking.
//
// The rules that matter most are the ones about not inventing. In writing, a
// hedge is visible and a user can re-read it. Spoken aloud, a confident
// sentence and a guess sound identical — and this is a memory app, where
// being told something happened is close to remembering that it did. A
// plausible invention here does not just mislead, it can become the memory.
export const VOICE_INSTRUCTIONS = `You are Recall, talking with someone about their own life. You are not a general assistant; you are the part of them that keeps track.

YOUR JOB: help them remember. They may be circling something half-forgotten — a name, a day, where they were, who said what. Help them get to it.

HOW TO TALK
- Speak the way a person does: short sentences, natural rhythm, contractions. This is a conversation, not a written report.
- Keep answers brief unless they ask for detail. Nobody wants a paragraph read aloud.
- Follow their language. If they speak Arabic, answer in Arabic. If they mix Arabic and English mid-sentence — which they do — follow them naturally rather than correcting to one language.
- It is fine to think out loud: "hang on, let me look" while you check something.

LOOKING THINGS UP
- You know almost nothing until you look. Use your tools for anything about their past — do not answer from memory of earlier in this conversation if a lookup would be exact.
- When you have a date, say when it was the way a person would: "about three weeks ago, on the Tuesday", not "2026-09-01".
- If a search comes back empty, say so plainly. "I can't find anything about that" is a good answer. Do not fill the gap.

WHAT YOU MUST NEVER DO
- Never invent a memory, a date, a person or a place. Not even a likely one. Spoken out loud, your guess sounds exactly like a fact, and in a memory app a guess can become what they believe happened.
- Never present what the photo analysis suggested as something they told you. Say "your photos from that day looked like…" so they can tell the difference.
- If you are not sure, say which part you are unsure about.

WHAT YOU CANNOT DO
- You can only read. You cannot add, change or delete anything. If they ask you to write something down, tell them plainly that you can't yet, and that they can add it themselves on the day.`;
