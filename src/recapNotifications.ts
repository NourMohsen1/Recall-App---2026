import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// "Your weekly recap is ready" — the Recap as Recall's notification. Each
// kind repeats on its own schedule, and the user turns each on or off in
// Profile → Notifications. Tapping one opens the Recap on that tab.
//
//   Daily   — every evening at 21:00, for the day that is ending.
//   Weekly  — Sunday at 19:00, when the Monday–Sunday week is complete.
//   Monthly — on the 1st at 10:00, for the month just finished.
//
// Scheduled on the phone (no server). The recap itself is written when it
// is opened, from what is there by then.

export type RecapCadence = 'daily' | 'weekly' | 'monthly';
export type RecapPrefs = Record<RecapCadence, boolean>;

const PREFS_KEY = 'recapNotifications';
const DEFAULTS: RecapPrefs = { daily: true, weekly: true, monthly: false };

/** The Recap tab each notification opens. */
export const RECAP_TAB: Record<RecapCadence, 'Today' | 'Weekly' | 'Monthly'> = {
  daily: 'Today',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const COPY: Record<RecapCadence, string> = {
  daily: 'Your daily recap is ready to review.',
  weekly: 'Your weekly recap is ready to review.',
  monthly: 'Your monthly recap is ready to review.',
};

export async function getRecapPrefs(): Promise<RecapPrefs> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RecapPrefs>) } : DEFAULTS;
}

function trigger(cadence: RecapCadence): Notifications.NotificationTriggerInput {
  if (cadence === 'daily') return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 0 };
  // Weekday 1 is Sunday.
  if (cadence === 'weekly') {
    return { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 19, minute: 0 };
  }
  return { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 10, minute: 0 };
}

const id = (cadence: RecapCadence) => `recap-${cadence}`;

async function place(cadence: RecapCadence, on: boolean): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id(cadence)).catch(() => {});
  if (!on) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id(cadence),
    content: {
      title: 'Recall',
      body: COPY[cadence],
      sound: true,
      data: { recap: RECAP_TAB[cadence] },
    },
    trigger: trigger(cadence),
  });
}

/** Turn one kind on or off. Asks for permission the first time one is
 *  turned on; returns false when it was refused. */
export async function setRecapNotification(cadence: RecapCadence, on: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (on) {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
  }
  const prefs = { ...(await getRecapPrefs()), [cadence]: on };
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  await place(cadence, on);
  console.log(`[recap] ${cadence} notification ${on ? 'on' : 'off'}`);
  return true;
}

/** On every launch: makes what is scheduled match the switches. Cheap and
 *  idempotent — each kind has a fixed id, so nothing doubles up. Never asks
 *  for permission itself; without it, nothing is scheduled. */
export async function syncRecapNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const prefs = await getRecapPrefs();
    for (const cadence of Object.keys(prefs) as RecapCadence[]) await place(cadence, prefs[cadence]);
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .map((n) => n.identifier)
      .filter((i) => i.startsWith('recap-'));
    console.log(`[recap] notifications scheduled: ${scheduled.join(', ') || 'none'}`);
  } catch (e) {
    console.warn('[recap] could not schedule notifications:', e);
  }
}

/** Development only: a weekly-recap notification in five seconds, to test
 *  that tapping one opens the Recap. */
export async function sendTestRecapNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Recall', body: COPY.weekly, data: { recap: RECAP_TAB.weekly } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
}
