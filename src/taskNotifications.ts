import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { PERIOD_LABEL, PERIOD_START, type DayPeriod, type ReminderChoice } from './taskTime';

// Local reminder notifications for tasks with a due date. Everything here is
// best-effort: no permission, web platform, or a past due date simply means
// no reminder — never an error that blocks saving the task itself.

let configured = false;

async function ensureConfigured(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (configured) return true;

  // Show reminders as banners even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tasks', {
      name: 'Task reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  configured = true;
  return true;
}

// ── What to remind, and when ──────────────────────────────────────────────
//
// A reminder AT a task's time is a reminder that you're already late — the
// dentist at 2:00 rang at 2:00. So, by default:
//   • a task at a time        → an hour before
//   • from a saved ticket or letter (remindEarly) → the evening before and
//     two hours before, as appointments need
//   • a date and a part of the day → when that part starts ("afternoon" → 1 pm)
//   • a date only             → 9 am that day
//   • no date                 → nothing (the Tasks page asks for one)
// The user can change it per task; `reminder` holds their choice.

export type ReminderTask = {
  title: string;
  dueDate?: string;
  dueTime?: string;
  duePeriod?: DayPeriod;
  reminder?: ReminderChoice;
  remindEarly?: boolean;
  done?: boolean;
};

export type PlannedReminder = { when: Date; title: string; body: string };

const MORNING = '09:00';

/** The reminder the task gets when the user hasn't chosen one. */
export function defaultReminder(t: ReminderTask): ReminderChoice | 'early' {
  if (t.remindEarly) return 'early';
  return t.dueTime ? '1h' : 'morning';
}

export function planTaskReminders(
  t: ReminderTask,
  now = new Date(),
  /** Off when asking whether a choice itself is still ahead. */
  rescueLate = true,
): PlannedReminder[] {
  if (!t.dueDate || t.done || t.reminder === 'none') return [];
  const [y, m, d] = t.dueDate.split('-').map(Number);
  const at = (hhmm: string, daysBefore = 0) => {
    const [h, min] = hhmm.split(':').map(Number);
    return new Date(y, m - 1, d - daysBefore, h, min, 0);
  };
  const choice = t.reminder ?? defaultReminder(t);
  const label = t.dueTime ? clock(t.dueTime) : t.duePeriod ? PERIOD_LABEL[t.duePeriod].toLowerCase() : '';
  const eveningBefore: PlannedReminder = {
    when: at('20:00', 1),
    title: 'Recall — tomorrow',
    body: label ? `${t.title} · ${label}` : t.title,
  };
  const daysAhead = (days: number, words: string): PlannedReminder => ({
    when: at(MORNING, days),
    title: `Recall — in ${words}`,
    body: label ? `${t.title} · ${label}` : t.title,
  });
  const plans: PlannedReminder[] = [];

  if (t.dueTime) {
    const start = at(t.dueTime);
    const before = (minutes: number, words: string): PlannedReminder => ({
      when: new Date(start.getTime() - minutes * 60_000),
      title: `Recall — in ${words}`,
      body: `${t.title} · ${clock(t.dueTime!)}`,
    });
    const onTime: PlannedReminder = { when: start, title: 'Recall — now', body: t.title };
    const minutes = BEFORE_MINUTES[choice as keyof typeof BEFORE_MINUTES];
    if (choice === 'at') plans.push(onTime);
    else if (minutes) plans.push(before(minutes, BEFORE_WORDS[choice as keyof typeof BEFORE_WORDS]));
    else if (choice === 'dayBefore') plans.push(eveningBefore);
    else if (choice === 'early') plans.push(eveningBefore, before(120, '2 hours'));
    else plans.push(before(60, '1 hour'));
    const ahead = plans.filter((p) => p.when > now);
    // Added too late for its reminder (at 1:30, "meeting at 2") — still
    // warn: 15 minutes before if there's time, else at the time itself.
    if (rescueLate && ahead.length === 0 && start > now && choice !== 'at') {
      const soon = before(15, '15 minutes');
      return [soon.when > now ? soon : onTime];
    }
    return ahead;
  }

  const dayStart = t.duePeriod ? PERIOD_START[t.duePeriod] : MORNING;
  const onTheDay: PlannedReminder = {
    when: at(dayStart),
    title: t.duePeriod ? `Recall — this ${t.duePeriod === 'night' ? 'evening' : t.duePeriod}` : 'Recall — today',
    body: t.title,
  };
  if (choice === 'dayBefore') plans.push(eveningBefore);
  else if (choice === 'early') plans.push(eveningBefore, onTheDay);
  else if (choice === '2d') plans.push(daysAhead(2, '2 days'));
  else if (choice === '1w') plans.push(daysAhead(7, 'a week'));
  else plans.push(onTheDay);
  return plans.filter((p) => p.when > now);
}

