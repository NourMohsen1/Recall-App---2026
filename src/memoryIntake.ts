import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  SIR_KINDS,
  addDayMarker,
  addRecurringMarker,
  isSirKind,
  type SirKind,
} from './dayMarkers';
import { dateKey, getLoggedMemories, localFile, splitMemory, updateMemory, type LoggedMemory } from './memoryLog';
import { addPersonMention, getKnownPeopleForPrompt } from './peopleTags';
import {
  isPlaceKind,
  knownPlaceNames,
  linkPhotosToSaidPlace,
  recordNamedPlaceForDay,
  type PlaceKind,
} from './places';
import { ParsedTask, addTask } from './tasks';
import { chatCompletion, textAvailable, textProviders } from './aiProviders';
import { transcribeAudio, transcriptionAvailable } from './transcription';
import { getUserProfile, identityForPrompt } from './userProfile';

// The core of Recall: the user logs everything through one door — a rambling
// voice note, a typed entry, a photo caption — and this module reads it once
// and sends every piece of information to its place:
//   · the memory itself, cleaned up, onto the Timeline
//   · commitments ("remind me to…") onto the Tasks page
//   · people the user was with onto their People profiles
//   · places mentioned onto that day's Places
// Everything is best-effort and runs after the memory is already saved, so a
// failed analysis can never lose what the user logged.

