import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getAllDayMarkers } from './dayMarkers';
import { dateKey, getMemoriesByDay, isManualLog, type LoggedMemory } from './memoryLog';
import { getAllDayPeople } from './peopleTags';
import { getAllDayPlaces } from './places';

// Recall's notifications, all scheduled on the phone (no server):
//
//   Reminder — (off) 10 pm, only on a day nothing was logged yet.
//   Daily    — 9 am, yesterday's recap: the day is truly over by then,
//              late-night notes included.
//   Weekly   — Monday 9 am, the Monday–Sunday week just finished.
//   Monthly  — the 1st at 9 am, the month just finished.
//
// Each one carries what actually happened ("Yesterday · 5 moments · with
// Omar · at Dunkin"), built here from the user's own logs — nothing goes
// to an AI for it. Since an app can't run at the moment a notification
// fires, they're rebuilt whenever Recall opens or goes to the background,
// so they include what was logged last. Lock screens can show them, so
// they say who, where and how much — never the words of a note.

export type RecapCadence = 'daily' | 'weekly' | 'monthly';
export type RecapPrefs = Record<RecapCadence | 'reminder', boolean>;

const PREFS_KEY = 'recapNotifications';
// The 10 pm reminder was built and switched off (Nour: rarely wanted,
// more confusing than useful). Kept off for everyone; the code stays.
const DEFAULTS: RecapPrefs = { reminder: false, daily: true, weekly: true, monthly: false };

/** The Recap tab each notification opens. */
export const RECAP_TAB: Record<RecapCadence, 'Today' | 'Weekly' | 'Monthly'> = {
  daily: 'Today',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const REMINDER_HOUR = 22;
const RECAP_HOUR = 9;
const REMINDER_DAYS = 3;

const REMINDER_LINES = [
  'Nothing saved from today yet — 30 seconds is enough.',
  'How was today? Say it before it slips away.',
  'One line about today. Future you will thank you.',
  "Today isn't in Recall yet. What happened?",
  "Who did you see today? Don't let it fade.",
];

export async function getRecapPrefs(): Promise<RecapPrefs> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<RecapPrefs>) : {}), reminder: false };
}

// ── Building the words ───────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0);

/** "Omar, Sara and 2 more" */
function names(list: string[], max = 2): string {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '');
}

export type Store = {
  byDay: Map<string, LoggedMemory[]>;
  people: Record<string, string[]>;
  places: Record<string, { label: string; named: boolean }[]>;
  markers: Record<string, { label: string }[]>;
};

async function readStore(): Promise<Store> {
  const [byDay, people, places, markers] = await Promise.all([
    getMemoriesByDay(),
    getAllDayPeople(),
    getAllDayPlaces(),
    getAllDayMarkers(),
  ]);
  return { byDay, people, places, markers };
}

/** "5 moments · with Omar and Sara · at Dunkin · gym, doctor" for the days
 *  from..to, or null when nothing was logged in them. */
function summary(store: Store, from: Date, to: Date): string | null {
  let moments = 0;
  const people = new Set<string>();
  const places = new Set<string>();
  const marks = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = dateKey(d);
    moments += (store.byDay.get(key) ?? []).filter(isManualLog).length;
    for (const p of store.people[key] ?? []) people.add(p);
    for (const p of store.places[key] ?? []) if (p.named) places.add(p.label);
    for (const m of store.markers[key] ?? []) marks.add(m.label);
  }
  if (moments === 0) return null;
  const parts = [`${moments} ${moments === 1 ? 'moment' : 'moments'}`];
  if (people.size) parts.push(`with ${names([...people])}`);
  if (places.size) parts.push(`at ${names([...places])}`);
  if (marks.size) parts.push(names([...marks], 3).toLowerCase());
  return parts.join(' · ');
}

// ── Scheduling ───────────────────────────────────────────────────────────

type Planned = { id: string; when: Date; title: string; body: string; data: Record<string, unknown> };

