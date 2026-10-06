import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textAvailable, textProviders } from './aiProviders';
import { blockedWords, checkTopic, type TopicCheck } from './contentSafety';
import { getLoggedMemories } from './memoryLog';
import { TOPIC_OPTIONS, getCustomTopics, type TopicKey } from './onThisDay';

// What the user follows, topic by topic: not "Sports" but Al Ahly, the
// Premier League, F1. On This Day searches only for these, so what comes
// back is something the user will actually remember — "that was the day
// Ahly beat Zamalek, I watched it at Omar's".
//
// Recall works most of it out on its own, the way it learns people and
// places: a quiet pass reads what the user has logged ("watched the Ahly
// match", "Amr Diab concert") and notes what they follow. No list of
// hundreds of chips to pick from. In a topic's "What you follow" sheet the
// user sees what was noticed — marked as noticed, never passed off as
// something they said — removes what's wrong, and adds their own.

export type Follow = {
  name: string;
  topic: TopicKey;
  /** Typed by the user, or noticed in their memories. */
  from: 'you' | 'memories';
};

const KEY = 'otdFollows';
/** Names the user removed — never re-learned. */
const DISMISSED_KEY = 'otdFollowsDismissed';
/** Which memories the learning pass has read, and when it last ran. */
const LEARNED_KEY = 'otdFollowsLearned';
/** The free-text "taste" of the earlier design, moved over once. */
const OLD_INTERESTS_KEY = 'otdTopicInterests';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const listeners = new Set<() => void>();
export function onFollowsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function save(all: Follow[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  listeners.forEach((fn) => fn());
}

export async function getFollows(): Promise<Follow[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) return JSON.parse(raw) as Follow[];
  // First run of this design: the old "tune to your taste" text becomes
  // follows, one per comma, so nothing the user typed is lost.
  const old = await readJSON<Record<string, string>>(OLD_INTERESTS_KEY, {});
  const moved: Follow[] = Object.entries(old).flatMap(([topic, text]) =>
    text
      .split(/[,،\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, topic, from: 'you' as const })),
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(moved));
  return moved;
}

export async function followsFor(topic: TopicKey): Promise<Follow[]> {
  return (await getFollows()).filter((f) => f.topic === topic);
}

/** Adds one the user typed, after the same safety check as a typed topic. */
export async function addFollow(topic: TopicKey, name: string): Promise<TopicCheck> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  const all = await getFollows();
  if (all.some((f) => f.topic === topic && same(f.name, clean))) return { ok: true };
  const check = await checkTopic(clean);
  if (!check.ok) return check;
  await save([...all, { name: clean, topic, from: 'you' }]);
  // Typed back after being removed: it's wanted after all.
  const dismissed = await readJSON<string[]>(DISMISSED_KEY, []);
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed.filter((d) => !same(d, clean))));
  return { ok: true };
}

export async function removeFollow(topic: TopicKey, name: string): Promise<void> {
  const all = await getFollows();
  const gone = all.find((f) => f.topic === topic && same(f.name, name));
  await save(all.filter((f) => f !== gone));
  // A noticed one the user took away is never noticed again.
  if (gone?.from === 'memories') {
    const dismissed = await readJSON<string[]>(DISMISSED_KEY, []);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed, gone.name]));
  }
}

// ── Learning from memories ────────────────────────────────────────────────

const LEARN_PROMPT = (topics: string) => `You read entries from someone's personal memory diary. Find the specific things they FOLLOW that appear in the news: sports teams, leagues, competitions, athletes, artists and bands, TV shows, games, companies, and countries or cities whose news they follow.

Only include something when the entry shows the person follows it — watched the match, went to the concert, supports the team, follows the show, keeps up with it. Not every place or name mentioned: a café, a friend, a university or the city they live in is not something they follow. Name what lasts, not the one event: "Formula 1", not "Monaco Grand Prix"; the league or competition alongside a team when it is clear. For a match between two teams, only the team they support when the entry shows it (they cheered, "we" won) — both only when it doesn't. Use the common English name ("Al Ahly", "Premier League", "Amr Diab"). Never include anything sexual or explicit.

Put each under exactly one of these topic keys:
${topics}

Entries may be in Arabic, English or both. Respond with ONLY JSON: {"follows":[{"name":"...","topic":"<key>"}]} — an empty list when there is nothing.`;

const BATCH = 40;
const MAX_BATCHES_PER_RUN = 3;
const RUN_EVERY = 6 * 3600_000;

let running: Promise<number> | null = null;

/** Reads memories not read before and adds what the user follows. Cheap
 *  and quiet: at most every six hours, a few batches a run. Returns how
 *  many follows were added. */
export function learnFollows(force = false): Promise<number> {
  if (!running) {
    running = learn(force).finally(() => {
      running = null;
    });
  }
  return running;
}

async function learn(force: boolean): Promise<number> {
  if (!textAvailable()) return 0;
  const state = await readJSON<{ at: number; read: string[] }>(LEARNED_KEY, { at: 0, read: [] });
  if (!force && Date.now() - state.at < RUN_EVERY) return 0;

  const read = new Set(state.read);
  const unread = (await getLoggedMemories())
    .filter((m) => !read.has(m.id) && m.text?.trim() && m.kind !== 'photo')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const topics = [...TOPIC_OPTIONS, ...(await getCustomTopics())];
  const keyList = topics.map((t) => `- "${t.key}": ${t.label}`).join('\n');
  const valid = new Set(topics.map((t) => t.key));
  const dismissed = await readJSON<string[]>(DISMISSED_KEY, []);

  let added = 0;
  for (let b = 0; b < MAX_BATCHES_PER_RUN && b * BATCH < unread.length; b++) {
    const batch = unread.slice(b * BATCH, (b + 1) * BATCH);
    const entries = batch.map((m, i) => `${i + 1}. ${m.text!.trim().slice(0, 400)}`).join('\n');
    const result = await chatCompletion(textProviders(), (model) => ({
      model,
      messages: [
        { role: 'system', content: LEARN_PROMPT(keyList) },
        { role: 'user', content: entries },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }));
    if (!result.ok) {
      // Not marked as read: the next run tries these again.
      console.warn(`[follows] could not read memories for follows: HTTP ${result.status}`);
      break;
    }
    let found: { name?: string; topic?: string }[] = [];
    try {
      found = (JSON.parse(result.content) as { follows?: { name?: string; topic?: string }[] }).follows ?? [];
    } catch {
      console.warn('[follows] the answer was not JSON — these memories will be read again');
      break;
    }
    const all = await getFollows();
    for (const f of found) {
      const name = f.name?.trim().slice(0, 40);
      if (!name || !f.topic || !valid.has(f.topic) || blockedWords(name)) continue;
      if (dismissed.some((d) => same(d, name))) continue;
      if (all.some((x) => x.topic === f.topic && same(x.name, name))) continue;
      all.push({ name, topic: f.topic, from: 'memories' });
      added++;
    }
    await save(all);
    batch.forEach((m) => read.add(m.id));
  }

  // A backlog is worked through on the next opens; the six-hour pause
  // starts only once everything has been read.
  const done = unread.every((m) => read.has(m.id));
  await AsyncStorage.setItem(LEARNED_KEY, JSON.stringify({ at: done ? Date.now() : 0, read: [...read] }));
  console.log(`[follows] read ${unread.length} new memories, noticed ${added} new follows`);
  return added;
}
