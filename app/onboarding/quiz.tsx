import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MISC } from '../../src/images';
import BackArrow from '../../src/components/BackArrow';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { checkTopic } from '../../src/contentSafety';
import { TOPIC_LABELS, saveCustomTopics } from '../../src/onThisDay';
import { setPositiveFocus } from '../../src/positiveFocus';
import { setRecapNotification, type RecapCadence } from '../../src/recapNotifications';
import { getUserProfile, setUserProfile } from '../../src/userProfile';
import { colors, fonts } from '../../src/theme';

// The setup questions. Each one changes something real in the app — no
// question is asked for its own sake:
//
//   name       → the user's profile; the AI knows whose life it is
//   interests  → On This Day's topics (src/onThisDay.ts reads quizAnswers[0]);
//                "Other" lets the user type one, checked for sexual content
//                first (src/contentSafety.ts)
//   recaps     → which recap notifications are scheduled
//   focus      → Positive Focus for the recaps (src/positiveFocus.ts)

type ChoiceId = 'interests' | 'recaps' | 'focus';
type Option = { label: string; value: string };
type Step =
  | { kind: 'name'; question: string; hint: string }
  | {
      kind: 'choice';
      id: ChoiceId;
      question: string;
      hint: string;
      options: Option[];
      multi: boolean;
      /** Offers "Other" with a field to type one. */
      other?: boolean;
    };

const STEPS: Step[] = [
  { kind: 'name', question: 'What should I call you?', hint: 'So Recall knows whose memories these are.' },
  {
    kind: 'choice',
    id: 'interests',
    question: 'What are you into?',
    hint: 'On This Day shows what was happening in these on your past days.',
    // Labels are the topics in src/onThisDay.ts.
    options: TOPIC_LABELS.map((l) => ({ label: l, value: l })),
    multi: true,
    other: true,
  },
  {
    kind: 'choice',
    id: 'recaps',
    question: 'When should Recall recap your memories?',
    hint: 'A short summary, sent as a notification.',
    options: [
      { label: 'Every evening', value: 'daily' },
      { label: 'Every Sunday', value: 'weekly' },
      { label: 'Every month', value: 'monthly' },
    ],
    multi: true,
  },
  {
    kind: 'choice',
    id: 'focus',
    question: 'Turn on Positive Focus?',
    hint: 'Recaps leave out painful moments, like a loss or a breakup. Your Timeline keeps everything.',
    options: [
      { label: 'Yes, keep recaps positive', value: 'on' },
      { label: 'No, show everything', value: 'off' },
    ],
    multi: false,
  },
];

const TOTAL_BARS = STEPS.length + 1; // the questions + the closing screen

