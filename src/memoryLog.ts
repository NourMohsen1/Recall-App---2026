import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Local-first store for memories the user logs from the "+" button.
// Every memory carries two timestamps: `createdAt` (when it was logged) and
// `takenAt` (when the moment actually happened — for photos this comes from
// EXIF metadata, so an old photo lands on the day it was taken, not today).

export type TranscriptWord = { word: string; start: number; end: number };

/** A screenshot or file the user saved as a memory. Read on the phone —
 *  see modules/text-reader. The file never leaves the device. */
export type Attachment = {
  uri: string;
  kind: 'image' | 'pdf';
  name?: string;
  /** PDFs: page one as an image, so it can be shown without a PDF viewer. */
  previewUri?: string;
  /** The words the phone read from it. */
  text?: string;
};

export type LoggedMemory = {
  id: string;
  createdAt: string; // ISO — when the user logged it
  takenAt: string; // ISO — when the moment happened; drives Timeline placement
  kind: 'text' | 'photo' | 'voice' | 'document';
  text?: string;
  // When AI intake polished the entry, `text` holds the cleaned memory and
  // `rawText` keeps the verbatim words — the source screen shows the
  // original, so nothing the user said is ever lost.
  rawText?: string;
  // True once the intake pass has analyzed this memory (polish + routing).
  // Unrefined memories get swept up retroactively when the app opens.
  refined?: boolean;
  photoUris?: string[];
  /** Photo memories only: the user added these photos by hand (Add Photos),
   *  as opposed to Recall importing them from the library. */
  manual?: boolean;
  // Document memories only: what was attached, and what was read from it.
  attachments?: Attachment[];
  audioUri?: string;
  durationMillis?: number;
  // Voice memories only: per-word timing for the transcript (from Whisper),
  // used to highlight along with playback. A manually-typed addendum the
  // user can attach to correct or extend what was transcribed.
  words?: TranscriptWord[];
  note?: string;
  // Voice memories only: how many times speech-to-text has been tried and
  // come back broken. Only genuine failures count — a missing key, an empty
  // balance or a rate limit are temporary and must NOT burn an attempt, or
  // a recording made during a quiet outage would be written off forever.
  // That is exactly what happened to the 3 Sep recording.
  transcribeAttempts?: number;
  /** Which polish rules this memory was last polished under — see
   *  repolishUnderNewRules in memoryIntake.ts. */
  polishVersion?: number;
  /** The user put this memory in its place by dragging it — the app never
   *  re-times it after that. */
  placedByUser?: boolean;
  /** One log that told about several moments of the day was split into
   *  them (memoryIntake.ts): the original stays as the source — its words,
   *  its recording — and is not shown on the day itself. */
  split?: boolean;
  /** A moment split out of a longer log: the original's id. */
  partOf?: string;
};

const STORAGE_KEY = 'loggedMemories';

/** Something the user logged themselves — typed, spoken, attached, or
 *  photos they picked — rather than photos Recall brought in on its own.
 *  Older hand-picked photo logs predate `manual`; their caption gives
 *  them away. This is what the Home week's green dots count. */
export function isManualLog(m: LoggedMemory): boolean {
  return m.kind !== 'photo' || m.manual === true || !!m.text?.trim();
}

/** A day's memories in the order the user dragged them into, kept by
 *  their times: the moved one takes a time between its new neighbours, and
 *  anything that would then be out of order is nudged a minute later.
 *  Never past the end of the day, and never into the future. */
