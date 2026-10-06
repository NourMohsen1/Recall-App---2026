#!/bin/sh
# Assembles preview.html from page.html + scene.js + ear-mesh.b64, with
# three.js loaded from the CDN — for editing the animation (refresh to see
# a change). Not what ships: build.sh bundles three.js in for the app.
#   sh tools/ear-animation/preview.sh
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
page = open('page.html', encoding='utf-8').read()
page = page.replace('@@MESH@@', open('ear-mesh.b64', encoding='utf-8').read().strip())
page = page.replace('@@SCENE@@', open('scene.js', encoding='utf-8').read())
open('preview.html', 'w', encoding='utf-8').write(page)
print('preview.html ready')
PY
