// The user pauses, OpenAI ends the turn, the app starts an answer, and the
// user goes on before it plays. Does Recall's voice play over them?
// Playback is simulated at real speed (output_audio_buffer.* as WebRTC
// sends them); the app's own turn-taking and lookups decide.
//   node tools/voice-lab/run.mjs resume resume,resume2
import { REALTIME_TOOLS, buildVoiceBootstrap, runRealtimeTool } from '@app/realtimeTools';
import { sessionSettings } from '@app/realtimeVoice';
import { createTurnTaker } from '@app/turnTaking';
import { diag, diagCallStart } from '@app/liveDiag';
const fs = require('fs');
const LAB = process.env.VOICE_LAB_DIR + '/';
const SR = 24000;
async function trial(clip: string) {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${process.env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const ws = new (globalThis as any).WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + ((await r.json()) as any).value]);
  const t0 = Date.now(); const at = () => Date.now() - t0;
  if (process.env.TRACE) diagCallStart({ clip });
  const raw = (o: any) => ws.send(JSON.stringify(o));
  let audible = false, playStart = 0, queuedMs = 0, stopTimer: any = null, userSpeaking = false, responding = false;
  let overUser = 0; const answers: string[] = []; const statuses: string[] = [];
  const turns = createTurnTaker({
    send: (e) => {
      if (e.type === 'output_audio_buffer.clear') { clearTimeout(stopTimer); if (audible) { audible = false; turns.onEvent({ type: 'output_audio_buffer.cleared' }); } return; }
      raw(e);
    },
    setVolume: () => {},
    log: () => {},
    trace: process.env.TRACE ? (e, d) => diag('APP', e, d) : undefined,
  });
  ws.onmessage = async (m: any) => {
    const e = JSON.parse(m.data);
    // DELAY_CREATED: deliver OpenAI's "answer confirmed" late, as it arrived
    // on Nour's phone (after the user's resumed speech), to exercise Gap A.
    if (e.type === 'response.created' && process.env.DELAY_CREATED) await new Promise((s) => setTimeout(s, Number(process.env.DELAY_CREATED)));
    turns.onEvent(e);
    if (e.type === 'input_audio_buffer.speech_started') userSpeaking = true;
    if (e.type === 'input_audio_buffer.speech_stopped') userSpeaking = false;
    if (e.type === 'response.created') responding = true;
    if (e.type === 'response.output_audio.delta') {
      const ms = (Buffer.from(e.delta, 'base64').length / 2 / SR) * 1000;
      if (userSpeaking) overUser += ms;
      if (!audible) { audible = true; playStart = at(); queuedMs = 0; turns.onEvent({ type: 'output_audio_buffer.started' }); }
      queuedMs += ms; clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { audible = false; turns.onEvent({ type: 'output_audio_buffer.stopped' }); }, playStart + queuedMs - at());
    }
    if (e.type === 'response.output_audio_transcript.done') answers.push(e.transcript);
    if (e.type === 'response.done') {
      responding = false;
      statuses.push(e.response.status);
      // As the app does (realtimeVoice.ts handleEvent).
      if (e.response.status === 'cancelled' && (turns as any).takeYielded?.()) return;
      const calls = (e.response.output ?? []).filter((o: any) => o.type === 'function_call');
      for (const c of calls) {
        const out = await runRealtimeTool(c.name, JSON.parse(c.arguments || '{}')).catch((x: any) => ({ error: String(x) }));
        raw({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } });
      }
      // As the app does (realtimeVoice.ts): held while the user speaks.
      if (calls.length && !responding && !turns.userTookTurn() && (turns as any).userSpeakingNow?.()) { (turns as any).holdAnswer?.(); return; }
      if (calls.length && !responding && !turns.userTookTurn()) { (turns as any).noteAnswerRequested?.(); raw({ type: 'response.create' }); }
    }
  };
  await new Promise((s) => (ws.onopen = s));
  raw({ type: 'session.update', session: { ...sessionSettings('auto', await buildVoiceBootstrap()), tools: REALTIME_TOOLS, tool_choice: 'auto' } });
  await new Promise((s) => setTimeout(s, 800));
  const pcm = fs.readFileSync(LAB + 'audio/' + clip + '.pcm'); const CH = 4800;
  for (let i = 0; i < pcm.length + 120 * CH; i += CH) {
    const chunk = i < pcm.length ? Buffer.from(pcm.subarray(i, i + CH)) : Buffer.alloc(CH);
    raw({ type: 'input_audio_buffer.append', audio: (chunk.length < CH ? Buffer.concat([chunk, Buffer.alloc(CH - chunk.length)]) : chunk).toString('base64') });
    await new Promise((s) => setTimeout(s, 100));
  }
  ws.close();
  console.log(`  ${clip.padEnd(8)} Recall's voice over the user: ${Math.round(overUser)} ms   answers: ${statuses.join(', ')}`);
  answers.forEach((a) => console.log(`           "${a.slice(0, 110)}"`));
}
(async () => { for (const c of (process.env.SCENARIO || 'resume').split(',')) await trial(c); process.exit(0); })();
