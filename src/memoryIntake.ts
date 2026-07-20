import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { dateKey, getLoggedMemories, updateMemory } from './memoryLog';
import { addPersonMention, getKnownPeopleForPrompt } from './peopleTags';
import { recordNamedPlaceForDay } from './placesFromPhotos';
import { ParsedTask, addTask } from './tasks';

// The core of Recall: the user logs everything through one door — a rambling
// voice note, a typed entry, a photo caption — and this module reads it once
// and sends every piece of information to its place:
//   · the memory itself, cleaned up, onto the Timeline
//   · commitments ("remind me to…") onto the Tasks page
//   · people the user was with onto their People profiles
//   · places mentioned onto that day's Places
// Everything is best-effort and runs after the memory is already saved, so a
// failed analysis can never lose what the user logged.

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

export function intakeAvailable(): boolean {
  return !!apiKey();
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
  "tasks": [{"title": "...", "date": "YYYY-MM-DD" | null, "period": "morning"|"afternoon"|"evening"|"night" | null, "time": "HH:MM" | null}],
  "people": [{"name": "...", "descriptor": "..." | null, "note": "..."}],
  "places": ["..."]
}

"polished" — the memory itself, cleaned and reorganized: fix rambling and fillers, keep EVERY event and detail, first person, past tense where natural, in the SAME language(s) the user used (Arabic stays Arabic, mixed stays mixed). Reminders/to-dos MUST be removed entirely from the polished text — they live in "tasks" instead. Example: "…grabbed coffee with Lina, oh and remind me to book the flight friday" → polished ends at "…grabbed coffee with Lina." and the flight goes into tasks. Never invent details. If the entry is already clean, return it as-is.

"tasks" — only genuine future to-dos: "remind me to…", "I have to…", "X asked me to…". Things that already happened are never tasks. title is a short imperative phrase in the user's own words with lead-ins stripped: "remind me to give Jeff the brief" → "Give Jeff the brief". Keep the entry's language. date resolves relative words ("tomorrow", weekday names) against TODAY given below; null when no day was mentioned. period only when the user said a day-part word. time only for an explicit clock time (24h).

"people" — only people the user personally met, saw, or spent time with in this entry (not people merely referred to). name: if the person clearly matches someone in KNOWN PEOPLE below, return EXACTLY that known spelling; otherwise the name as the user said it. descriptor: a short "who they are" only if the user stated it ("your neighbor", "coworker") — null otherwise. note: one short sentence about what happened with this person this time — written in the exact same language as the entry itself; NEVER translate.

"places" — short names of places the user was physically at ("Work", "Gym", "787 Coffee"). Not places merely mentioned ("a client in New Jersey" is not a visit).

Empty arrays are correct when a section has nothing.`;

export type IntakeResult = {
  polished?: string;
  tasks: ParsedTask[];
  people: { name: string; descriptor?: string; note?: string }[];
  places: string[];
};

const PERIOD_TIMES: Record<string, string> = {
  morning: '09:00',
  afternoon: '15:00',
  evening: '20:00',
  night: '20:00',
};

export async function analyzeMemory(text: string): Promise<IntakeResult | null> {
  const key = apiKey();
  if (!key || !text.trim()) return null;

  const now = new Date();
  const known = await getKnownPeopleForPrompt();
  // Spell out the next two weeks so "next Friday" can't be mis-resolved by
  // model date arithmetic.
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return `${WEEKDAYS_LONG[d.getDay()]} = ${localDate(d)}`;
  }).join(', ');
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `${INTAKE_PROMPT}\n\nTODAY is ${WEEKDAYS_LONG[now.getDay()]}, ${localDate(now)}. Upcoming dates for reference: ${calendar}.\n\nKNOWN PEOPLE:\n${known || '(none yet)'}`,
          },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as {
      polished?: string;
      tasks?: { title?: string; date?: string | null; period?: string | null; time?: string | null }[];
      people?: { name?: string; descriptor?: string | null; note?: string | null }[];
      places?: string[];
    };

    const tasks: ParsedTask[] = (parsed.tasks ?? [])
      .filter((t): t is { title: string } & typeof t => !!t.title?.trim())
      .map((t) => {
        const dueDate = t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : undefined;
        let dueTime: string | undefined;
        if (t.time && /^\d{2}:\d{2}$/.test(t.time)) dueTime = t.time;
        else if (t.period && PERIOD_TIMES[t.period.toLowerCase()]) {
          dueTime = PERIOD_TIMES[t.period.toLowerCase()];
        }
        return { title: t.title.trim(), dueDate, dueTime };
      });

    return {
      polished: parsed.polished?.trim() || undefined,
      tasks,
      people: (parsed.people ?? [])
        .filter((p): p is { name: string } & typeof p => !!p.name?.trim())
        .map((p) => ({
          name: p.name.trim(),
          descriptor: p.descriptor?.trim() || undefined,
          note: p.note?.trim() || undefined,
        })),
      places: (parsed.places ?? []).map((s) => s.trim()).filter(Boolean),
    };
  } catch {
    return null;
  }
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
    const result = await analyzeMemory(rawText);
    // Analysis unavailable (no key / network) — leave the memory unrefined
    // so the sweep retries it next time the app opens.
    if (!result) return false;

    // 1 — The polished memory replaces the raw text everywhere the app
    //     displays notes; the verbatim original is kept as the source (the
    //     transcript screen still shows the exact words that were said).
    const polished =
      result.polished && result.polished !== rawText ? result.polished : undefined;
    await updateMemory(memoryId, {
      ...(polished ? { text: polished } : {}),
      rawText,
      refined: true,
    });

    // 2 — Commitments become tasks. Ones without a date are flagged so the
    //     Tasks page can ask the user to confirm a due date.
    for (const t of result.tasks) {
      await addTask({
        ...t,
        source: 'memory',
        sourceText: rawText,
        sourceDate: dayKey,
        seen: false,
        needsDueDate: !t.dueDate,
      });
    }

    // 3 — People get tagged on this day; brand-new names are created
    //     unverified so the user can confirm them on their profile.
    for (const p of result.people) {
      await addPersonMention(dayKey, p.name, p.descriptor, p.note);
    }

    // 4 — Places mentioned land on this day's Places.
    for (const label of result.places) {
      await recordNamedPlaceForDay(dayKey, label);
    }
    return true;
  } catch {
    // Best-effort by design — the memory itself is already safe.
    return false;
  } finally {
    inFlight.delete(memoryId);
  }
}

// A failed attempt is retried on the next sweep rather than given up on
// forever — but not on every single screen focus in a tight loop, so a
// memory that keeps failing (e.g. no network) waits a short cooldown before
// being tried again.
const lastAttemptAt = new Map<string, number>();
const RETRY_COOLDOWN_MS = 20_000;

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
          !!m.text?.trim() &&
          !inFlight.has(m.id) &&
          now - (lastAttemptAt.get(m.id) ?? 0) > RETRY_COOLDOWN_MS,
      )
      .slice(0, limit);

    let changed = false;
    for (const m of pending) {
      lastAttemptAt.set(m.id, Date.now());
      const ok = await processMemoryIntake(m.id, m.text!, dateKey(new Date(m.takenAt)));
      changed = changed || ok;
    }
    return changed;
  } catch {
    return false;
  }
}

// Drop-in hook for any screen that displays memory content: on every focus,
// sweeps up unpolished memories and calls `onChanged` if anything was
// updated (so the screen can re-fetch what it shows). Returns `analyzing`,
// true only once the sweep has taken long enough to be worth showing —
// avoids a flash when there's nothing pending.
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

      polishPendingMemories()
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
