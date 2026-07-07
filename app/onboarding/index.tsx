import { Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { BRAND } from '../../src/images';
import { colors, fonts } from '../../src/theme';

export default function Splash() {
  const router = useRouter();

  return (
    <OnboardingBackground light>
      <SafeAreaView style={styles.safe}>
        <View style={styles.logoBlock}>
          <Image
            source={BRAND.logo}
            style={styles.logo}
            tintColor={colors.white}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.tagline}>Your AI memory companion{'\n'}that grows with you.</Text>
        <PillButton label="Get Started" onPress={() => router.push('/onboarding/welcome')} />
        <View style={{ flex: 1 }} />
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, alignItems: 'center', paddingHorizontal: 32 },
  logoBlock: { alignItems: 'center', marginTop: 110 },
  logo: { width: 210, height: 210 },
  tagline: {
    color: colors.white,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
    marginTop: 70,
    marginBottom: 80,
  },
});
