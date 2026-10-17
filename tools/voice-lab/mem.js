// A test phone's storage: seeded from seed.json, kept in memory.
const m = new Map(Object.entries(JSON.parse(require('fs').readFileSync(process.env.VOICE_LAB_SEED, 'utf8'))));
const s = {
  getItem: async (k) => (m.has(k) ? m.get(k) : null),
  setItem: async (k, v) => { m.set(k, v); },
  removeItem: async (k) => { m.delete(k); },
  multiGet: async (ks) => ks.map((x) => [x, m.get(x) ?? null]),
  multiSet: async (p) => p.forEach(([k, v]) => m.set(k, v)),
  multiRemove: async (ks) => ks.forEach((k) => m.delete(k)),
  getAllKeys: async () => [...m.keys()],
};
// Optional: write the storage out at exit, to start a later run from it
// (a closed and reopened app).
if (process.env.VOICE_LAB_SAVE_TO) process.on('exit', () => require('fs').writeFileSync(process.env.VOICE_LAB_SAVE_TO, JSON.stringify(Object.fromEntries(m))));
module.exports = s;
module.exports.default = s;
