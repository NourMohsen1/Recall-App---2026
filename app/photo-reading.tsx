import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import BackArrow from '../src/components/BackArrow';
import OnboardingBackground from '../src/components/OnboardingBackground';
import PillButton from '../src/components/PillButton';
import { runPhotoAnalysisNow } from '../src/photoAnalysisQueue';
import {
  PHOTO_READER,
  getPhotoReading,
  setPhotoReading,
  type PhotoReading,
} from '../src/photoReading';
import { colors, fonts } from '../src/theme';

// "Bring your past back" — whether Recall may send photos to an AI service
// to write the story of each day. Asked once (after setup, or the next time
// Home opens for someone who already had the app) and reachable any time
// from Profile. See src/photoReading.ts.
//
// Built like the onboarding screens it follows: dark teal, one title, one
// line, and the choices doing the talking. The privacy facts are two short
// lines with icons, not a paragraph — still complete, still on screen.

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const CHOICES: { mode: PhotoReading; icon: IconName; title: string; hint: string }[] = [
  { mode: 'all', icon: 'history', title: 'All my past days', hint: 'Read quietly in the background' },
  { mode: 'chosen', icon: 'gesture-tap', title: 'Only days I choose', hint: 'Nothing is sent until you tap a day' },
  { mode: 'off', icon: 'calendar-today', title: 'From today on', hint: 'No photos are sent' },
];

export default function PhotoReadingScreen() {
  const router = useRouter();
  // `from=profile` is a change of mind; otherwise it is the one-time
  // question, which leads on to Home.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const changing = from === 'profile';
  const [picked, setPicked] = useState<PhotoReading | null>(null);

  useEffect(() => {
    getPhotoReading().then(setPicked);
  }, []);

  const confirm = async () => {
    if (!picked) return;
    await setPhotoReading(picked);
    if (picked === 'all') runPhotoAnalysisNow();
    if (changing && router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe}>
        <BackArrow />
        <View style={styles.content}>
          <Text style={styles.title}>Bring your past back</Text>
          <Text style={styles.body}>
            Recall can read the photos you already have and write the story of each day.
          </Text>

          <View style={styles.choices}>
            {CHOICES.map((c, i) => {
              const on = picked === c.mode;
              return (
                <Pressable key={c.mode} onPress={() => setPicked(c.mode)} style={[styles.choice, on && styles.choiceOn]}>
                  <View style={[styles.choiceIcon, on && styles.choiceIconOn]}>
                    <MaterialCommunityIcons name={c.icon} size={22} color={on ? colors.ink : colors.white} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.choiceTitleRow}>
                      <Text style={[styles.choiceTitle, on && styles.choiceTitleOn]}>{c.title}</Text>
                      {i === 0 && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>Recommended</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.choiceHint, on && styles.choiceHintOn]}>{c.hint}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={on ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={on ? colors.ink : 'rgba(255,255,255,0.45)'}
                  />
                </Pressable>
              );
            })}
          </View>

          {/* The facts, short: who reads the photos, and what never goes. */}
          <View style={styles.facts}>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="earth" size={16} color={colors.accent} />
              <Text style={styles.factText}>
                Read by {PHOTO_READER.name} ({PHOTO_READER.where}), only to write each day's story
              </Text>
            </View>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.accent} />
              <Text style={styles.factText}>Your notes, contacts and location never leave the phone</Text>
            </View>
          </View>

          <PillButton
            label={changing ? 'Save' : 'Continue'}
            onPress={confirm}
            style={[styles.button, !picked && { opacity: 0.4 }]}
          />
          <Text style={styles.footnote}>You can change this any time in Profile.</Text>
        </View>
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  content: { flex: 1, justifyContent: 'center' },
  title: { color: colors.white, fontFamily: fonts.bold, fontSize: 28, lineHeight: 38 },
  body: { color: colors.white, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, marginTop: 12 },

  choices: { gap: 12, marginTop: 32 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  choiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconOn: { backgroundColor: 'rgba(255,255,255,0.45)' },
  choiceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  choiceTitle: { color: colors.white, fontFamily: fonts.semiBold, fontSize: 15 },
  choiceTitleOn: { color: colors.ink },
  choiceHint: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  choiceHintOn: { color: colors.deep },
  badge: { backgroundColor: 'rgba(99,188,198,0.25)', borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { color: colors.accent, fontFamily: fonts.semiBold, fontSize: 10 },

  facts: { gap: 10, marginTop: 26 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factText: { flex: 1, color: 'rgba(255,255,255,0.8)', fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },

  button: { alignSelf: 'stretch', marginTop: 32 },
  footnote: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});
