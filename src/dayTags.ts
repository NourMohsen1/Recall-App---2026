import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textProviders } from './aiProviders';
import { liveRequestInFlight } from './assumedMemory';
import { dateKey, getLoggedMemories, shownMemories } from './memoryLog';

// Search tags for what the user wrote and said — the notes' half of the
// "anchors" Ask searches by (memorySearch.ts). The photos' half comes with
// each photo story (assumedMemory.ts).
//
// Notes are kept in the user's own language, mostly Arabic script, and
// questions arrive in any language. Tags bridge that: "رحت المتحف المصري
// الكبير" gets "grand egyptian museum, museum, متحف, giza, tutankhamun", so
// "when did I go to the museum?" finds it. They also name what a note
// implies without saying ("شفت توت عنخ آمون" → museum).
//
// Written once per day in the background, ten days to a call, and again
// only when that day's words change. Text only — never photos.

const KEY = 'dayTags';
const BATCH = 10;
const PACE_MS = 3000;

type Stored = Record<string, { sig: string; tags: string[] }>;

const PROMPT = `You write search tags for days in someone's personal journal, so they can find a day later by asking about it in any language.

For each day, give 5 to 15 short tags for what someone might search for: places and kinds of place (museum, beach, café, hospital, university), named places, shops and brands, landmarks, things, food, activities, events, and what the entry implies without naming it (seeing Tutankhamun → museum). Each important tag in BOTH English (lowercase) and Arabic script ("museum", "متحف"); Franco-Arabic in the entry means Arabic. Never people's names, never feelings, never anything sensitive.

Return ONLY JSON: {"days": [{"date": "YYYY-MM-DD", "tags": ["...", "..."]}]}`;

async function readAll(): Promise<Stored> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

/** Every day's note tags. */
export async function getAllDayTags(): Promise<Record<string, string[]>> {
  const all = await readAll();
  return Object.fromEntries(Object.entries(all).map(([day, r]) => [day, r.tags]));
}

// Cheap and stable: changes whenever the day's words do.
function signature(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;

/** Tags every day whose words are new or changed. Safe to call often. */
export async function backfillDayTags(): Promise<number> {
  if (running || textProviders().length === 0) return 0;
  running = true;
  try {
    const byDay = new Map<string, string[]>();
    for (const m of shownMemories(await getLoggedMemories())) {
      const text = m.text?.trim();
      if (!text) continue;
      const day = dateKey(new Date(m.takenAt));
      byDay.set(day, [...(byDay.get(day) ?? []), text]);
    }
    const stored = await readAll();
    const pending = [...byDay.entries()]
      .map(([day, texts]) => ({ day, text: texts.join('\n'), sig: signature(texts.join('\n')) }))
      .filter((d) => stored[d.day]?.sig !== d.sig)
      .sort((a, b) => b.day.localeCompare(a.day));
    if (pending.length === 0) return 0;
    console.log(`[tags] ${pending.length} day(s) of notes to tag`);

    let done = 0;
    for (let i = 0; i < pending.length; i += BATCH) {
      while (liveRequestInFlight()) await sleep(300);
      const batch = pending.slice(i, i + BATCH);
      const input = batch.map((d) => `=== ${d.day} ===\n${d.text.slice(0, 1500)}`).join('\n\n');
      const result = await chatCompletion(textProviders(), (model) => ({
        model,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }));
      if (!result.ok) {
        // Said, not swallowed: nothing is marked done, so the next run
        // tries these days again.
        console.warn(`[tags] could not tag notes: HTTP ${result.status} ${result.body.slice(0, 120)}`);
        return done;
      }
      let days: { date?: string; tags?: unknown }[] = [];
      try {
        days = (JSON.parse(result.content) as { days?: typeof days }).days ?? [];
      } catch {
        console.warn('[tags] unreadable reply — will try again next time');
        return done;
      }
      const fresh = await readAll();
      for (const d of batch) {
        const got = days.find((x) => x.date === d.day);
        if (!got || !Array.isArray(got.tags)) continue;
        const tags = [...new Set(got.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
        fresh[d.day] = { sig: d.sig, tags };
        done += 1;
      }
      await AsyncStorage.setItem(KEY, JSON.stringify(fresh));
      await sleep(PACE_MS);
    }
    console.log(`[tags] tagged ${done} day(s) of notes`);
    return done;
  } finally {
    running = false;
  }
}
