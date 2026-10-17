#!/bin/zsh
# Puts the current JS into the simulator's installed Recall (a release copy),
# to check screens without a rebuild. Back up the original first:
#   cp "$(xcrun simctl get_app_container booted com.nourwalid.recall app)/main.jsbundle" <somewhere>
# Usage: tools/sim-bundle.sh <work dir>
set -e
W=${1:?work dir}
mkdir -p $W
cd "$(dirname $0)/.."
npx expo export:embed --platform ios --dev false --minify true --entry-file node_modules/expo-router/entry.js \
  --bundle-output $W/main.jsbundle --assets-dest $W/assets >/dev/null
node_modules/hermes-compiler/hermesc/osx-bin/hermesc -emit-binary -O -out $W/main.hbc $W/main.jsbundle -w
A=$(xcrun simctl get_app_container booted com.nourwalid.recall app)
xcrun simctl terminate booted com.nourwalid.recall || true
cp $W/main.hbc "$A/main.jsbundle"
xcrun simctl launch booted com.nourwalid.recall >/dev/null
sleep 25
echo installed
