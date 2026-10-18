// The turn-taking logic, fed exact event orders (some from Nour's phone
// log), checking what it sends. Deterministic: no network.
//   node tools/voice-lab/run.mjs turns-unit
import { createTurnTaker } from '@app/turnTaking';
type Sent = string;
function run(events: Record<string, unknown>[], transcriptDeltas = true) {
  const sent: Sent[] = [];
  const t = createTurnTaker({ send: (e) => sent.push(String(e.type)), setVolume: (v) => sent.push(`volume ${v}`), log: () => {} });
  for (const e of events) {
    if (e.type === '@expect') continue;
    t.onEvent(e);
  }
  return { sent, t };
}
const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });
let pass = 0, fail = 0;
function check(name: string, got: string[], want: string[]) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}\n      sent: ${got.join(', ') || '(nothing)'}${ok ? '' : `\n      want: ${want.join(', ')}`}`);
}

// Gap A, the exact order from the phone (132.272 → 132.381): answer asked
// for, user resumes 15 ms later, OpenAI confirms after.
check('Gap A: speech between "answer asked for" and "confirmed" cancels it on confirmation',
  run([ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u1' }),
       ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('response.created')]).sent,
  ['response.create', 'response.cancel', 'output_audio_buffer.clear']);
check('Gap A: the cancelled answer\'s lookups are dropped (takeYielded once)',
  [String(run([ev('input_audio_buffer.committed', { item_id: 'u1' }), ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('response.created'), ev('response.done')]).t.takeYielded())], ['true']);
check('Gap A: after resuming, the end of the sentence is answered once',
  run([ev('input_audio_buffer.committed', { item_id: 'u1' }), ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('response.created'), ev('response.done'),
       ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u2' })]).sent,
  ['response.create', 'response.cancel', 'output_audio_buffer.clear', 'response.create']);

// Gap B, the order from the phone (134.304 → 134.773): a turn ends while an
// answer is active (owed), the user starts again, the answer finishes.
check('Gap B: a waiting answer is not started while the user is speaking',
  run([ev('response.created'), ev('output_audio_buffer.started'), ev('input_audio_buffer.committed', { item_id: 'u1' }),
       ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('output_audio_buffer.cleared'), ev('response.done')]).sent,
  ['volume 0.3', 'volume 1']);
const gapB = (words: string) => [ev('response.created'), ev('output_audio_buffer.started'), ev('input_audio_buffer.committed', { item_id: 'u1' }),
  ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('output_audio_buffer.cleared'),
  ...(words ? [ev('conversation.item.input_audio_transcription.delta', { item_id: 'u2', delta: words })] : []),
  ev('response.done'), ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u2' })];
check('Gap B: real words → answered once when their sentence ends', run(gapB('اليوم كان')).sent.filter((s) => s === 'response.create'), ['response.create']);
check('Gap B: a cough (no words) → the held answer is still sent, once', run(gapB('')).sent.filter((s) => s === 'response.create'), ['response.create']);
check('Gap B: "آه" → the held answer is still sent, once', run(gapB('آه')).sent.filter((s) => s === 'response.create'), ['response.create']);
check('Gap B: lookup replies wait while the user speaks (userSpeakingNow)',
  [String(run([ev('input_audio_buffer.speech_started', { item_id: 'u1' })]).t.userSpeakingNow()), String(run([ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('input_audio_buffer.speech_stopped')]).t.userSpeakingNow())],
  ['true', 'false']);

// Unchanged behaviour.
check('unchanged: an ordinary turn is answered',
  run([ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u1' })]).sent, ['response.create']);
check('unchanged: a waiting answer starts when the user is quiet',
  run([ev('response.created'), ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u1' }), ev('response.done')]).sent,
  ['response.cancel', 'output_audio_buffer.clear', 'response.create']);
check('unchanged (Fix 2): speech while an answer is confirmed but not playing cancels it',
  run([ev('response.created'), ev('input_audio_buffer.speech_started', { item_id: 'u1' })]).sent, ['response.cancel', 'output_audio_buffer.clear']);
check('unchanged: "آه" over Recall is let go, no answer',
  run([ev('output_audio_buffer.started'), ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('conversation.item.input_audio_transcription.delta', { item_id: 'u1', delta: 'آه' }),
       ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u1' })]).sent, ['volume 0.3', 'volume 1']);
check('unchanged: "لا استنى" over Recall cuts and answers at its end',
  run([ev('output_audio_buffer.started'), ev('response.created'), ev('input_audio_buffer.speech_started', { item_id: 'u1' }), ev('conversation.item.input_audio_transcription.delta', { item_id: 'u1', delta: 'لا' }),
       ev('response.done'), ev('input_audio_buffer.speech_stopped'), ev('input_audio_buffer.committed', { item_id: 'u1' })]).sent,
  ['volume 0.3', 'response.cancel', 'output_audio_buffer.clear', 'volume 1', 'response.create']);
check('unchanged: no yield when nothing was asked for',
  run([ev('input_audio_buffer.speech_started', { item_id: 'u1' })]).sent, []);
check('stale mark: a confirmation long after a finished answer is not cancelled',
  run([ev('input_audio_buffer.committed', { item_id: 'u1' }), ev('response.created'), ev('response.done'), ev('input_audio_buffer.speech_started', { item_id: 'u2' }), ev('input_audio_buffer.speech_stopped'),
       ev('input_audio_buffer.committed', { item_id: 'u2' }), ev('response.created')]).sent,
  ['response.create', 'response.create']);
// A lookup's reply held because the user spoke "آه" over the "one sec".
{
  const sent: string[] = [];
  const t = createTurnTaker({ send: (e) => sent.push(String(e.type)), setVolume: () => {}, log: () => {} });
  t.onEvent(ev('output_audio_buffer.started')); t.onEvent(ev('input_audio_buffer.speech_started', { item_id: 'u1' }));
  t.onEvent(ev('output_audio_buffer.cleared'));
  if (t.userSpeakingNow()) t.holdAnswer(); // what realtimeVoice does when the lookup finishes
  t.onEvent(ev('conversation.item.input_audio_transcription.delta', { item_id: 'u1', delta: 'آه' }));
  t.onEvent(ev('input_audio_buffer.speech_stopped')); t.onEvent(ev('input_audio_buffer.committed', { item_id: 'u1' }));
  check('Gap B (lookup): reply held during "آه" is sent once when it ends', sent.filter((s) => s === 'response.create'), ['response.create']);
}
console.log(`\n${pass} passed, ${fail} failed`);
