// Preferences across a restart, learning over calls, forgetting, turning off.
//   step 1: save; step 2: a fresh process (a reopened app) reads them back.
import { forgetNote, getVoicePrefs, learnFromCall, learnedLines, prefsBlock, rememberNote, setLearning, setVoiceChoice } from '@app/voicePrefs';
(async () => {
  const step = process.env.SCENARIO;
  if (step === 'save') {
    await setVoiceChoice('male');
    await rememberNote('Keep answers short');
    await rememberNote('Call them Nono');
    const call = [{ role: 'user', text: 'روحت الـ gym كام مرة؟' }, { role: 'assistant', text: '…' }, { role: 'user', text: 'مين كان معايا؟' }, { role: 'user', text: 'والـ meeting كان امتى؟' }] as any;
    for (let i = 1; i <= 2; i++) { await learnFromCall(call); console.log(`after call ${i}: learned`, JSON.stringify(learnedLines(await getVoicePrefs()))); }
    await learnFromCall(call);
    console.log('after call 3: learned', JSON.stringify(learnedLines(await getVoicePrefs())));
  } else if (step === 'reopen') {
    const p = await getVoicePrefs();
    console.log('reopened: voice =', p.voice, '| notes =', JSON.stringify(p.notes.map((n) => n.text)));
    console.log('what the call is told:\n' + (await prefsBlock()));
    await forgetNote('nono');
    console.log('after forgetting "nono":', JSON.stringify((await getVoicePrefs()).notes.map((n) => n.text)));
    await setLearning(false);
    console.log('after turning off: notes', (await getVoicePrefs()).notes.length, '| block:', JSON.stringify(await prefsBlock()), '| saving refused:', JSON.stringify(await rememberNote('x')));
  }
})();
