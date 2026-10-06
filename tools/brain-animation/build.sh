#!/bin/sh
# Rebuilds assets/animations/brain.html from scene.js: bundles three.js in
# (no internet needed at run time) and puts it into the page.
#   sh tools/brain-animation/build.sh
set -e
cd "$(dirname "$0")"
[ -d node_modules/three ] || npm i --no-save three@0.160.0 esbuild@0.24 >/dev/null
npx esbuild scene.js --bundle --format=esm --minify --target=safari15 --outfile=scene.bundle.js --log-level=warning
python3 - <<'PY'
s = open('../../assets/animations/brain.html', encoding='utf-8').read()
b = open('scene.bundle.js', encoding='utf-8').read()
assert '</script' not in b.lower()
i = s.index('<script type="module">') + len('<script type="module">')
j = s.index('</script>', i)
open('../../assets/animations/brain.html', 'w', encoding='utf-8').write(s[:i] + '\n' + b + '\n' + s[j:])
print('brain.html rebuilt')
PY
rm -f scene.bundle.js
