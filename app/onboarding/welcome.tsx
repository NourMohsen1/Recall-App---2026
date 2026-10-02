import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import OnboardingBackground from '../../src/components/OnboardingBackground';
import PillButton from '../../src/components/PillButton';
import { appleSignInAvailable, getAccount, signInWithApple } from '../../src/account';
import { MISC } from '../../src/images';
import { getUserProfile, setUserProfile } from '../../src/userProfile';
import { colors, fonts } from '../../src/theme';

// Welcome, and the account: one tap on "Continue with Apple" and Face ID.
// "Not now" is a real choice — everything works without an account, the
// memories just stay on this phone (Apple also asks that an app working
// without an account doesn't force one). Signing in later is in Profile.

export default function Welcome() {
  const router = useRouter();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    appleSignInAvailable().then(setApple);
  }, []);

  const next = () => router.push('/onboarding/know-you');

  const continueWithApple = async () => {
    setProblem(null);
    setBusy(true);
    const result = await signInWithApple();
    setBusy(false);
    if (result.ok) {
      // Apple shares the name once, the first time — so the name question
      // comes already answered.
      if (result.name && !(await getUserProfile()).name) await setUserProfile({ name: result.name });
      next();
    } else if (!result.canceled) {
      setProblem(result.message ?? 'Signing in didn’t work. Try again, or tap Not now.');
    }
  };

  const signedIn = !!getAccount();

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

        {apple && !signedIn ? (
          <View style={styles.actions}>
            {busy ? (
              <View style={styles.appleButton}>
                <ActivityIndicator color={colors.white} />
              </View>
            ) : (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={999}
                style={styles.appleButton}
                onPress={continueWithApple}
              />
            )}
            <Text style={styles.why}>Keeps your memories safe when you change phones.</Text>
            {problem && <Text style={styles.problem}>{problem}</Text>}
            <PillButton label="Not now" variant="ghost" style={{ marginTop: 6 }} onPress={next} />
          </View>
        ) : (
          <PillButton
            label="Next"
            style={{ alignSelf: 'center', minWidth: 240, marginBottom: 44 }}
            onPress={next}
          />
        )}
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
  actions: { alignItems: 'center', marginBottom: 30 },
  appleButton: { width: 280, height: 52, alignItems: 'center', justifyContent: 'center' },
  why: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  problem: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
