// Nour's Friday (16 Oct): one paragraph about the whole day. What time does
// each part get? The layout alone, then the real intake on his words.
import { analyzeMemory, momentTimes } from '@app/memoryIntake';
import { realClock } from '@app/logicalDay';
import { loadAiConsent } from '@app/aiConsent';
const show = (iso: string) => realClock(new Date(iso)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
(async () => {
  await loadAiConsent();
  console.log('layout of 12:00, 13:00, 15:00, 17:00, 21:00, 00:30:');
  console.log('  ' + momentTimes(['12:00', '13:00', '15:00', '17:00', '21:00', '00:30'].map((time) => ({ time, text: '' })), '2026-10-16', '2026-10-16T12:00:00').map((m) => show(m.takenAt)).join(' → '));
  const text = 'الجمعة الصبح أحمد ربيع وأنا روحنا صلاة الجمعة سوا في ابن سينا. خلصنا صلاة وروحنا جبنا قهوة من مكان اسمه Verse، وروحت مع نجيب أخوه و٤ أطفال تانيين كده بنوصلهم على الطريق. خلصت وروحت، غسلت هدومي وركبت باقي الترابيزة وهي جاهزة دلوقتي. ناير جه من الشغل وروحنا ودينا الترابيزة التانية لـ Varun (ده اللي أنا باعتله الترابيزة على Facebook Marketplace بـ $150). بس وروحت جبت حاجتي بسرعة وروحت مع بودي وأحمد ربيع وأحمد راضي وعبدالله راشد في العربية للعب الكورة. كان من 9 pm لـ 12 am. خلصنا وروحنا جبنا أكل من آيكرافيت وروحنا روزفلت شوية في الآخر وروحنا.';
  for (let run = 1; run <= 2; run++) {
    const r: any = await analyzeMemory(text, { entryDay: '2026-10-16' }).catch((e: any) => ({ error: String(e) }));
    if (!r || r.error) { console.log('intake error', r.error); continue; }
    const laid = momentTimes(r.moments ?? [], '2026-10-16', '2026-10-16T23:59:00');
    console.log(`\nrun ${run}: AI gave ${JSON.stringify((r.moments ?? []).map((m: any) => m.time))}`);
    laid.forEach((m) => console.log(`  ${show(m.takenAt).padStart(8)}  ${m.text.slice(0, 60)}`));
  }
})();
