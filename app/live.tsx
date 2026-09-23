import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
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

// 'opening' exists because asking for the microphone is not instant. Without
// it, the first tap looked like nothing had happened, so the natural thing to
// do was tap again — which started a second recording over the first and left
// a fragment too short to transcribe. That was the reported "it said it
// didn't catch that, instantly".
type Phase = 'idle' | 'opening' | 'listening' | 'thinking' | 'speaking';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  opening: 'Opening the mic…',
  listening: 'Listening… tap when you’re done',
  thinking: 'Thinking…',
  speaking: 'Tap to stop',
};

// Anything shorter than this is a tap, not a sentence. Sending it to be
// transcribed spends a call and comes back as an unexplained failure.
const MIN_SPEECH_MS = 700;

export default function LiveConversation() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const insets = useSafeAreaInsets();

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
    const active = phase !== 'idle';
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
    // Set before the first await, so a second tap cannot start a second
    // recording while the first is still being set up.
    setPhase('opening');
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access so Recall can hear you.');
        setPhase('idle');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('listening');
    } catch {
      setError('Could not open the microphone.');
      setPhase('idle');
    }
  };

  const finishListening = async () => {
    const spokenMs = recorderState.durationMillis ?? 0;
    setPhase('thinking');
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    if (!uri) {
      setError('Nothing was recorded — try again.');
      setPhase('idle');
      return;
    }
    if (spokenMs < MIN_SPEECH_MS) {
      setError('I didn’t hear anything. Tap, speak, then tap again when you’re done.');
      setPhase('idle');
      return;
    }

    const heard = await transcribeAudio(uri, 'auto');
    if (!heard.ok) {
      // Each of these is a different problem with a different answer, and
      // collapsing them all into "I couldn't make that out" left the user
      // repeating themselves at a screen that had actually run out of credit.
      setError(
        heard.reason === 'no-key'
          ? 'No API key for speech.'
          : heard.reason === 'no-credits'
            ? 'That OpenAI key is out of credit.'
            : heard.reason === 'rate-limited'
              ? 'Too many requests just now — try again in a moment.'
              : 'The transcription failed. Try again.',
      );
      setPhase('idle');
      return;
    }
    if (!heard.text.trim()) {
      setError('I couldn’t make out any words — try speaking a little longer.');
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
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              stopSpeaking();
              router.back();
            }}
            hitSlop={16}
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={28} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Talk to Recall</Text>
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

        <View style={[styles.orbArea, { paddingBottom: Math.max(insets.bottom, 18) + 8 }]}>
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
  // Same shape as Ask's header, which is the one known to behave on a real
  // phone: a centred title with the back arrow laid over it, rather than a
  // three-way space-between that leans whenever one side is empty.
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
    minHeight: 48,
  },
  back: { position: 'absolute', left: 16, top: 6, padding: 4 },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white },
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
  orbArea: { alignItems: 'center', gap: 14 },
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
