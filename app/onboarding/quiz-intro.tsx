import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackArrow from '../../src/components/BackArrow';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { colors, fonts } from '../../src/theme';

export default function QuizIntro() {
  const router = useRouter();

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <BackArrow />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.title}>Interest Quiz</Text>
          <Text style={styles.body}>
            To personalize your experience, we’ll ask a few quick questions about what you enjoy.
          </Text>
          <Text style={[styles.body, { marginTop: 24 }]}>
            Think of it as creating your memory fingerprint.
          </Text>
          <PillButton
            label="Start Quiz"
            style={{ alignSelf: 'flex-start', marginTop: 40 }}
            onPress={() => router.push('/onboarding/quiz')}
          />
        </View>
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  title: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 28,
    marginBottom: 18,
  },
  body: {
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
  },
});
