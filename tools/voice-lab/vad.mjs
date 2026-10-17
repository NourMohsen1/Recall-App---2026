// Stream a recording in real time and log when the model decides the user finished.
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_(API_URL|APP_TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const base = env.EXPO_PUBLIC_RECALL_API_URL || 'https://recall-keys.nourmohsen-recall.workers.dev';
const [, , file, mode] = process.argv;
const td = mode === 'default' ? undefined : mode.startsWith('server') ? { type: 'server_vad', silence_duration_ms: Number(mode.slice(6)) || 500, create_response: true, interrupt_response: true } : { type: 'semantic_vad', eagerness: mode, create_response: true, interrupt_response: true };
const r = await fetch(base + '/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
const key = (await r.json()).value;
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
const send = (o) => ws.send(JSON.stringify(o));
const pcm = fs.readFileSync(file);
let t0 = 0; const now = () => ((Date.now() - t0) / 1000).toFixed(1);
let early = 0, late = null; const END = pcm.length / 48000;
ws.onmessage = (m) => {
  const e = JSON.parse(m.data);
  if (e.type === 'error') console.log('ERROR', e.error.message);
  if (e.type === 'response.created') { const t = (Date.now() - t0) / 1000; if (t < END - 0.05) early++; else if (late === null) late = t - END; }
};
ws.onopen = async () => {
  const input = { noise_reduction: { type: 'far_field' } };
  if (td) input.turn_detection = td;
  send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'], instructions: 'Answer in one short sentence.', audio: { input } } });
  await new Promise((s) => setTimeout(s, 800));
  t0 = Date.now();
  const CH = 4800; // 100 ms
  const silence = Buffer.alloc(CH);
  for (let i = 0; i < pcm.length + 40 * CH; i += CH) {
    const chunk = i < pcm.length ? pcm.subarray(i, i + CH) : silence;
    send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
    await new Promise((s) => setTimeout(s, 100));
  }
  console.log(`${file.padEnd(8)} ${mode.padEnd(10)} false starts mid-sentence: ${early}   answer after the end: ${late === null ? 'none in 4s' : late.toFixed(1) + 's'}`);
  ws.close(); process.exit(0);
};
