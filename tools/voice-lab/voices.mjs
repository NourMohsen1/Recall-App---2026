// Every realtime voice saying the same Egyptian, mixed and English lines.
// Clarity: the audio is transcribed back and compared with what the voice
// meant to say. Pitch: the median of its voiced frames (most men speak
// around 85–155 Hz, most women around 165–255 Hz).
//   node voices.mjs
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_APP_TOKEN=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const TOKEN = env.EXPO_PUBLIC_RECALL_APP_TOKEN;
const VOICES = (process.env.VOICES || 'marin,cedar,alloy,ash,ballad,coral,echo,sage,shimmer,verse').split(',');
const LINES = [
  'آه، ده كان يوم التلات اللي فات. روحت الجيم مع عمر الصبح، وبعدين اتغديتوا في التحرير.',
  'مش لاقي حاجة عن كده، بس ممكن تكون مكتوبة باسم المكان. فاكر اسمه؟',
  'استنى أشوف… أيوه، آخر مرة كانت من حوالي أسبوعين، يوم الخميس بالليل.',
  'You met Sara and Nour on Tuesday, and you had lunch together in Tahrir.',
];
const norm = (s) => s.toLowerCase().replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
function cer(a, b) { a = norm(a); b = norm(b); const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] / Math.max(1, a.length); }
function pitch(pcm) {
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2); const SR = 24000, W = 1024, out = [];
  for (let i = 0; i + W < s.length; i += W) {
    let e = 0; for (let j = 0; j < W; j++) e += s[i + j] * s[i + j]; if (Math.sqrt(e / W) < 1500) continue;
    let best = 0, lag = 0; for (let L = Math.floor(SR / 400); L < SR / 70; L++) { let c = 0, n1 = 0, n2 = 0; for (let j = 0; j < W - L; j++) { c += s[i + j] * s[i + j + L]; n1 += s[i + j] ** 2; n2 += s[i + j + L] ** 2; } const r = c / Math.sqrt(n1 * n2 + 1); if (r > best) { best = r; lag = L; } }
    if (best > 0.6) out.push(SR / lag);
  }
  out.sort((a, b) => a - b); return out.length ? out[Math.floor(out.length / 2)] : 0;
}
async function speak(voice, line) {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  const key = (await r.json()).value;
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
  const send = (o) => ws.send(JSON.stringify(o)); const chunks = []; let said = '', t0 = 0, first = 0;
  const done = new Promise((res) => { ws.onmessage = (m) => { const e = JSON.parse(m.data);
    if (e.type === 'response.output_audio.delta') { if (!first) first = Date.now() - t0; chunks.push(Buffer.from(e.delta, 'base64')); }
    if (e.type === 'response.output_audio_transcript.done') said = e.transcript;
    if (e.type === 'response.done') res(); if (e.type === 'error') { console.log('ERR', e.error.message); res(); } }; });
  await new Promise((s) => (ws.onopen = s));
  send({ type: 'session.update', session: { type: 'realtime', audio: { output: { voice } }, instructions: 'You read text aloud. Say exactly the text the user gives you, word for word, in a natural conversational voice (Egyptian Arabic when it is Arabic). Nothing else.' } });
  await new Promise((s) => setTimeout(s, 500));
  send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: line }] } });
  t0 = Date.now(); send({ type: 'response.create' }); await Promise.race([done, new Promise((s) => setTimeout(s, 30000))]); ws.close();
  return { pcm: Buffer.concat(chunks), said, first };
}
async function heard(pcm) {
  // A WAV for the transcription endpoint.
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const form = new FormData(); form.append('model', 'gpt-transcribe'); form.append('file', new Blob([Buffer.concat([h, pcm])], { type: 'audio/wav' }), 'a.wav');
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  return ((await r.json()).text ?? '').trim();
}
for (const v of VOICES) {
  let err = 0, n = 0; const ps = [], firsts = [], worst = [];
  for (const line of LINES) {
    const { pcm, said, first } = await speak(v, line); if (!pcm.length) continue;
    const back = await heard(pcm); const e = cer(said || line, back); err += e; n++; ps.push(pitch(pcm)); firsts.push(first);
    if (e > 0.08) worst.push(`${(e * 100).toFixed(0)}% "${back.slice(0, 70)}"`);
    if (process.env.SAVE) fs.writeFileSync(new URL(`./audio/voice-${v}-${n}.pcm`, import.meta.url), pcm);
  }
  ps.sort((a, b) => a - b);
  console.log(`${v.padEnd(8)} clarity error ${(err / n * 100).toFixed(1).padStart(4)}%   pitch ${Math.round(ps[Math.floor(ps.length / 2)])} Hz   first sound ${Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length)} ms${worst.length ? '\n         ' + worst.join('\n         ') : ''}`);
}
process.exit(0);
