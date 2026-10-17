import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^EXPO_PUBLIC_RECALL_(API_URL|APP_TOKEN)=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const base = env.EXPO_PUBLIC_RECALL_API_URL || 'https://recall-keys.nourmohsen-recall.workers.dev';
const parts = JSON.parse(process.argv[2]); const out = process.argv[3];
const bufs = [];
for (const p of parts) {
  if (typeof p === 'number') { bufs.push(Buffer.alloc(Math.round(24000 * p) * 2)); continue; }
  const r = await fetch(base + '/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${env.EXPO_PUBLIC_RECALL_APP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'ash', input: p, response_format: 'pcm', instructions: process.env.TTS_STYLE || 'Speak casual Egyptian Arabic like a young man from Cairo, relaxed, thinking aloud.' }) });
  if (!r.ok) { console.log('tts failed', r.status, await r.text()); process.exit(1); }
  let b = Buffer.from(await r.arrayBuffer());
  // Trim the generator's own silence, so the pauses are only the ones asked for.
  const v = new Int16Array(b.buffer, b.byteOffset, b.length / 2); const loud = (i) => Math.abs(v[i]) > 600;
  let a = 0; while (a < v.length && !loud(a)) a++; let z = v.length - 1; while (z > a && !loud(z)) z--;
  bufs.push(b.subarray(Math.max(0, a - 1200) * 2, Math.min(v.length, z + 1200) * 2));
}
const all = Buffer.concat(bufs); fs.writeFileSync(out, all); console.log(out, (all.length / 48000).toFixed(2) + 's');
