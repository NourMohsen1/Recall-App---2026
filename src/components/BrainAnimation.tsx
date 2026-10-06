import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Asset } from 'expo-asset';
import { WebView } from 'react-native-webview';

// The "inside the brain" scene for live voice: Nour's animation, a
// self-contained web page (three.js and the brain model inside it), shown
// in a WebView behind the conversation. It loads once when the screen
// opens — the model is large and its shaders compile up front — and the
// screen then just plays and pauses it.
//
// The page's own captions and buttons are hidden in the app's copy
// (assets/animations/brain.html); the app draws its words over it.
//
// Brain model: "Human Brain" by agher08 (Sketchfab), CC BY 4.0 — credited
// in Profile.

const PAGE = require('../../assets/animations/brain.html');

export default function BrainAnimation({ playing, style }: { playing: boolean; style?: StyleProp<ViewStyle> }) {
  const [uri, setUri] = useState<string | null>(null);
  const web = useRef<WebView>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Asset.fromModule(PAGE)
      .downloadAsync()
      .then((a) => setUri(a.localUri ?? a.uri))
      .catch((e) => console.warn('[brain] could not load the animation:', e));
  }, []);

  // Fade in once the page has drawn, so there's no white flash.
  useEffect(() => {
    if (!ready) return;
    Animated.timing(shown, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [ready, shown]);

  useEffect(() => {
    if (!ready) return;
    web.current?.injectJavaScript(`window.recallSetPlaying && window.recallSetPlaying(${playing}); true;`);
  }, [playing, ready]);

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
            bounces={false}
            style={styles.web}
            onLoadEnd={() => {
              console.log('[brain] animation loaded');
              // Give the page a moment to build the scene before showing it.
              setTimeout(() => setReady(true), 900);
            }}
            onError={(e) => console.warn('[brain] animation failed:', e.nativeEvent.description)}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#021416', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#021416' },
});
