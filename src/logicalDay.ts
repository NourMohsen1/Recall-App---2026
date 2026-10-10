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
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, minutes * 240);
}
