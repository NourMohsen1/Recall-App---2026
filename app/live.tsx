import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { rtlIfArabic } from '../src/transcription';
import type { VoiceTurn } from '../src/voiceSession';
import { newSessionId, saveSession, type ChatMessage } from '../src/chatSessions';
import { liveVoiceAvailable, startLiveVoice, type LiveSession } from '../src/realtimeVoice';
import { colors, fonts } from '../src/theme';
import BrainAnimation from '../src/components/BrainAnimation';
import { useLightStatusBar } from '../src/statusBar';

// Talking to Recall, live.
//
// Audio goes both ways at once. The model hears the user while it is still
// speaking, so it can be cut off mid-sentence, and it starts answering
// before the question has finished — which is the whole difference between
// a conversation and a walkie-talkie.
//
// The brain is not new. Same instructions, same six tools, same refusal to
// invent, all from realtimeTools.ts. This screen used to run that brain in
// turns: record, transcribe, think, speak. Now the model runs the loop
// itself and this screen only shows what is happening.
//
// WHAT IS SHOWN AND WHY. The transcript is not decoration. Mishearing is
// the commonest reason a spoken answer is wrong, and out loud there is no
// way to tell a misheard question from a bad answer — so both sides of the
// conversation are written down as they happen.

// 'opening' covers minting a key, asking for the microphone and connecting.
// It is deliberately one state: from the user's side it is all "starting".
type Phase = 'idle' | 'opening' | 'listening' | 'thinking' | 'speaking';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  opening: 'Connecting…',
  listening: 'Listening — just talk',
  thinking: 'Looking something up…',
  speaking: 'Tap to cut in',
};

