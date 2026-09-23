import AsyncStorage from '@react-native-async-storage/async-storage';
import { addPersonForDay } from './peopleTags';

// Days the app THINKS a person was there, from recognising their face in
// that day's photos — kept completely apart from the days the user tagged
// themselves.
//
// That separation is the whole point. `dayPeople` is what the user said, and
// it drives the Timeline, the Ask answers and the People page. A guess must
// never quietly become one of those: it lives here until the user confirms
// it, and it's drawn differently everywhere it appears.
//
// Rejecting a suggestion is remembered too, so the pass doesn't keep
// offering the same wrong face every time it runs.

const KEY = 'personSuggestions';

export type SuggestionStatus = 'pending' | 'rejected';

export type PersonSuggestion = {
  name: string;
  day: string; // YYYY-MM-DD
  // The photo the face was recognised in, so the user can see WHY the app
  // thinks this — a suggestion you can't check is one you can't judge.
  photoUri: string;
  confidence: number; // 0-1, as reported by the matcher
  // The model's own account of which face it matched and why. Shown to the
  // user: a guess you can inspect is one you can judge, and a vague reason
  // is itself the tell that it isn't a real match.
  why?: string;
  status: SuggestionStatus;
  at: string; // ISO, when it was suggested
};

type Store = Record<string, PersonSuggestion>; // keyed `${name}|${day}`

function keyOf(name: string, day: string): string {
  return `${name}|${day}`;
}

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(store));
}

export async function getAllSuggestions(): Promise<PersonSuggestion[]> {
  return Object.values(await read());
}

// Pending suggestions for one day, for the day screen's People row.
export async function getSuggestionsForDay(day: string): Promise<PersonSuggestion[]> {
  const all = await read();
  return Object.values(all).filter((s) => s.day === day && s.status === 'pending');
}

// Pending suggestions for one person, for their profile.
export async function getSuggestionsForPerson(name: string): Promise<PersonSuggestion[]> {
  const all = await read();
  return Object.values(all)
    .filter((s) => s.name === name && s.status === 'pending')
    .sort((a, b) => b.day.localeCompare(a.day));
}

// Records a new guess. Never overwrites a decision the user already made —
// once they've said no to a day, the pass doesn't get to ask again.
export async function addSuggestion(
  s: Omit<PersonSuggestion, 'status' | 'at'>,
): Promise<boolean> {
  const store = await read();
  const key = keyOf(s.name, s.day);
  if (store[key]) return false;
  store[key] = { ...s, status: 'pending', at: new Date().toISOString() };
  await write(store);
  return true;
}

// The user said yes: this becomes a real tagged day like any they typed, and
// the suggestion is cleared out.
export async function acceptSuggestion(name: string, day: string): Promise<void> {
  await addPersonForDay(day, name);
  const store = await read();
  delete store[keyOf(name, day)];
  await write(store);
}

// The user said no. Kept as a rejection rather than deleted, so the next
// pass knows not to suggest it again.
export async function rejectSuggestion(name: string, day: string): Promise<void> {
  const store = await read();
  const existing = store[keyOf(name, day)];
  store[keyOf(name, day)] = {
    ...(existing ?? {
      name,
      day,
      photoUri: '',
      confidence: 0,
      at: new Date().toISOString(),
    }),
    status: 'rejected',
  };
  await write(store);
}

// Every day already decided for this person — tagged, suggested or rejected
// — so a scan doesn't spend a vision call re-asking about them.
export async function decidedDaysFor(name: string): Promise<Set<string>> {
  const all = await read();
  return new Set(
    Object.values(all)
      .filter((s) => s.name === name)
      .map((s) => s.day),
  );
}

// Moves guesses from one name to another, for when two profiles are joined
// or a person is renamed.
//
// Without this, merging "Nair" into "Nayer Mohsen" would strand every
// pending guess under a name that no longer exists — the day screen would
// keep asking "Nair?" about somebody who isn't in the app any more, and
// accepting it would quietly recreate the profile that was just merged away.
export async function migrateSuggestions(from: string, to: string): Promise<void> {
  if (from === to) return;
  const store = await read();
  let changed = false;

  for (const key of Object.keys(store)) {
    const s = store[key];
    if (s.name !== from) continue;
    delete store[key];
    changed = true;
    const target = keyOf(to, s.day);
    // A decision already recorded for the surviving person wins — they're
    // the profile being kept, and their answers came first.
    if (!store[target]) store[target] = { ...s, name: to };
  }

  if (changed) await write(store);
}

// Days a scan has already looked at for this person and found nothing.
//
// Without this the background pass has no memory of its own work: a day it
// checked and cleared leaves no trace, so the next run starts at the newest
// day again and the scan never walks backwards through the library. This is
// what lets it creep into older photos a slice at a time.
//
// Deliberately separate from suggestions — those are claims about the
// person, this is bookkeeping about the search.
const EXAMINED_KEY = 'personScannedDays';

async function readExamined(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(EXAMINED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export async function getExaminedDays(name: string): Promise<Set<string>> {
  return new Set((await readExamined())[name] ?? []);
}

export async function markDaysExamined(name: string, days: string[]): Promise<void> {
  if (days.length === 0) return;
  const all = await readExamined();
  all[name] = [...new Set([...(all[name] ?? []), ...days])];
  await AsyncStorage.setItem(EXAMINED_KEY, JSON.stringify(all));
}

// One day, marked as read for several people at once.
//
// The obvious spelling — markDaysExamined for each name in a Promise.all —
// silently loses all but one of them: every call reads the whole record,
// adds its own name and writes the lot back, so the last write wins and the
// rest of the people look unsearched. The day then gets re-read, and paid
// for, every single time it is opened.
export async function markDayExaminedFor(names: string[], day: string): Promise<void> {
  if (names.length === 0) return;
  const all = await readExamined();
  for (const name of names) all[name] = [...new Set([...(all[name] ?? []), day])];
  await AsyncStorage.setItem(EXAMINED_KEY, JSON.stringify(all));
}

// A new reference face makes every past search meaningless — those days were
// compared against a different photo, so they're all worth checking again.
export async function clearExaminedFor(name: string): Promise<void> {
  const all = await readExamined();
  delete all[name];
  await AsyncStorage.setItem(EXAMINED_KEY, JSON.stringify(all));
}

// Clears everything the app guessed about one person — used when their
// reference photo is removed or changed, since the guesses were made against
// the old face and shouldn't outlive it.
export async function clearSuggestionsFor(name: string): Promise<void> {
  const store = await read();
  for (const key of Object.keys(store)) {
    // Rejections are the user's decisions, not the app's guesses — those stay.
    if (store[key].name === name && store[key].status === 'pending') delete store[key];
  }
  await write(store);
}