export function intakeAvailable(): boolean {
  return textAvailable();
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const INTAKE_PROMPT = `You are the intake brain of Recall, a personal memory-logging app. The user logs one free-form journal entry — spoken or typed, in any language, often rambling and out of order. Read it once and split every piece of information into its place.

Respond with ONLY a JSON object in this exact shape:
{
  "polished": "...",
  "happened": {"date": "YYYY-MM-DD" | null, "time": "HH:MM" | null},
  "moments": [{"time": "HH:MM" | null, "text": "..."}],
  "tasks": [{"title": "...", "date": "YYYY-MM-DD" | null, "period": "morning"|"afternoon"|"evening"|"night" | null, "time": "HH:MM" | null, "details": "..." | null, "kind": "..." | null}],
  "people": [{"name": "...", "descriptor": "..." | null, "note": "..."}],
  "places": [{"name": "...", "kind": "...", "moment": "..." | null}],
  "markers": [{"kind": "...", "label": "..."}],
  "recurring": [{"kind": "...", "label": "...", "every": "year"|"month", "date": "MM-DD" | "today" | null, "day_of_month": 1-31 | null, "person": "..." | null}]
}

"polished" — the memory itself, cleaned and reorganized: fix rambling and fillers, keep EVERY event and detail, first person, past tense where natural, in the SAME language(s) the user used (Arabic stays Arabic, mixed stays mixed). Reminders/to-dos MUST be removed entirely from the polished text — they live in "tasks" instead. Example: "…grabbed coffee with Lina, oh and remind me to book the flight friday" → polished ends at "…grabbed coffee with Lina." and the flight goes into tasks. Never invent details. A clean TYPED entry may come back as-is.

POLISH, DON'T REWRITE. Change as little as needed: fix spelling, fillers and repetition, add punctuation — never reword what happened. Every detail keeps its exact meaning: body parts (edy/إيدي = hand, dahry/ضهري = back, regl/رجلي = leg — never swap one for another), people, places, numbers, times, who did what and who won. Keep the user's own SCRIPT: an entry marked FRANCO ENTRY is written back in Franco, in Latin letters — converting it to Arabic script misreads words (measured: "jamica", a football pitch, became "الجامعة", the university). Never translate: Arabic stays Arabic, English stays English, mixed stays mixed. If you are not sure what a word means, keep the user's word exactly as written.

"moments" — when the entry tells about SEVERAL separate parts of the day ("in the morning I went to the café… then the doctor… at night football"), split "polished" into those parts, in the order they happened: each "text" is one part, polished by the same rules (same language and script, nothing reworded, nothing left out — together they say everything "polished" says), and each "time" is when that part started, by the same rules as "happened.time" below — use "then"/"after that" to keep later parts later. Return an empty list when the entry is about one moment, or when the parts have no order in the day. Never more than 8.

"happened" — WHEN this entry's events took place, only from what the entry itself says. date: only when the entry says the events were on a different day than ENTRY DAY below ("yesterday", "on Friday", "last night" written the next morning) — resolve it against TODAY, the day the entry was written; otherwise null. time: when the events started, in this order of preference —
  1. an explicit time ("at 9", "el sa3a 2", "2:00 pm"); for an hour without am/pm, judge from what was done ("played football at 9, then went out" → 21:00);
  2. a day part, in any language (الصبح, بالليل, b3d el dohr, "in the morning"): early morning 07:00, morning 09:00, noon 12:00, afternoon 15:00, evening 19:00, night 21:00, late night 23:30;
  3. no time words at all: the time the activity itself usually happens — breakfast 08:00, lunch 13:00, dinner 20:00, class or work in the day, a party or a movie out at night;
  4. nothing to go on: null (the app keeps it where it is — midday for a day it was added to later). Never a future date or time — plans are tasks. When "happened.date" moves the entry to another day, "polished" must read right ON that day: drop the word that pointed there ("Yesterday afternoon I met Dave" → "In the afternoon I met Dave").

SPOKEN ENTRY — when the entry is marked SPOKEN ENTRY, it is a raw speech-to-text transcript, never something to show as it is. Speech recognition mishears words, especially names, places and English words inside Arabic speech ("إيميل من غير إس" is an email from the IRS; "المشرفين" may be "the refund"). Work out what the person most likely said from the rest of the entry and the SAME-DAY CONTEXT, and write that. Then ALWAYS rewrite it as a short, clean written memory: complete sentences, no fillers or thinking aloud ("يعني", "تمام، مش مشكلة", "um", "like"), no repetition. Keep the language the person spoke (Arabic stays Arabic, mixed stays mixed). Where a word or part truly can't be worked out, leave it out rather than guess.

"tasks" — only genuine future to-dos: "remind me to…", "I have to…", "X asked me to…". Things that already happened are never tasks. title is a short imperative phrase in the user's own words with lead-ins stripped: "remind me to give Jeff the brief" → "Give Jeff the brief". Keep the entry's language. date resolves relative words ("tomorrow", weekday names) against TODAY given below; null when no day was mentioned. period only when the user said a day-part word. time only for an explicit clock time (24h).

"people" — only people the user personally met, saw, or spent time with in this entry (not people merely referred to). name: if the person clearly matches someone in KNOWN PEOPLE below, return EXACTLY that known spelling; otherwise the name as the user said it. Match ACROSS SCRIPTS AND SPELLINGS — the user writes the same person differently from day to day, and every version must come back as the one known spelling: "بابا" and "Baba" are one person; "Nayer", "Nair" and "ناير" are one person; "Ahmad" and "Ahmed" are usually one person. A KNOWN PEOPLE line that lists "also written: …" is telling you exactly which spellings already belong to that person. Only give a new name when this really is somebody the list doesn't have. descriptor: a short "who they are" only if the user stated it ("your neighbor", "coworker") — null otherwise. note: one short sentence about what happened with this person this time — written in the exact same language as the entry itself; NEVER translate.

"places" — places the user was physically at in this entry. Not places merely mentioned ("a client in New Jersey" is not a visit). name: short, the way the user calls it ("Work", "Gym", "787 Coffee", "CityTech"); if it clearly matches one in KNOWN PLACES below, return EXACTLY that known spelling — across scripts and wordings, like people: "الجامعة", "college" and "uni" are the known "CityTech" when that is plainly where the user studies; "البيت" is "Home". Otherwise the name as the user said it. kind is exactly one of: home, work, school, cafe, food, gym, shop, outdoors, friend (someone else's home), health, worship, travel, fun, other. moment: one short line of what happened there this time, in the entry's own language, NEVER translated ("Prof talked about the final project", "اتغديت مع عمر") — null when the entry says nothing about it.

"markers" — notable moments that HAPPENED in this entry, the kind a person would later want to find at a glance ("when did I last take my medicine?"). kind is exactly one of: medicine, workout, doctor, sick, travel, celebration, study, work, home, purchase, religious, holiday, dinner, call, car, pet, family, achievement, payday. Only things that already happened on the day of the entry — plans and reminders belong in "tasks", never here. label is 2–5 words in the entry's own language, NEVER translated: "أخدت الدوا", "Got paid", "روحت الجيم", "Flight to Cairo". Leave out ordinary routine nobody would look for later (commuting, an everyday meal, a normal workday). Birthdays and anniversaries never go here — they go in "recurring" — and neither does a party, cake or dinner held FOR a birthday or anniversary: the recurring entry already marks that day, and a second icon for the same occasion is clutter.

"recurring" — dates that come back. ONLY two cases: (1) a birthday or anniversary the entry mentions — every "year", date "MM-DD", or "today" when the entry says it is today ("النهاردة عيد ميلاد عمر", "it's our anniversary"); (2) something the user explicitly says repeats ("I get paid on the 25th", "rent is due on the 1st of every month") — every "month" with day_of_month. NEVER turn a one-off into a repeat: "got paid today" on its own is a payday marker, not recurring; a party is a celebration marker, not an anniversary. kind uses the same list plus birthday and anniversary. person: whose birthday or anniversary it is, matched to KNOWN PEOPLE exactly like "people"; null when it is the user's own. label is short, in the entry's language: "Omar's birthday", "عيد جوازنا", "Payday".

"details" and "kind" on a task are only for ATTACHED DOCUMENT entries (below); null otherwise.

ATTACHED DOCUMENT — when the entry contains a block marked ATTACHED DOCUMENT, that block is text the user's phone read from a screenshot or file they saved. It may contain reading mistakes and screen clutter (clock, battery, buttons, app menus) — ignore those. The user saved it to remember it, so:
· Every UPCOMING appointment, booking, reservation, flight, ticketed event, bill due date or deadline in it is a task, even though nobody wrote "remind me". title: short and specific, in the document's language ("Dentist appointment — Dr. Lee", "Flight to Cairo MS986"). date and time come from the document itself; resolve relative words against TODAY. details: every practical detail, one per line — who, the full address, phone, what to bring or prepare, confirmation or booking number, cost, gate or seat — copied exactly, nothing invented; null if there are none. kind: the icon that fits — doctor, travel, work, study, purchase, dinner, call, car, pet, family, holiday, celebration, payday, religious — or null.
· Anything in the document that is already past is not a task.
· polished: one or two first-person sentences saying what the user saved ("Saved my dentist appointment with Dr. Lee on Thursday 3 October at 2:30 pm."), followed by the user's own note if they wrote one. Never paste the document.
· People and places named in the document are NOT people the user met or places they were at. Leave them out of "people" and "places" unless the user's own note says so.
· No markers or recurring entries for what the document describes, unless the user's own note describes something that happened.

Empty arrays are correct when a section has nothing.`;

/** A task, plus what only a saved document gives: its details, and the icon
 *  for the day it happens on. */
export type IntakeTask = ParsedTask & { details?: string; icon?: SirKind };

export type ParsedPlace = { name: string; kind?: PlaceKind; moment?: string };

export type ParsedRecurring = {
  kind: SirKind;
  label: string;
  every: 'year' | 'month';
  /** Yearly: the month and day. Absent when `onEntryDay` is set. */
  month?: number;
  day?: number;
  /** The entry said "today" — resolved in code from the day the memory
   *  belongs to, not by the model. A memory processed a week late by the
   *  retry sweep would otherwise put the birthday on the wrong date for
   *  every year to come. */
  onEntryDay?: boolean;
  person?: string;
};

export type IntakeResult = {
  polished?: string;
  /** When the events took place, if the entry said: another day, a time. */
  happened?: { date?: string; time?: string };
  /** The day's separate parts, when one log told about several. */
  moments?: { time?: string; text: string }[];
  tasks: IntakeTask[];
  people: { name: string; descriptor?: string; note?: string }[];
  places: ParsedPlace[];
  /** Smart Icon Reminders for this day — see src/dayMarkers.ts. */
  markers: { kind: SirKind; label: string }[];
  recurring: ParsedRecurring[];
};

function readMoments(m: { time?: string | null; text?: string | null }[] | null | undefined): IntakeResult['moments'] {
  const list = (m ?? [])
    .map((x) => ({
      text: typeof x?.text === 'string' ? x.text.trim() : '',
      time: typeof x?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : undefined,
    }))
    .filter((x) => x.text)
    .slice(0, 8);
  return list.length >= 2 ? list : undefined;
}

function readHappened(h: { date?: string | null; time?: string | null } | null | undefined): IntakeResult['happened'] {
  const date = typeof h?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date) ? h.date : undefined;
  const time = typeof h?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.time) ? h.time : undefined;
  return date || time ? { date, time } : undefined;
}

