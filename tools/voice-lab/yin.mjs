// Median pitch of saved voice samples, by YIN (de Cheveigné & Kawahara).
import fs from 'fs';
function yin(s, SR = 24000, W = 1200) {
  const out = [];
  for (let i = 0; i + 2 * W < s.length; i += W / 2) {
    let e = 0; for (let j = 0; j < W; j++) e += s[i + j] ** 2; if (Math.sqrt(e / W) < 1200) continue;
    const d = new Float64Array(W); for (let t = 1; t < W; t++) { let x = 0; for (let j = 0; j < W; j++) { const v = s[i + j] - s[i + j + t]; x += v * v; } d[t] = x; }
    let run = 0; const c = new Float64Array(W); c[0] = 1; for (let t = 1; t < W; t++) { run += d[t]; c[t] = d[t] * t / (run || 1); }
    const lo = Math.floor(SR / 400), hi = Math.floor(SR / 65);
    for (let t = lo; t < hi; t++) if (c[t] < 0.15) { while (t + 1 < hi && c[t + 1] < c[t]) t++; out.push(SR / t); break; }
  }
  out.sort((a, b) => a - b); return out.length ? Math.round(out[Math.floor(out.length / 2)]) : 0;
}
const by = {};
for (const f of fs.readdirSync(new URL('./audio/', import.meta.url))) {
  const m = f.match(/^voice-(\w+)-\d\.pcm$/); if (!m) continue;
  const b = fs.readFileSync(new URL('./audio/' + f, import.meta.url)); (by[m[1]] ??= []).push(yin(new Int16Array(b.buffer, b.byteOffset, b.length / 2)));
}
for (const [v, ps] of Object.entries(by)) { ps.sort((a, b) => a - b); console.log(v.padEnd(8), ps.join(' '), '→ median', ps[Math.floor(ps.length / 2)], 'Hz'); }
