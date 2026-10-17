import { mentionsPerson } from '@app/personIdentity';
const cases: [string, string[], boolean][] = [
  ['ناير جه من الشغل وروحنا ودينا الترابيزة التانية لـ Varun', ['Nayer', 'ناير'], true],
  ['ناير جه من الشغل وروحنا ودينا الترابيزة التانية لـ Varun', ['Varun'], true],
  ['وروحت مع بودي وأحمد ربيع وأحمد راضي وعبدالله راشد في العربية للعب الكورة', ['Ahmed Rabie', 'أحمد ربيع'], true],
  ['وروحت مع بودي وأحمد ربيع وأحمد راضي', ['Boudy', 'بودي'], true],
  ['وروحت مع بودي وأحمد ربيع وأحمد راضي', ['Nayer', 'ناير'], false],
  ['الجمعة الصبح أحمد ربيع وأنا روحنا صلاة الجمعة سوا في ابن سينا', ['Ahmed Rady', 'أحمد راضي'], false],
  ['روحت الجيم مع عمر', ['Omar'], true],
  ['وقفت أموّن في البنزينة وقابلت واحد اسمه علي', ['Omar'], false],
  ['وقفت أموّن في البنزينة وقابلت واحد اسمه علي', ['Ali'], true],
  ['I had lunch with Sara and Nour', ['Sarah'], true],
  ['خلصنا وروحنا جبنا أكل من آيكرافيت', ['Boudy', 'بودي'], false],
];
let ok = 0;
for (const [t, n, want] of cases) { const got = mentionsPerson(t, n); if (got === want) ok++; console.log(`${got === want ? 'ok ' : 'BAD'} ${n[0].padEnd(12)} ${want ? 'named   ' : 'not there'} ${t.slice(0, 50)}`); }
console.log(`${ok}/${cases.length}`);
