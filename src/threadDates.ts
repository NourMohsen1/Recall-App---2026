// ── Dates in the thread ──────────────────────────────────────────────────
// Like Messages: a small centred line above the first message — when the
// chat started — and again where it picks up on a later day or after an
// hour's pause. "Today · 2:14 PM", "Yesterday · 9:03 PM", "Mon, 6 Oct ·
// 11:20 AM", with the year once it isn't this one.

const DATE_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const PAUSE_MS = 60 * 60 * 1000;

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function threadDateLabel(d: Date, now = new Date()): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const h = d.getHours() % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  const day = sameDay(d, now)
    ? 'Today'
    : sameDay(d, yesterday)
      ? 'Yesterday'
      : `${DATE_DAYS[d.getDay()]}, ${d.getDate()} ${DATE_MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
  return `${day} · ${time}`;
}

/** Each message's time. Chats saved before messages carried one fall back
 *  to when the chat began — its id starts with that moment — so even old
 *  threads say when they were started. */
export function messageTimes(messages: { at?: string }[], sessionId: string | null): (Date | null)[] {
  const started = sessionId ? Number(sessionId.split('-')[0]) : NaN;
  let last: Date | null = Number.isFinite(started) && started > 0 ? new Date(started) : null;
  return messages.map((m) => {
    if (m.at) last = new Date(m.at);
    return last;
  });
}