export async function reorderDay(orderedIds: string[], movedId: string): Promise<void> {
  const all = await getLoggedMemories();
  const byId = new Map(all.map((m) => [m.id, m]));
  const list = orderedIds.map((id) => byId.get(id)).filter((m): m is LoggedMemory => !!m);
  if (list.length < 2) return;
  const t = list.map((m) => new Date(m.takenAt).getTime());
  const i = list.findIndex((m) => m.id === movedId);
  const day = new Date(list[0].takenAt);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = Math.min(dayStart + 86400000 - 60000, Date.now());
  const prev = i > 0 ? t[i - 1] : undefined;
  const next = i < t.length - 1 ? t[i + 1] : undefined;
  const fits = (i >= 0) && (prev === undefined || t[i] > prev) && (next === undefined || t[i] < next);
  if (i >= 0 && !fits) {
    if (prev !== undefined && next !== undefined) t[i] = prev + (next - prev) / 2;
    else if (next !== undefined) t[i] = Math.max(dayStart, next - 30 * 60000);
    else if (prev !== undefined) t[i] = Math.min(dayEnd, prev + 30 * 60000);
  }
  for (let k = 1; k < t.length; k++) if (t[k] <= t[k - 1]) t[k] = t[k - 1] + 60000;
  // Pushed past the end: walk back from the end instead.
  for (let k = t.length - 1; k >= 0; k--) {
    const limit = k === t.length - 1 ? dayEnd : t[k + 1] - 60000;
    if (t[k] > limit) t[k] = limit;
  }
  // Only what actually had to change: the moved one, and any it pushed.
  // The rest keep their exact times.
  const changes = new Map<string, string>();
  list.forEach((m, k) => {
    const before = new Date(m.takenAt).getTime();
    if (m.id !== movedId && t[k] === before) return;
    changes.set(m.id, new Date(Math.round(t[k] / 60000) * 60000).toISOString());
  });
  const updated = all.map((m) =>
    changes.has(m.id) ? { ...m, takenAt: changes.get(m.id)!, placedByUser: true } : m,
  );
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  console.log(`[day] reordered ${list.length} memories; ${changes.size} re-timed`);
}

// Local-timezone day key, e.g. "2026-07-02". All grouping uses this.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export async function getLoggedMemories(): Promise<LoggedMemory[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed: LoggedMemory[] = JSON.parse(raw);
  // Older entries predate `takenAt` — fall back to when they were logged.
  return parsed.map((m) => ({ ...m, takenAt: m.takenAt ?? m.createdAt }));
}

/** What the day shows: a split log appears as its moments, not twice. */
export function shownMemories(all: LoggedMemory[]): LoggedMemory[] {
  return all.filter((m) => !m.split);
}

/** What the user actually logged, once each: originals, not their moments. */
export function originalMemories(all: LoggedMemory[]): LoggedMemory[] {
  return all.filter((m) => !m.partOf);
}

/** By day, oldest first. `sources`: the original logs (the Source page)
 *  instead of what the day shows. */
export async function getMemoriesByDay(options: { sources?: boolean } = {}): Promise<Map<string, LoggedMemory[]>> {
  const everything = await getLoggedMemories();
  const all = options.sources ? originalMemories(everything) : shownMemories(everything);
  const byDay = new Map<string, LoggedMemory[]>();
  for (const m of all) {
    const key = dateKey(new Date(m.takenAt));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(m);
    else byDay.set(key, [m]);
  }
  // Oldest first within a day so bullets read chronologically.
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  }
  return byDay;
}

export async function saveMemory(
  memory: Omit<LoggedMemory, 'id' | 'createdAt' | 'takenAt'> & { takenAt?: Date },
): Promise<LoggedMemory> {
  const entry: LoggedMemory = {
    ...memory,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    takenAt: (memory.takenAt ?? new Date()).toISOString(),
  };
  const existing = await getLoggedMemories();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...existing]));
  return entry;
}

/** Takes these photos off every memory they are on. A photo memory left
 *  with no photos and no words of its own goes too. Returns the days that
 *  changed. See src/photoGuard.ts. */
export async function removePhotosFromMemories(uris: Set<string>): Promise<string[]> {
  const existing = await getLoggedMemories();
  const days = new Set<string>();
  const next: LoggedMemory[] = [];
  for (const m of existing) {
    if (!m.photoUris?.some((u) => uris.has(u))) {
      next.push(m);
      continue;
    }
    days.add(dateKey(new Date(m.takenAt)));
    const left = m.photoUris.filter((u) => !uris.has(u));
    if (left.length === 0 && m.kind === 'photo' && !m.text?.trim()) continue;
    next.push({ ...m, photoUris: left });
  }
  if (days.size > 0) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return [...days];
}

