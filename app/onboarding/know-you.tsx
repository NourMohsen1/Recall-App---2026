import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackArrow from '../../src/components/BackArrow';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { colors, fonts } from '../../src/theme';

export default function KnowYou() {
  const router = useRouter();

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <BackArrow />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.title}>Let’s get to know you better!</Text>
          <Text style={styles.body}>
            Your answers will help personalize your memory experience, so every reminder, playlist,
            and recap feels truly you.
          </Text>
          <PillButton
            label="Let’s Go"
            style={{ alignSelf: 'flex-start', marginTop: 40 }}
            onPress={() => router.push('/onboarding/quiz-intro')}
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
    lineHeight: 38,
    marginBottom: 18,
  },
  body: {
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
  },
});
