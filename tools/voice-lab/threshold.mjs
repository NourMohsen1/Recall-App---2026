// Does the detector hear each clip at a given sensitivity? (speech_started)
//   node threshold.mjs 0.5 0.6 0.7
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_APP_TOKEN=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const CLIPS = ['nowait', 'hold', 'ah', 'soft-nowait', 'soft-ah', 'tv-loud', 'tv50', 'tv', 'tv20', 'cough'];
for (const th of process.argv.slice(2).map(Number)) {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + (await r.json()).value]);
  const send = (o) => ws.send(JSON.stringify(o)); let heard = false;
  ws.onmessage = (m) => { const e = JSON.parse(m.data); if (e.type === 'input_audio_buffer.speech_started') heard = true; };
  await new Promise((s) => (ws.onopen = s));
  send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'], audio: { input: { noise_reduction: { type: 'far_field' }, turn_detection: { type: 'server_vad', threshold: th, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: false, interrupt_response: false } } } } });
  await new Promise((s) => setTimeout(s, 600));
  const row = [];
  for (const c of CLIPS) {
    heard = false; const pcm = fs.readFileSync(new URL(`./audio/${c}.pcm`, import.meta.url)); const CH = 4800;
    for (let i = 0; i < pcm.length + 12 * CH; i += CH) { send({ type: 'input_audio_buffer.append', audio: (i < pcm.length ? pcm.subarray(i, i + CH) : Buffer.alloc(CH)).toString('base64') }); await new Promise((s) => setTimeout(s, 25)); }
    await new Promise((s) => setTimeout(s, 700)); send({ type: 'input_audio_buffer.clear' }); row.push(`${c}:${heard ? 'HEARD' : '-'}`);
  }
  console.log(`threshold ${th}: ${row.join('  ')}`); ws.close();
}
process.exit(0);
