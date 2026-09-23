// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The face recognition models ship inside the app as ordinary assets, loaded
// with require() the same way an image is. Metro only bundles extensions it
// recognises, and .tflite is not one of them by default — without this the
// model is silently left out of the build and the app starts up with no way
// to recognise anything.
config.resolver.assetExts.push('tflite');

module.exports = config;
