import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textAvailable, textProviders } from './aiProviders';
import { cancelTaskReminder, scheduleTaskReminder } from './taskNotifications';

// Local-first task store. Tasks come from two doors: the user creates one
// deliberately (+ button on the Tasks page), or the app notices a commitment
// inside a logged memory ("I have to get some fruits tomorrow") and creates
// it automatically. Both kinds live in the same list; auto-created ones keep
// the original sentence as a citation back to what was said.

export type StoredTask = {
  id: string;
  title: string;
  notes?: string; // the user's own description / details for the task
  dueDate?: string; // local YYYY-MM-DD
  dueTime?: string; // 24h HH:MM — only when the user gave a time or a period
  done: boolean;
  createdAt: string; // ISO
  source: 'manual' | 'memory';
  sourceText?: string; // the sentence the task was extracted from
  sourceDate?: string; // YYYY-MM-DD of the memory day it was extracted from
  seen?: boolean; // false = auto-created and not yet viewed on the Tasks page
  notificationId?: string; // scheduled due-reminder, so it can be cancelled
  // The user never said when — the Tasks page asks them to confirm a due
  // date (or explicitly choose to keep it dateless).
  needsDueDate?: boolean;
};

const STORAGE_KEY = 'storedTasks';

// The user speaks in day-parts, not clock times. Each period maps to a
// reasonable middle of its window: morning 6–12 → 9:00, afternoon 12–5 →
// 3:00 pm, evening/night 5–11 → 8:00 pm.
const PERIOD_TIMES: Record<string, string> = {
  morning: '09:00',
  afternoon: '15:00',
  evening: '20:00',
  night: '20:00',
};

export async function getTasks(): Promise<StoredTask[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredTask[]) : [];
}

async function writeTasks(tasks: StoredTask[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export async function addTask(
  task: Omit<StoredTask, 'id' | 'createdAt' | 'done' | 'notificationId'>,
): Promise<StoredTask> {
  const existing = await getTasks();

  // Re-analyzing the same memory must never duplicate its tasks: an
  // auto-extracted task with the same wording from the same day is a dupe.
  if (task.source === 'memory') {
    const dupe = existing.find(
      (t) =>
        t.source === 'memory' &&
        t.sourceDate === task.sourceDate &&
        t.title.trim().toLowerCase() === task.title.trim().toLowerCase(),
    );
    if (dupe) return dupe;
  }

  const entry: StoredTask = {
    ...task,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    done: false,
  };
  entry.notificationId =
    (await scheduleTaskReminder(entry.title, entry.dueDate, entry.dueTime)) ?? undefined;
  await writeTasks([entry, ...existing]);
  return entry;
}

// Edits title / notes / due date / due time and keeps the reminder in sync.
export async function updateTask(
  id: string,
  patch: Pick<StoredTask, 'title'> & { notes?: string; dueDate?: string; dueTime?: string },
): Promise<void> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (!target) return;

  await cancelTaskReminder(target.notificationId);
  const updated: StoredTask = {
    ...target,
    title: patch.title,
    notes: patch.notes,
    dueDate: patch.dueDate,
    dueTime: patch.dueTime,
    notificationId: undefined,
    // Editing IS the confirmation — whatever the user saved is the answer.
    needsDueDate: false,
  };
  if (!updated.done) {
    updated.notificationId =
      (await scheduleTaskReminder(updated.title, updated.dueDate, updated.dueTime)) ?? undefined;
  }
  await writeTasks(existing.map((t) => (t.id === id ? updated : t)));
}

export async function toggleTask(id: string): Promise<void> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (!target) return;

  const updated: StoredTask = { ...target, done: !target.done };
  if (updated.done) {
    // No point reminding about something already finished.
    await cancelTaskReminder(updated.notificationId);
    updated.notificationId = undefined;
  } else {
    updated.notificationId =
      (await scheduleTaskReminder(updated.title, updated.dueDate, updated.dueTime)) ?? undefined;
  }
  await writeTasks(existing.map((t) => (t.id === id ? updated : t)));
}

