import { useRef, useState } from 'react';
import {
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
import { AskResult, ChatTurn, Reference, askAvailable, askMemory } from '../../src/askAI';
import { PEOPLE } from '../../src/data';
import { MISC, PERSON_PLACEHOLDER, personPhoto, placePhoto } from '../../src/images';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

type Message = {
  role: 'user' | 'ai';
  text: string;
  reference?: Reference | null;
  error?: boolean;
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

function TypingDots() {
  return (
    <View style={styles.typingRow}>
      <View style={styles.typingDot} />
      <View style={[styles.typingDot, { opacity: 0.7 }]} />
      <View style={[styles.typingDot, { opacity: 0.4 }]} />
    </View>
  );
}

function ReferenceCard({ reference }: { reference: Reference }) {
  const router = useRouter();

  if (reference.type === 'person') {
    const person = PEOPLE.find((p) => p.name === reference.name);
    return (
      <Pressable
        style={styles.cardRow}
        onPress={() => router.push({ pathname: '/person/[name]', params: { name: reference.name } })}
      >
        <Image
          source={person?.hasPhoto ? personPhoto(reference.name) : PERSON_PLACEHOLDER}
          style={styles.cardAvatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{reference.name}</Text>
          {person && <Text style={styles.cardBullet}>{person.relation}</Text>}
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

export default function Chat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const historyRef = useRef<ChatTurn[]>([]);
  const available = askAvailable();

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setThinking(true);

    const result = await askMemory(text, historyRef.current);
    setThinking(false);

    if (result.ok) {
      const userTurn: ChatTurn = { role: 'user', text };
      const aiTurn: ChatTurn = { role: 'assistant', text: result.answer };
      historyRef.current = [...historyRef.current, userTurn, aiTurn].slice(-10);
      setMessages((prev) => [...prev, { role: 'ai', text: result.answer, reference: result.reference }]);
    } else {
      setMessages((prev) => [...prev, { role: 'ai', text: errorText(result.reason), error: true }]);
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
              <Image
                source={MISC.brain3d}
                style={{ width: 280, height: 280 }}
                resizeMode="contain"
              />
              <View style={styles.promptBubble}>
                <Text style={styles.promptText}>
                  {available
                    ? 'What do you want to remember?'
                    : 'Ask isn’t set up yet — add your OpenAI key to .env to turn this on.'}
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.thread} showsVerticalScrollIndicator={false}>
              {messages.map((m, i) =>
                m.role === 'ai' ? (
                  <View key={i} style={styles.aiRow}>
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
                    </View>
                  </View>
                ) : (
                  <View key={i} style={styles.userRow}>
                    <View style={styles.userBubble}>
                      <Text style={[styles.bubbleText, rtlIfArabic(m.text)]}>{m.text}</Text>
                    </View>
                    <View style={styles.userAvatar}>
                      <Ionicons name="person" size={18} color={colors.white} />
                    </View>
                  </View>
                ),
              )}
              {thinking && (
                <View style={styles.aiRow}>
                  <Image source={MISC.brain3d} style={{ width: 48, height: 48 }} resizeMode="contain" />
                  <View style={styles.aiBubble}>
                    <TypingDots />
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          {/* Input bar */}
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
            <Pressable onPress={send} hitSlop={8} disabled={thinking}>
              <Ionicons
                name="arrow-up-circle"
                size={34}
                color={thinking ? 'rgba(255,255,255,0.4)' : colors.white}
              />
            </Pressable>
          </View>
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
  promptBubble: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginTop: 40,
    marginHorizontal: 24,
  },
  promptText: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.white, textAlign: 'center' },

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

  typingRow: { flexDirection: 'row', gap: 5, paddingVertical: 4 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.pale },

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
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.white, paddingVertical: 8 },
});
