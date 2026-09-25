import AsyncStorage from '@react-native-async-storage/async-storage';

import { addPersonForDay, getPeopleForDay } from './peopleTags';

// People the app thinks were there, kept apart from people the user said
// were there.
//
// THE WHOLE POINT IS THE SEPARATION. Recognition is good, not certain, and
// the app's one rule is that a guess is never dressed up as a fact. So
// guesses live here, in their own store, and every screen that shows people
// reads both and draws them differently — a guess gets a ring the user
// learns to read as "the app thinks so".
//
// That is deliberately NOT the same as hiding them until approved. Waiting
// for approval before showing anything makes the feature useless until the
// user has done hours of work; showing a guess plainly, marked, means the
// app is immediately useful and never lies about what it knows.
//
// A rejection is remembered for the same reason a suggestion is: without
// it, the next pass over the library proposes the same wrong person again,
// and the user has to say no forever.

const GUESS_KEY = 'dayPeopleGuesses';
const REJECTED_KEY = 'dayPeopleRejected';

export type Guess = {
  name: string;
  /** Which group of faces produced this, so a whole group can be undone. */
  clusterId: number;
  /** The photo the face was found in. Kept so the user can look at the
   *  thing being claimed: a guess you cannot check is one you cannot
   *  judge, and "is this Sara?" is unanswerable without the picture. */
  photoUri?: string;
  /** Where the face sits in that photo, so it can be cut out rather than
   *  shown as a whole scene the user has to search. */
  box?: { x: number; y: number; w: number; h: number };
};

type GuessesByDay = Record<string, Guess[]>;
type RejectedByDay = Record<string, string[]>;

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function getGuessesForDay(day: string): Promise<Guess[]> {
  return (await readJSON<GuessesByDay>(GUESS_KEY, {}))[day] ?? [];
}

export async function getAllGuesses(): Promise<GuessesByDay> {
  return readJSON<GuessesByDay>(GUESS_KEY, {});
}

/** How many guesses are waiting, for the counter in Profile. */
export async function pendingGuessCount(): Promise<number> {
  const all = await readJSON<GuessesByDay>(GUESS_KEY, {});
  return Object.values(all).reduce((n, list) => n + list.length, 0);
}

export async function getGuessedDaysFor(name: string): Promise<string[]> {
  const all = await readJSON<GuessesByDay>(GUESS_KEY, {});
  return Object.entries(all)
    .filter(([, list]) => list.some((g) => sameName(g.name, name)))
    .map(([day]) => day)
    .sort()
    .reverse();
}

/** Record that a group's person probably appears on a day.
 *
 *  Silently does nothing when the user has already said so themselves, or
 *  has already said no. Both are answers, and re-asking is the behaviour
 *  that makes a feature like this exhausting. */
/** Returns true only when something was actually recorded, so a caller can
 *  report what changed rather than how many times it asked. */
export async function addGuess(
  day: string,
  name: string,
  clusterId: number,
  face?: { photoUri: string; box: { x: number; y: number; w: number; h: number } },
): Promise<boolean> {
  const confirmed = await getPeopleForDay(day);
  if (confirmed.some((n) => sameName(n, name))) return false;

  const rejected = await readJSON<RejectedByDay>(REJECTED_KEY, {});
  if ((rejected[day] ?? []).some((n) => sameName(n, name))) return false;

  const all = await readJSON<GuessesByDay>(GUESS_KEY, {});
  const forDay = all[day] ?? [];
  if (forDay.some((g) => sameName(g.name, name))) return false;

  all[day] = [...forDay, { name, clusterId, photoUri: face?.photoUri, box: face?.box }];
  await AsyncStorage.setItem(GUESS_KEY, JSON.stringify(all));
  return true;
}

async function dropGuess(day: string, name: string): Promise<void> {
  const all = await readJSON<GuessesByDay>(GUESS_KEY, {});
  const forDay = all[day] ?? [];
  const left = forDay.filter((g) => !sameName(g.name, name));
  if (left.length === forDay.length) return;
  if (left.length === 0) delete all[day];
  else all[day] = left;
  await AsyncStorage.setItem(GUESS_KEY, JSON.stringify(all));
}

/** The user says yes. It stops being a guess and becomes their own data —
 *  which is what every other part of the app already reads, so nothing else
 *  needs to know this ever happened. */
export async function approveGuess(day: string, name: string): Promise<void> {
  await addPersonForDay(day, name);
  await dropGuess(day, name);
}

/** The user says no. Remembered, so the next pass does not ask again. */
export async function rejectGuess(day: string, name: string): Promise<void> {
  await dropGuess(day, name);
  const rejected = await readJSON<RejectedByDay>(REJECTED_KEY, {});
  const forDay = rejected[day] ?? [];
  if (!forDay.some((n) => sameName(n, name))) {
    rejected[day] = [...forDay, name];
    await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify(rejected));
  }
}

/** Say yes to every day a group produced, in one go. */
export async function approveAllFor(name: string): Promise<number> {
  const days = await getGuessedDaysFor(name);
  for (const day of days) await approveGuess(day, name);
  return days.length;
}

/** Throw away every guess the app has made.
 *
 *  For starting the recognition over. Only touches guesses: days the user
 *  confirmed are their own data and survive, because the app deciding to
 *  delete someone's memories on its own is a worse bug than any it would be
 *  fixing. */
export async function clearAllGuesses(): Promise<void> {
  await AsyncStorage.removeItem(GUESS_KEY);
}

/** Undo a whole group — for when a name was given to the wrong face. */
export async function forgetCluster(clusterId: number): Promise<void> {
  const all = await readJSON<GuessesByDay>(GUESS_KEY, {});
  for (const [day, list] of Object.entries(all)) {
    const left = list.filter((g) => g.clusterId !== clusterId);
    if (left.length === 0) delete all[day];
    else all[day] = left;
  }
  await AsyncStorage.setItem(GUESS_KEY, JSON.stringify(all));
}
