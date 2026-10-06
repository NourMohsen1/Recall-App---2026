import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Asset } from 'expo-asset';
import { WebView } from 'react-native-webview';

// The ear that listens while the user logs: Nour's animation, a
// self-contained web page (three.js and the ear model inside it — built by
// tools/ear-animation/build.sh), shown in a WebView behind the screen.
//
// It follows the real input rather than playing a loop: the voice screen
// sends the microphone's level, the typing screen sends each character
// typed (Arabic too), and both say when something is saved — the phrase
// condenses into a bead and slips into the ear. Before that, it rests.
//
// Ear model: "Human Ear Model" by ssavish274 (Sketchfab), CC BY 4.0 —
// credited in Profile.

const PAGE = require('../../assets/animations/ear.html');

export type EarHandle = {
  /** One or more characters just typed. */
  key: (chars: string) => void;
  /** Something was saved: the bead goes into the ear (about a second). */
  saved: () => void;
};

type Props = {
  mode: 'voice' | 'type';
  /** Listening (recording, or the keyboard is up) — at rest otherwise. */
  active: boolean;
  /** Voice loudness, 0–1. Send it as it changes, ~10 times a second. */
  level?: number;
  style?: StyleProp<ViewStyle>;
};

const EarAnimation = forwardRef<EarHandle, Props>(function EarAnimation({ mode, active, level, style }, ref) {
  const [uri, setUri] = useState<string | null>(null);
  const web = useRef<WebView>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);

  const run = (js: string) => web.current?.injectJavaScript(`window.recallEar && (${js}); true;`);

  useImperativeHandle(ref, () => ({
    key: (chars) => run(`recallEar.key(${JSON.stringify(chars)})`),
    saved: () => run('recallEar.saved()'),
  }));

  useEffect(() => {
    Asset.fromModule(PAGE)
      .downloadAsync()
      .then((a) => setUri(a.localUri ?? a.uri))
      .catch((e) => console.warn('[ear] could not load the animation:', e));
  }, []);

  // Fade in once the page has drawn its first frame, so there's no flash.
  useEffect(() => {
    if (!ready) return;
    Animated.timing(shown, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [ready, shown]);

  useEffect(() => {
    if (ready) run(`recallEar.setMode('${mode}')`);
  }, [mode, ready]);

  useEffect(() => {
    if (ready) run(`recallEar.setActive(${active})`);
  }, [active, ready]);

  useEffect(() => {
    if (ready && level !== undefined) run(`recallEar.level(${level.toFixed(3)})`);
  }, [level, ready]);

  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
      {uri && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
          <WebView
            ref={web}
            source={{ uri }}
            originWhitelist={['*']}
            allowFileAccess
            allowingReadAccessToURL={uri.replace(/[^/]*$/, '')}
            javaScriptEnabled
            scrollEnabled={false}
            contentInsetAdjustmentBehavior="never"
            bounces={false}
            style={styles.web}
            onMessage={(e) => {
              if (e.nativeEvent.data === 'ready') {
                console.log('[ear] animation ready');
                setReady(true);
              }
            }}
            onError={(e) => console.warn('[ear] animation failed:', e.nativeEvent.description)}
          />
        </Animated.View>
      )}
    </View>
  );
});

export default EarAnimation;

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#021416', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#021416' },
});