const PERIOD_TIMES: Record<string, string> = {
  morning: '09:00',
  afternoon: '15:00',
  evening: '20:00',
  night: '20:00',
};

export async function analyzeMemory(
  text: string,
  options: { spoken?: boolean; sameDay?: string[]; entryDay?: string } = {},
): Promise<IntakeResult | null> {
  if (!intakeAvailable() || !text.trim()) return null;

  const now = new Date();
  const known = await getKnownPeopleForPrompt();
  const knownPlaces = await knownPlaceNames().catch(() => [] as string[]);

  // Who is writing. Without this the intake brain can pull the user's own
  // name out of their own entry and file them as somebody they met — you'd
  // end up with a profile of yourself sitting in your People list.
  const profile = await getUserProfile();
  const identity = identityForPrompt(profile);
  const self = identity
    ? `\n\nWHO IS WRITING: ${identity} They are the "I"/"me" in every entry — never list them under "people", no matter which name or spelling they use for themselves.`
    : '';

  // Spell out the next two weeks so "next Friday" can't be mis-resolved by
  // model date arithmetic.
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return `${WEEKDAYS_LONG[d.getDay()]} = ${localDate(d)}`;
  }).join(', ');
  const result = await chatCompletion(textProviders(), (model) => ({
        model,
        messages: [
          {
            role: 'system',
            content: `${INTAKE_PROMPT}\n\nTODAY is ${WEEKDAYS_LONG[now.getDay()]}, ${localDate(now)}.${entryDayLine(options.entryDay, now)} Upcoming dates for reference: ${calendar}.${self}\n\nKNOWN PEOPLE:\n${known || '(none yet)'}\n\nKNOWN PLACES:\n${knownPlaces.join('\n') || '(none yet)'}`,
          },
          { role: 'user', content: entryFor(text, options) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
  }));
  if (!result.ok) return null;

  try {
    const parsed = JSON.parse(result.content) as {
      polished?: string;
      happened?: { date?: string | null; time?: string | null } | null;
      moments?: { time?: string | null; text?: string | null }[] | null;
      tasks?: {
        title?: string;
        date?: string | null;
        period?: string | null;
        time?: string | null;
        details?: string | null;
        kind?: string | null;
      }[];
      people?: { name?: string; descriptor?: string | null; note?: string | null }[];
      places?: (string | { name?: string; kind?: string; moment?: string | null })[];
      markers?: { kind?: string; label?: string }[];
      recurring?: {
        kind?: string;
        label?: string;
        every?: string;
        date?: string | null;
        day_of_month?: number | null;
        person?: string | null;
      }[];
    };

    // Every kind is checked against the list the app can draw. A model that
    // invents a kind ("coffee") gets it dropped rather than rendered as a
    // blank icon.
    const markers = (parsed.markers ?? [])
      .filter((m): m is { kind: SirKind; label?: string } => isSirKind(m.kind))
      // Birthdays and anniversaries are repeats by nature; if one arrives
      // here as a one-day marker it is the model ignoring its instructions,
      // and keeping it would draw the same cake twice on that day.
      .filter((m) => m.kind !== 'birthday' && m.kind !== 'anniversary')
      .map((m) => ({ kind: m.kind, label: (m.label ?? '').trim() || SIR_KINDS[m.kind].label }));

    const recurring: ParsedRecurring[] = [];
    for (const r of parsed.recurring ?? []) {
      if (!isSirKind(r.kind)) continue;
      const label = (r.label ?? '').trim() || SIR_KINDS[r.kind].label;
      const person = r.person?.trim() || undefined;
      if (r.every === 'month') {
        const day = Number(r.day_of_month);
        if (Number.isInteger(day) && day >= 1 && day <= 31) {
          recurring.push({ kind: r.kind, label, every: 'month', day, person });
        }
        continue;
      }
      // Yearly. Anything that isn't a real month and day is dropped: a
      // birthday on the wrong date is worse than no birthday, because it
      // comes back wrong every year.
      if (r.date === 'today') {
        recurring.push({ kind: r.kind, label, every: 'year', onEntryDay: true, person });
        continue;
      }
      const match = /^(\d{2})-(\d{2})$/.exec(r.date ?? '');
      const month = match ? Number(match[1]) : NaN;
      const day = match ? Number(match[2]) : NaN;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        recurring.push({ kind: r.kind, label, every: 'year', month, day, person });
      }
    }

    const tasks: IntakeTask[] = (parsed.tasks ?? [])
      .filter((t): t is { title: string } & typeof t => !!t.title?.trim())
      .map((t) => {
        const dueDate = t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : undefined;
        let dueTime: string | undefined;
        if (t.time && /^\d{2}:\d{2}$/.test(t.time)) dueTime = t.time;
        else if (t.period && PERIOD_TIMES[t.period.toLowerCase()]) {
          dueTime = PERIOD_TIMES[t.period.toLowerCase()];
        }
        return {
          title: t.title.trim(),
          dueDate,
          dueTime,
          details: t.details?.trim() || undefined,
          icon: isSirKind(t.kind) ? t.kind : undefined,
        };
      });

    return {
      polished: parsed.polished?.trim() || undefined,
      happened: readHappened(parsed.happened),
      moments: readMoments(parsed.moments),
      tasks,
      people: (parsed.people ?? [])
        .filter((p): p is { name: string } & typeof p => !!p.name?.trim())
        .map((p) => ({
          name: p.name.trim(),
          descriptor: p.descriptor?.trim() || undefined,
          note: p.note?.trim() || undefined,
        })),
      // Older answers were a plain list of names; both shapes are read.
      places: (parsed.places ?? [])
        .map((p): ParsedPlace | null => {
          if (typeof p === 'string') return p.trim() ? { name: p.trim() } : null;
          const name = p?.name?.trim();
          if (!name) return null;
          return {
            name,
            kind: isPlaceKind(p.kind) ? p.kind : undefined,
            moment: p.moment?.trim() || undefined,
          };
        })
        .filter((p): p is ParsedPlace => !!p),
      markers,
      recurring,
    };
  } catch {
    return null;
  }
}

