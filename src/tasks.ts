import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textAvailable, textProviders } from './aiProviders';
import { cancelTaskReminder, scheduleTaskReminders } from './taskNotifications';
import { isDayPeriod, type DayPeriod, type ReminderChoice } from './taskTime';

export {
  PERIOD_LABEL,
  PERIOD_START,
  formatDueTime,
  isDayPeriod,
  taskClock,
  taskTimeLabel,
  type DayPeriod,
  type ReminderChoice,
} from './taskTime';

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
  dueTime?: string; // 24h HH:MM — only when the user gave an actual time
  // "Tomorrow afternoon": the user said a part of the day, not a time. Kept
  // as the word — showing it as "3:00 PM" would present a guess as a fact.
  duePeriod?: DayPeriod;
  // When to be reminded. Unset means the default for the task — see
  // planTaskReminders: an hour before a time, the morning of a date.
  reminder?: ReminderChoice;
  done: boolean;
  doneAt?: string; // ISO — when it was ticked off; files an undated task under that week
  createdAt: string; // ISO
  source: 'manual' | 'memory';
  sourceText?: string; // the sentence the task was extracted from
  sourceDate?: string; // YYYY-MM-DD of the memory day it was extracted from
  seen?: boolean; // false = auto-created and not yet viewed on the Tasks page
  reminderIds?: string[]; // every scheduled reminder, so they can be cancelled
  notificationId?: string; // older tasks: their single due-reminder
  // The user never said when — the Tasks page asks them to confirm a due
  // date (or explicitly choose to keep it dateless).
  needsDueDate?: boolean;
  // Created from a screenshot or file the user saved: the original, so the
  // task can show where it came from, and the memory it belongs to.
  attachment?: { uri: string; kind: 'image' | 'pdf'; name?: string; previewUri?: string };
  memoryId?: string;
  // Something that happens AT a time (an appointment, from a saved ticket
  // or letter): by default reminded the evening before and two hours before.
  remindEarly?: boolean;
  earlyReminderIds?: string[]; // older tasks: their early reminders
};

// Every reminder a task has, set or cleared together.
async function scheduleAll(t: StoredTask): Promise<Pick<StoredTask, 'reminderIds' | 'notificationId' | 'earlyReminderIds'>> {
  const ids = t.done ? [] : await scheduleTaskReminders(t);
  return { reminderIds: ids.length > 0 ? ids : undefined, notificationId: undefined, earlyReminderIds: undefined };
}

async function cancelAll(t: StoredTask): Promise<void> {
  await cancelTaskReminder(t.notificationId);
  for (const id of [...(t.earlyReminderIds ?? []), ...(t.reminderIds ?? [])]) await cancelTaskReminder(id);
}

const STORAGE_KEY = 'storedTasks';

export async function getTasks(): Promise<StoredTask[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredTask[]) : [];
}

async function writeTasks(tasks: StoredTask[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export async function addTask(
  task: Omit<StoredTask, 'id' | 'createdAt' | 'done' | 'reminderIds' | 'notificationId' | 'earlyReminderIds'>,
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
  Object.assign(entry, await scheduleAll(entry));
  await writeTasks([entry, ...existing]);
  return entry;
}

// Edits title / notes / when / reminder and keeps the reminders in sync.
export async function updateTask(
  id: string,
  patch: Pick<StoredTask, 'title'> &
    Partial<Pick<StoredTask, 'notes' | 'dueDate' | 'dueTime' | 'duePeriod' | 'reminder'>>,
): Promise<void> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (!target) return;

  await cancelAll(target);
  const updated: StoredTask = {
    ...target,
    title: patch.title,
    notes: patch.notes,
    dueDate: patch.dueDate,
    dueTime: patch.dueTime,
    duePeriod: patch.dueTime ? undefined : patch.duePeriod,
    reminder: patch.reminder,
    reminderIds: undefined,
    notificationId: undefined,
    earlyReminderIds: undefined,
    // Editing IS the confirmation — whatever the user saved is the answer.
    needsDueDate: false,
  };
  Object.assign(updated, await scheduleAll(updated));
  await writeTasks(existing.map((t) => (t.id === id ? updated : t)));
}

// Reminders used to fire AT a task's time ("dentist at 2:00" rang at 2:00).
// Once per plan version, every open task still ahead is re-planned, so
// tasks saved before the change get their earlier reminder too.
const REMINDER_PLAN_KEY = 'taskReminderPlan';
const REMINDER_PLAN_VERSION = '2';

export async function refreshTaskReminders(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(REMINDER_PLAN_KEY)) === REMINDER_PLAN_VERSION) return;
    const existing = await getTasks();
    const today = localDate(new Date());
    let n = 0;
    const next: StoredTask[] = [];
    for (const t of existing) {
      if (t.done || !t.dueDate || t.dueDate < today) {
        next.push(t);
        continue;
      }
      await cancelAll(t);
      next.push({ ...t, ...(await scheduleAll(t)) });
      n += 1;
    }
    await writeTasks(next);
    await AsyncStorage.setItem(REMINDER_PLAN_KEY, REMINDER_PLAN_VERSION);
    console.log(`[tasks] re-planned reminders for ${n} open tasks`);
  } catch (e) {
    console.warn('[tasks] could not re-plan reminders:', e);
  }
}

export async function toggleTask(id: string): Promise<void> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (!target) return;

  const updated: StoredTask = {
    ...target,
    done: !target.done,
    doneAt: target.done ? undefined : new Date().toISOString(),
  };
  // No point reminding about something already finished; scheduleAll sets
  // nothing for a done task.
  await cancelAll(target);
  Object.assign(updated, await scheduleAll(updated));
  await writeTasks(existing.map((t) => (t.id === id ? updated : t)));
}

export async function deleteTask(id: string): Promise<StoredTask | null> {
  const existing = await getTasks();
  const target = existing.find((t) => t.id === id);
  if (target) await cancelAll(target);
  await writeTasks(existing.filter((t) => t.id !== id));
  return target ?? null;
}

/** Undo a delete: the task comes back as it was, reminders set again. */
export async function restoreTask(task: StoredTask): Promise<void> {
  const existing = await getTasks();
  if (existing.some((t) => t.id === task.id)) return;
  const back: StoredTask = { ...task, reminderIds: undefined, notificationId: undefined, earlyReminderIds: undefined };
  Object.assign(back, await scheduleAll(back));
  await writeTasks([back, ...existing]);
  console.log(`[tasks] restored "${task.title}"`);
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

export type ParsedTask = { title: string; dueDate?: string; dueTime?: string; duePeriod?: DayPeriod };

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
        const dueTime = t.time && /^\d{2}:\d{2}$/.test(t.time) ? t.time : undefined;
        const period = t.period?.toLowerCase();
        return { title: t.title.trim(), dueDate, dueTime, duePeriod: !dueTime && isDayPeriod(period) ? period : undefined };
      });
  } catch {
    return null;
  }
}

