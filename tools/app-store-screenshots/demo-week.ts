// Builds Recall's demo week with the app's own code and the real AI, then
// writes everything it stored to demo-store.json for the screenshot simulator.
import fs from 'fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAiConsent } from '@app/aiConsent';
import { saveMemory } from '@app/memoryLog';
import { processMemoryIntake } from '@app/memoryIntake';
import { setUserProfile } from '@app/userProfile';
import { addTask } from '@app/tasks';
import { addRecurringMarker } from '@app/dayMarkers';
import { recapLine, recapPeriod, unitsWithContent } from '@app/recap';
import { askMemory } from '@app/askAI';
import { saveSession } from '@app/chatSessions';

const notes: [string, string, string][] = [
  ['2026-10-04', '11:30', 'Brunch at Zooba with Sara and Omar. Sara got the job at the design studio, we celebrated with way too much ta3meya.'],
  ['2026-10-05', '08:00', 'Gym in the morning before work. Presented the new onboarding screens to the team at 3, they loved the illustrations.'],
  ['2026-10-06', '17:00', "Took Mom to Dr. Hany's clinic for her checkup, everything looks good. Picked up her medicine on the way home."],
  ['2026-10-07', '13:00', 'Got paid today! Booked the beach house in Sahel for the long weekend with Youssef and Hana.'],
  ['2026-10-08', '21:30', 'اتمشيت مع عمر على الكورنيش بالليل وأكلنا درة مشوية. اتكلمنا كتير عن المشروع الجديد بتاعه.'],
  ['2026-10-09', '14:00', "Family lunch at Mom's, Youssef brought the kids. Played FIFA with Omar after, he won again."],
  ['2026-10-10', '10:00', 'Went to the Grand Egyptian Museum with Hana, the pyramids looked unreal from the terrace. Coffee at Café Riche after. I need to renew my passport before November.'],
  ['2026-10-11', '07:30', 'Morning run along the Nile, 5 km. Feeling good.'],
];

(async () => {
  await loadAiConsent();
  await setUserProfile({ name: 'Layla Hassan', joinedAt: '2026-09-01T09:00:00.000Z' });
  for (const [day, time, text] of notes) {
    const [y, m, d] = day.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const saved = await saveMemory({ kind: 'text', text, takenAt: new Date(y, m - 1, d, hh, mm) });
    const ok = await processMemoryIntake(saved.id, text, day);
    console.log(day, ok ? 'filed' : 'NOT filed');
  }
  await addTask({ title: 'Dentist — Dr. Salma', dueDate: '2026-10-14', dueTime: '14:00', source: 'manual', reminder: '2h' });
  await addTask({ title: 'Pay the internet bill', dueDate: '2026-10-15', source: 'manual' });
  await addRecurringMarker({ kind: 'birthday', label: "Sara's birthday", every: 'year', month: 10, day: 13, since: '2026-10-04', source: 'manual', person: 'Sara' });

  // This week's recap lines, written now by the real AI and cached.
  const period = recapPeriod('week', 0);
  for (const { unit, hasContent } of await unitsWithContent(period)) {
    if (!hasContent) continue;
    const line = await recapLine('week', unit);
    console.log('recap', unit.key, '→', line?.summary);
  }

  // One real conversation in Ask.
  const q = 'When did I last see Omar?';
  const r = await askMemory(q, []);
  if (r.ok) {
    const id = `${new Date(2026, 9, 11, 9, 12).getTime()}-demo01`;
    await saveSession(id, [
      { role: 'user', text: q, at: new Date(2026, 9, 11, 9, 12).toISOString() },
      { role: 'ai', text: r.answer, sources: r.sources, reference: r.reference, at: new Date(2026, 9, 11, 9, 12, 20).toISOString() },
    ]);
    console.log('ask →', r.answer, r.sources.map((s) => s.date));
  } else console.log('ask failed', r.reason);

  const out: Record<string, string> = {};
  for (const k of await AsyncStorage.getAllKeys()) out[k] = (await AsyncStorage.getItem(k)) as string;
  fs.writeFileSync(__dirname + '/demo-store.json', JSON.stringify(out));
  console.log('keys:', Object.keys(out).join(', '));
})();