// What the AI reads for a saved document: the user's note, then the words
// the phone read from the file, clearly fenced off as the document's.
// Capped: a long PDF is mostly small print, and the useful part — who, when,
// where — is nearly always near the top.
const DOCUMENT_TEXT_LIMIT = 6000;

/** Arabic written in Latin letters and numbers ("3shan", "le3bt", "a7a",
 *  "2ol"): two or more such words, and no Arabic script. */
export function isFranco(text: string): boolean {
  if (/[\u0600-\u06FF]/.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return words.filter((w) => /[a-z]/.test(w) && /[235789]/.test(w) && !/^\d+(am|pm|st|nd|rd|th|s|k)?$/.test(w)).length >= 2;
}

/** The day the entry is filed under, when it isn't today — a note added
 *  to a past day from its page. */
function entryDayLine(entryDay: string | undefined, now: Date): string {
  if (!entryDay || entryDay === localDate(now)) return ' ENTRY DAY is today.';
  const [y, m, d] = entryDay.split('-').map(Number);
  return ` ENTRY DAY is ${WEEKDAYS_LONG[new Date(y, m - 1, d).getDay()]}, ${entryDay} — the user added this to that day, writing today.`;
}

/** The entry as the model reads it: a spoken one marked as a transcript,
 *  with what else the user logged that day to make sense of misheard words. */
function entryFor(text: string, options: { spoken?: boolean; sameDay?: string[] }): string {
  if (!options.spoken) {
    return isFranco(text)
      ? `FRANCO ENTRY — write "polished" in Franco-Arabic, Latin letters, like the user wrote it. Do NOT convert it to Arabic script.\n\n${text}`
      : text;
  }
  const context = (options.sameDay ?? []).filter(Boolean).slice(0, 6);
  return [
    'SPOKEN ENTRY (speech-to-text transcript — may contain misheard words):',
    text,
    ...(context.length
      ? ['', 'SAME-DAY CONTEXT (other things the user logged that day — only to understand the entry, not to copy):', ...context.map((c) => `- ${c.slice(0, 300)}`)]
      : []),
  ].join('\n');
}

export function documentEntry(note: string, memory: LoggedMemory): string {
  const a = memory.attachments?.[0];
  const what = a?.kind === 'pdf' ? `a file${a.name ? ` ("${a.name}")` : ''}` : 'a screenshot';
  const text = (a?.text ?? '').trim().slice(0, DOCUMENT_TEXT_LIMIT) || '(no readable text was found in it)';
  return [
    note.trim() ? `The user's note: ${note.trim()}` : 'The user added no note.',
    '',
    `ATTACHED DOCUMENT (${what}, read on the phone):`,
    '<<<',
    text,
    '>>>',
  ].join('\n');
}

// A memory logging screen calls this directly right after saving, and the
// retroactive sweep (below) can ALSO pick up that same still-unrefined
// memory moments later on the very next screen focus — without this guard
// the two would race, double-hitting the API and, if either leg failed,
// wrongly counting the memory as "tried" for the whole app session.
const inFlight = new Set<string>();

// Analyzes a just-saved memory and routes every finding. `dayKey` is the day
// the memory belongs to (photos can land on past days). Fire-and-forget:
// never throws, never blocks the save. Returns true when the pass completed
// (so the memory is marked refined and won't be re-processed).
export async function processMemoryIntake(
  memoryId: string,
  rawText: string,
  dayKey: string,
): Promise<boolean> {
  if (inFlight.has(memoryId)) return false;
  inFlight.add(memoryId);
  try {
    // A saved screenshot or file: the AI reads the user's note and the words
    // the phone read from the file. `rawText` stays the user's own note — the
    // document's text is kept on the attachment, not passed off as theirs.
    const all = await getLoggedMemories();
    const memory = all.find((m) => m.id === memoryId);
    const attachment = memory?.kind === 'document' ? memory.attachments?.[0] : undefined;
    const spoken = memory?.kind === 'voice';
    const result = await analyzeMemory(attachment ? documentEntry(rawText, memory!) : rawText, {
      spoken,
      sameDay: spoken ? sameDayText(all, memoryId, dayKey) : undefined,
      entryDay: dayKey,
    });
    // Analysis unavailable (no key / network) — leave the memory unrefined
    // so the sweep retries it next time the app opens.
    if (!result) return false;

    // 1 — The polished memory replaces the raw text everywhere the app
    //     displays notes; the verbatim original is kept as the source (the
    //     transcript screen still shows the exact words that were said).
    const polished =
      result.polished && result.polished !== rawText ? result.polished : undefined;
    if (spoken) console.log(`[intake] voice note ${memoryId} ${polished ? 'polished' : 'came back unchanged — the transcript stays'}`);
    // When it happened, as the entry says — so a day reads in order and
    // "yesterday afternoon I met Dave" lands on yesterday afternoon. Only
    // for words the user wrote or said: a photo's own time is the truth,
    // and a document's dates belong to what it describes.
    const moved = memory && (memory.kind === 'text' || memory.kind === 'voice') ? retime(memory, dayKey, result.happened) : null;
    if (moved) {
      console.log(`[intake] ${memoryId} happened ${moved.day} ${moved.takenAt.slice(11, 16)} (was filed ${dayKey})`);
      dayKey = moved.day;
    }
    await updateMemory(memoryId, {
      ...(polished ? { text: polished } : {}),
      rawText,
      refined: true,
      polishVersion: POLISH_VERSION,
      ...(moved ? { takenAt: moved.takenAt } : {}),
    });
    // One log about the whole day becomes its moments, each at its time.
    if (memory && (memory.kind === 'text' || memory.kind === 'voice') && result.moments && !memory.placedByUser) {
      await splitMemory(memoryId, momentTimes(result.moments, dayKey, moved?.takenAt ?? memory.takenAt));
    }

    // 2 — Commitments become tasks. Ones without a date are flagged so the
    //     Tasks page can ask the user to confirm a due date.
    for (const t of result.tasks) {
      const { details, icon, ...task } = t;
      await addTask({
        ...task,
        notes: details,
        source: 'memory',
        sourceText: rawText || undefined,
        sourceDate: dayKey,
        seen: false,
        needsDueDate: !t.dueDate,
        ...(attachment
          ? {
              attachment: {
                uri: attachment.uri,
                kind: attachment.kind,
                name: attachment.name,
                previewUri: attachment.previewUri,
              },
              memoryId,
              // Something that happens at a set time needs warning ahead.
              remindEarly: !!t.dueDate,
            }
          : {}),
      });
      // The day it happens gets its icon — the stethoscope on the day of
      // the appointment — so the Timeline shows it coming.
      if (attachment && icon && t.dueDate) {
        await addDayMarker(t.dueDate, { kind: icon, label: t.title, source: 'log', memoryId });
      }
    }

    // 3 — People get tagged on this day; brand-new names are created
    //     unverified so the user can confirm them on their profile.
    for (const p of result.people) {
      await addPersonMention(dayKey, p.name, p.descriptor, p.note);
    }

    // 4 — Places the user was at land on this day's Places. When the log
    //     came with photos and names exactly one place, those photos are of
    //     it — the user said so about these very pictures — which is what
    //     gives a place its name, location and cover without anyone asking.
    //     Two places named with the same photos is ambiguous: no link.
    const placeIds: string[] = [];
    for (const place of result.places) {
      const id = await recordNamedPlaceForDay(dayKey, place);
      if (id) placeIds.push(id);
    }
    if (placeIds.length === 1) {
      const memory = (await getLoggedMemories()).find((m) => m.id === memoryId);
      if (memory?.photoUris?.length) await linkPhotosToSaidPlace(memory.photoUris, placeIds[0]);
    }

    // 5 — Moments worth finding at a glance become icons beside this day.
    for (const m of result.markers) {
      await addDayMarker(dayKey, { kind: m.kind, label: m.label, source: 'log', memoryId });
    }

    // 6 — Dates that come back. "today" is resolved against the day this
    //     memory belongs to, which is not always the day it is processed.
    const [, entryMonth, entryDay] = dayKey.split('-').map(Number);
    for (const r of result.recurring) {
      const month = r.onEntryDay ? entryMonth : r.month;
      const day = r.onEntryDay ? entryDay : r.day;
      if (!day) continue;
      await addRecurringMarker({
        kind: r.kind,
        label: r.label,
        every: r.every,
        month: r.every === 'year' ? month : undefined,
        day,
        person: r.person,
        since: dayKey,
        source: 'log',
      });
    }
    return true;
  } catch (e) {
    // Best-effort by design — the memory itself is already safe, and it is
    // left unrefined so the sweep tries again. Said out loud, though.
    console.warn(`[intake] could not process ${memoryId}:`, e);
    return false;
  } finally {
    inFlight.delete(memoryId);
  }
}

/** Each moment's time on the day: its own when it has one; between its
 *  neighbours when it doesn't; always in order, never in the future. A log
 *  with no times at all keeps its parts together around its own time. */
function momentTimes(moments: { time?: string; text: string }[], dayKey: string, fallbackIso: string): { text: string; takenAt: string }[] {
  const [y, mo, d] = dayKey.split('-').map(Number);
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(y, mo - 1, d, h, m).getTime();
  };
  const t: (number | undefined)[] = moments.map((m) => (m.time ? at(m.time) : undefined));
  const base = new Date(fallbackIso).getTime();
  if (!t.some((x) => x !== undefined)) t[0] = base;
  // Fill the gaps between known times, evenly; before the first and after
  // the last, an hour apart.
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== undefined) continue;
    let p = i - 1;
    while (p >= 0 && t[p] === undefined) p--;
    let n = i + 1;
    while (n < t.length && t[n] === undefined) n++;
    if (p >= 0 && n < t.length) t[i] = t[p]! + ((t[n]! - t[p]!) * (i - p)) / (n - p);
    else if (p >= 0) t[i] = t[p]! + 3600000 * (i - p);
    else t[i] = t[n]! - 3600000 * (n - i);
  }
  const dayStart = new Date(y, mo - 1, d).getTime();
  const dayEnd = Math.min(dayStart + 86400000 - 60000, Date.now());
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    let v = Math.min(dayEnd, Math.max(dayStart, t[i]!));
    if (i > 0 && v <= out[i - 1]) v = out[i - 1] + 60000;
    out.push(v);
  }
  return moments.map((m, i) => ({ text: m.text, takenAt: new Date(Math.round(out[i] / 60000) * 60000).toISOString() }));
}

