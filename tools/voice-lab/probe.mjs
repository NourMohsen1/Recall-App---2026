// Probe: does the realtime API accept the proposed session settings and history items?
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_(API_URL|APP_TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const base = env.EXPO_PUBLIC_RECALL_API_URL || 'https://recall-keys.nourmohsen-recall.workers.dev';
const r = await fetch(base + '/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
const key = (await r.json()).value; if (!key) { console.log('no key', r.status); process.exit(1); }
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
const send = (o) => ws.send(JSON.stringify(o));
ws.onmessage = (m) => {
  const e = JSON.parse(m.data);
  if (e.type === 'error') console.log('ERROR', JSON.stringify(e.error));
  if (e.type === 'session.updated') console.log('session.updated turn_detection=', JSON.stringify(e.session.audio.input.turn_detection), 'noise=', JSON.stringify(e.session.audio.input.noise_reduction), 'transcription=', JSON.stringify(e.session.audio.input.transcription));
  if (e.type === 'conversation.item.added' || e.type === 'conversation.item.created') console.log('item ok', e.item.role, e.item.content?.[0]?.type);
  if (e.type === 'response.output_text.done' || e.type === 'response.output_audio_transcript.done') { console.log('REPLY:', e.text ?? e.transcript); ws.close(); }
};
ws.onopen = () => {
  send({ type: 'session.update', session: { type: 'realtime', instructions: 'You are a test. Answer in one short sentence.', audio: { input: {
    noise_reduction: { type: 'far_field' },
    transcription: { model: 'gpt-live-transcribe', prompt: 'Egyptian Arabic and English, often mixed in one sentence.' },
    turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true },
  } } } });
  setTimeout(() => {
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'My favourite colour is teal.' }] } });
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Noted, teal.' }] } });
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What colour did I say?' }] } });
    send({ type: 'response.create', response: { output_modalities: ['text'] } });
  }, 1500);
};
setTimeout(() => process.exit(0), 25000);
