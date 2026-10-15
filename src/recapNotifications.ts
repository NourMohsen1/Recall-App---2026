import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getAllDayMarkers } from './dayMarkers';
import { dateKey, getMemoriesByDay, isManualLog, type LoggedMemory } from './memoryLog';
import { getAllDayPeople } from './peopleTags';
import { getAllDayPlaces } from './places';

// Recall's notifications, all scheduled on the phone (no server):
//
//   Daily    — 9 am, "your recap of yesterday is ready".
//   Weekly   — Monday 9 am, about the Monday–Sunday week just finished.
//   Monthly  — the 1st at 9 am, about the month just finished.
//   Nudges   — at most one a day, and never on a day already logged:
//              "did you log today?" at 9 pm (every other day at most),
//              "it's been a while" after three quiet days, and "this day
//              last year" at 6 pm when there's a memory from that date.
//
// A lock screen is seen by anyone near the phone, so a notification never
// says who, where or what — only that a recap is ready, and how many
// moments it holds (Nour, Oct 2026). The detail is one tap away, inside
// the app. Since an app can't run at the moment a notification fires,
// they're rebuilt whenever Recall opens or goes to the background.

export type RecapCadence = 'daily' | 'weekly' | 'monthly';
export type RecapPrefs = Record<RecapCadence | 'reminder' | 'nudges', boolean>;

const PREFS_KEY = 'recapNotifications';
// The old every-night 10 pm reminder stays off (Nour: too often). Nudges
// replace it: rarer, and only when something is actually missing.
const DEFAULTS: RecapPrefs = { reminder: false, nudges: true, daily: true, weekly: true, monthly: false };

/** The Recap tab each notification opens. */
export const RECAP_TAB: Record<RecapCadence, 'Today' | 'Weekly' | 'Monthly'> = {
  daily: 'Today',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const RECAP_HOUR = 9;
const NUDGE_HOUR = 21;
const LAST_YEAR_HOUR = 18;
/** How many days ahead nudges are planned — rebuilt on every open anyway. */
const NUDGE_DAYS = 4;

// Each one an invitation into the user's own story, never a chore, and
// still nothing private on the lock screen (Nour, Oct 2026: "something
// that pulls you in", like asking Recall to tell you your week).
const LOG_TITLES = ['Before today slips away', 'What made today today?', 'Keep today', 'A line for today'];
const LOG_LINES = [
  'Say it in 30 seconds. Recall keeps the rest.',
  'One thing you want to remember from today.',
  'Who did you see? Where did you go? Just talk.',
  'Future you will want to know how today went.',
];

export async function getRecapPrefs(): Promise<RecapPrefs> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<RecapPrefs>) : {}), reminder: false };
  // (`reminder`, the old nightly one, stays off; `nudges` replaced it.)
}

// ── Building the words ───────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0);

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

/** How many moments were logged between two days — the only detail a
 *  notification carries. */
function momentCount(store: Store, from: Date, to: Date): number {
  let moments = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    moments += (store.byDay.get(dateKey(d)) ?? []).filter(isManualLog).length;
  }
  return moments;
}

const moments = (n: number) => `${n} ${n === 1 ? 'moment' : 'moments'}`;

// ── Scheduling ───────────────────────────────────────────────────────────

/** "Tell me about my last week", in the language the user mostly writes. */
function weekQuestion(store: Store): string {
  const texts = [...store.byDay.values()].flat().slice(-40).map((m) => m.text ?? '');
  const arabic = texts.filter((t) => /[\u0600-\u06FF]/.test(t)).length;
  return arabic > texts.length / 2 ? 'احكيلي الأسبوع اللي فات كان عامل إزاي' : 'Tell me about my last week';
}

type Planned = { id: string; when: Date; title: string; body: string; data: Record<string, unknown> };

