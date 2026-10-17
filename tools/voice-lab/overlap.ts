// Talking over Recall: a long answer plays (at real speed, as on the phone),
// and 2.5 s in, the user says something over it. The app's own session
// settings and turn-taking code decide what happens.
//   node tools/voice-lab/run.mjs overlap ah,mmok,nowait,hold,cut,tv,cough
import { REALTIME_TOOLS, buildVoiceBootstrap, runRealtimeTool } from '@app/realtimeTools';
import { sessionSettings } from '@app/realtimeVoice';
import { createTurnTaker } from '@app/turnTaking';
const fs = require('fs');
const LAB = process.env.VOICE_LAB_DIR + '/';
const clips = (process.env.SCENARIO || 'ah').split(',');
const SR = 24000;

async function trial(clip: string) {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${process.env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const key = ((await r.json()) as any).value;
  const ws = new (globalThis as any).WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
  const t0 = Date.now(); const at = () => Date.now() - t0;
  const raw = (o: any) => ws.send(JSON.stringify(o));
  // Playback, as the phone would do it: audio plays at real speed from the
  // first chunk; output_audio_buffer.* are the events WebRTC would send.
  let playStart = 0, queuedMs = 0, playingItem = '', itemStart = 0, stopTimer: any = null, audible = false, cutAt = 0, userStart = 0, responding = false;
  const vol: string[] = [];
  let answers: string[] = []; let lastAnswerAt = 0; let heardOver = -1;
  const turns = createTurnTaker({
    send: (e) => {
      if (e.type === 'output_audio_buffer.clear') {
        // WebSocket has no server-side playback: stop ours and trim the
        // conversation to what was heard, as WebRTC does by itself.
        if (audible) raw({ type: 'conversation.item.truncate', item_id: playingItem, content_index: 0, audio_end_ms: Math.max(0, at() - itemStart - 50) });
        clearTimeout(stopTimer); audible = false; cutAt = at(); queuedMs = 0;
        turns.onEvent({ type: 'output_audio_buffer.cleared' });
        return;
      }
      raw(e);
    },
    setVolume: (v) => vol.push(`${(at() - (userStart || at())) }ms→${v}`),
    log: (l) => console.log('     ' + l),
  });
  const done = new Promise<void>((res) => {
    ws.onmessage = async (m: any) => {
      const e = JSON.parse(m.data);
      turns.onEvent(e);
      if (e.type === 'error' && !/cancel/.test(e.error.code || '')) console.log('     ERROR', e.error.message);
      if (e.type === 'response.output_audio.delta') {
        const ms = (Buffer.from(e.delta, 'base64').length / 2 / SR) * 1000;
        if (!audible) { audible = true; playStart = at(); queuedMs = 0; turns.onEvent({ type: 'output_audio_buffer.started' }); }
        if (e.item_id !== playingItem) { playingItem = e.item_id; itemStart = Math.max(at(), playStart + queuedMs); }
        queuedMs += ms; clearTimeout(stopTimer);
        stopTimer = setTimeout(() => { audible = false; turns.onEvent({ type: 'output_audio_buffer.stopped' }); }, playStart + queuedMs - at());
      }
      if (e.type === 'response.output_audio_transcript.done') { answers.push(e.transcript); lastAnswerAt = at(); }
      if (e.type === 'response.created') responding = true;
      if (e.type === 'response.done') {
        responding = false;
        const calls = (e.response.output ?? []).filter((o: any) => o.type === 'function_call');
        for (const c of calls) {
          const out = await runRealtimeTool(c.name, JSON.parse(c.arguments || '{}')).catch((x: any) => ({ error: String(x) }));
          raw({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } });
        }
        // As the app does (realtimeVoice.ts): not if the user has moved on.
        if (calls.length && !responding && !turns.userTookTurn()) raw({ type: 'response.create' });
      }
    };
    setTimeout(res, 34000);
  });
  await new Promise((s) => (ws.onopen = s));
  raw({ type: 'session.update', session: { ...sessionSettings('auto', await buildVoiceBootstrap()), tools: REALTIME_TOOLS, tool_choice: 'auto' } });
  await new Promise((s) => setTimeout(s, 800));
  // A question with a long answer, typed so it doesn't need a turn of its own.
  raw({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'احكيلي بالتفصيل عن يوم التلات اللي فات، كل اللي حصل فيه' }] } });
  raw({ type: 'response.create' });
  // The microphone: silence all along, the user's clip 2.5 s into the answer.
  const user = fs.readFileSync(LAB + 'audio/' + clip + '.pcm'); let u = -1; const CH = 4800;
  const mic = setInterval(() => {
    // 2.5 s into the real answer (not the "one sec" before a lookup).
    if (u < 0 && audible && queuedMs > 4000 && at() - itemStart > 2500 && !userStart) { u = 0; userStart = at(); heardOver = answers.length; }
    let chunk = Buffer.alloc(CH);
    if (u >= 0 && u < user.length) { chunk = Buffer.from(user.subarray(u, u + CH)); u += CH; if (chunk.length < CH) chunk = Buffer.concat([chunk, Buffer.alloc(CH - chunk.length)]); }
    raw({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
  }, 100);
  await done; clearInterval(mic); ws.close();
  const played = cutAt ? cutAt - playStart : null;
  console.log(`  ${clip.padEnd(7)} ${cutAt ? `CUT OFF ${cutAt - userStart} ms after the user started` : 'KEPT TALKING'}   volume: ${vol.join(', ') || '-'}`);
  answers.forEach((a, i) => console.log(`          ${i === heardOver ? '>>' : '  '} ${a.slice(0, 150)}`));
}
(async () => { for (const c of clips) await trial(c); process.exit(0); })();
