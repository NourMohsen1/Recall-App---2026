// A style that changes over calls: does what Recall believes follow it?
import { getVoicePrefs, learnFromCall, learnedLines } from '@app/voicePrefs';
(async () => {
  const ar = [{ role: 'user', text: 'روحت الجيم كام مرة؟' }, { role: 'user', text: 'مين كان معايا يوم الخميس؟' }, { role: 'user', text: 'وبعدين رحنا فين؟' }] as any;
  const en = [{ role: 'user', text: 'Could you walk me through everything I did last weekend, including who I saw and where we went afterwards?' }, { role: 'user', text: 'And tell me more about the dinner on Saturday, I want all the details please.' }, { role: 'user', text: 'What else happened that week that I might have forgotten about?' }] as any;
  for (let i = 1; i <= 3; i++) await learnFromCall(ar);
  console.log('after 3 Egyptian calls:', JSON.stringify(learnedLines(await getVoicePrefs())));
  for (let i = 1; i <= 8; i++) { await learnFromCall(en); if ([1, 3, 5, 8].includes(i)) console.log(`after ${i} English call(s):`, JSON.stringify(learnedLines(await getVoicePrefs()))); }
})();
