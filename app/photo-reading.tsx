import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
// Two looks, one layout. During onboarding it is dark teal like the screens
// around it; opened inside the app (Profile, or the one-time question for
// someone who already had Recall) it is light like every other app screen.
// One title, one line, the choices doing the talking, and the privacy facts
// as two short icon lines.

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
  const dark = from === 'onboarding';
  const t = dark ? DARK : LIGHT;
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

  const screen = (
      <SafeAreaView style={[styles.safe, !dark && { backgroundColor: t.background }]}>
        {dark ? (
          <BackArrow />
        ) : (
          router.canGoBack() && (
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.lightBack}>
              <Ionicons name="arrow-back" size={28} color={colors.primary} />
            </Pressable>
          )
        )}
        <View style={styles.content}>
          <Text style={[styles.title, { color: t.title }]}>Bring your past back</Text>
          <Text style={[styles.body, { color: t.body }]}>
            Recall can read the photos you already have and write the story of each day.
          </Text>

          <View style={styles.choices}>
            {CHOICES.map((c, i) => {
              const on = picked === c.mode;
              return (
                <Pressable
                  key={c.mode}
                  onPress={() => setPicked(c.mode)}
                  style={[
                    styles.choice,
                    { backgroundColor: t.card, borderColor: t.cardBorder },
                    on && styles.choiceOn,
                  ]}
                >
                  <View style={[styles.choiceIcon, { backgroundColor: t.iconBg }, on && styles.choiceIconOn]}>
                    <MaterialCommunityIcons name={c.icon} size={22} color={on ? colors.ink : t.icon} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.choiceTitleRow}>
                      <Text style={[styles.choiceTitle, { color: t.title }, on && styles.choiceTitleOn]}>{c.title}</Text>
                      {i === 0 && !on && (
                        <View style={[styles.badge, { backgroundColor: t.badgeBg }]}>
                          <Text style={[styles.badgeText, { color: t.badgeText }]}>Recommended</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.choiceHint, { color: t.hint }, on && styles.choiceHintOn]}>{c.hint}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={on ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={on ? colors.ink : t.radio}
                  />
                </Pressable>
              );
            })}
          </View>

          {/* The facts, short: who reads the photos, and what never goes. */}
          <View style={styles.facts}>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="earth" size={16} color={t.factIcon} />
              <Text style={[styles.factText, { color: t.fact }]}>
                Read by {PHOTO_READER.name}, only to write each day's story
              </Text>
            </View>
            <View style={styles.fact}>
              <MaterialCommunityIcons name="lock-outline" size={16} color={t.factIcon} />
              <Text style={[styles.factText, { color: t.fact }]}>Your contacts and location never leave the phone</Text>
            </View>
          </View>

          <PillButton
            label={changing ? 'Save' : 'Continue'}
            onPress={confirm}
            style={[styles.button, !picked && { opacity: 0.4 }]}
          />
          <Text style={[styles.footnote, { color: t.footnote }]}>You can change this any time in Profile.</Text>
        </View>
      </SafeAreaView>
  );

  return dark ? <OnboardingBackground>{screen}</OnboardingBackground> : screen;
}

// The same screen in the onboarding's dark teal and in the app's light look.
const DARK = {
  background: 'transparent',
  title: colors.white,
  body: colors.white,
  card: 'rgba(255,255,255,0.08)',
  cardBorder: 'rgba(255,255,255,0.35)',
  iconBg: 'rgba(255,255,255,0.12)',
  icon: colors.white,
  hint: 'rgba(255,255,255,0.7)',
  radio: 'rgba(255,255,255,0.45)',
  badgeBg: 'rgba(99,188,198,0.25)',
  badgeText: colors.accent,
  factIcon: colors.accent,
  fact: 'rgba(255,255,255,0.8)',
  footnote: 'rgba(255,255,255,0.5)',
};

const LIGHT = {
  background: '#EFF3F3',
  title: '#1B1B1B',
  body: '#3A4243',
  card: colors.white,
  cardBorder: colors.white,
  iconBg: colors.pale,
  icon: colors.primary,
  hint: '#6B7475',
  radio: colors.soft,
  badgeBg: colors.pale,
  badgeText: colors.primary,
  factIcon: colors.teal,
  fact: '#4A5253',
  footnote: '#8B9394',
};

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 28 },
  lightBack: { marginTop: 24, alignSelf: 'flex-start' },
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
