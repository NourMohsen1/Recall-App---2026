// Stand-in for phone-only modules in Node tests: anything asked for exists and does nothing.
const NAMES = ['default', 'Platform', 'Appearance', 'StyleSheet', 'Dimensions', 'NativeModules', 'AppState', 'Image', 'Alert', 'Linking',
  'expoConfig', 'RTCPeerConnection', 'RTCSessionDescription', 'mediaDevices', 'setAudioModeAsync', 'File', 'Paths', 'Directory'];
// Bound: constructible, with no 'prototype', 'arguments' or 'caller' to trip Proxy rules.
const target = function () {}.bind(null);
const special = { __esModule: true, OS: 'ios', select: (o) => o.ios ?? o.default, then: undefined, expoConfig: {} };
const handler = {
  get(t, k) {
    if (k in special) return special[k];
    if (k === Symbol.toPrimitive) return () => '';
    return proxy;
  },
  apply() { return proxy; },
  construct() { return proxy; },
  ownKeys() { return NAMES; },
  getOwnPropertyDescriptor(t, k) {
    return { configurable: true, enumerable: true, value: handler.get(t, k) };
  },
};
const proxy = new Proxy(target, handler);
module.exports = proxy;
