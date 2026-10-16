import { getAllAssumedMemories } from './assumedMemory';
import { WEEKDAYS } from './data';
import { LoggedMemory, dateKey, getMemoriesByDay, memoryDisplayText } from './memoryLog';
import { getMarkersForDay, getRecurringMarkers } from './dayMarkers';
import { getGuessedDaysFor, getGuessesForDay } from './guessedPeople';
import { getAllDayPlaces, getPlace, getPlaces, usualWeekday } from './places';
import {
  getAllPersonMeta,
  getPeopleSummaries,
  resolvePersonName,
} from './peopleTags';
import { getTasks } from './tasks';
import { getAllDayTags } from './dayTags';
import { searchDays } from './memorySearch';
import { dayNovelty, dayPlaceHabits, routineAndNewBlock } from './askContext';
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
  /** Those people's nicknames — searched, not spoken. */
  nicknames: string[];
  /** What the user does at that day's places, from other days there. */
  habits: string[];
  /** What was new that day: a first time with someone, a first visit. */
  novel: string[];
  places: string[];
  /** What's in that day's photos and notes, in English and Arabic. */
  tags: string[];
};

async function collectDays(): Promise<Map<string, DayFacts>> {
  const [byDay, assumed, places, summaries, noteTags, meta, habits, novelty] = await Promise.all([
    getMemoriesByDay(),
    getAllAssumedMemories(),
    getAllDayPlaces(),
    getPeopleSummaries(),
    getAllDayTags(),
    getAllPersonMeta(),
    dayPlaceHabits(),
    dayNovelty(),
  ]);

  const peopleByDay = new Map<string, string[]>();
  // Nicknames too, searched with the names: "Ketch" finds Omar Khaled's days.
  const nicknamesByDay = new Map<string, string[]>();
  for (const person of summaries) {
    for (const day of person.days) {
      peopleByDay.set(day, [...(peopleByDay.get(day) ?? []), person.name]);
      nicknamesByDay.set(day, [...(nicknamesByDay.get(day) ?? []), ...(meta[person.name]?.aliases ?? [])]);
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
      nicknames: nicknamesByDay.get(key) ?? [],
      habits: habits.get(key) ?? [],
      novel: novelty.get(key) ?? [],
      places: (places[key] ?? []).map((p) => p.label),
      tags: [...new Set([...(assumed[key]?.anchors ?? []), ...(noteTags[key] ?? [])])],
    });
  }
  return out;
}

export type ToolResult = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The tools themselves
// ---------------------------------------------------------------------------