export async function deleteTask(id: string): Promise<void> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (target) await cancelTaskReminder(target.notificationId);
  await writeTasks(existing.filter((t) => t.id !== id));
}

// The user chose to keep a task without a due date — stop asking.
export async function confirmNoDueDate(id: string): Promise<void> {
  const existing = await getTasks();
  await writeTasks(existing.map((t) => (t.id === id ? { ...t, needsDueDate: false } : t)));
}

// Called after the Tasks page has shown its list: clears the "new" state on
// auto-created tasks so the badge only appears until they've been seen once.
export async function markTasksSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const existing = await getTasks();
  await writeTasks(existing.map((t) => (ids.includes(t.id) ? { ...t, seen: true } : t)));
}

export async function getTask(id: string): Promise<StoredTask | null> {
  const existing = await getTasks();
  return existing.find((t) => t.id === id) ?? null;
}

export function formatDueTime(dueTime: string): string {
  const [hStr, m] = dueTime.split(':');
  let h = Number(hStr);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// ---------------------------------------------------------------------------
// AI extraction — turns free-form journal text into structured tasks.

export function taskExtractionAvailable(): boolean {
  return textAvailable();
}

type ExtractedTask = {
  title?: string;
  date?: string | null;
  period?: string | null;
  time?: string | null;
};

const EXTRACT_PROMPT = `You read one journal entry from a memory-logging app and extract any REAL to-dos the user still needs to act on.

Extract a task only when the entry states a future intention, commitment, or request: "I have to…", "I need to…", "I should…", "don't forget to…", "X asked me to…". Things that already happened are memories, not tasks — never extract those. If there is nothing to do, return an empty list.

Rules for each task:
- "title": keep the user's own wording, trimmed to a short imperative phrase (entry "I have to get some fruits tomorrow" → title "Get some fruits"). Keep the user's language — Arabic stays Arabic.
- "date": resolve relative words against TODAY (given below) into "YYYY-MM-DD" — "tomorrow", "tonight", weekday names (next occurrence). null when no day is mentioned.
- "period": "morning", "afternoon", "evening", or "night" when the user used a day-part word; otherwise null.
- "time": "HH:MM" 24-hour only when the user said an actual clock time; otherwise null.

Respond with ONLY a JSON object: {"tasks": [{"title": "...", "date": "YYYY-MM-DD" | null, "period": "..." | null, "time": "HH:MM" | null}]}`;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ParsedTask = { title: string; dueDate?: string; dueTime?: string };

// Parses journal/dictated text into zero or more structured tasks.
// Returns null when the AI call itself failed (no key, network, bad JSON) so
// callers can tell "no tasks in this text" apart from "couldn't check".
export async function extractTasks(text: string): Promise<ParsedTask[] | null> {
  if (!textAvailable() || !text.trim()) return null;

  const now = new Date();
  const result = await chatCompletion(textProviders(), (model) => ({
        model,
        messages: [
          {
            role: 'system',
            content: `${EXTRACT_PROMPT}\n\nTODAY is ${WEEKDAYS_LONG[now.getDay()]}, ${localDate(now)}.`,
          },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
  }));
  if (!result.ok) return null;

  try {
    const parsed = JSON.parse(result.content) as { tasks?: ExtractedTask[] };
    if (!Array.isArray(parsed.tasks)) return null;

    return parsed.tasks
      .filter((t): t is ExtractedTask & { title: string } => !!t.title?.trim())
      .map((t) => {
        const dueDate = t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : undefined;
        let dueTime: string | undefined;
        if (t.time && /^\d{2}:\d{2}$/.test(t.time)) {
          dueTime = t.time;
        } else if (t.period && PERIOD_TIMES[t.period.toLowerCase()]) {
          dueTime = PERIOD_TIMES[t.period.toLowerCase()];
        }
        return { title: t.title.trim(), dueDate, dueTime };
      });
  } catch {
    return null;
  }
}

