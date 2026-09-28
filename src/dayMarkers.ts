import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

// Smart Icon Reminders — the small round icons that float beside a day on
// the Timeline.
//
// WHY THEY EXIST. A day card is text, and text has to be read. The icons are
// for the moments someone wants to find without reading anything: the day
// they took the medicine, the day they got paid, their friend's birthday.
// One glance down the timeline answers "when was the last time I…" before a
// single sentence has been opened.
//
// WHERE THEY COME FROM, in order of how much work they cost the user:
//
//   1. The intake brain (src/memoryIntake.ts) notices them in what the user
//      already logs — "أخدت الدوا", "got paid today" — as part of the same
//      call that finds tasks, people and places. Nothing extra to do.
//   2. Dates that repeat. A birthday mentioned once lands on that date every
//      year, including days that haven't happened yet — which is the
//      "reminder" in the name. Only things that repeat BY NATURE (birthdays,
//      anniversaries) or that the user SAID repeat ("I get paid on the 25th")
//      are ever repeated. Mentioning a payday once is one payday, not a
//      pattern: inventing a pattern would be the app presenting a guess as a
//      fact, which is the one thing it must never do.
//   3. The user, by hand, with the "+" on the Timeline.

export type SirKind =
  | 'birthday'
  | 'anniversary'
  | 'payday'
  | 'medicine'
  | 'workout'
  | 'doctor'
  | 'sick'
  | 'travel'
  | 'celebration'
  | 'study'
  | 'work'
  | 'home'
  | 'purchase'
  | 'religious'
  | 'holiday'
  | 'dinner'
  | 'call'
  | 'car'
  | 'pet'
  | 'family'
  | 'achievement';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Every icon here was checked against the icon set the app ships, so none
// renders as an empty box. The label is what the "+" picker shows, and what
// a marker falls back to when it has no words of its own.
export const SIR_KINDS: Record<SirKind, { icon: IconName; label: string }> = {
  birthday: { icon: 'cake-variant', label: 'Birthday' },
  anniversary: { icon: 'ring', label: 'Anniversary' },
  payday: { icon: 'cash', label: 'Payday' },
  medicine: { icon: 'pill', label: 'Medicine' },
  workout: { icon: 'dumbbell', label: 'Workout' },
  doctor: { icon: 'stethoscope', label: 'Doctor' },
  sick: { icon: 'thermometer', label: 'Sick day' },
  travel: { icon: 'airplane', label: 'Travel' },
  celebration: { icon: 'party-popper', label: 'Celebration' },
  study: { icon: 'school-outline', label: 'Exam / study' },
  work: { icon: 'briefcase-outline', label: 'Work milestone' },
  home: { icon: 'home-outline', label: 'Home / moving' },
  purchase: { icon: 'shopping-outline', label: 'Big purchase' },
  religious: { icon: 'star-crescent', label: 'Eid / Ramadan' },
  holiday: { icon: 'calendar-star', label: 'Holiday' },
  dinner: { icon: 'silverware-fork-knife', label: 'Special meal' },
  call: { icon: 'phone-outline', label: 'Important call' },
  car: { icon: 'car-outline', label: 'Car' },
  pet: { icon: 'paw', label: 'Pet' },
  family: { icon: 'baby-carriage', label: 'Family event' },
  achievement: { icon: 'trophy-outline', label: 'Achievement' },
};

export const SIR_KIND_LIST = Object.keys(SIR_KINDS) as SirKind[];

export function isSirKind(value: unknown): value is SirKind {
  return typeof value === 'string' && value in SIR_KINDS;
}

/** Something that happened on one day. */
export type DayMarker = {
  id: string;
  kind: SirKind;
  /** In the user's own words and language — "أخدت الدوا", "Got paid". */
  label: string;
  source: 'log' | 'manual';
  /** The log it was noticed in, so the bubble can lead back to it. */
  memoryId?: string;
};

/** Something that comes back on the same date. */
export type RecurringMarker = {
  id: string;
  kind: SirKind;
  label: string;
  every: 'year' | 'month';
  /** 1–12. Only for yearly markers. */
  month?: number;
  /** 1–31. Clamped to the last day of shorter months. */
  day: number;
  /** Whose birthday or anniversary, when it belongs to someone in People. */
  person?: string;
  /** The first day this was known to apply. Monthly markers start here —
   *  a salary the user describes today says nothing about last year. */
  since: string;
  source: 'log' | 'manual';
};

/** What a day actually shows: its own markers plus any repeat that lands on it. */
export type ShownMarker = DayMarker & { recurring?: RecurringMarker };

const DAY_KEY = 'dayMarkers';
const RECURRING_KEY = 'recurringMarkers';