/** The new day and time a memory belongs at, or null to leave it. Never
 *  moved into the future, and never more than a month back. */
function retime(
  memory: LoggedMemory,
  dayKey: string,
  happened: IntakeResult['happened'],
): { day: string; takenAt: string } | null {
  if (!happened || memory.placedByUser) return null;
  const day = happened.date ?? dayKey;
  const [y, mo, d] = day.split('-').map(Number);
  const at = new Date(memory.takenAt);
  const [hh, mm] = happened.time ? happened.time.split(':').map(Number) : [at.getHours(), at.getMinutes()];
  const when = new Date(y, mo - 1, d, hh, mm);
  const now = Date.now();
  if (when.getTime() > now || now - when.getTime() > 31 * 86400000) return null;
  if (when.getTime() === at.getTime()) return null;
  return { day, takenAt: when.toISOString() };
}

// A failed attempt is retried on the next sweep rather than given up on
// forever — but not on every single screen focus in a tight loop, so a
// memory that keeps failing (e.g. no network) waits a short cooldown before
// being tried again.
const lastAttemptAt = new Map<string, number>();
const RETRY_COOLDOWN_MS = 20_000;

/** What else the user logged that day, for making sense of a transcript. */
function sameDayText(all: LoggedMemory[], memoryId: string, dayKey: string): string[] {
  return all
    .filter((m) => m.id !== memoryId && dateKey(new Date(m.takenAt)) === dayKey)
    .map((m) => m.text?.trim() ?? '')
    .filter(Boolean);
}

