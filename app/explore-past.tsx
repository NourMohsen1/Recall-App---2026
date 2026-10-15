import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingBackground from '../src/components/OnboardingBackground';
import PillButton from '../src/components/PillButton';
import { getAiConsent } from '../src/aiConsent';
import { markExplorePastAsked, startExplorePast } from '../src/explorePast';
import { getPhotoReading } from '../src/photoReading';
import { colors, fonts } from '../src/theme';

// "Explore your past", in setup, after the AI question: bring in the photos
// already on the phone, so the past year fills in without logging any of it.
// See src/explorePast.ts. The photo-reading question comes after this,
// because it only means something once there are photos to read.

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

// What a past day turns into: three cards fanned like photos in a hand.
const FAN: { icon: IconName; label: string; rotate: string; x: number; y: number; shift: number }[] = [
  { icon: 'map-marker-radius', label: 'Places', rotate: '-12deg', x: -92, y: 16, shift: -30 },
  { icon: 'account-group', label: 'People', rotate: '10deg', x: 92, y: 16, shift: 30 },
  { icon: 'calendar-heart', label: 'Your days', rotate: '0deg', x: 0, y: 0, shift: 0 },
];

export default function ExplorePast() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fan = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fan, { toValue: 1, duration: 700, delay: 150, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [fan]);

  // On to the photo question when the AI is on, else Home.
  const next = async () => {
    if (getAiConsent() === 'on' && (await getPhotoReading()) === null) {
      router.replace({ pathname: '/photo-reading', params: { from: 'onboarding' } });
    } else {
      router.replace('/home');
    }
  };

  const yes = async () => {
    setBusy(true);
    const granted = await startExplorePast();
    setBusy(false);
    if (!granted) {
      Alert.alert(
        'Photo access is off',
        'Allow access to your photos in Settings and Recall will bring your past in.',
        [
          { text: 'Not now', style: 'cancel', onPress: next },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    next();
  };

  const notNow = async () => {
    await markExplorePastAsked();
    console.log('[explore] not now, in setup');
    next();
  };

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <View style={styles.fanArea}>
            {FAN.map((c) => (
              <Animated.View
                key={c.label}
                style={[
                  styles.fanCard,
                  {
                    opacity: fan,
                    transform: [
                      { translateX: fan.interpolate({ inputRange: [0, 1], outputRange: [0, c.x] }) },
                      { translateY: fan.interpolate({ inputRange: [0, 1], outputRange: [30, c.y] }) },
                      { rotate: c.rotate },
                    ],
                  },
                ]}
              >
                {/* A side card's face sits in the half the middle card leaves showing. */}
                <View style={{ alignItems: 'center', gap: 12, transform: [{ translateX: c.shift }] }}>
                  <View style={styles.fanIcon}>
                    <MaterialCommunityIcons name={c.icon} size={30} color={colors.white} />
                  </View>
                  <Text style={styles.fanLabel}>{c.label}</Text>
                </View>
              </Animated.View>
            ))}
          </View>

          <Text style={styles.title}>Explore your past</Text>
          <Text style={styles.body}>
            Your photos already hold the last year. Recall can place each one on its day, so you can
            look back at where you went and who you were with.
          </Text>

          <View style={styles.facts}>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.accent} />
              <Text style={styles.factText}>Sorted on your phone. Private photos are left out.</Text>
            </View>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="clock-fast" size={16} color={colors.accent} />
              <Text style={styles.factText}>Happens in the background while you carry on.</Text>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <PillButton label={busy ? 'Opening your photos…' : 'Bring back my past year'} onPress={busy ? undefined : yes} style={styles.button} />
          <PillButton label="Not now" variant="ghost" onPress={notNow} />
        </View>
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  content: { flex: 1, justifyContent: 'center' },
  fanArea: { height: 190, alignItems: 'center', justifyContent: 'center', marginBottom: 34 },
  fanCard: {
    position: 'absolute',
    width: 128,
    height: 156,
    borderRadius: 22,
    // Solid, so the middle card sits cleanly over the two behind it.
    backgroundColor: '#17363A',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fanIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fanLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.white },
  title: { color: colors.white, fontFamily: fonts.bold, fontSize: 30, lineHeight: 40 },
  body: { color: colors.white, fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, marginTop: 12 },
  facts: { gap: 10, marginTop: 26 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  actions: { alignItems: 'center', gap: 6, marginBottom: 24 },
  button: { alignSelf: 'stretch' },
});