export function plan(prefs: RecapPrefs, store: Store, now: Date): Planned[] {
  const out: Planned[] = [];
  const today = at(now, 0);
  const logged = (d: Date) => (store.byDay.get(dateKey(d)) ?? []).some(isManualLog);

  // Daily: the next 9 am, about the day before it.
  if (prefs.daily) {
    const when = at(now, RECAP_HOUR) > now ? at(now, RECAP_HOUR) : at(addDays(today, 1), RECAP_HOUR);
    const covered = addDays(at(when, 0), -1);
    const n = momentCount(store, covered, covered);
    if (n > 0) {
      out.push({
        id: 'recap-daily',
        when,
        title: `Remember your ${WEEKDAYS[covered.getDay()]}?`,
        body: `${moments(n)} from yesterday. Take a minute to live it again.`,
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
    const n = momentCount(store, from, addDays(monday, -1));
    if (n > 0) {
      out.push({
        id: 'recap-weekly',
        when: at(monday, RECAP_HOUR),
        title: 'Your week, told back to you',
        body: `${moments(n)} last week. Tap and Recall tells you how it went.`,
        // Opens Ask with the question already asked: the answer to "tell me
        // about my last week" is the one Nour liked most.
        data: { ask: weekQuestion(store), weekOf: dateKey(from) },
      });
    }
  }

  // Monthly: the next 1st at 9 am, about the month before it.
  if (prefs.monthly) {
    let first = new Date(now.getFullYear(), now.getMonth(), 1, RECAP_HOUR);
    if (first <= now) first = new Date(now.getFullYear(), now.getMonth() + 1, 1, RECAP_HOUR);
    const from = new Date(first.getFullYear(), first.getMonth() - 1, 1);
    const n = momentCount(store, from, addDays(at(first, 0), -1));
    if (n > 0) {
      out.push({
        id: 'recap-monthly',
        when: first,
        title: `How was your ${MONTHS[from.getMonth()]}?`,
        body: `${moments(n)} in one month. See it all in one place.`,
        data: { recap: RECAP_TAB.monthly, monthOf: dateKey(from) },
      });
    }
  }

  // Nudges: at most one a day, none on a day already logged, none for
  // someone who has never logged anything (the app hasn't started yet).
  if (prefs.nudges && store.byDay.size > 0) {
    const lastLogged = [...store.byDay.entries()]
      .filter(([, list]) => list.some(isManualLog))
      .map(([k]) => k)
      .sort()
      .pop();
    // Never two days in a row, whatever kind: a day off between nudges.
    let lastNudge = -2;
    // A memory from a year ago beats an ordinary nudge the day before it.
    const yearAgoOf = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
    const yearDay = (i: number) => {
      const d = addDays(today, i);
      return logged(yearAgoOf(d)) && at(d, LAST_YEAR_HOUR) > now;
    };
    for (let i = 0; i < NUDGE_DAYS; i++) {
      const day = addDays(today, i);
      // Days after today can't be known to be logged yet; today can.
      if (i === 0 && logged(day)) continue;
      if (i - lastNudge < 2) continue;

      // "This day last year", when there's a memory from that date.
      const yearAgo = yearAgoOf(day);
      if (yearDay(i)) {
        out.push({
          id: `reminder-year-${dateKey(day)}`,
          when: at(day, LAST_YEAR_HOUR),
          title: 'A year ago today…',
          body: 'Something happened on this day last year. Want to see it?',
          data: { day: dateKey(yearAgo) },
        });
        lastNudge = i;
        continue;
      }

      const when = at(day, NUDGE_HOUR);
      if (when <= now || yearDay(i + 1)) continue;
      // Quiet for three days by then: a softer, different line.
      const quietDays = lastLogged ? Math.round((at(day, 0).getTime() - at(new Date(`${lastLogged}T00:00:00`), 0).getTime()) / 86400000) : 0;
      // Instead of "did you log today", never as well as it.
      if (quietDays >= 3) {
        out.push({
          id: `reminder-quiet-${dateKey(day)}`,
          when,
          title: 'Your story has a gap',
          body: 'A few words about the last few days, before they fade.',
          data: { log: true },
        });
        break; // one "while" is enough until they're back
      }
      lastNudge = i;
      out.push({
        id: `reminder-${dateKey(day)}`,
        when,
        title: LOG_TITLES[day.getDate() % LOG_TITLES.length],
        body: LOG_LINES[(day.getDate() + 1) % LOG_LINES.length],
        data: { log: true },
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
      title: `Remember your ${WEEKDAYS[yesterday.getDay()]}?`,
      body: `${moments(momentCount(store, yesterday, yesterday))} from yesterday. Take a minute to live it again.`,
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
  if (typeof data.ask === 'string') return { pathname: '/chat', params: { ask: data.ask } };
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