export default function LiveConversation() {
  // Dark teal screen: white top bar while it shows (src/statusBar.ts).
  useLightStatusBar();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useRef<LiveSession | null>(null);
  // Where this conversation is being written down. Made when it starts, so
  // every turn is saved as it happens rather than at the end — a spoken
  // conversation that is only saved on a tidy exit is one that vanishes
  // whenever the app is closed mid-sentence, which is most of the time.
  const sessionId = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [lookedUp, setLookedUp] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView | null>(null);

  const available = liveVoiceAvailable();
  // The latest exchange only: what was just said, and the answer to it.
  const lastUser = turns.map((t) => t.role).lastIndexOf('user');
  const recent = lastUser >= 0 ? turns.slice(lastUser) : turns.slice(-1);

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

  // Leaving must hang up. Walking away from a screen that is still
  // listening — and still being charged by the minute — is the sort of
  // thing that makes an app feel out of control.
  useEffect(() => {
    return () => {
      session.current?.end();
      session.current = null;
    };
  }, []);

  const push = useCallback((turn: VoiceTurn) => {
    setTurns((prev) => [...prev, turn]);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  }, []);

  // Saved into the same history as typed conversations, marked as spoken.
  // One place to look for "what did I ask Recall", whichever way it was
  // asked — two histories would mean remembering which one a conversation
  // happened in, which is exactly the sort of thing this app exists to
  // stop people having to do.
  useEffect(() => {
    const id = sessionId.current;
    if (!id || turns.length === 0) return;
    const messages: ChatMessage[] = turns.map((t) => ({
      role: t.role === 'assistant' ? 'ai' : 'user',
      text: t.text,
      spoken: true,
    }));
    void saveSession(id, messages);
  }, [turns]);

  // Start talking. Everything after this is driven by events from the
  // model rather than by taps: it decides when the user has finished
  // speaking, and it can be interrupted by them starting again.
  const start = async () => {
    setError(null);
    setPhase('opening');
    // A new thread each time the orb is tapped from idle. Picking up where
    // a previous conversation left off is a different feature; this one
    // just has to not lose anything.
    sessionId.current = newSessionId();
    try {
      session.current = await startLiveVoice((e) => {
        switch (e.type) {
          case 'connecting':
            setPhase('opening');
            break;
          case 'listening':
            setPhase('listening');
            break;
          case 'thinking':
            setPhase('thinking');
            break;
          case 'speaking':
            setPhase('speaking');
            break;
          case 'said':
            push({ role: e.role, text: e.text });
            break;
          case 'looked-up':
            // What it consulted, shown as it happens. Not decoration: it is
            // the difference between an answer the user can check and one
            // they have to take on faith.
            setLookedUp((prev) => (prev.includes(e.label) ? prev : [...prev, e.label]));
            break;
          case 'ended':
            session.current = null;
            setPhase('idle');
            if (e.reason === 'time') {
              setError('That conversation reached ten minutes. Tap to start another.');
            } else if (e.reason === 'error') {
              setError(e.detail ?? 'The conversation dropped.');
            }
            break;
        }
      });
    } catch (e) {
      session.current = null;
      setPhase('idle');
      setError(
        e instanceof Error ? e.message : 'Could not start the conversation.',
      );
    }
  };

  const stop = () => {
    session.current?.end();
    session.current = null;
    setPhase('idle');
  };

  const onOrbPress = () => {
    if (!available) return;
    if (phase === 'idle') {
      start();
    } else if (phase === 'speaking') {
      // Cut it off without hanging up — the same thing as talking over it,
      // for when the user would rather not.
      session.current?.interrupt();
      setPhase('listening');
    } else {
      stop();
    }
  };

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] });

  return (
    <View style={styles.fill}>
      {/* Inside the brain: it plays while the conversation is on, and
          holds still when it isn't. */}
      <BrainAnimation playing={phase !== 'idle'} style={StyleSheet.absoluteFill} />
      {/* Darkens toward the bottom so the words and the orb stay readable. */}
      <LinearGradient
        colors={['rgba(2,20,22,0.55)', 'rgba(2,20,22,0)', 'rgba(2,20,22,0.25)', 'rgba(2,20,22,0.9)']}
        locations={[0, 0.22, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              // Hanging up is the point: leaving must not leave a live
              // microphone open behind the screen.
              stop();
              router.back();
            }}
            hitSlop={16}
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={28} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Talk to Recall</Text>
        </View>

        {/* The brain has the screen; the words sit just above the mic as
            captions — only the latest exchange, on a dark glass panel so
            they read over the animation. The whole conversation is still
            saved, and is in Ask's history. */}
        <View style={{ flex: 1 }} />
        {(recent.length > 0 || error || (lookedUp.length > 0 && phase !== 'listening')) && (
          <View style={styles.captions}>
            <ScrollView
              ref={scroller}
              style={styles.captionsScroll}
              contentContainerStyle={styles.transcriptInner}
              showsVerticalScrollIndicator={false}
            >
              {recent.map((t, i) => (
                <Text
                  key={`${turns.length}-${i}`}
                  style={[t.role === 'user' ? styles.userText : styles.aiText, rtlIfArabic(t.text)]}
                >
                  {t.text}
                </Text>
              ))}
              {/* What it consulted, so an answer can be checked rather than
                  believed — spoken aloud, a guess and a fact sound the same. */}
              {lookedUp.length > 0 && phase !== 'listening' && (
                <Text style={styles.lookedUp}>It {lookedUp.join(', then ')}.</Text>
              )}
              {error && <Text style={styles.error}>{error}</Text>}
            </ScrollView>
          </View>
        )}

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
            {available ? PHASE_LABEL[phase] : 'Recall’s AI is off. Turn it on in Profile → Recall’s AI.'}
          </Text>
          {/* Said once, at the start, because a conversation that ends
              without warning reads as a fault rather than a limit. */}
          {phase === 'listening' && turns.length === 0 && (
            <Text style={styles.limitHint}>Up to ten minutes. Talk over it any time.</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const ORB = 96;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  limitHint: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
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
  captions: {
    marginHorizontal: 16,
    marginBottom: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(2,20,22,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(111,245,230,0.14)',
    overflow: 'hidden',
  },
  captionsScroll: { maxHeight: 200 },
  transcriptInner: { paddingHorizontal: 18, paddingVertical: 14, gap: 10 },
  userText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.6)' },
  aiText: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 25, color: colors.white },
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