// The polish rules changed (Oct 2026): voice notes are rewritten as
// transcripts, nothing is reworded — "edy" (hand) once came back as "ضهري"
// (back) — Franco stays Franco, and each entry is placed at the time it
// says. Voice notes from before, and typed notes from the last week, are
// polished once more under these rules: the text and its time only — their
// tasks, people and places were filed the first time and are not again.
// v3 (Oct 2026): a log about the whole day is split into its moments.
const POLISH_VERSION = 3;
const RECHECK_TYPED_DAYS = 7;

async function repolishUnderNewRules(limit = 4): Promise<boolean> {
  const all = await getLoggedMemories();
  const weekAgo = Date.now() - RECHECK_TYPED_DAYS * 86400000;
  const stale = all
    .filter(
      (m) =>
        m.refined &&
        !m.partOf &&
        (m.polishVersion ?? 0) < POLISH_VERSION &&
        !!(m.rawText ?? m.text)?.trim() &&
        (m.kind === 'voice' || (m.kind === 'text' && new Date(m.createdAt).getTime() > weekAgo)) &&
        !inFlight.has(m.id) &&
        Date.now() - (lastAttemptAt.get(m.id) ?? 0) > RETRY_COOLDOWN_MS,
    )
    .slice(0, limit);
  let changed = false;
  for (const m of stale) {
    lastAttemptAt.set(m.id, Date.now());
    const raw = (m.rawText ?? m.text)!;
    const day = dateKey(new Date(m.takenAt));
    const spoken = m.kind === 'voice';
    const result = await analyzeMemory(raw, {
      spoken,
      sameDay: spoken ? sameDayText(all, m.id, day) : undefined,
      entryDay: day,
    });
    if (!result) continue;
    const polished = result.polished?.trim();
    const moved = retime(m, day, result.happened);
    await updateMemory(m.id, {
      ...(polished && polished !== raw.trim() ? { text: polished } : {}),
      rawText: raw,
      polishVersion: POLISH_VERSION,
      ...(moved ? { takenAt: moved.takenAt } : {}),
    });
    if (result.moments && !m.placedByUser) {
      await splitMemory(m.id, momentTimes(result.moments, moved?.day ?? day, moved?.takenAt ?? m.takenAt));
    }
    console.log(
      `[intake] re-polished ${m.kind} ${m.id}: ${polished && polished !== raw.trim() ? 'rewritten' : 'unchanged'}${moved ? `, now ${moved.day} ${moved.takenAt.slice(11, 16)}` : ''}`,
    );
    changed = true;
  }
  return changed;
}

