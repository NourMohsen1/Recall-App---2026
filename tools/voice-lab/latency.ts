// How long after the user stops talking Recall starts to sound, step by step,
// for ordinary questions (Recall quiet), with the app's own settings.
//   node tools/voice-lab/run.mjs latency eg1,mix,en,help,who
import { REALTIME_TOOLS, buildVoiceBootstrap, runRealtimeTool } from '@app/realtimeTools';
import { sessionSettings } from '@app/realtimeVoice';
import { createTurnTaker } from '@app/turnTaking';
const fs = require('fs');
const LAB = process.env.VOICE_LAB_DIR + '/';
(async () => {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${process.env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const ws = new (globalThis as any).WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + ((await r.json()) as any).value]);
  const raw = (o: any) => ws.send(JSON.stringify(o));
  const turns = createTurnTaker({ send: raw, setVolume: () => {}, log: () => {} });
  let mark: Record<string, number> = {}; let responding = false; let finished: (() => void) | null = null; let said = '';
  ws.onmessage = async (m: any) => {
    const e = JSON.parse(m.data); turns.onEvent(e); const t = Date.now();
    if (e.type === 'input_audio_buffer.speech_stopped' && !mark.stopped) mark.stopped = t;
    if (e.type === 'response.created') { responding = true; if (!mark.created) mark.created = t; }
    if (e.type === 'response.output_audio.delta' && !mark.sound) mark.sound = t;
    if (e.type === 'response.output_audio_transcript.done') said += e.transcript + ' ';
    if (e.type === 'response.done') {
      responding = false;
      const calls = (e.response.output ?? []).filter((o: any) => o.type === 'function_call');
      for (const c of calls) { if (!mark.tool) mark.tool = t; const out = await runRealtimeTool(c.name, JSON.parse(c.arguments || '{}')); raw({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } }); }
      if (calls.length) { raw({ type: 'response.create' }); return; }
      finished?.();
    }
    if (e.type === 'response.output_audio.delta' && mark.tool && !mark.answerSound) mark.answerSound = t;
  };
  await new Promise((s) => (ws.onopen = s));
  raw({ type: 'session.update', session: { ...sessionSettings('auto', await buildVoiceBootstrap()), tools: REALTIME_TOOLS, tool_choice: 'auto' } });
  await new Promise((s) => setTimeout(s, 800));
  const rows: string[] = [];
  for (const clip of (process.env.SCENARIO || 'eg1').split(',')) {
    mark = {}; said = '';
    const pcm = fs.readFileSync(LAB + 'audio/' + clip + '.pcm'); const CH = 4800; let end = 0;
    const done = new Promise<void>((s) => (finished = s));
    for (let i = 0; i < pcm.length + 30 * CH; i += CH) {
      raw({ type: 'input_audio_buffer.append', audio: (i < pcm.length ? pcm.subarray(i, i + CH) : Buffer.alloc(CH)).toString('base64') });
      if (i >= pcm.length && !end) end = Date.now();
      await new Promise((s) => setTimeout(s, 100));
      if (mark.sound && i > pcm.length + 10 * CH) break;
    }
    await Promise.race([done, new Promise((s) => setTimeout(s, 20000))]);
    const d = (a?: number, b?: number) => (a && b ? `${b - a}` : '-').padStart(5);
    rows.push(`${clip.padEnd(6)} stop→turn ${d(end, mark.stopped)}  turn→answer ${d(mark.stopped, mark.created)}  answer→sound ${d(mark.created, mark.sound)}  = first sound ${d(end, mark.sound)} ms${mark.tool ? `   (lookup, then the answer itself at ${d(end, mark.answerSound)} ms)` : ''}\n         ${said.trim().slice(0, 120)}`);
    await new Promise((s) => setTimeout(s, 1500));
  }
  rows.forEach((r) => console.log(r)); ws.close(); process.exit(0);
})();