type MarkersByDay = Record<string, DayMarker[]>;

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Two markers are the same moment when they are the same kind with the same
// words. "Took medicine" noticed in the morning's voice note and again in
// the evening's typed one is one icon, not two.
function sameMoment(a: { kind: SirKind; label: string }, b: { kind: SirKind; label: string }) {
  return a.kind === b.kind && a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

/** Does a repeating marker land on this day? */
export function occursOn(r: RecurringMarker, dayKey: string): boolean {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return false;
  // A birthday on the 31st still happens in a 30-day month, and a 29 Feb
  // birthday still happens in a year without one — on the last day there is.
  const lastDay = new Date(y, m, 0).getDate();
  const target = Math.min(r.day, lastDay);
  if (d !== target) return false;
  if (r.every === 'year') return m === r.month;
  return dayKey >= r.since;
}

export async function getRecurringMarkers(): Promise<RecurringMarker[]> {
  return readJSON<RecurringMarker[]>(RECURRING_KEY, []);
}

export async function getAllDayMarkers(): Promise<MarkersByDay> {
  return readJSON<MarkersByDay>(DAY_KEY, {});
}

/** Everything the Timeline should float beside this day. */
export async function getMarkersForDay(dayKey: string): Promise<ShownMarker[]> {
  const [byDay, recurring] = await Promise.all([getAllDayMarkers(), getRecurringMarkers()]);

  // Repeats first: a birthday is the more meaningful icon for its day.
  const shown: ShownMarker[] = [];
  for (const r of recurring) {
    if (!occursOn(r, dayKey)) continue;
    shown.push({ id: r.id, kind: r.kind, label: r.label, source: r.source, recurring: r });
  }

  const recurringLabels = new Set(shown.map((s) => s.label.trim().toLowerCase()));
  for (const m of byDay[dayKey] ?? []) {
    // The same occasion twice under two icons — a cake for the birthday and
    // a party popper labelled with the same birthday — was a real result on
    // the first test. The repeat already covers the day, so a one-day
    // marker with its exact words is dropped, whatever kind it was given.
    if (recurringLabels.has(m.label.trim().toLowerCase())) continue;
    if (shown.some((s) => sameMoment(s, m))) continue;
    shown.push(m);
  }
  return shown;
}

export async function addDayMarker(
  dayKey: string,
  marker: Omit<DayMarker, 'id'>,
): Promise<boolean> {
  const label = marker.label.trim() || SIR_KINDS[marker.kind].label;
  const all = await getAllDayMarkers();
  const forDay = all[dayKey] ?? [];
  if (forDay.some((m) => sameMoment(m, { kind: marker.kind, label }))) return false;
  all[dayKey] = [...forDay, { ...marker, label, id: newId() }];
  await AsyncStorage.setItem(DAY_KEY, JSON.stringify(all));
  return true;
}

export async function addRecurringMarker(
  marker: Omit<RecurringMarker, 'id'>,
): Promise<boolean> {
  const label = marker.label.trim() || SIR_KINDS[marker.kind].label;
  const all = await getRecurringMarkers();
  const duplicate = all.some(
    (r) =>
      r.kind === marker.kind &&
      r.every === marker.every &&
      r.day === marker.day &&
      r.month === marker.month &&
      sameMoment(r, { kind: marker.kind, label }),
  );
  if (duplicate) return false;
  await AsyncStorage.setItem(
    RECURRING_KEY,
    JSON.stringify([...all, { ...marker, label, id: newId() }]),
  );
  return true;
}

/** Mark a day by hand, from the "+" on the Timeline or the day screen.
 *
 *  A birthday or anniversary is a repeat by nature, so it is remembered for
 *  every year on this date — the same rule the intake brain follows.
 *  Anything else marks only this day: choosing "Payday" once says nothing
 *  about next month, and assuming it does would be the app inventing a
 *  pattern. */
export async function markDay(dayKey: string, kind: SirKind): Promise<void> {
  if (kind === 'birthday' || kind === 'anniversary') {
    const [, month, day] = dayKey.split('-').map(Number);
    await addRecurringMarker({
      kind,
      label: SIR_KINDS[kind].label,
      every: 'year',
      month,
      day,
      since: dayKey,
      source: 'manual',
    });
    return;
  }
  await addDayMarker(dayKey, { kind, label: SIR_KINDS[kind].label, source: 'manual' });
}

/** Take an icon off. A repeating one goes from every date it lands on —
 *  the user pressed remove on a birthday, not on one year of it. */
export async function removeMarker(dayKey: string, marker: ShownMarker): Promise<void> {
  if (marker.recurring) {
    const all = await getRecurringMarkers();
    await AsyncStorage.setItem(
      RECURRING_KEY,
      JSON.stringify(all.filter((r) => r.id !== marker.recurring?.id)),
    );
    return;
  }
  const all = await getAllDayMarkers();
  const left = (all[dayKey] ?? []).filter((m) => m.id !== marker.id);
  if (left.length === 0) delete all[dayKey];
  else all[dayKey] = left;
  await AsyncStorage.setItem(DAY_KEY, JSON.stringify(all));
}