// Retroactive pass: any memory the intake never analyzed — logged before the
// pipeline existed, still mid-flight from a direct call, or whose analysis
// failed — gets polished and routed the next time the app opens. Returns
// true when anything changed so callers can refresh what's on screen.
export async function polishPendingMemories(limit = 6): Promise<boolean> {
  if (!intakeAvailable()) return false;
  try {
    const now = Date.now();
    const all = await getLoggedMemories();
    const pending = all
      .filter(
        (m) =>
          !m.refined &&
          // rawText set means an older pipeline version already processed it.
          !m.rawText &&
          (!!m.text?.trim() || m.kind === 'document') &&
          !inFlight.has(m.id) &&
          now - (lastAttemptAt.get(m.id) ?? 0) > RETRY_COOLDOWN_MS,
      )
      .slice(0, limit);

    let changed = false;
    for (const m of pending) {
      lastAttemptAt.set(m.id, Date.now());
      const ok = await processMemoryIntake(m.id, m.text ?? '', dateKey(new Date(m.takenAt)));
      changed = changed || ok;
    }
    if (await repolishUnderNewRules().catch((e) => (console.warn('[intake] re-polish failed:', e), false))) changed = true;
    return changed;
  } catch {
    return false;
  }
}

// A recording whose speech-to-text keeps coming back broken. Four tries is
// generous for a genuinely unreadable file; past that the Source page's
// "Generate transcript" button is still there to force one by hand.
const MAX_TRANSCRIBE_ATTEMPTS = 4;
const lastTranscribeAt = new Map<string, number>();

