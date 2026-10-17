// Timeline of what OpenAI reports while the user speaks, with automatic
// answering and interrupting both off (the app would decide).
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_(API_URL|APP_TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
const key = (await r.json()).value;
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
const send = (o) => ws.send(JSON.stringify(o));
let t0 = 0; const now = () => ((Date.now() - t0) / 1000).toFixed(2);
ws.onmessage = (m) => {
  const e = JSON.parse(m.data);
  if (e.type === 'error') console.log(`  ${now()} ERROR ${e.error.message}`);
  if (/speech_started|speech_stopped|committed/.test(e.type)) console.log(`  ${now()} ${e.type.replace('input_audio_buffer.', '')}`);
  if (e.type === 'conversation.item.input_audio_transcription.delta') console.log(`  ${now()} delta "${e.delta}"`);
  if (e.type === 'conversation.item.input_audio_transcription.completed') console.log(`  ${now()} DONE "${e.transcript}"`);
  if (e.type === 'response.created') console.log(`  ${now()} response.created (should not happen)`);
};
ws.onopen = async () => {
  send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'], audio: { input: {
    noise_reduction: { type: 'far_field' },
    transcription: { model: 'gpt-live-transcribe', prompt: 'Often Egyptian Arabic and English mixed in one sentence; any other language is possible.' },
    turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: false, interrupt_response: false } } } } });
  await new Promise((s) => setTimeout(s, 800));
  for (const f of process.argv.slice(2)) {
    const pcm = fs.readFileSync(f); console.log(`== ${f} (${(pcm.length / 48000).toFixed(2)}s of speech)`);
    t0 = Date.now(); const CH = 2400; // samples are 2 bytes: 2400 bytes = 50 ms, sent every 50 ms = real time
    for (let i = 0; i < pcm.length + 50 * CH; i += CH) {
      send({ type: 'input_audio_buffer.append', audio: (i < pcm.length ? pcm.subarray(i, i + CH) : Buffer.alloc(CH)).toString('base64') });
      await new Promise((s) => setTimeout(s, 50));
    }
  }
  ws.close(); process.exit(0);
};