export default function Quiz() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [picks, setPicks] = useState<Record<ChoiceId, string[]>>({
    interests: [],
    // The same defaults as Profile's switches.
    recaps: ['daily', 'weekly'],
    focus: [],
  });
  const [busy, setBusy] = useState(false);
  // Topics typed under "Other" — only ever added after the safety check.
  const [custom, setCustom] = useState<string[]>([]);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [checking, setChecking] = useState(false);
  const [otherProblem, setOtherProblem] = useState<string | null>(null);

  // Someone going through setup again keeps the name they gave.
  useEffect(() => {
    getUserProfile().then((p) => p.name && setName(p.name));
  }, []);

  const current = STEPS[step] as Step | undefined;
  const isClosing = step === STEPS.length;

  const toggle = (id: ChoiceId, value: string, multi: boolean) =>
    setPicks((prev) => {
      const sel = prev[id];
      const next = sel.includes(value) ? sel.filter((v) => v !== value) : multi ? [...sel, value] : [value];
      return { ...prev, [id]: next };
    });

  const addOther = async () => {
    const label = otherText.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!label || checking) return;
    const known = [...TOPIC_LABELS, ...custom].find((l) => l.toLowerCase() === label.toLowerCase());
    if (known) {
      // Already a chip: just select it.
      setPicks((prev) => (prev.interests.includes(known) ? prev : { ...prev, interests: [...prev.interests, known] }));
      setOtherText('');
      setOtherOpen(false);
      return;
    }
    setChecking(true);
    setOtherProblem(null);
    const check = await checkTopic(label);
    setChecking(false);
    if (!check.ok) {
      setOtherProblem(
        check.reason === 'blocked'
          ? 'Recall doesn’t show sexual or explicit content. Try something else.'
          : 'Couldn’t check that just now. Try again in a moment.',
      );
      return;
    }
    setCustom((c) => [...c, label]);
    setPicks((prev) => ({ ...prev, interests: [...prev.interests, label] }));
    setOtherText('');
    setOtherOpen(false);
  };

  // A yes-or-no has to be answered; everything else can be left empty.
  const canGoOn = !current || current.kind === 'name' || current.multi || picks[current.id].length > 0;

  // Each answer takes effect as it is given, so the notification permission
  // is asked right after the user chose to get recaps — when it makes sense.
  const next = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (current.kind === 'name' && name.trim()) {
        await setUserProfile({ name: name.trim() });
      } else if (current.kind === 'choice' && current.id === 'interests') {
        await saveCustomTopics(custom.filter((c) => picks.interests.includes(c)));
      } else if (current.kind === 'choice' && current.id === 'recaps') {
        const chosen = picks.recaps;
        // The ones turned on first: the first of those asks for permission.
        const order: RecapCadence[] = ['daily', 'weekly', 'monthly'];
        for (const c of [...order.filter((c) => chosen.includes(c)), ...order.filter((c) => !chosen.includes(c))]) {
          await setRecapNotification(c, chosen.includes(c));
        }
      } else if (current.kind === 'choice' && current.id === 'focus') {
        await setPositiveFocus(picks.focus[0] === 'on');
      }
    } catch (e) {
      console.warn('[onboarding] could not save an answer:', e);
    } finally {
      setBusy(false);
    }
    setStep((s) => s + 1);
  };

  const finish = async () => {
    await AsyncStorage.multiSet([
      ['onboardingComplete', 'true'],
      // Interests stay first: On This Day reads them as quizAnswers[0].
      ['quizAnswers', JSON.stringify([picks.interests, picks.recaps, picks.focus])],
    ]);
    console.log(
      `[onboarding] done — ${picks.interests.length} interests, recaps: ${picks.recaps.join(', ') || 'none'}, positive focus: ${picks.focus[0] ?? 'off'}`,
    );
    // The last question of setup: whether Recall may read past photos.
    router.replace({ pathname: '/photo-reading', params: { from: 'onboarding' } });
  };

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <BackArrow onPress={step > 0 ? () => setStep((s) => s - 1) : undefined} />
        <View style={styles.progressRow}>
          {Array.from({ length: TOTAL_BARS }).map((_, i) => (
            <View key={i} style={[styles.bar, i === step && styles.barActive]} />
          ))}
        </View>

        {isClosing ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={styles.question}>Your Memory Experience Is Loading...</Text>
            <View style={{ alignItems: 'center', marginVertical: 30 }}>
              <Image source={MISC.network} style={{ width: 300, height: 190 }} resizeMode="contain" />
            </View>
            <Text style={styles.body}>
              Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ''}, that’s all we need!
            </Text>
            <PillButton
              label="Continue"
              style={{ alignSelf: 'center', minWidth: 280, marginTop: 40 }}
              onPress={finish}
            />
          </View>
        ) : current ? (
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.question}>{current.question}</Text>
              <Text style={styles.hint}>{current.hint}</Text>

              {current.kind === 'name' ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={next}
                />
              ) : (
                <View style={[styles.chips, current.other && styles.chipsDense]}>
                  {[...current.options, ...(current.other ? custom.map((c) => ({ label: c, value: c })) : [])].map(
                    (o) => {
                      const selected = picks[current.id].includes(o.value);
                      return (
                        <Pressable
                          key={o.value}
                          onPress={() => toggle(current.id, o.value, current.multi)}
                          style={[styles.chip, current.other && styles.chipDense, selected && styles.chipSelected]}
                        >
                          <Text style={styles.chipText}>{o.label}</Text>
                        </Pressable>
                      );
                    },
                  )}
                  {current.other && !otherOpen && (
                    <Pressable
                      onPress={() => setOtherOpen(true)}
                      style={[styles.chip, styles.chipDense, styles.chipOther]}
                    >
                      <Text style={styles.chipText}>+ Other</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {current.kind === 'choice' && current.other && otherOpen && (
                <View>
                  <View style={styles.otherRow}>
                    <TextInput
                      value={otherText}
                      onChangeText={(t) => {
                        setOtherText(t);
                        setOtherProblem(null);
                      }}
                      placeholder="Type a topic"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      style={styles.otherInput}
                      autoFocus
                      maxLength={40}
                      returnKeyType="done"
                      onSubmitEditing={addOther}
                    />
                    <Pressable onPress={addOther} style={styles.otherAdd} hitSlop={8}>
                      {checking ? (
                        <ActivityIndicator color={colors.ink} />
                      ) : (
                        <Text style={styles.otherAddText}>Add</Text>
                      )}
                    </Pressable>
                  </View>
                  {otherProblem && <Text style={styles.otherProblem}>{otherProblem}</Text>}
                </View>
              )}

              <PillButton
                label={current.kind === 'name' && !name.trim() ? 'Skip' : 'Next'}
                style={[{ alignSelf: 'flex-start', minWidth: 240, marginTop: 48 }, !canGoOn && { opacity: 0.4 }]}
                onPress={canGoOn ? next : undefined}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  progressRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 40,
  },
  bar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  barActive: {
    backgroundColor: colors.white,
  },
  question: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 36,
  },
  hint: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 10,
  },
  body: {
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 23,
  },
  input: {
    marginTop: 40,
    color: colors.white,
    fontFamily: fonts.semiBold,
    fontSize: 22,
    paddingVertical: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.6)',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 40,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  // The interests step has many chips; a little tighter so they fit.
  chipsDense: { gap: 10, marginTop: 28 },
  chipDense: { paddingVertical: 8, paddingHorizontal: 15 },
  chipOther: { borderStyle: 'dashed' },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  otherInput: {
    flex: 1,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 16,
    paddingVertical: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.6)',
  },
  otherAdd: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 20,
    minWidth: 72,
    alignItems: 'center',
  },
  otherAddText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  otherProblem: { color: colors.accent, fontFamily: fonts.medium, fontSize: 13, marginTop: 10 },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
});
