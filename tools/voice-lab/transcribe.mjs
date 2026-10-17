// How well the live transcriber writes down Egyptian, English and mixed
// speech, under different hints. Scored against the words recorded.
//   node transcribe.mjs
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_(APP_TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const A = new URL('./audio/', import.meta.url);
const CLIPS = {
  'help.pcm': 'تقدري تساعديني إزاي؟', 'q1.pcm': 'ممكن تقوليلي أنا كنت فين امبارح بالليل؟', 'q2.pcm': 'هو الـ meeting بتاع الشغل كان امتى الأسبوع ده؟',
  'q3.pcm': 'إنتي فاكرة الواد اللي اسمه كريم؟', 'mix.pcm': 'كنت عايز أعرف أنا روحت ال gym كام مرة الشهر ده؟', 'eg1.pcm': 'هو أنا كنت فين يوم الجمعة اللي فات؟',
  'en.pcm': 'Wait so what was the name of the restaurant that we went to with Sara, like, last week?', 'fr.pcm': 'C était quand la dernière fois que je suis allé à la salle de sport ?',
  'start.pcm': 'بص أنا عايز أظبط الموضوع ده بس مش عارف أبدأ منين',
};
const VARIANTS = {
  'no hint': {},
  'current hint': { prompt: 'Often Egyptian Arabic and English mixed in one sentence; any other language is possible.' },
  'Arabic-script hint': { prompt: 'The speaker is usually Egyptian and speaks Egyptian Arabic, written in Arabic script, with some English words such as gym, meeting or project written in English. They may also speak English or another language.' },
};
const norm = (s) => s.toLowerCase().replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ال\s+/g, 'ال').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
function cer(a, b) { a = norm(a); b = norm(b); const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] / Math.max(1, a.length); }
async function run(name, transcription) {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const key = (await r.json()).value;
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
  const send = (o) => ws.send(JSON.stringify(o));
  const got = []; let wait = null;
  ws.onmessage = (m) => { const e = JSON.parse(m.data); if (e.type === 'conversation.item.input_audio_transcription.completed') { got.push(e.transcript); wait?.(); } if (e.type === 'error') console.log('ERR', e.error.message); };
  await new Promise((s) => (ws.onopen = s));
  send({ type: 'session.update', session: { type: 'realtime', output_modalities: ['text'], audio: { input: { noise_reduction: { type: 'far_field' }, transcription: { model: 'gpt-live-transcribe', ...transcription }, turn_detection: null } } } });
  await new Promise((s) => setTimeout(s, 600));
  let total = 0; const lines = [];
  for (const [f, truth] of Object.entries(CLIPS)) {
    const pcm = fs.readFileSync(new URL(f, A));
    send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
    const done = new Promise((s) => (wait = s)); send({ type: 'input_audio_buffer.commit' });
    await Promise.race([done, new Promise((s) => setTimeout(s, 15000))]);
    const t = got[got.length - 1] ?? ''; const e = cer(truth, t); total += e; lines.push(`   ${(e * 100).toFixed(0).padStart(3)}%  ${t}`);
  }
  console.log(`\n${name}: average error ${(total / Object.keys(CLIPS).length * 100).toFixed(1)}%`); lines.forEach((l) => console.log(l)); ws.close();
}
for (const [n, v] of Object.entries(VARIANTS)) await run(n, v);
process.exit(0);
