import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Reference, Source } from './askAI';

// Saved Ask conversations.
//
// Everything the user asked lived in component state, so leaving the screen
// erased it — you couldn't step out to check a day and come back to the
// answer. Nothing is thrown away now: every exchange is written down and
// reachable from the sidebar.
//
// There is deliberately NO session timeout. ChatGPT doesn't have one either
// — a conversation stays open until you start a new one, and the sidebar
// groups the old ones by date. A timer that quietly ended a thread while the
// user was mid-thought would be a worse version of the bug being fixed. The
// only time-based behaviour is on the way IN: see RESUME_WINDOW_MS.

const INDEX_KEY = 'chatSessions';
const MESSAGE_PREFIX = 'chatSession:';

// How stale the last conversation can be and still be picked up where it was
// left. Step out for lunch and come back, you're still in the same thread;
// come back tomorrow and it's a new one, with yesterday's a tap away in the
// sidebar. Six hours is long enough to cover an evening's interruptions and
// short enough that a new day starts fresh.
export const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

export type ChatMessage = {
  role: 'user' | 'ai';
  text: string;
  reference?: Reference | null;
  sources?: Source[];
  error?: boolean;
  spoken?: boolean;
  suggestions?: string[];
};

// The lightweight row shown in the sidebar. Kept apart from the messages so
// listing every conversation doesn't mean loading every message in all of
// them.
export type ChatSessionMeta = {
  id: string;
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  messageCount: number;
};

async function readIndex(): Promise<ChatSessionMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as ChatSessionMeta[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: ChatSessionMeta[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

// Newest first — the order the sidebar shows them in.
export async function listSessions(): Promise<ChatSessionMeta[]> {
  const list = await readIndex();
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMessages(id: string): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(MESSAGE_PREFIX + id);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

// A conversation's name, taken from the first thing the user asked. ChatGPT
// spends a model call writing a title; the opening question is nearly always
// just as recognisable and costs nothing.
function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.text.trim();
  if (!first) return 'New chat';
  const oneLine = first.replace(/\s+/g, ' ');
  return oneLine.length > 44 ? `${oneLine.slice(0, 44).trimEnd()}…` : oneLine;
}

export function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Writes the whole conversation. Called after each exchange — an empty one
// is never stored, so opening Ask and leaving doesn't litter the sidebar
// with blank threads.
export async function saveSession(id: string, messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;

  await AsyncStorage.setItem(MESSAGE_PREFIX + id, JSON.stringify(messages));

  const list = await readIndex();
  const now = new Date().toISOString();
  const existing = list.find((s) => s.id === id);
  const meta: ChatSessionMeta = {
    id,
    // The title follows the first question, so a thread that starts with a
    // tap-to-answer reply still gets named once a real question is asked.
    title: titleFrom(messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messageCount: messages.length,
  };
  await writeIndex([meta, ...list.filter((s) => s.id !== id)]);
}

export async function deleteSession(id: string): Promise<void> {
  await AsyncStorage.removeItem(MESSAGE_PREFIX + id);
  await writeIndex((await readIndex()).filter((s) => s.id !== id));
}

// The conversation to open when Ask is launched: the most recent one if it's
// still warm, otherwise nothing (the caller starts a fresh thread).
export async function resumableSession(): Promise<ChatSessionMeta | null> {
  const [latest] = await listSessions();
  if (!latest) return null;
  const age = Date.now() - new Date(latest.updatedAt).getTime();
  return age <= RESUME_WINDOW_MS ? latest : null;
}

// Sidebar grouping, the same buckets every chat app uses — people look for a
// conversation by roughly when they had it, not by its name.
export type SessionGroup = { label: string; sessions: ChatSessionMeta[] };

export function groupSessions(sessions: ChatSessionMeta[]): SessionGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  const buckets: { label: string; min: number; items: ChatSessionMeta[] }[] = [
    { label: 'Today', min: startOfToday.getTime(), items: [] },
    { label: 'Yesterday', min: startOfToday.getTime() - dayMs, items: [] },
    { label: 'Previous 7 days', min: startOfToday.getTime() - 7 * dayMs, items: [] },
    { label: 'Previous 30 days', min: startOfToday.getTime() - 30 * dayMs, items: [] },
    { label: 'Older', min: -Infinity, items: [] },
  ];

  for (const s of sessions) {
    const at = new Date(s.updatedAt).getTime();
    (buckets.find((b) => at >= b.min) ?? buckets[buckets.length - 1]).items.push(s);
  }

  return buckets
    .filter((b) => b.items.length > 0)
    .map((b) => ({ label: b.label, sessions: b.items }));
}