const BEFORE_MINUTES = { '15m': 15, '30m': 30, '1h': 60, '2h': 120, '3h': 180, '1d': 1440 } as const;
const BEFORE_WORDS = {
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '2h': '2 hours',
  '3h': '3 hours',
  '1d': '1 day',
} as const;

/** The reminder in words, for the task page: "1 hour before". */
export function reminderLabel(t: ReminderTask): string {
  const choice = t.reminder ?? defaultReminder(t);
  const options = reminderOptions(t);
  return options.find((o) => o.key === choice)?.label ?? (choice === 'early' ? 'Night before + 2 hours before' : 'Off');
}

/** The choices that make sense for this task, in order on the wheel.
 *  "15 minutes before" means nothing without a time; a reminder that
 *  would already be in the past isn't offered (a task in 40 minutes has no
 *  "3 hours before"); "the night before, 8 PM" only when it says more than
 *  "1 day before" does — for a task earlier than 6 pm. */
export function reminderOptions(
  t: ReminderTask,
  now = new Date(),
): { key: ReminderChoice | 'early'; label: string }[] {
  const ahead = (key: ReminderChoice | 'early') =>
    key === 'none' ||
    planTaskReminders({ ...t, reminder: key === 'early' ? undefined : key, remindEarly: key === 'early' }, now, false).length > 0;
  if (t.dueTime) {
    const night = Number(t.dueTime.slice(0, 2)) < 18;
    const all: { key: ReminderChoice | 'early'; label: string }[] = [
      ...(t.remindEarly ? [{ key: 'early' as const, label: 'Night before + 2 hours before' }] : []),
      { key: 'at', label: 'At the time' },
      { key: '15m', label: '15 minutes before' },
      { key: '30m', label: '30 minutes before' },
      { key: '1h', label: '1 hour before' },
      { key: '2h', label: '2 hours before' },
      { key: '3h', label: '3 hours before' },
      { key: '1d', label: '1 day before' },
      ...(night ? [{ key: 'dayBefore' as const, label: 'The night before, 8 PM' }] : []),
      { key: 'none', label: 'Off' },
    ];
    return all.filter((o) => ahead(o.key));
  }
  const start = t.duePeriod ? PERIOD_START[t.duePeriod] : MORNING;
  const all: { key: ReminderChoice | 'early'; label: string }[] = [
    ...(t.remindEarly ? [{ key: 'early' as const, label: 'Night before + on the day' }] : []),
    { key: 'morning', label: `On the day, ${clock(start)}` },
    { key: 'dayBefore', label: 'The night before, 8 PM' },
    { key: '2d', label: '2 days before' },
    { key: '1w', label: '1 week before' },
    { key: 'none', label: 'Off' },
  ];
  return all.filter((o) => ahead(o.key));
}

/** Sets every reminder the task should have. Returns their ids. */
export async function scheduleTaskReminders(t: ReminderTask): Promise<string[]> {
  const plans = planTaskReminders(t);
  if (plans.length === 0) return [];
  const ids: string[] = [];
  try {
    if (!(await ensureConfigured())) return [];
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      console.log('[tasks] notifications not allowed — no reminders set');
      return [];
    }
    for (const p of plans) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: p.title,
            body: p.body,
            sound: true,
            ...(Platform.OS === 'android' ? { channelId: 'tasks' } : {}),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when },
        }),
      );
    }
    console.log(`[tasks] reminders for "${t.title}": ${plans.map((p) => p.when.toLocaleString()).join(', ')}`);
  } catch (e) {
    console.warn('[tasks] could not set reminders:', e);
  }
  return ids;
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export async function cancelTaskReminder(notificationId?: string): Promise<void> {
  if (!notificationId || Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Already fired or already cancelled — nothing to do.
  }
}
