import { Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Live voice diagnostics (Oct 2026): a timeline of one call, to find out on
// a real iPhone why interruptions felt late and abrupt and why Recall
// sometimes answered during a thinking pause. Measurement only: nothing
// here changes what a call does.
//
// Every line: milliseconds since the call started (monotonic clock), a
// kind, the event, then details.
//   OBS  something the app received (OpenAI event, WebRTC event or stat)
//   APP  something the app's own logic decided or set (inferred, not observed)
//   CMD  a command the app sent to OpenAI
// "volume set 0.3" means the app ASKED WebRTC for that volume; whether the
// sound changed is a separate question, answered (only partly) by the
// "level" lines, which are WebRTC's measure of the received audio.
//
// Content: transcripts only as needed to judge a turn: the words said over
// Recall (that is what decides an interruption), clipped; other turns as a
// word count. No keys, no tool results, no instructions.
//
// Export: long-press "Talk to Recall" on the live screen (app/live.tsx).

const MAX_LINES = 6000;
const lines: string[] = [];

const now = (): number => {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
};

let t0 = now();
let callNo = 0;

function push(line: string): void {
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  console.log(`[diag] ${line}`);
}

function fmt(data?: Record<string, unknown>): string {
  if (!data) return '';
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}

/** Milliseconds since this call started. */
export function diagNow(): number {
  return Math.round(now() - t0);
}

export function diagCallStart(details: Record<string, unknown>): void {
  t0 = now();
  callNo += 1;
  push(`---- call ${callNo} at ${new Date().toISOString()} ${fmt(details)}`);
}

export function diag(kind: 'OBS' | 'APP' | 'CMD', event: string, data?: Record<string, unknown>): void {
  push(`${String(diagNow()).padStart(7)} ${kind} ${event} ${fmt(data)}`.trimEnd());
}

/** A transcript, as much as the log needs: the words when they decide an
 *  interruption (short), a word count otherwise. */
export function diagText(text: string, keepWords: boolean): string {
  const t = text.trim();
  if (keepWords) return t.slice(0, 40);
  return `${t ? t.split(/\s+/).length : 0} words`;
}

/** Opens the share sheet with the log as a text file. */
export async function shareDiagLog(): Promise<void> {
  const body = [
    'Recall live voice diagnostic log',
    `exported ${new Date().toISOString()}`,
    'columns: ms since call start | OBS observed / APP app logic / CMD sent | event | details',
    '',
    ...lines,
  ].join('\n');
  try {
    const path = `${FileSystem.cacheDirectory}recall-voice-log.txt`;
    await FileSystem.writeAsStringAsync(path, body);
    await Share.share({ url: path, title: 'Recall voice log' });
  } catch (e) {
    console.warn('[diag] could not share the log as a file, sharing as text:', e);
    await Share.share({ message: body });
  }
}
