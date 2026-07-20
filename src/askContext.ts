import { PLACES, WEEKDAYS } from './data';
import { getLoggedMemories } from './memoryLog';
import { getAllPersonMeta, getPeopleSummaries } from './peopleTags';
import { formatDueTime, getTasks } from './tasks';

// Builds the text the AI reads before answering — everything Recall knows
// about the user: what they logged (real), and the People/Places/Tasks
// directories. Kept as plain dated text rather than a vector index: personal
// memory logs are small enough to stuff directly into the prompt, and plain
// text is easier for the model to cite accurately from.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function longDate(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function buildMemoryContext(): Promise<string> {
  const sections: string[] = [];
  const today = new Date();
  sections.push(`Today's date is ${longDate(today)} (${isoDate(today)}).`);

  // Real memories the user has actually logged.
  const real = await getLoggedMemories();
  if (real.length > 0) {
    const lines = real
      .slice(0, 300) // keep the prompt bounded for very long histories
      .map((m) => {
        const d = new Date(m.takenAt);
        const when = `${longDate(d)} (${isoDate(d)})`;
        if (m.kind === 'text') return `- [${when}] Note: ${m.text}`;
        if (m.kind === 'voice') {
          const transcript = m.text ?? '(no transcript available)';
          return `- [${when}] Voice memory: ${transcript}${m.note ? ` (user's added note: ${m.note})` : ''}`;
        }
        return `- [${when}] Photo memory${m.text ? `: ${m.text}` : ' (no caption)'}`;
      });
    sections.push(`Memories the user has logged:\n${lines.join('\n')}`);
  }

  // People directory — real people the user tagged on their days, so the
  // assistant can resolve "when did I last see X" / "who was I with".
  const people = await getPeopleSummaries();
  if (people.length > 0) {
    const personMeta = await getAllPersonMeta();
    const peopleLines = people.map((p) => {
      const meta = personMeta[p.name];
      const who = meta?.descriptor ? ` (${meta.descriptor})` : '';
      const notes =
        meta && meta.mentions.length > 0
          ? ` Notes: ${meta.mentions
              .slice(0, 5)
              .map((m) => `[${m.day}] ${m.text}`)
              .join(' | ')}`
          : '';
      return `- ${p.name}${who}: seen together on ${p.days.length} day(s); last on ${p.lastSeenDay}; days: ${p.days.join(', ')}.${notes}`;
    });
    sections.push(`People the user has tagged in their days:\n${peopleLines.join('\n')}`);
  }

  // Places directory.
  const placeLines = PLACES.map((p) => `- ${p.name}`);
  sections.push(`Places the user frequents:\n${placeLines.join('\n')}`);

  // Tasks, in case the user asks about to-dos — real ones only.
  const tasks = await getTasks();
  if (tasks.length > 0) {
    const taskLines = tasks.map((t) => {
      const due = t.dueDate
        ? `, due ${t.dueDate}${t.dueTime ? ` at ${formatDueTime(t.dueTime)}` : ''}`
        : '';
      return `- ${t.title} (${t.done ? 'done' : 'not done'})${due}`;
    });
    sections.push(`Tasks:\n${taskLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
