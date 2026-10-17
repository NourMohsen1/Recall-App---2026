// Kept free of imports: memoryLog.ts uses this when it saves.
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The day a log belongs to is the day the user is living, not the one the
// clock says. Nour, Oct 2026: "I don't sleep at 11:59 — my day runs to one
// or two." A note written at 1:30 am is about the evening that's still
// going, so until LATE_NIGHT_ENDS it belongs to the day before — without
// asking, because nine times in ten that is the answer. A log that names
// its own day ("yesterday morning…", "on Wednesday…") still goes there:
// the intake reads it against this same day (memoryIntake.ts).

/** Before this hour, it's still the night of the day before. */
export const LATE_NIGHT_ENDS = 4;

export function isLateNight(now = new Date()): boolean {
  return now.getHours() < LATE_NIGHT_ENDS;
}

/** The day the user is living: yesterday's date until 4 am. */
export function logicalToday(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (isLateNight(now)) d.setDate(d.getDate() - 1);
  return d;
}

/** The day key a log written now belongs to. */
export function logDayKey(now = new Date()): string {
  return dateKey(logicalToday(now));
}

/** When a log written now sits on its day. At night, the last minute of
 *  the day before — later notes later still, so they keep their order
 *  (minutes after midnight become quarter-seconds past 11:59 pm). */
export function logTakenAt(now = new Date()): Date {
  if (!isLateNight(now)) return now;
  const d = logicalToday(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  // +1 ms so that midnight itself still reads as after midnight (realClock).
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, minutes * 240 + 1);
}

/** A clock time on a day, the way the app keeps it: before LATE_NIGHT_ENDS
 *  it is that night's after-midnight (kept at 11:59 pm, the real minutes in
 *  the seconds, as logTakenAt does), so it stays at the end of the day. */
export function onDayAt(day: Date, hours: number, minutes: number): Date {
  if (hours < LATE_NIGHT_ENDS) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 0, (hours * 60 + minutes) * 240 + 1);
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
}

/** The time to show for a memory: the real one for an after-midnight log
 *  kept at 11:59 pm (12:40 am, not 11:59 pm). */
export function realClock(takenAt: Date): Date {
  const extra = takenAt.getSeconds() * 1000 + takenAt.getMilliseconds();
  if (takenAt.getHours() !== 23 || takenAt.getMinutes() !== 59 || extra === 0) return takenAt;
  const minutes = Math.round(extra / 240);
  return new Date(takenAt.getFullYear(), takenAt.getMonth(), takenAt.getDate() + 1, Math.floor(minutes / 60), minutes % 60);
}
