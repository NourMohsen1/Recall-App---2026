// "Was this person with me all day?" On 7 Oct the user went to the gym with
// Omar, then met Ali at the petrol station. Ali was never at the gym.
// Typed Ask, two-question conversations, as Nour asked them.
import { askMemory, type ChatTurn } from '@app/askAI';
import { loadAiConsent } from '@app/aiConsent';
const CONVOS: string[][] = [
  ['قابلت علي كام مرة الأسبوع اللي فات؟', 'قولي كان بيعمل معايا إيه يومها؟'],
  ['Who did I see on October 7th?', 'What did Ali and I do together that day?'],
  ['عمر كان معايا فين يوم 7 أكتوبر؟'],
  ['هو علي كان معايا في الجيم؟'],
];
(async () => {
  await loadAiConsent();
  for (const qs of CONVOS) {
    const history: ChatTurn[] = [];
    console.log('');
    for (const q of qs) {
      const r: any = await askMemory(q, history);
      const a = r.ok ? r.answer : `ERROR ${r.error}`;
      console.log(`  Q: ${q}\n  A: ${a.replace(/\n+/g, ' ').slice(0, 300)}`);
      history.push({ role: 'user', text: q }, { role: 'assistant', text: a });
    }
  }
})();
