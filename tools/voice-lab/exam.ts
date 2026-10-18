// Ask's exam: questions people actually ask, on a test phone with a real
// past (photo-only months, typed weeks). Each line is a conversation;
// " >> " separates its turns.  SCENARIO=<file in scenarios/> (one per line)
import { askMemory, type ChatTurn } from '@app/askAI';
import { loadAiConsent } from '@app/aiConsent';
const fs = require('fs');
(async () => {
  await loadAiConsent();
  const convos = fs.readFileSync(process.env.VOICE_LAB_DIR + '/scenarios/' + process.env.SCENARIO, 'utf8').split('\n').filter((l: string) => l.trim() && !l.startsWith('#'));
  for (const line of convos) {
    const history: ChatTurn[] = [];
    console.log('');
    for (const q of line.split(' >> ')) {
      const t0 = Date.now();
      const r: any = await askMemory(q, history);
      const a = r.ok ? r.answer : `ERROR ${r.error}`;
      console.log(`  Q: ${q}\n  A: (${((Date.now() - t0) / 1000).toFixed(1)}s) ${a.replace(/\n+/g, ' ').slice(0, 420)}`);
      history.push({ role: 'user', text: q }, { role: 'assistant', text: a });
    }
  }
})();
