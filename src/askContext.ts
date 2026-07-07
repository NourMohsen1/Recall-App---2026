import { PEOPLE, PLACES, TASKS, WEEKDAYS, dateWithOffset, getDayDetail } from './data';
import { getLoggedMemories } from './memoryLog';

// Builds the text the AI reads before answering — everything Recall knows
// about the user: what they logged (real), the seeded demo days, and the
// People/Places/Tasks directories. Kept as plain dated text rather than a
// vector index: personal memory logs are small enough to stuff directly into
// the prompt, and plain text is easier for the model to cite accurately from.

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

  // Seeded demo days (offsets -1, -2, -3) so the assistant can answer about
  // them too while the app is still mostly demo content.
  const demoLines: string[] = [];
  for (const offset of [-1, -2, -3]) {
    const detail = getDayDetail(offset);
    if (!detail) continue;
    const d = dateWithOffset(offset);
    demoLines.push(`- [${longDate(d)} (${isoDate(d)})] ${detail.bullets.join(' ')}`);
  }
  if (demoLines.length > 0) {
    sections.push(`Sample logged days:\n${demoLines.join('\n')}`);
  }

  // People directory — lets the assistant resolve "who is X" / "who did I meet at Y".
  const peopleLines = PEOPLE.map(
    (p) => `- ${p.name} (${p.relation}): ${p.lastSeen} Tags: ${p.tags.join(', ')}`,
  );
  sections.push(`People the user knows:\n${peopleLines.join('\n')}`);

  // Places directory.
  const placeLines = PLACES.map((p) => `- ${p.name}`);
  sections.push(`Places the user frequents:\n${placeLines.join('\n')}`);

  // Tasks, in case the user asks about to-dos.
  const taskLines = TASKS.map(
    (t) => `- ${t.title} (${t.done ? 'done' : 'not done'}), due ${t.month} ${t.day} at ${t.time}: ${t.description}`,
  );
  sections.push(`Tasks:\n${taskLines.join('\n')}`);

  return sections.join('\n\n');
}
