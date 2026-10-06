// How a task's "when" is said and sorted — its time, or the part of the
// day the user named. Shared by the task store and its reminders.

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

type When = { dueTime?: string; duePeriod?: DayPeriod };

export function isDayPeriod(v: unknown): v is DayPeriod {
  return v === 'morning' || v === 'afternoon' || v === 'evening' || v === 'night';
}

export const PERIOD_LABEL: Record<DayPeriod, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Tonight',
};

/** Where each part of the day starts — the reminder comes then, and lists
 *  sort by it. A reminder in the middle of "the afternoon" is already late. */
export const PERIOD_START: Record<DayPeriod, string> = {
  morning: '09:00',
  afternoon: '13:00',
  evening: '18:00',
  night: '20:00',
};

/** at = at the time; 15m / 1h before it; dayBefore = 8 pm the evening
 *  before; morning = 9 am on the day (for tasks without a time). */
export type ReminderChoice = 'at' | '15m' | '1h' | 'dayBefore' | 'morning' | 'none';

/** The time a task is "at", for sorting: its time, or where its part of
 *  the day starts. */
export function taskClock(t: When): string | undefined {
  return t.dueTime ?? (t.duePeriod ? PERIOD_START[t.duePeriod] : undefined);
}

/** "2:30 PM", or "Afternoon" — what the user said, never more exact. */
export function taskTimeLabel(t: When): string | undefined {
  if (t.dueTime) return formatDueTime(t.dueTime);
  return t.duePeriod ? PERIOD_LABEL[t.duePeriod] : undefined;
}

export function formatDueTime(dueTime: string): string {
  const [hStr, m] = dueTime.split(':');
  let h = Number(hStr);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
