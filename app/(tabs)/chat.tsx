import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { AskResult, ChatTurn, Reference, askAvailable, askMemory } from '../../src/askAI';
import { MISC, placePhoto } from '../../src/images';
import { avatarTint } from '../../src/peopleTags';
import { speakText, stopSpeaking } from '../../src/speech';
import { rtlIfArabic, transcribeAudio, transcriptionAvailable } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

type Message = {
  role: 'user' | 'ai';
  text: string;
  reference?: Reference | null;
  error?: boolean;
  spoken?: boolean; // asked by voice — shows a small mic mark on the bubble
  // Tap-to-answer replies for the AI's clarifying question ("Yes, that's
  // him") — shown only while this is the latest message.
  suggestions?: string[];
};

function dayOffsetFromIso(iso: string): number {
  const target = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function errorText(reason: Exclude<AskResult, { ok: true }>['reason']) {
  if (reason === 'no-key') {
    return 'Ask isn’t set up yet — add EXPO_PUBLIC_OPENAI_API_KEY to your .env file to turn this on.';
  }
  if (reason === 'no-credits') {
    return 'Your OpenAI account has no credits yet — add a prepaid balance at platform.openai.com → Billing.';
  }
  return 'Something went wrong reaching your memory. Try again in a moment.';
}

function formatTime(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Fades + slides each message up as it lands in the thread.
function MessageAppear({ children }: { children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

// Three dots that actually breathe while the AI is thinking.
function TypingDots() {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  useEffect(() => {
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 340, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 340, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={styles.typingRow}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[styles.typingDot, { opacity: dot }]} />
      ))}
    </View>
  );
}

// Gentle floating loop for the empty-state brain, so the screen feels alive
// before the first question.
function FloatingBrain() {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{
        transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }],
      }}
    >
      <Image source={MISC.brain3d} style={{ width: 280, height: 280 }} resizeMode="contain" />
    </Animated.View>
  );
}

// Mini live waveform inside the input bar while the user speaks their
// question — decorative (expo-audio has no cross-platform metering), but it
// makes "I'm being heard" unmistakable.
function MiniWaveform() {
  const bars = useRef(Array.from({ length: 14 }, () => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.4 + Math.random() * 0.6,
            duration: 240 + (i % 4) * 50,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.15 + Math.random() * 0.3,
            duration: 240 + (i % 4) * 50,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    Animated.stagger(40, loops).start();
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={styles.miniWaveRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.miniWaveBar,
            { height: bar.interpolate({ inputRange: [0, 1], outputRange: [4, 26] }) },
          ]}
        />
      ))}
    </View>
  );
}

// Pulsing red dot marking an active recording.
function RecDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[styles.recDot, { opacity: pulse }]} />;
}

function ReferenceCard({ reference }: { reference: Reference }) {
  const router = useRouter();

  if (reference.type === 'person') {
    const letters = reference.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('');
    return (
      <Pressable
        style={styles.cardRow}
        onPress={() => router.push({ pathname: '/person/[name]', params: { name: reference.name } })}
      >
        <View style={[styles.cardAvatar, styles.cardAvatarIcon, { backgroundColor: avatarTint(reference.name) }]}>
          <Text style={styles.cardAvatarInitials}>{letters}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{reference.name}</Text>
          <Text style={styles.cardBullet}>Tap to view your days together</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.pale} />
      </Pressable>
    );
  }

  if (reference.type === 'place') {
    return (
      <Pressable
        style={styles.cardRow}
        onPress={() => router.push({ pathname: '/place/[name]', params: { name: reference.name } })}
      >
        <Image source={placePhoto(reference.name)} style={styles.cardAvatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{reference.name}</Text>
          <Text style={styles.cardBullet}>Tap to view this place</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.pale} />
      </Pressable>
    );
  }

  const offset = dayOffsetFromIso(reference.date);
  return (
    <Pressable
      style={styles.cardRow}
      onPress={() => router.push(`/day/${offset}` as Parameters<typeof router.push>[0])}
    >
      <View style={[styles.cardAvatar, styles.cardAvatarIcon]}>
        <MaterialCommunityIcons name="calendar-outline" size={22} color={colors.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{reference.label}</Text>
        <Text style={styles.cardBullet}>Tap to view that day</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.pale} />
    </Pressable>
  );
}

