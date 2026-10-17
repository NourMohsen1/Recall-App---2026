// Nour's Friday, written as one paragraph, through the app's real intake,
// then asked about one person at a time: did Recall put them everywhere?
// Nayer only came to take the second table to Varun; Ahmed Rabie was at the
// prayer and the football; Boudy only at the football.
import { saveMemory, getLoggedMemories } from '@app/memoryLog';
import { processMemoryIntake } from '@app/memoryIntake';
import { askMemory, type ChatTurn } from '@app/askAI';
import { loadAiConsent } from '@app/aiConsent';
import { runRealtimeTool } from '@app/realtimeTools';
const TEXT = 'الجمعة الصبح أحمد ربيع وأنا روحنا صلاة الجمعة سوا في ابن سينا. خلصنا صلاة وروحنا جبنا قهوة من مكان اسمه Verse، وروحت مع نجيب أخوه و٤ أطفال تانيين كده بنوصلهم على الطريق. خلصت وروحت، غسلت هدومي وركبت باقي الترابيزة وهي جاهزة دلوقتي. ناير جه من الشغل وروحنا ودينا الترابيزة التانية لـ Varun (ده اللي أنا باعتله الترابيزة على Facebook Marketplace بـ $150). بس وروحت جبت حاجتي بسرعة وروحت مع بودي وأحمد ربيع وأحمد راضي وعبدالله راشد في العربية للعب الكورة. كان من 9 pm لـ 12 am. خلصنا وروحنا جبنا أكل من آيكرافيت وروحنا روزفلت شوية في الآخر وروحنا.';
const CONVOS: string[][] = [
  ['شفت ناير امتى آخر مرة؟', 'قولي كان بيعمل معايا إيه يومها؟'],
  ['What did Boudy and I do on Friday?'],
  ['أحمد ربيع كان معايا فين يوم الجمعة؟'],
  ['مين كان معايا في الكورة يوم الجمعة؟'],
];
(async () => {
  await loadAiConsent();
  const m = await saveMemory({ kind: 'text', text: TEXT, takenAt: new Date(2026, 9, 16, 23, 0) } as any);
  await processMemoryIntake(m.id, TEXT, '2026-10-16');
  const day = (await getLoggedMemories()).filter((x) => x.takenAt.startsWith('2026-10-16') || x.takenAt.startsWith('2026-10-17'));
  console.log(`  stored: ${day.length} entries`);
  if (process.env.SHOW_TOOLS) console.log(JSON.stringify(await runRealtimeTool('find_person', { name: 'Nayer' }), null, 1).slice(0, 2500));
  for (const qs of CONVOS) {
    const history: ChatTurn[] = [];
    for (const q of qs) {
      const r: any = await askMemory(q, history);
      const a = r.ok ? r.answer : `ERROR ${r.error}`;
      console.log(`  Q: ${q}\n  A: ${a.replace(/\n+/g, ' ').slice(0, 320)}`);
      history.push({ role: 'user', text: q }, { role: 'assistant', text: a });
    }
  }
})();
