// Learn more https://docs.expo.dev/guides/customizing-metro
// Sentry's wrapper around Expo's default: same config, plus the debug ids
// that let crash reports point at real source lines.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// The face recognition models ship inside the app as ordinary assets, loaded
// with require() the same way an image is. Metro only bundles extensions it
// recognises, and .tflite is not one of them by default — without this the
// model is silently left out of the build and the app starts up with no way
// to recognise anything.
config.resolver.assetExts.push('tflite');

module.exports = config;
