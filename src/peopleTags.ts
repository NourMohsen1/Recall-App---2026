import AsyncStorage from '@react-native-async-storage/async-storage';

// Real face recognition needs either a paid cloud vision API or ejecting out
// of Expo Go for on-device ML — both are bigger asks than this feature
// warrants right now. Instead people are tagged manually per day: the user
// types who they were with once, and that becomes the day's real "People"
// data. Names are stored per day so a wrongly-tagged person is one tap to
// remove (the requested filtering mechanism) without touching anyone else.

const DAY_PEOPLE_KEY = 'dayPeople';

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

export async function getPeopleForDay(dayKey: string): Promise<string[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  return byDay[dayKey] ?? [];
}

export async function getAllTaggedPeople(): Promise<string[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const names = new Set<string>();
  Object.values(byDay).forEach((list) => list.forEach((n) => names.add(n)));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function addPersonForDay(dayKey: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const existing = byDay[dayKey] ?? [];
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
  byDay[dayKey] = [...existing, trimmed];
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
}

export async function removePersonForDay(dayKey: string, name: string): Promise<void> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const existing = byDay[dayKey] ?? [];
  byDay[dayKey] = existing.filter((n) => n !== name);
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
}

// Everything the app knows about one person, derived purely from which days
// they were tagged on — the source of truth for the People page.
export type PersonSummary = {
  name: string;
  lastSeenDay: string; // YYYY-MM-DD
  firstSeenDay: string;
  days: string[]; // every day together, newest first
};

export async function getPeopleSummaries(): Promise<PersonSummary[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const perPerson = new Map<string, string[]>();
  for (const [day, names] of Object.entries(byDay)) {
    for (const name of names) {
      const days = perPerson.get(name);
      if (days) days.push(day);
      else perPerson.set(name, [day]);
    }
  }
  return Array.from(perPerson.entries())
    .map(([name, days]) => {
      const sorted = [...days].sort((a, b) => b.localeCompare(a));
      return {
        name,
        days: sorted,
        lastSeenDay: sorted[0],
        firstSeenDay: sorted[sorted.length - 1],
      };
    })
    // Most recently seen people first — the ones freshest in memory.
    .sort((a, b) => b.lastSeenDay.localeCompare(a.lastSeenDay));
}

// "today" / "yesterday" / "5 days ago" / "Jun 12" — how a friend would say it.
export function lastSeenLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const withYear = target.getFullYear() !== today.getFullYear();
  return `${MONTHS[target.getMonth()]} ${target.getDate()}${withYear ? `, ${target.getFullYear()}` : ''}`;
}

// A stable avatar tint per person, drawn from the app palette.
const AVATAR_TINTS = ['#336970', '#5C878D', '#4A7C83', '#85A5A9', '#29545A', '#B98A8A'];

export function avatarTint(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

// ---------------------------------------------------------------------------
// Person metadata — what the app has learned about each person from the
// user's loggings. People the AI creates start unverified so the user can
// confirm them; people the user adds by hand are trusted from the start.

export type PersonMention = { day: string; text: string };

export type PersonMeta = {
  descriptor?: string; // "Your neighbor", "Coworker" — only if the user said it
  verified: boolean;
  mentions: PersonMention[]; // what happened with them, one line per logging
};

const PERSON_META_KEY = 'personMeta';

export async function getAllPersonMeta(): Promise<Record<string, PersonMeta>> {
  return readJSON<Record<string, PersonMeta>>(PERSON_META_KEY, {});
}

export async function getPersonMeta(name: string): Promise<PersonMeta | null> {
  const all = await getAllPersonMeta();
  return all[name] ?? null;
}

export async function verifyPerson(name: string): Promise<void> {
  const all = await getAllPersonMeta();
  all[name] = { ...(all[name] ?? { mentions: [] }), verified: true };
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Removes a person everywhere — for when the AI caught a name that isn't
// actually someone the user knows.
export async function removePersonEverywhere(name: string): Promise<void> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  for (const day of Object.keys(byDay)) {
    byDay[day] = byDay[day].filter((n) => n !== name);
    if (byDay[day].length === 0) delete byDay[day];
  }
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
  const all = await getAllPersonMeta();
  delete all[name];
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// The intake pipeline found this person in a logging: tag them on the day,
// remember what happened with them, and keep/learn who they are. New names
// are created unverified; existing people keep their verification state.
export async function addPersonMention(
  dayKey: string,
  name: string,
  descriptor?: string,
  note?: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  // Reuse an existing person when the only difference is casing.
  const existingNames = await getAllTaggedPeople();
  const canonical =
    existingNames.find((n) => n.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
  const isKnown = existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  await addPersonForDay(dayKey, canonical);

  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[canonical] ?? { verified: isKnown, mentions: [] };
  if (descriptor && !meta.descriptor) meta.descriptor = descriptor;
  if (note && !meta.mentions.some((m) => m.day === dayKey && m.text === note)) {
    meta.mentions = [{ day: dayKey, text: note }, ...meta.mentions].slice(0, 50);
  }
  all[canonical] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Compact list of who the user already knows, fed to the intake prompt so
// the AI can match "Jeff" back to an existing "Jeff" instead of duplicating.
export async function getKnownPeopleForPrompt(): Promise<string> {
  const names = await getAllTaggedPeople();
  if (names.length === 0) return '';
  const meta = await getAllPersonMeta();
  return names
    .map((n) => `- ${n}${meta[n]?.descriptor ? ` (${meta[n].descriptor})` : ''}`)
    .join('\n');
}
