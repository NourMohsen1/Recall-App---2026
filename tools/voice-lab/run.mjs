// Runs a test against the app's own code: bundles it with Recall's src/
// (phone-only parts stubbed, storage from seed.json), runs it, deletes the
// bundle (it holds the app token from .env).
//   node tools/voice-lab/run.mjs rtlive s1.json
import * as esbuild from '../brain-animation/node_modules/esbuild/lib/main.js';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
const LAB = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const env = Object.fromEntries(fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => /^EXPO_PUBLIC_RECALL_/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [, , entry, scenario, seed] = process.argv;
const out = `${LAB}/out-${entry}.js`;
await esbuild.build({
  entryPoints: [`${LAB}/${entry}.ts`], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
  define: { __DEV__: 'true', ...Object.fromEntries(Object.entries(env).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)])) },
  loader: { '.png': 'empty', '.jpg': 'empty', '.html': 'empty' },
  plugins: [{ name: 'lab', setup(b) {
    b.onResolve({ filter: /^@app\// }, (a) => ({ path: `${SRC}/${a.path.slice(5)}.ts` }));
    b.onResolve({ filter: /^@react-native-async-storage/ }, () => ({ path: `${LAB}/mem.js` }));
    b.onResolve({ filter: /^fs$/ }, () => ({ path: 'fs', external: true }));
    b.onResolve({ filter: /(modules\/|\.tflite$)/ }, () => ({ path: `${LAB}/stub.js` }));
    b.onResolve({ filter: /^[^./]/ }, () => ({ path: `${LAB}/stub.js` }));
  } }],
});
try {
  execFileSync('node', [out], { stdio: 'inherit', env: { ...process.env, VOICE_LAB_DIR: LAB, VOICE_LAB_SEED: `${LAB}/${seed || 'seed.json'}`, SCENARIO: scenario ?? '' } });
} finally {
  fs.rmSync(out, { force: true });
}
