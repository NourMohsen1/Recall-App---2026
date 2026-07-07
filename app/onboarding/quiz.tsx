import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MISC } from '../../src/images';
import BackArrow from '../../src/components/BackArrow';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { colors, fonts } from '../../src/theme';

type Step = {
  question: string;
  options: string[];
  multi: boolean;
};

const STEPS: Step[] = [
  {
    question: 'What kind of content inspires you most?',
    options: ['Music', 'News', 'World Events', 'Sports', 'Design', 'Movies', 'Travel', 'Books'],
    multi: true,
  },
  {
    question: 'What motivates you to record memories?',
    options: [
      'Tracking progress',
      'Staying organized',
      'Improving my focus',
      'Boost Confidence',
      'Sharing with loved ones',
      'Reflecting on good moments',
    ],
    multi: true,
  },
  {
    question: 'How often would you like to be reminded of your memories?',
    options: ['Daily', 'Weekly', 'Monthly'],
    multi: false,
  },
  {
    question: 'Would you like to activate “Positive Focus” mode?',
    options: ['Yes, keep things positive', 'Show everything, I want balance'],
    multi: false,
  },
];

const TOTAL_BARS = 5; // 4 questions + final loading step

export default function Quiz() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(STEPS.map(() => []));

  const isLoadingStep = step === STEPS.length;

  const toggle = (option: string) => {
    const current = STEPS[step];
    setAnswers((prev) => {
      const next = prev.map((a) => [...a]);
      const selected = next[step];
      if (selected.includes(option)) {
        next[step] = selected.filter((o) => o !== option);
      } else {
        next[step] = current.multi ? [...selected, option] : [option];
      }
      return next;
    });
  };

  const finish = async () => {
    await AsyncStorage.multiSet([
      ['onboardingComplete', 'true'],
      ['quizAnswers', JSON.stringify(answers)],
    ]);
    router.replace('/home');
  };

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <BackArrow />
        <View style={styles.progressRow}>
          {Array.from({ length: TOTAL_BARS }).map((_, i) => (
            <View key={i} style={[styles.bar, i === step && styles.barActive]} />
          ))}
        </View>

        {isLoadingStep ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={styles.question}>Your Memory Experience Is Loading...</Text>
            <View style={{ alignItems: 'center', marginVertical: 30 }}>
              <Image
                source={MISC.network}
                style={{ width: 300, height: 190 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.body}>
              Thanks, that’s all we need!{'\n'}
              We’re creating your personalized Recall experience — where your memories connect with
              the moments that matter most.
            </Text>
            <PillButton
              label="Continue"
              style={{ alignSelf: 'center', minWidth: 280, marginTop: 40 }}
              onPress={finish}
            />
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={styles.question}>{STEPS[step].question}</Text>
            <View style={styles.chips}>
              {STEPS[step].options.map((option) => {
                const selected = answers[step].includes(option);
                return (
                  <Pressable
                    key={option}
                    onPress={() => toggle(option)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={styles.chipText}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
            <PillButton
              label="Next"
              style={{ alignSelf: 'flex-start', minWidth: 240, marginTop: 48 }}
              onPress={() => setStep((s) => s + 1)}
            />
          </View>
        )}
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
  body: {
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 23,
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
