#!/bin/sh
# Builds assets/animations/ear.html for the app from page.html + scene.js +
# ear-mesh.b64: three.js bundled in (no internet needed at run time), the
# CDN and web-font links dropped, and app mode on (the page shows only the
# scene and follows window.recallEar).
#   sh tools/ear-animation/build.sh
set -e
cd "$(dirname "$0")"
[ -d node_modules/three ] || npm i --no-save three@0.160.0 esbuild@0.24 >/dev/null
npx esbuild scene.js --bundle --format=esm --minify --target=safari15 --outfile=scene.bundle.js --log-level=warning
python3 - <<'PY'
import re
page = open('page.html', encoding='utf-8').read()
bundle = open('scene.bundle.js', encoding='utf-8').read()
assert '</script' not in bundle.lower()
page = re.sub(r'<script type="importmap">.*?</script>\s*', '', page, flags=re.S)
page = re.sub(r'<link [^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*', '', page)
page = page.replace('@@MESH@@', open('ear-mesh.b64', encoding='utf-8').read().strip())
page = page.replace('<script type="module">\n@@SCENE@@\n</script>',
                    '<script>window.RECALL_APP = true;</script>\n<script type="module">\n' + bundle + '\n</script>')
assert '@@' not in page and 'cdn.jsdelivr' not in page
open('../../assets/animations/ear.html', 'w', encoding='utf-8').write(page)
print('ear.html built', len(page) // 1024, 'KB')
PY
rm -f scene.bundle.js
