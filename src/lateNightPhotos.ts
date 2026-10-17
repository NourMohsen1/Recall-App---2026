import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetAssumedMemory } from './assumedMemory';
import { moveFacesToDays } from './faceIndex';
import { moveGuessesWithPhotos } from './guessedPeople';
import { logDayKey, logTakenAt } from './logicalDay';
import { LoggedMemory, dateKey, getLoggedMemories, replaceMemories } from './memoryLog';
import { getAllPhotoTimestamps } from './photoMeta';

// Photos taken after midnight belong to the night before, the same rule
// notes follow (src/logicalDay.ts): until 4 am it is still the day before.
//
// Photos were filed by the calendar date instead, so a night out that ran
// past midnight split in two: its last photos landed on the next day, the
// day's story was written from them there, and On This Day paired them with
// the next day's news (Nour, Oct 2026: two-days-ago photos from after
// midnight showed up under yesterday with the Ahly–Zamalek story).
//
// New photos are filed by the night's day on import (photoImport.ts,
// log/photo.tsx). This repairs what was filed before, once: each photo goes
// to its own night's day, the face index and face guesses move with it, and
// the stories of every day that changed are thrown away to be written again
// from the right photos.

const DONE_KEY = 'lateNightPhotosFiled:v1';

export type LateNightPlan = {
  memories: LoggedMemory[];
  /** Photo → the day it now belongs to, for every photo that moved. */
  moved: Map<string, string>;
  /** Every day that gained or lost photos. */
  days: Set<string>;
};

const nightDay = (ms: number) => logDayKey(new Date(ms));

/** Where every photo should be. Pure: works on what it is given. */
export function planLateNightMoves(
  all: LoggedMemory[],
  timestamps: Record<string, number>,
): LateNightPlan {
  const moved = new Map<string, string>();
  const days = new Set<string>();
  // Photos leaving a memory that keeps others, gathered by the day they go to.
  const leaving = new Map<string, { uris: string[]; first: number }>();
  const next: LoggedMemory[] = [];

  for (const m of all) {
    const uris = m.photoUris ?? [];
    // A memory the user placed by hand stays where they put it.
    if (m.kind !== 'photo' || uris.length === 0 || m.placedByUser) {
      next.push(m);
      continue;
    }
    const day = dateKey(new Date(m.takenAt));
    const want = (u: string) => (timestamps[u] ? nightDay(timestamps[u]) : day);
    const targets = new Set(uris.map(want));

    if (targets.size === 1 && !targets.has(day)) {
      // All of it belongs to one other night: the memory moves whole, words
      // and all, to the end of that night.
      const target = [...targets][0];
      const first = Math.min(...uris.map((u) => timestamps[u] ?? Infinity));
      next.push({ ...m, takenAt: logTakenAt(new Date(first)).toISOString() });
      for (const u of uris) moved.set(u, target);
      days.add(day).add(target);
      continue;
    }

    const stay = uris.filter((u) => want(u) === day);
    for (const u of uris) {
      const target = want(u);
      if (target === day) continue;
      const bucket = leaving.get(target) ?? { uris: [], first: Infinity };
      bucket.uris.push(u);
      bucket.first = Math.min(bucket.first, timestamps[u]);
      leaving.set(target, bucket);
      moved.set(u, target);
      days.add(day).add(target);
    }
    if (stay.length === uris.length) {
      next.push(m);
      continue;
    }
    // What stays keeps the time of its own first photo, not of one that left.
    const firstStaying = Math.min(...stay.map((u) => timestamps[u] ?? Infinity));
    next.push({
      ...m,
      photoUris: stay,
      ...(Number.isFinite(firstStaying) ? { takenAt: new Date(firstStaying).toISOString() } : {}),
    });
  }

  // The photos that left go to their night's own photo memory — the one
  // Recall brought in, not a log the user captioned — or a new one.
  for (const [target, bucket] of leaving) {
    const home = next.find(
      (m) =>
        m.kind === 'photo' && !m.manual && !m.text?.trim() && dateKey(new Date(m.takenAt)) === target,
    );
    if (home) {
      const i = next.indexOf(home);
      // Never twice: a photo already there stays listed once.
      next[i] = { ...home, photoUris: [...new Set([...(home.photoUris ?? []), ...bucket.uris])] };
    } else {
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'photo',
        photoUris: bucket.uris,
        createdAt: new Date().toISOString(),
        takenAt: logTakenAt(new Date(bucket.first)).toISOString(),
      } as LoggedMemory);
    }
  }

  return { memories: next, moved, days };
}

let running: Promise<void> | null = null;

/** Once per install. Callers can await it before touching photos. */
export function fileLateNightPhotos(): Promise<void> {
  running ??= repair().catch((e) => {
    // Not marked done: tried again on the next launch.
    console.warn('[late-night] could not refile photos from after midnight:', e);
  });
  return running;
}

async function repair(): Promise<void> {
  if (await AsyncStorage.getItem(DONE_KEY)) return;
  const [all, timestamps] = await Promise.all([getLoggedMemories(), getAllPhotoTimestamps()]);
  const plan = planLateNightMoves(all, timestamps);
  if (plan.moved.size > 0) {
    await replaceMemories(plan.memories);
    await moveFacesToDays(plan.moved);
    await moveGuessesWithPhotos(plan.moved);
    for (const day of plan.days) await forgetAssumedMemory(day);
  }
  await AsyncStorage.setItem(DONE_KEY, new Date().toISOString());
  console.log(
    `[late-night] ${plan.moved.size} photos from after midnight moved to the night before` +
      (plan.days.size ? `; days changed: ${[...plan.days].sort().join(', ')}` : ''),
  );
}
