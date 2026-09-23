import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { speakText, stopSpeaking } from '../src/speech';
import { rtlIfArabic, transcribeAudio, transcriptionAvailable } from '../src/transcription';
import { VoiceTurn, answerAloud, voiceSessionAvailable } from '../src/voiceSession';
import { colors, fonts } from '../src/theme';

// Talking to Recall.
//
// TWO VERSIONS OF THIS SCREEN, one shape. The real one streams audio both
// ways through gpt-realtime and lets you cut in mid-sentence; it needs WebRTC,
// which is native, so it only exists in an installed build. This is the other
// one: tap, speak, tap, and it answers — recorded, transcribed, thought about
// and spoken in turns.
//
// It is not a stand-in for the sake of having something. The turns are the
// only difference. The instructions, the tools, the refusal to invent and the
// answers themselves are identical, because they come from the same place
// (see voiceSession.ts). Whatever this says now is what the live one will say
// later, just without the pause.

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening… tap when you’re done',
  thinking: 'Thinking…',
  speaking: 'Tap to stop',
};

export default function LiveConversation() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [lookedUp, setLookedUp] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView | null>(null);

  const available = voiceSessionAvailable() && transcriptionAvailable();

  // The orb breathes while it listens and while it talks, so the screen is
  // never ambiguous about whose turn it is.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const active = phase === 'listening' || phase === 'speaking' || phase === 'thinking';
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: phase === 'thinking' ? 700 : 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: phase === 'thinking' ? 700 : 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  // Leaving must silence it. Walking away from a screen that is still talking
  // is the sort of thing that makes an app feel out of control.
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const push = useCallback((turn: VoiceTurn) => {
    setTurns((prev) => [...prev, turn]);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  }, []);

  const startListening = async () => {
    setError(null);
    stopSpeaking();
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access so Recall can hear you.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('listening');
  };

  const finishListening = async () => {
    setPhase('thinking');
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    if (!uri) {
      setPhase('idle');
      return;
    }

    const heard = await transcribeAudio(uri, 'auto');
    if (!heard.ok || !heard.text.trim()) {
      setError('I couldn’t make that out — try again.');
      setPhase('idle');
      return;
    }
    const question = heard.text.trim();
    push({ role: 'user', text: question });

    // History is passed so it can follow "and who else was there?" — a
    // conversation that forgets the previous sentence isn't one.
    const answer = await answerAloud(question, turns);
    if (!answer.ok) {
      setError(answer.error);
      setPhase('idle');
      return;
    }
    setLookedUp(answer.lookedUp);
    push({ role: 'assistant', text: answer.text });

    setPhase('speaking');
    const started = await speakText(answer.text, () => setPhase('idle'));
    if (!started) setPhase('idle');
  };

  const onOrbPress = () => {
    if (!available) return;
    if (phase === 'idle') startListening();
    else if (phase === 'listening') finishListening();
    else if (phase === 'speaking') {
      stopSpeaking();
      setPhase('idle');
    }
  };

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] });

  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={[colors.ink, colors.dark, colors.teal, colors.dark]}
        locations={[0, 0.4, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-down" size={28} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <Text style={styles.headerTitle}>Talk to Recall</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* What was said, newest at the bottom. Kept on screen rather than
            disappearing as it's spoken: half the point of asking about your
            own life is being able to read the answer back. */}
        <ScrollView
          ref={scroller}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptInner}
          showsVerticalScrollIndicator={false}
        >
          {turns.length === 0 && !error && (
            <Text style={styles.hint}>
              {available
                ? 'Ask about anything you’ve recorded. Where you were, who you were with, what you said you’d do.'
                : 'Talking needs an API key with speech access.'}
            </Text>
          )}
          {turns.map((t, i) => (
            <View key={i} style={t.role === 'user' ? styles.userRow : styles.aiRow}>
              <Text
                style={[
                  t.role === 'user' ? styles.userText : styles.aiText,
                  rtlIfArabic(t.text),
                ]}
              >
                {t.text}
              </Text>
            </View>
          ))}
          {/* What it consulted, so an answer can be checked rather than
              believed. This matters more here than anywhere: spoken aloud, a
              guess and a fact sound the same. */}
          {lookedUp.length > 0 && phase !== 'listening' && (
            <Text style={styles.lookedUp}>It {lookedUp.join(', then ')}.</Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>

        <View style={styles.orbArea}>
          <Pressable onPress={onOrbPress} disabled={!available || phase === 'thinking'}>
            <Animated.View
              style={[
                styles.orbGlow,
                { transform: [{ scale }], opacity: available ? glow : 0.1 },
              ]}
            />
            <View style={[styles.orb, !available && styles.orbOff]}>
              <Ionicons
                name={
                  phase === 'listening' ? 'stop'
                  : phase === 'speaking' ? 'volume-high'
                  : phase === 'thinking' ? 'ellipsis-horizontal'
                  : 'mic'
                }
                size={34}
                color={colors.ink}
              />
            </View>
          </Pressable>
          <Text style={styles.phase}>
            {available ? PHASE_LABEL[phase] : 'Unavailable'}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const ORB = 96;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.white },
  transcript: { flex: 1 },
  transcriptInner: { paddingHorizontal: 22, paddingBottom: 20, gap: 14 },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 40,
    textAlign: 'center',
  },
  userRow: { alignSelf: 'flex-end', maxWidth: '85%' },
  userText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    overflow: 'hidden',
  },
  aiRow: { alignSelf: 'flex-start', maxWidth: '95%' },
  aiText: {
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 26,
    color: 'rgba(255,255,255,0.95)',
  },
  lookedUp: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.45)',
    fontStyle: 'italic',
  },
  error: { fontFamily: fonts.regular, fontSize: 14, color: '#FFB4A8' },
  orbArea: { alignItems: 'center', paddingBottom: 18, gap: 14 },
  orbGlow: {
    position: 'absolute',
    top: -14,
    left: -14,
    width: ORB + 28,
    height: ORB + 28,
    borderRadius: (ORB + 28) / 2,
    backgroundColor: colors.accent,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbOff: { backgroundColor: 'rgba(255,255,255,0.25)' },
  phase: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
});