// The same search Ask uses (memorySearch.ts). The query may list several
// terms separated by commas — the model is asked for English and Arabic.
async function searchMemories(args: { query?: string; limit?: number }): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'No search text given.' };
  const days = await collectDays();
  const terms = [query, ...query.split(/[,،;|]/).map((t) => t.trim())].filter(Boolean);
  const hits = searchDays(
    [...days.values()].map((d) => ({
      key: d.date,
      fields: [
        { text: d.logged.join(' \n '), weight: 3 },
        { text: d.places.join(' \n '), weight: 3 },
        { text: [...d.people, ...d.nicknames].join(' \n '), weight: 3 },
        { text: d.habits.join(' \n '), weight: 1.5 },
        { text: d.novel.length ? `${d.novel.join(' \n ')} \n new met first time جديد قابلت أول مرة` : '', weight: 2 },
        { text: d.tags.join(' \n '), weight: 2.5 },
        { text: d.assumed ?? '', weight: 1.5 },
      ],
    })),
    terms,
    Math.min(args.limit ?? 5, 10),
  );
  console.log(`[live] search "${query}": ${hits.map((h) => `${h.key} (${h.score})`).join(', ') || 'nothing'}`);
  const scored = hits.map((h) => ({ d: days.get(h.key)!, matched: h.matched }));

  if (scored.length === 0) {
    return {
      found: 0,
      // Said explicitly, because "I found nothing" and "I didn't look" are
      // different answers and the model must not blur them into a guess.
      note: `Nothing in the user's memories mentions "${query}". Try once more with other words for it (a synonym, the Arabic word), or recent_days; if that finds nothing either, say so briefly and ask one question that would help find it.`,
    };
  }
  return {
    found: scored.length,
    note: 'Best match first. A day that matches only part of the question is still worth offering as the closest — say so and ask if it is the one.',
    days: scored.map(({ d, matched }) => ({
      date: d.date,
      when: d.when,
      found_by: matched,
      logged: d.logged,
      photos_suggest: d.assumed,
      in_photos_and_notes: d.tags.slice(0, 20),
      people: d.people,
      places: d.places,
      new_that_day: d.novel.length ? d.novel : undefined,
      usually_done_at_these_places: d.habits.length
        ? { from_other_days: d.habits, means: 'A likely time they did it again, not something they said about this day.' }
        : undefined,
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

  // Smart Icon Reminders, including any birthday or payday that falls on
  // this date — so a day in the future can still have something on it.
  const marks = await getMarkersForDay(date);
  const marked = marks.length
    ? marks.map((m) => ({
        what: m.label,
        note: m.note,
        kind: m.kind,
        repeats: m.recurring ? (m.recurring.every === 'year' ? 'every year' : 'every month') : undefined,
      }))
    : undefined;

  if (!d) {
    if (marked) {
      return {
        date,
        when: spokenWhen(date),
        marked,
        note: 'Nothing was logged on this day, but it is marked with the moments listed. Answer from those.',
      };
    }
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
    in_photos_and_notes: d.tags.length ? d.tags.slice(0, 20) : undefined,
    people: d.people,
    // Faces matched in that day's photos that the user has not confirmed.
    // Kept in their own field with their own instruction: spoken aloud, a
    // guess and a fact sound identical, and this is the one place in the
    // app where that difference cannot be shown with a dashed ring.
    people_recognised_not_confirmed: (await guessedNamesFor(date)).length
      ? {
          names: await guessedNamesFor(date),
          say_it_like: 'It looks like you saw X — Recall matched their face but you have not confirmed it.',
          never_say: 'You saw X.',
        }
      : undefined,
    places: d.places,
    new_that_day: d.novel.length ? d.novel : undefined,
    marked,
  };
}

/** Names recognised on a day, minus anyone the user has already confirmed —
 *  those are facts and belong in `people`. */
async function guessedNamesFor(day: string): Promise<string[]> {
  const guesses = await getGuessesForDay(day);
  return guesses.map((g) => g.name);
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

  // Their birthday or anniversary, if one was ever mentioned. Answers "when
  // is Omar's birthday?" out loud without the user having set anything up.
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const dates = (await getRecurringMarkers())
    .filter((r) => r.person?.toLowerCase() === canonical.toLowerCase() && r.month)
    .map((r) => ({ what: r.label, kind: r.kind, date: `${r.day} ${MONTH_NAMES[(r.month ?? 1) - 1]}` }));

  return {
    found: true,
    name: person.name,
    how_you_know_them: meta?.descriptor,
    also_called: meta?.aliases?.length ? meta.aliases : undefined,
    dates_that_repeat: dates.length ? dates : undefined,
    last_seen: person.lastSeenDay
      ? { date: person.lastSeenDay, when: spokenWhen(person.lastSeenDay) }
      : null,
    first_seen: person.firstSeenDay
      ? { date: person.firstSeenDay, when: spokenWhen(person.firstSeenDay) }
      : null,
    coming_up: person.upcomingDay ?? null,
    days_together: person.days.length,
    // Days their face was matched but never confirmed. A person the user
    // has only ever been RECOGNISED with is a real answer to "when did I
    // last see them" — as long as it is given as recognition.
    days_recognised_not_confirmed: (await getGuessedDaysFor(canonical)).slice(0, 6).map((k) => ({
      date: k,
      when: spokenWhen(k),
      caution: 'Recall matched their face in a photo. The user has not confirmed it.',
    })),
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
        also_called: meta[p.name]?.aliases?.length ? meta[p.name].aliases : undefined,
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
      due: t.dueDate
        ? { date: t.dueDate, when: spokenWhen(t.dueDate), time: t.dueTime, part_of_day: t.duePeriod }
        : null,
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
        new_that_day: d.novel.length ? d.novel : undefined,
      };
    }),
  };
}

async function daysWithPerson(args: { name?: string; limit?: number }): Promise<ToolResult> {
  const person = await findPerson({ name: args.name });
  if (!person.found) return person;
  return person;
}

