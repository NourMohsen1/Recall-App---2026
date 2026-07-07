import { Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { MISC } from '../../src/images';
import { colors, fonts } from '../../src/theme';

export default function Welcome() {
  const router = useRouter();

  return (
    <OnboardingBackground>
      {/* Soft blurred brain behind the copy, like the mockup */}
      <Image source={MISC.brain3d} style={styles.brainBg} blurRadius={12} resizeMode="contain" />
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.title}>Welcome!</Text>
          <Text style={styles.body}>
            Reconnect with your memories. Explore your world, one moment at a time.
          </Text>
        </View>
        <PillButton
          label="Next"
          style={{ alignSelf: 'center', minWidth: 240 }}
          onPress={() => router.push('/onboarding/know-you')}
        />
        <PillButton
          label="Already Have an Account?"
          variant="ghost"
          style={{ marginTop: 20, marginBottom: 44 }}
          onPress={() => router.push('/onboarding/know-you')}
        />
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  brainBg: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    width: '110%',
    height: 420,
    opacity: 0.55,
  },
  title: {
    color: colors.white,
    fontFamily: fonts.bold,
    fontSize: 32,
    marginBottom: 18,
  },
  body: {
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 26,
  },
});
