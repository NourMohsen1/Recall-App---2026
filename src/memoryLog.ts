import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// Local-first store for memories the user logs from the "+" button.
// Every memory carries two timestamps: `createdAt` (when it was logged) and
// `takenAt` (when the moment actually happened — for photos this comes from
// EXIF metadata, so an old photo lands on the day it was taken, not today).

export type TranscriptWord = { word: string; start: number; end: number };

export type LoggedMemory = {
  id: string;
  createdAt: string; // ISO — when the user logged it
  takenAt: string; // ISO — when the moment happened; drives Timeline placement
  kind: 'text' | 'photo' | 'voice';
  text?: string;
  // When AI intake polished the entry, `text` holds the cleaned memory and
  // `rawText` keeps the verbatim words — the source screen shows the
  // original, so nothing the user said is ever lost.
  rawText?: string;
  // True once the intake pass has analyzed this memory (polish + routing).
  // Unrefined memories get swept up retroactively when the app opens.
  refined?: boolean;
  photoUris?: string[];
  audioUri?: string;
  durationMillis?: number;
  // Voice memories only: per-word timing for the transcript (from Whisper),
  // used to highlight along with playback. A manually-typed addendum the
  // user can attach to correct or extend what was transcribed.
  words?: TranscriptWord[];
  note?: string;
};

const STORAGE_KEY = 'loggedMemories';

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

export async function getMemoriesByDay(): Promise<Map<string, LoggedMemory[]>> {
  const all = await getLoggedMemories();
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

export async function updateMemory(id: string, patch: Partial<LoggedMemory>): Promise<void> {
  const existing = await getLoggedMemories();
  const next = existing.map((m) => (m.id === id ? { ...m, ...patch } : m));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deleteMemory(id: string): Promise<void> {
  const existing = await getLoggedMemories();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((m) => m.id !== id)));
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