// Stage one of finishing an incomplete memory: a recording that has audio
// but no words yet.
//
// Transcription used to be attempted exactly once, on the recording screen,
// with no way back. So a recording made while the network was down or the
// API balance was empty saved with no text and stayed that way forever —
// the polish sweep below couldn't rescue it either, because there was no
// text to polish. That's how a real memory ended up permanently showing a
// placeholder. This is the retry that was missing.
export async function transcribePendingMemories(limit = 3): Promise<boolean> {
  if (!transcriptionAvailable()) return false;
  try {
    const now = Date.now();
    const all = await getLoggedMemories();
    const pending = all
      .filter(
        (m) =>
          m.kind === 'voice' &&
          !!m.audioUri &&
          !m.text?.trim() &&
          (m.transcribeAttempts ?? 0) < MAX_TRANSCRIBE_ATTEMPTS &&
          now - (lastTranscribeAt.get(m.id) ?? 0) > RETRY_COOLDOWN_MS,
      )
      .slice(0, limit);

    let changed = false;
    for (const m of pending) {
      lastTranscribeAt.set(m.id, Date.now());

      // A recording saved by a previous install is still on disk, under a
      // container path that no longer exists. Repair the record itself, not
      // just this read — and give it its attempts back, because every past
      // failure was the app looking in the wrong place rather than anything
      // wrong with the recording.
      const repaired = localFile(m.audioUri);
      if (repaired && repaired !== m.audioUri) {
        await updateMemory(m.id, { audioUri: repaired, transcribeAttempts: 0 });
      }

      const result = await transcribeAudio(repaired || m.audioUri!, 'auto');

      if (!result.ok) {
        // Only a real failure counts against the attempt budget. No key, no
        // credit and rate-limited are all temporary conditions that say
        // nothing about the recording, so they leave the count untouched
        // and the memory stays eligible for the next sweep.
        if (result.reason === 'failed') {
          await updateMemory(m.id, { transcribeAttempts: (m.transcribeAttempts ?? 0) + 1 });
        }
        continue;
      }

      await updateMemory(m.id, { text: result.text, words: result.words });
      changed = true;
      // Straight on to the intake brain: polish for the card, and route any
      // tasks/people/places the recording mentioned — the same treatment it
      // would have had if transcription had worked the first time.
      const spoken = [result.text.trim(), m.note?.trim()].filter(Boolean).join(' — ');
      await processMemoryIntake(m.id, spoken, dateKey(new Date(m.takenAt)));
    }
    return changed;
  } catch {
    return false;
  }
}

// Drop-in hook for any screen that displays memory content: on every focus,
// finishes any memory that isn't finished — first transcribing recordings
// that never got words, then polishing and routing anything unrefined — and
// calls `onChanged` if anything was updated (so the screen can re-fetch
// what it shows). Returns `analyzing`, true only once the sweep has taken
// long enough to be worth showing — avoids a flash when nothing is pending.
export function useMemoryPolish(onChanged: () => void): boolean {
  const [analyzing, setAnalyzing] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      const showDelay = setTimeout(() => {
        if (live) setAnalyzing(true);
      }, 250);

      // Transcribe first, then polish: a recording that only just got its
      // words needs the polish pass in the same sweep, or the card would
      // show the raw transcript until the next time the screen is opened.
      transcribePendingMemories()
        .then(async (transcribed) => {
          const polished = await polishPendingMemories();
          return transcribed || polished;
        })
        .then((changed) => {
          if (!live) return;
          clearTimeout(showDelay);
          setAnalyzing(false);
          if (changed) onChangedRef.current();
        })
        .catch(() => {
          if (live) {
            clearTimeout(showDelay);
            setAnalyzing(false);
          }
        });

      return () => {
        live = false;
        clearTimeout(showDelay);
      };
    }, []),
  );

  return analyzing;
}
