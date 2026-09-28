import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

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

// When a task has a date but no time, remind at 09:00 that morning.
const DEFAULT_REMINDER_TIME = '09:00';

export function dueDateTimeOf(dueDate?: string, dueTime?: string): Date | null {
  if (!dueDate) return null;
  const [y, m, d] = dueDate.split('-').map(Number);
  const [h, min] = (dueTime ?? DEFAULT_REMINDER_TIME).split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0);
}

export async function scheduleTaskReminder(
  title: string,
  dueDate?: string,
  dueTime?: string,
): Promise<string | null> {
  try {
    const when = dueDateTimeOf(dueDate, dueTime);
    if (!when || when.getTime() <= Date.now()) return null;
    if (!(await ensureConfigured())) return null;

    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Recall — task due',
        body: title,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'tasks' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
  } catch {
    return null;
  }
}

// Extra, earlier reminders for things that happen AT a time — an
// appointment, a flight. A reminder at 2:30 for a 2:30 appointment is a
// reminder that you are already late. So: the evening before at 20:00, and
// two hours before when there is a time. Only the ones still ahead are set.
export async function scheduleEarlyReminders(
  title: string,
  dueDate?: string,
  dueTime?: string,
): Promise<string[]> {
  const at = dueDateTimeOf(dueDate, dueTime);
  if (!at) return [];
  const eveningBefore = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1, 20, 0, 0);
  const plans: { when: Date; body: string }[] = [
    { when: eveningBefore, body: `Tomorrow: ${title}${dueTime ? ` at ${clock(dueTime)}` : ''}` },
  ];
  if (dueTime) plans.push({ when: new Date(at.getTime() - 2 * 3600 * 1000), body: `In 2 hours: ${title}` });

  const ids: string[] = [];
  try {
    if (!(await ensureConfigured())) return [];
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return [];
    for (const p of plans) {
      if (p.when.getTime() <= Date.now()) continue;
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Recall — coming up',
            body: p.body,
            sound: true,
            ...(Platform.OS === 'android' ? { channelId: 'tasks' } : {}),
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when },
        }),
      );
    }
  } catch (e) {
    console.warn('[tasks] could not set early reminders:', e);
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