export async function updateMemory(id: string, patch: Partial<LoggedMemory>): Promise<void> {
  const existing = await getLoggedMemories();
  const next = existing.map((m) => (m.id === id ? { ...m, ...patch } : m));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deleteMemory(id: string): Promise<void> {
  const existing = await getLoggedMemories();
  const gone = existing.find((m) => m.id === id);
  let kept = existing.filter((m) => m.id !== id && m.partOf !== id);
  // The last moment of a split log deleted: the original goes with it.
  if (gone?.partOf && !kept.some((m) => m.partOf === gone.partOf)) kept = kept.filter((m) => m.id !== gone.partOf);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
}

/** A log split into its moments: the original kept as the source, each
 *  moment saved as its own memory at its own time. */
export async function splitMemory(
  parentId: string,
  moments: { text: string; takenAt: string }[],
): Promise<void> {
  const all = await getLoggedMemories();
  const parent = all.find((m) => m.id === parentId);
  if (!parent || moments.length < 2) return;
  const children: LoggedMemory[] = moments.map((mo, i) => ({
    id: `${parentId}-m${i + 1}`,
    createdAt: parent.createdAt,
    takenAt: mo.takenAt,
    kind: parent.kind,
    text: mo.text,
    refined: true,
    polishVersion: parent.polishVersion,
    partOf: parentId,
  }));
  const rest = all.filter((m) => m.partOf !== parentId).map((m) => (m.id === parentId ? { ...m, split: true } : m));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...children, ...rest]));
  console.log(`[intake] split ${parentId} into ${children.length} moments`);
}

/** Undoes a split: the moments go and the note shows whole again — for a
 *  note re-polished into a single moment, whose old moments would
 *  otherwise keep showing the old wording. */
export async function unsplitMemory(parentId: string): Promise<void> {
  const all = await getLoggedMemories();
  const next = all
    .filter((m) => m.partOf !== parentId)
    .map((m) => (m.id === parentId ? { ...m, split: undefined } : m));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  console.log(`[intake] ${parentId} is one moment again`);
}

// What the user reads on a card for one logged memory.
//
// How a memory was captured is an input method, not content: a voice note
// reads as a plain note once it's transcribed, exactly like a typed one. So
// there is no such thing as a card that says "voice memory" — either the
// words are ready, or the app is still working on them.
export const PENDING_MEMORY_TEXT = 'Still writing this one up…';

export function memoryDisplayText(m: LoggedMemory): string | null {
  const text = m.text?.trim();
  if (text) return text;
  // Audio exists but no words yet — being transcribed, or waiting on a
  // retry. Deliberately says nothing about voice, transcription or failure:
  // the machinery is not the user's problem, and the line is replaced by
  // the real memory the moment it lands.
  if (m.kind === 'voice' && m.audioUri) return PENDING_MEMORY_TEXT;
  if (m.kind === 'document') return PENDING_MEMORY_TEXT;
  return null;
}

export function formatClockTime(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// Copies a picked/recorded file out of the volatile cache directory into the
// app's document directory so the OS won't clean it up. Returns the permanent
// URI, or the original one if copying isn't possible (e.g. on web, or if the
// copy fails for any reason — better to keep a working link to the cache
// copy than to silently point at a file that was never actually written).
// Repairs a stored file path after the app has been reinstalled.
//
// THE BUG THIS EXISTS FOR, because it is invisible until it has already
// destroyed something. Files saved by persistFile are recorded as absolute
// paths:
//
//   file:///var/mobile/Containers/Data/Application/<UUID>/Documents/voice-1.m4a
//
// iOS gives an app a NEW <UUID> every time it is installed — including
// every ordinary App Store update. The file survives; the path does not. So
// after an update every voice recording, every imported photo, every
// person's picture and the user's own avatar point at an address that no
// longer exists, and the app reports them as missing. The user sees their
// memories quietly disappear on an update they did not ask for.
//
// This re-bases any such path onto the container the app is in NOW. It is
// cheap, synchronous and safe to call on anything: a path already in the
// current container, an iCloud asset reference, a data URI or a web URL all
// come back untouched.
export function localFile(uri: string | undefined | null): string {
  if (!uri) return '';
  const docs = FileSystem.documentDirectory;
  if (Platform.OS === 'web' || !docs) return uri;
  if (uri.startsWith(docs)) return uri;

  // Only file paths that lived in some Documents directory are ours to
  // repair. Anything else is somebody else's address.
  const marker = '/Documents/';
  const at = uri.indexOf(marker);
  if (!uri.startsWith('file://') || at === -1) return uri;

  const name = uri.slice(at + marker.length);
  // A nested path means this was not one of our flat persistFile names;
  // leaving it alone is better than inventing a location for it.
  if (!name || name.includes('/')) return uri;
  return docs + name;
}

export async function persistFile(uri: string, prefix: string): Promise<string> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return uri;
  try {
    const extMatch = uri.match(/\.(\w{2,5})(\?|$)/);
    const ext = extMatch ? extMatch[1] : 'bin';
    const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const dest = FileSystem.documentDirectory + name;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}