export function plan(prefs: RecapPrefs, store: Store, now: Date): Planned[] {
  const out: Planned[] = [];
  const today = at(now, 0);

  // Reminder: today (if still ahead and nothing logged), and the next days.
  if (prefs.reminder) {
    for (let i = 0; i < REMINDER_DAYS; i++) {
      const day = addDays(today, i);
      const when = at(day, REMINDER_HOUR);
      if (when <= now) continue;
      const logged = (store.byDay.get(dateKey(day)) ?? []).some(isManualLog);
      if (logged) continue;
      out.push({
        id: `reminder-${dateKey(day)}`,
        when,
        title: "Don't miss your day",
        body: REMINDER_LINES[day.getDate() % REMINDER_LINES.length],
        data: { log: true },
      });
    }
  }

  // Daily: the next 9 am, about the day before it.
  if (prefs.daily) {
    const when = at(now, RECAP_HOUR) > now ? at(now, RECAP_HOUR) : at(addDays(today, 1), RECAP_HOUR);
    const covered = addDays(at(when, 0), -1);
    const body = summary(store, covered, covered);
    if (body) {
      out.push({
        id: 'recap-daily',
        when,
        title: `Your ${WEEKDAYS[covered.getDay()]}, in Recall`,
        body,
        data: { day: dateKey(covered) },
      });
    }
  }

  // Weekly: the next Monday 9 am, about the week before it.
  if (prefs.weekly) {
    const toMonday = (8 - today.getDay()) % 7;
    let monday = addDays(today, toMonday);
    if (at(monday, RECAP_HOUR) <= now) monday = addDays(monday, 7);
    const from = addDays(monday, -7);
    const body = summary(store, from, addDays(monday, -1));
    if (body) {
      out.push({
        id: 'recap-weekly',
        when: at(monday, RECAP_HOUR),
        title: 'Your week, in Recall',
        body,
        data: { recap: RECAP_TAB.weekly, weekOf: dateKey(from) },
      });
    }
  }

  // Monthly: the next 1st at 9 am, about the month before it.
  if (prefs.monthly) {
    let first = new Date(now.getFullYear(), now.getMonth(), 1, RECAP_HOUR);
    if (first <= now) first = new Date(now.getFullYear(), now.getMonth() + 1, 1, RECAP_HOUR);
    const from = new Date(first.getFullYear(), first.getMonth() - 1, 1);
    const body = summary(store, from, addDays(at(first, 0), -1));
    if (body) {
      out.push({
        id: 'recap-monthly',
        when: first,
        title: `Your ${MONTHS[from.getMonth()]}, in Recall`,
        body,
        data: { recap: RECAP_TAB.monthly, monthOf: dateKey(from) },
      });
    }
  }
  return out;
}

const OURS = /^(recap-|reminder-)/;
let running: Promise<void> | null = null;

async function reschedule(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const [prefs, store] = await Promise.all([getRecapPrefs(), readStore()]);
    const planned = plan(prefs, store, new Date());
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of existing) if (OURS.test(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    for (const p of planned) {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: p.title, body: p.body, sound: true, data: p.data },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when },
      });
    }
    console.log(
      `[notify] scheduled: ${planned.map((p) => `${p.id} ${p.when.toLocaleString()} "${p.body}"`).join(' | ') || 'nothing'}`,
    );
  } catch (e) {
    console.warn('[notify] could not schedule notifications:', e);
  }
}

/** Rebuilds every notification from what's logged now. Safe to call often. */
export function syncRecapNotifications(): Promise<void> {
  if (!running) running = reschedule().finally(() => (running = null));
  return running;
}

/** At launch, and each time Recall goes to the background — so what's in
 *  the notifications is what was logged last. */
export function startNotifications(): () => void {
  syncRecapNotifications();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background') syncRecapNotifications();
  });
  return () => sub.remove();
}

/** Turn one kind on or off. Asks for permission the first time one is
 *  turned on; returns false when it was refused. */
export async function setRecapNotification(kind: keyof RecapPrefs, on: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (on) {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
  }
  const prefs = { ...(await getRecapPrefs()), [kind]: on };
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  await syncRecapNotifications();
  console.log(`[notify] ${kind} ${on ? 'on' : 'off'}`);
  return true;
}

/** Development only: tomorrow's daily recap, in five seconds. */
export async function sendTestRecapNotification(): Promise<void> {
  const store = await readStore();
  const yesterday = addDays(at(new Date(), 0), -1);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Your ${WEEKDAYS[yesterday.getDay()]}, in Recall`,
      body: summary(store, yesterday, yesterday) ?? 'Nothing logged yesterday',
      data: { day: dateKey(yesterday) },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
}

/** Where a tapped notification goes, worked out when it is tapped — it may
 *  be opened days later. */
export function notificationTarget(data: Record<string, unknown> | undefined):
  | { pathname: string; params?: Record<string, string> }
  | null {
  if (!data) return null;
  const daysAgo = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d).getTime() - at(new Date(), 0).getTime()) / 86400000);
  };
  if (data.log) return { pathname: '/log/text' };
  if (typeof data.day === 'string') return { pathname: `/day/${daysAgo(data.day)}` };
  if (typeof data.weekOf === 'string') {
    // Weeks start on Monday: how many weeks before this one it was.
    const thisMonday = -((new Date().getDay() + 6) % 7);
    return { pathname: '/recap', params: { period: 'Weekly', offset: String(Math.round((daysAgo(data.weekOf) - thisMonday) / 7)) } };
  }
  if (typeof data.monthOf === 'string') {
    const [y, m] = data.monthOf.split('-').map(Number);
    const now = new Date();
    return { pathname: '/recap', params: { period: 'Monthly', offset: String((y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())) } };
  }
  // Older notifications, scheduled before this version.
  if (typeof data.recap === 'string') {
    return { pathname: '/recap', params: typeof data.offset === 'number' ? { period: data.recap, offset: String(data.offset) } : { period: data.recap } };
  }
  return null;
}