type VoiceState = 'idle' | 'recording' | 'transcribing';

export default function Chat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const historyRef = useRef<ChatTurn[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const available = askAvailable();

  // Ask-by-voice: record → Whisper transcript → sent as the question.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const canSpeak = transcriptionAvailable();

  // Which AI answer is being read aloud right now (index into messages).
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);

  // Nothing keeps talking after the user leaves the screen.
  useEffect(() => () => stopSpeaking(), []);

  const speakAnswer = (idx: number, text: string) => {
    setSpeakingIdx(idx);
    speakText(text, () => setSpeakingIdx((cur) => (cur === idx ? null : cur))).then((started) => {
      if (!started) setSpeakingIdx((cur) => (cur === idx ? null : cur));
    });
  };

  const toggleSpeak = (idx: number, text: string) => {
    if (speakingIdx === idx) {
      stopSpeaking();
      setSpeakingIdx(null);
    } else {
      speakAnswer(idx, text);
    }
  };

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (messages.length > 0 || thinking) {
      const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(t);
    }
  }, [messages.length, thinking]);

  // Tapping a quick reply keeps the conversation in whatever mode the user
  // is in — a spoken thread keeps answering out loud.
  const lastQuestionWasSpoken =
    [...messages].reverse().find((m) => m.role === 'user')?.spoken ?? false;

  const ask = async (text: string, spoken = false) => {
    stopSpeaking();
    setSpeakingIdx(null);
    setMessages((prev) => [...prev, { role: 'user', text, spoken }]);
    setThinking(true);

    const result = await askMemory(text, historyRef.current);
    setThinking(false);

    if (result.ok) {
      const userTurn: ChatTurn = { role: 'user', text };
      const aiTurn: ChatTurn = { role: 'assistant', text: result.answer };
      historyRef.current = [...historyRef.current, userTurn, aiTurn].slice(-10);
      // The answer lands right after the question we appended above.
      const aiIdx = messages.length + 1;
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: result.answer,
          reference: result.reference,
          suggestions: result.suggestions,
        },
      ]);
      // Asked out loud → answered out loud, like a real conversation.
      if (spoken) speakAnswer(aiIdx, result.answer);
    } else {
      setMessages((prev) => [...prev, { role: 'ai', text: errorText(result.reason), error: true }]);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    ask(text);
  };

  const startVoice = async () => {
    if (thinking || voiceState !== 'idle') return;
    // Don't let the mic record the bot's own voice.
    stopSpeaking();
    setSpeakingIdx(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access so Recall can hear your question.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setVoiceState('recording');
  };

  const cancelVoice = async () => {
    try {
      await recorder.stop();
    } catch {
      // Nothing to clean up if the recorder never fully started.
    }
    setVoiceState('idle');
  };

  const finishVoice = async () => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setVoiceState('idle');
      return;
    }
    setVoiceState('transcribing');
    const result = await transcribeAudio(uri, 'auto');
    setVoiceState('idle');
    if (result.ok && result.text.trim()) {
      ask(result.text.trim(), true);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: 'I couldn’t make that out — try asking again.', error: true },
      ]);
    }
  };

  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={[colors.ink, colors.dark, colors.teal, colors.dark]}
        locations={[0, 0.4, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Ionicons name="arrow-back" size={28} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Ask</Text>
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <FloatingBrain />
              <View style={styles.promptRow}>
                <View style={styles.promptLine} />
                <Text style={styles.promptText}>
                  {available ? 'What do you want to remember?' : 'Ask isn’t set up yet'}
                </Text>
                <View style={styles.promptLine} />
              </View>
              {available ? (
                <View style={styles.suggestWrap}>
                  {[
                    'What did I do yesterday?',
                    'Who did I meet this week?',
                    'Where was I last Friday?',
                  ].map((q) => (
                    <Pressable key={q} style={styles.suggestChip} onPress={() => ask(q)}>
                      <Text style={styles.suggestChipText}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.voiceHint}>
                  Add your OpenAI key to .env to turn this on.
                </Text>
              )}
              {available && canSpeak && (
                <Text style={styles.voiceHint}>or tap the mic and just ask — it answers out loud</Text>
              )}
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.thread}
              showsVerticalScrollIndicator={false}
            >
              {messages.map((m, i) =>
                m.role === 'ai' ? (
                  <MessageAppear key={i}>
                    <View style={styles.aiRow}>
                      <Image
                        source={MISC.brain3d}
                        style={{ width: 48, height: 48 }}
                        resizeMode="contain"
                      />
                      <View
                        style={[
                          styles.aiBubble,
                          m.reference && styles.aiBubbleRich,
                          m.error && styles.aiBubbleError,
                        ]}
                      >
                        <Text style={[styles.bubbleText, rtlIfArabic(m.text)]}>{m.text}</Text>
                        {m.reference && <ReferenceCard reference={m.reference} />}
                        {/* Hear this answer — your memory reads it out loud */}
                        {!m.error && (
                          <Pressable
                            style={[styles.speakBtn, speakingIdx === i && styles.speakBtnActive]}
                            onPress={() => toggleSpeak(i, m.text)}
                            hitSlop={6}
                          >
                            <Ionicons
                              name={speakingIdx === i ? 'stop' : 'volume-high'}
                              size={15}
                              color={speakingIdx === i ? colors.ink : colors.accent}
                            />
                            <Text
                              style={[
                                styles.speakBtnText,
                                speakingIdx === i && styles.speakBtnTextActive,
                              ]}
                            >
                              {speakingIdx === i ? 'Stop' : 'Listen'}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {/* Tap-to-answer replies for the AI's clarifying question —
                        only while this is the latest message */}
                    {i === messages.length - 1 &&
                      !thinking &&
                      (m.suggestions?.length ?? 0) > 0 && (
                        <View style={styles.replyWrap}>
                          {m.suggestions!.map((s) => (
                            <Pressable
                              key={s}
                              style={styles.replyChip}
                              onPress={() => ask(s, lastQuestionWasSpoken)}
                            >
                              <Text style={[styles.replyChipText, rtlIfArabic(s)]}>{s}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                  </MessageAppear>
                ) : (
                  <MessageAppear key={i}>
                    <View style={styles.userRow}>
                      <View style={styles.userBubble}>
                        {m.spoken && (
                          <View style={styles.spokenRow}>
                            <Ionicons name="mic" size={12} color={colors.accent} />
                            <Text style={styles.spokenText}>Asked by voice</Text>
                          </View>
                        )}
                        <Text style={[styles.bubbleText, rtlIfArabic(m.text)]}>{m.text}</Text>
                      </View>
                      <View style={styles.userAvatar}>
                        <Ionicons name="person" size={18} color={colors.white} />
                      </View>
                    </View>
                  </MessageAppear>
                ),
              )}
              {thinking && (
                <MessageAppear>
                  <View style={styles.aiRow}>
                    <Image source={MISC.brain3d} style={{ width: 48, height: 48 }} resizeMode="contain" />
                    <View style={styles.aiBubble}>
                      <TypingDots />
                    </View>
                  </View>
                </MessageAppear>
              )}
            </ScrollView>
          )}

          {/* Input bar — morphs into a live recording strip while speaking */}
          {voiceState === 'recording' ? (
            <View style={[styles.inputBar, styles.inputBarRec]}>
              <Pressable onPress={cancelVoice} hitSlop={8}>
                <Ionicons name="close-circle" size={30} color="rgba(255,255,255,0.7)" />
              </Pressable>
              <RecDot />
              <Text style={styles.recTimer}>{formatTime(recorderState.durationMillis)}</Text>
              <MiniWaveform />
              <Pressable onPress={finishVoice} hitSlop={8}>
                <Ionicons name="checkmark-circle" size={34} color={colors.accent} />
              </Pressable>
            </View>
          ) : voiceState === 'transcribing' ? (
            <View style={[styles.inputBar, styles.inputBarRec]}>
              <TypingDots />
              <Text style={styles.recTimer}>Listening back…</Text>
            </View>
          ) : (
            <View style={styles.inputBar}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={send}
                placeholder="Ask your memory…"
                placeholderTextColor="rgba(255,255,255,0.5)"
                returnKeyType="send"
                editable={!thinking}
              />
              {/* One primary action: mic while the field is empty, send once
                  there's text — always big, always in thumb reach. */}
              {input.trim().length === 0 && canSpeak ? (
                <Pressable onPress={startVoice} hitSlop={8} disabled={thinking}>
                  <View style={[styles.primaryBtn, thinking && { opacity: 0.4 }]}>
                    <Ionicons name="mic" size={24} color={colors.ink} />
                  </View>
                </Pressable>
              ) : (
                <Pressable onPress={send} hitSlop={8} disabled={thinking || !input.trim()}>
                  <View
                    style={[
                      styles.primaryBtn,
                      styles.sendBtn,
                      (thinking || !input.trim()) && { opacity: 0.4 },
                    ]}
                  >
                    <Ionicons name="arrow-up" size={24} color={colors.ink} />
                  </View>
                </Pressable>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingVertical: 16, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 18 },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 24, color: colors.white },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  promptRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
    paddingHorizontal: 32,
  },
  promptLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' },
  promptText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.4,
  },
  suggestWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 28,
  },
  suggestChip: {
    borderWidth: 1,
    borderColor: 'rgba(99,188,198,0.55)',
    backgroundColor: 'rgba(99,188,198,0.12)',
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  suggestChipText: { fontFamily: fonts.regular, fontSize: 13, color: colors.white },
  voiceHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 18,
    fontStyle: 'italic',
  },

  thread: { padding: 20, paddingBottom: 40, gap: 20 },
  aiRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingRight: 40 },
  aiBubble: {
    backgroundColor: 'rgba(20,45,48,0.85)',
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  aiBubbleRich: { backgroundColor: 'rgba(60,105,110,0.75)' },
  aiBubbleError: { borderColor: 'rgba(255,255,255,0.35)' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    alignSelf: 'flex-end',
    paddingLeft: 40,
  },
  userBubble: {
    backgroundColor: 'rgba(8,17,18,0.55)',
    borderWidth: 1.5,
    borderColor: colors.white,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.white },
  spokenRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  spokenText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent },

  typingRow: { flexDirection: 'row', gap: 5, paddingVertical: 4 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.pale },

  speakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(99,188,198,0.55)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  speakBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  speakBtnText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  speakBtnTextActive: { color: colors.ink },

  replyWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingLeft: 58, // align under the bubble, past the avatar
  },
  replyChip: {
    backgroundColor: 'rgba(99,188,198,0.16)',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 15,
  },
  replyChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },

  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.25)',
    paddingTop: 14,
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E3E5E5',
    overflow: 'hidden',
  },
  cardAvatarIcon: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  cardAvatarInitials: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.white },
  cardTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.white, marginBottom: 3 },
  cardBullet: { fontFamily: fonts.regular, fontSize: 13, color: colors.pale, lineHeight: 20 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.white,
    borderRadius: 18,
    marginHorizontal: 20,
    marginBottom: 110,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  inputBarRec: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(99,188,198,0.12)',
    minHeight: 56,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.white, paddingVertical: 8 },
  primaryBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: { backgroundColor: colors.white },

  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D' },
  recTimer: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white, minWidth: 44 },
  miniWaveRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 30,
  },
  miniWaveBar: { width: 3, borderRadius: 2, backgroundColor: colors.accent },
});