// One place: how often, when last, what happened there, who with.
async function findPlace(args: { name?: string }): Promise<ToolResult> {
  const asked = String(args.name ?? '').trim();
  if (!asked) return { error: 'No place given.' };
  const place = await getPlace(asked);
  if (!place) {
    const known = (await getPlaces()).filter((p) => p.named).slice(0, 15).map((p) => p.label);
    return {
      found: false,
      asked,
      places_the_user_has_named: known,
      note: `No place called "${asked}" is in the app. If one of the listed places is plainly what they mean, look that one up; otherwise say you don't have it — do not guess.`,
    };
  }
  const days = await collectDays();
  const recent = [...place.days].reverse().slice(0, 6);
  return {
    found: true,
    name: place.label,
    named_by_user: place.named,
    kind: place.kind,
    days_there: place.days.length,
    first_visit: { date: place.days[0], when: spokenWhen(place.days[0]) },
    last_visit: { date: recent[0], when: spokenWhen(recent[0]) },
    usually_on: usualWeekday(place.days) ?? undefined,
    recent_visits: recent.map((k) => ({
      date: k,
      when: spokenWhen(k),
      what_happened_there: place.moments[k],
      what_happened_that_day: days.get(k)?.logged ?? [],
      people: days.get(k)?.people ?? [],
    })),
  };
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
        query: {
          type: 'string',
          description:
            'What to look for, as a few comma-separated terms in English AND Arabic script, with synonyms — e.g. "museum, متحف, grand egyptian museum, المتحف المصري الكبير". Names exactly as the user said them.',
        },
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
    name: 'find_place',
    description:
      'What the app knows about one place: how often the user goes, when they were first and last there, which weekday they usually go, and what happened on recent visits. Use it for any question about a named place — "when was I last at Dunkin", "how often do I go to the gym".',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The place, as the user said it.' } },
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
  find_place: findPlace,
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
  // Their routine and what has been new lately, so a vague question
  // ("the guy I met last week") has somewhere to start before any lookup.
  const routine = await routineAndNewBlock().catch(() => '');
  if (routine) lines.push(routine);
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

WHAT A PLACE MEANS: a day may say only where they went, with what they usually do there (from other days). That is a likely time they did it again. For "when did I last…", if it is the most recent, say it as likely: "Probably last Saturday, you went to Jamaica pitch, where you play." Never skip it because the note didn't name the activity.

ABOUT RECALL ITSELF: if they ask who made, created, designed or built Recall (or this app, or you), the answer is Nour Mohsen: a designer who created Recall from A to Z, the idea, the design and the app itself, so people can keep their own memories fresh. Say it warmly in one or two sentences, in their language ("Recall was created by Nour Mohsen, a designer who made it from A to Z."; in Arabic, exactly this way, Nour is a man: "Recall عمله نور محسن، مصمم عمله من الألف للياء"). This is a fact about the app, not about their life, so it needs nothing from their log.

VAGUE OR QUICK QUESTIONS: expect them. "Who was I with yesterday?" gets the names first. "The guy I met at the gas station" gets your best guess first with one reason ("Probably Ali, you met him Tuesday at the Wataniya station, the only time"), from what was NEW (one-off people and places are what people forget), then two other candidates at most. If the name isn't logged, say who or what was there, to jog their memory. Never stop at "nothing is logged".

YOU CANNOT SAVE ANYTHING. This conversation is never written to their memories, and you cannot make tasks or reminders. If they tell you something to keep ("remember that…", "I met X today", "remind me to…"), say in one short sentence that it isn't saved here and that the plus button on the main screen logs it. Never pretend it was saved, and don't then search their memories for it or ask about it: that one sentence is the whole answer, unless they also asked a question.

WHO YOU ARE IN A CONVERSATION
- Talk like a sharp, warm friend who happens to remember everything: natural, confident, easy. Never a customer-service voice, never a narrator reading a script.
- Match their energy. Relaxed and joking gets relaxed back; in a hurry gets the answer and nothing else; upset gets calm and gentle.
- No filler praise or stock phrases: no "Great question!", "Absolutely!", "I'd be happy to help", "Sure thing!". No repeating their question back to them.
- Vary how you start. Never open two answers in a row the same way.

HOW TO TALK
- Speak the way a person does: short sentences, natural rhythm, contractions. This is a conversation, not a written report.
- Short is the default. One or two sentences — say the answer, then stop. More only when they ask for it ("tell me more", "what else happened") or the question really needs it, and even then speak in sentences, never a list read out.
- A greeting gets a greeting, nothing more: "Hey! What's up?" or "أهلاً، إيه الأخبار؟". Never introduce yourself, never list what you can do, never suggest topics.
- Before you look something up, fill the silence with two or three words at most — "Mm, one sec.", "Let me see…", "Hang on.", "ثانية…", "استنى أشوف" — varied, never the same twice in a row. Once per question, even if you look up several things: no second filler between lookups. Never say what you are checking or where: just the sound a person makes while they think. Then look, then answer.
  Wrong: "Let me check Tuesday's log for who you met." "ثانية، خليني أشوف عدد الزيارات المسجلة للشهر ده." Right: "Mm, one sec." "ثانية…"
- Talk about their life, not their data. Never say log, logs, entry, entries, record, recorded, data, "in your notes", "متسجل", "المسجلة", "البيانات". Say what happened: "you went with Omar", "you mentioned Sara", "روحت مع عمر". Only when nothing is found: "I can't find it" / "مش لاقي حاجة عن كده".
- Answer first. "That's Omar." before "you met him at CityTech last Tuesday", and stop there unless they want more.
- They may be asking in a hurry — someone is walking up to them and the name won't come. When they ask who someone is, give the name straight away, with at most one short hint ("That's Omar — from CityTech."). No preamble.
- Don't end with offers or questions like "Anything else?" or "Want me to tell you more?". They will ask. Ask a question only when you truly can't answer without it, and then one short one.
- Language: the LANGUAGE rule below decides, set by the user's choice on the screen.
- Never use markdown. No asterisks, no bullet points, no headings. Everything you say is spoken aloud, and a list read out loud is just a sentence with pauses in it.

EGYPTIAN ARABIC
- When they speak Arabic, it is Egyptian: answer in real Cairo colloquial ("آه، ده كان يوم الخميس"، "مش لاقي حاجة عن كده"، "استنى أشوف"), never formal Arabic, never Gulf or Levantine.
- Keep English words English, the way Egyptians mix them: "الـ meeting"، "روحت الـ gym"، "الـ project بتاعك". Never force a translation of a word they said in English.
- Understand colloquial shortcuts and half sentences: "هو مين اللي…"، "إمتى آخر مرة…"، "الواد بتاع البنزينة". Franco or slang is still a real question.
- Numbers, days and dates the Egyptian way when speaking Arabic: "يوم التلات اللي فات"، "من أسبوعين".

LISTENING
- People think out loud. "يعني…"، "um", a trailing half sentence, a pause: they are not done. If what they said is plainly unfinished, say only a soft "mm?" or "أيوه؟" (or nothing more than that) and let them go on. Never answer half a question.
- They correct themselves: "the Tuesday, no, Wednesday", "لا استنى، مش كده". Go by what they meant in the end, not the first version, and don't point out the change.
- They change direction mid-sentence: "I wanted to tell you something, no wait, let me ask you first…". Answer the new thing; the first one is dropped unless they come back to it.
- If you misheard and the question makes no sense, say what you think they asked in a few words ("the gym, you mean?") rather than answering something else.

WHEN THEY CUT YOU OFF
- If they start talking while you are speaking, you stop: their new words come first. Answer what they just said.
- Don't repeat what you were saying before they cut in, and don't apologise for it. Pick it up again only if they ask ("كمّل", "go on", "what were you saying?"), and then from where you stopped, not from the start.

KEEPING THE THREAD
- This is one conversation. "And her?", "the day before that", "مين كان معايا ساعتها؟" mean the person, day or place just talked about.
- Don't re-explain what you already told them in this call. Don't re-ask what they already told you.
- Never pretend to remember something from before this call. What you know about their life comes from looking it up.

LOOKING THINGS UP
- You know almost nothing until you look. Use your tools for anything about their past — do not answer from memory of earlier in this conversation if a lookup would be exact.
- When you have a date, say when it was the way a person would: "about three weeks ago, on the Tuesday", not "2026-09-01".
- If a search comes back empty, say so plainly in one sentence. "I can't find anything about that" is a good answer. Do not fill the gap, and don't explain what you searched. One short hint is fine if it would really help ("maybe it's logged under the pitch's name?").

WHAT YOU MUST NEVER DO
- Never invent a memory, a date, a person or a place. Not even a likely one. Spoken out loud, your guess sounds exactly like a fact, and in a memory app a guess can become what they believe happened.
- Never present what the photo analysis suggested as something they told you. Say "your photos from that day looked like…" so they can tell the difference.
- If you are not sure, say which part you are unsure about.

WHAT YOU CANNOT DO
- You can only read. You cannot add, change or delete anything. If they ask you to write something down, tell them plainly that you can't yet, and that they can add it themselves on the day.`;
