// Setting a moment's time by hand: it stays on its day, in order, and an
// after-midnight time stays at the end of that night and shows as itself.
import { getMemoriesByDay, saveMemory, setMemoryTime } from '@app/memoryLog';
import { realClock } from '@app/logicalDay';
(async () => {
  const at = (h: number) => new Date(2026, 9, 16, h);
  const ids: string[] = [];
  for (const [h, t] of [[12, 'prayer'], [19, 'football'], [19, 'dinner after']] as const) ids.push((await saveMemory({ kind: 'text', text: t, takenAt: at(h) } as any)).id);
  const show = async (when: string) => {
    const day = (await getMemoriesByDay()).get('2026-10-16') ?? [];
    console.log(`  ${when}: ` + day.map((m) => `${m.text} ${realClock(new Date(m.takenAt)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${m.placedByUser ? ' (set)' : ''}`).join(' → '));
  };
  await show('before');
  await setMemoryTime(ids[1], 21, 0);
  await setMemoryTime(ids[2], 0, 30);
  await show('after ');
  console.log('  other days touched:', [...(await getMemoriesByDay()).keys()].filter((k) => k !== '2026-10-16').join(', ') || 'none');
})();
