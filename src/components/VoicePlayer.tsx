import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TranscriptWord } from '../memoryLog';
import { rtlIfArabic } from '../transcription';
import { colors, fonts } from '../theme';

function formatTime(seconds: number) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

type Props = {
  playing: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  words?: TranscriptWord[];
  text?: string;
  note?: string;
  /** 'dark' = light text for dark backgrounds (recording screen).
   *  'light' = dark text for white backgrounds (Source page). */
  variant?: 'dark' | 'light';
};

export default function VoicePlayer({
  playing,
  currentTime,
  duration,
  onToggle,
  onSeek,
  words,
  text,
  note,
  variant = 'light',
}: Props) {
  const dark = variant === 'dark';
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragFrac, setDragFrac] = useState<number | null>(null);

  // Animated bars give the player a sense of life while something is
  // actually being said, instead of a static waveform image.
  const bars = useRef(Array.from({ length: 18 }, () => new Animated.Value(0.3))).current;
  useEffect(() => {
    if (!playing) {
      bars.forEach((b) => b.stopAnimation());
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, {
            toValue: 0.4 + Math.random() * 0.6,
            duration: 220 + (i % 4) * 35,
            useNativeDriver: false,
          }),
          Animated.timing(b, {
            toValue: 0.2 + Math.random() * 0.3,
            duration: 220 + (i % 4) * 35,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    Animated.stagger(25, loops).start();
    return () => loops.forEach((l) => l.stop());
  }, [playing]);

  const frac = dragFrac ?? (duration > 0 ? currentTime / duration : 0);
  const displayTime = dragFrac != null ? dragFrac * duration : currentTime;

  const seekFromTouchX = (x: number) => {
    if (trackWidth <= 0) return;
    setDragFrac(Math.min(1, Math.max(0, x / trackWidth)));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekFromTouchX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => seekFromTouchX(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        setDragFrac((f) => {
          if (f != null && duration > 0) onSeek(f * duration);
          return null;
        });
      },
    }),
  ).current;

  const activeWordIndex =
    words && words.length > 0
      ? words.findIndex((w) => currentTime >= w.start && currentTime < w.end)
      : -1;

  return (
    <View style={styles.wrap}>
      {/* Transcript — highlights the word being spoken right now */}
      <View style={[styles.transcriptBox, dark ? styles.transcriptBoxDark : styles.transcriptBoxLight]}>
        {words && words.length > 0 ? (
          <Text style={[styles.transcriptLine, rtlIfArabic(text)]}>
            {words.map((w, i) => (
              <Text
                key={i}
                style={[
                  dark ? styles.wordDark : styles.wordLight,
                  i === activeWordIndex && styles.wordActive,
                ]}
              >
                {w.word}{' '}
              </Text>
            ))}
          </Text>
        ) : text ? (
          <Text style={[styles.transcriptLine, dark ? styles.wordDark : styles.wordLight, rtlIfArabic(text)]}>
            {text}
          </Text>
        ) : (
          <Text style={[styles.hint, dark && styles.hintDark]}>No transcript available.</Text>
        )}
        {!!note && (
          <Text style={[styles.note, dark && styles.noteDark, rtlIfArabic(note)]}>📝 {note}</Text>
        )}
      </View>

      {/* Live waveform */}
      <View style={styles.barsRow}>
        {bars.map((b, i) => (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              dark ? styles.barDark : styles.barLight,
              {
                height: b.interpolate({ inputRange: [0, 1], outputRange: [6, 34] }),
                opacity: playing ? 1 : 0.35,
              },
            ]}
          />
        ))}
      </View>

      {/* Scrub bar — drag anywhere to seek */}
      <View style={styles.track} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)} {...panResponder.panHandlers}>
        <View style={[styles.trackBg, dark ? styles.trackBgDark : styles.trackBgLight]} />
        <View style={[styles.trackFill, { width: `${frac * 100}%` }]} />
        <View style={[styles.knob, { left: `${Math.max(0, frac * 100 - 3)}%` }]} />
      </View>

      <View style={styles.timeRow}>
        <Text style={[styles.timeText, dark && styles.timeTextDark]}>{formatTime(displayTime)}</Text>
        <Text style={[styles.timeText, dark && styles.timeTextDark]}>{formatTime(duration)}</Text>
      </View>

      <Pressable style={styles.playBtn} onPress={onToggle}>
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={28}
          color={colors.white}
          style={{ marginLeft: playing ? 0 : 3 }}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },

  transcriptBox: {
    alignSelf: 'stretch',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  transcriptBoxDark: {
    borderWidth: 1.5,
    borderColor: 'rgba(99,188,198,0.5)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  transcriptBoxLight: {
    borderWidth: 1,
    borderColor: '#BFC9CA',
    backgroundColor: colors.white,
  },
  transcriptLine: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 24 },
  wordDark: { color: 'rgba(255,255,255,0.75)' },
  wordLight: { color: colors.teal },
  wordActive: { color: colors.accent, fontFamily: fonts.semiBold },
  hint: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394', textAlign: 'center' },
  hintDark: { color: 'rgba(255,255,255,0.6)' },
  note: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: '#5B6364',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E8E8',
  },
  noteDark: { color: 'rgba(255,255,255,0.7)', borderTopColor: 'rgba(255,255,255,0.15)' },

  barsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, marginBottom: 16 },
  bar: { width: 4, borderRadius: 2 },
  barDark: { backgroundColor: colors.accent },
  barLight: { backgroundColor: colors.primary },

  track: { alignSelf: 'stretch', height: 24, justifyContent: 'center' },
  trackBg: { height: 6, borderRadius: 3, position: 'absolute', left: 0, right: 0 },
  trackBgDark: { backgroundColor: 'rgba(255,255,255,0.2)' },
  trackBgLight: { backgroundColor: '#DCE6E7' },
  trackFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    position: 'absolute',
    left: 0,
  },
  knob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
  },

  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 8 },
  timeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
  timeTextDark: { color: 'rgba(255,255,255,0.7)' },

  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
});
