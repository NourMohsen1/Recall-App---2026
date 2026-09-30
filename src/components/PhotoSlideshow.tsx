import { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import PhotoImage from './PhotoImage';

// One photo at a time, fading into the next every few seconds — a glance
// at what a stretch of time looked like. Two layers: the next photo fades
// in over the current one, then becomes it.

const HOLD_MS = 3200;
const FADE_MS = 900;

export default function PhotoSlideshow({ uris, style }: { uris: string[]; style?: StyleProp<ViewStyle> }) {
  const [index, setIndex] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setIndex(0);
    setNext(null);
  }, [uris]);

  useEffect(() => {
    if (uris.length < 2) return;
    const timer = setTimeout(() => {
      const n = (index + 1) % uris.length;
      setNext(n);
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start(() => {
        setIndex(n);
        setNext(null);
      });
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [index, uris, fade]);

  if (uris.length === 0) return <View style={[style, styles.empty]} />;

  return (
    <View style={[style, styles.frame]}>
      <PhotoImage uri={uris[index]} style={StyleSheet.absoluteFill} />
      {next != null && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <PhotoImage uri={uris[next]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  empty: { backgroundColor: '#E7EDEE' },
});
