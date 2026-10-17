import fs from 'fs';
const pcm = fs.readFileSync(process.argv[2]); const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
const W = 480; let run = 0, start = 0, out = [];
for (let i = 0; i < s.length; i += W) { let e = 0; for (let j = i; j < i + W && j < s.length; j++) e += s[j] * s[j]; const rms = Math.sqrt(e / W);
  if (rms < 300) { if (!run) start = i; run += W; } else { if (run > 24000 * 0.25) out.push(`${(start / 24000).toFixed(1)}s +${(run / 24000).toFixed(2)}`); run = 0; } }
console.log(process.argv[2], 'speech ends', out.join(' | '), '| tail', (run / 24000).toFixed(2));
