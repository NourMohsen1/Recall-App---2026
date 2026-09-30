import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
// from Profile. The choice is the user's; see src/photoReading.ts.
//
// Framed around what the user gets back, because that is the real
// difference: without it, the past is photos and places with no story.
// The privacy facts are stated plainly and in full on the same screen.

const CHOICES: { mode: PhotoReading; title: string; detail: string }[] = [
  {
    mode: 'all',
    title: 'Bring back my past',
    detail: 'Recall reads your past days in the background.',
  },
  {
    mode: 'chosen',
    title: 'Only the days I choose',
    detail: 'Nothing is sent until you tap a day.',
  },
  {
    mode: 'off',
    title: "Start from today — don't read my photos",
    detail: 'No photos are sent. Your memory starts now, from what you log.',
  },
];

export default function PhotoReadingScreen() {
  const router = useRouter();
  // `from=profile` is a change of mind, with a way back; otherwise it is
  // the one-time question, which leads on to Home.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const changing = from === 'profile';
  const [current, setCurrent] = useState<PhotoReading | null>(null);

  useEffect(() => {
    getPhotoReading().then(setCurrent);
  }, []);

  const choose = async (mode: PhotoReading) => {
    await setPhotoReading(mode);
    if (mode === 'all') runPhotoAnalysisNow();
    if (changing && router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {changing && (
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.icon}>
          <MaterialCommunityIcons name="image-multiple-outline" size={34} color={colors.primary} />
        </View>
        <Text style={styles.title}>Bring your past back</Text>
        <Text style={styles.body}>
          Recall can read the photos you've already taken and write the story of each day — where
          you were, who you were with, what happened.
        </Text>
        <Text style={styles.body}>
          It's what turns years of photos into memories you can actually get back, even the days
          you've forgotten.
        </Text>

        <View style={styles.privacy}>
          <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.teal} />
          <Text style={styles.privacyText}>
            <Text style={styles.privacyBold}>How it works: </Text>
            to read a day, Recall sends that day's photos to {PHOTO_READER.name}, an AI service
            based in {PHOTO_READER.where}. They're used only to write that day's story — your
            notes, contacts and location are never sent with them. You can change this any time in
            Profile.
          </Text>
        </View>

        <Pressable style={[styles.primary, current === 'all' && styles.selected]} onPress={() => choose('all')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.primaryTitle}>{CHOICES[0].title}</Text>
            <Text style={styles.primaryDetail}>{CHOICES[0].detail}</Text>
          </View>
          {current === 'all' && <Ionicons name="checkmark-circle" size={22} color={colors.white} />}
        </Pressable>

        <Pressable
          style={[styles.secondary, current === 'chosen' && styles.secondarySelected]}
          onPress={() => choose('chosen')}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.secondaryTitle}>{CHOICES[1].title}</Text>
            <Text style={styles.secondaryDetail}>{CHOICES[1].detail}</Text>
          </View>
          {current === 'chosen' && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
        </Pressable>

        <Pressable style={styles.link} onPress={() => choose('off')} hitSlop={8}>
          <Text style={styles.linkText}>
            {current === 'off' ? '✓ ' : ''}
            {CHOICES[2].title}
          </Text>
          <Text style={styles.linkDetail}>{CHOICES[2].detail}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  back: { position: 'absolute', left: 20, top: 58, zIndex: 2 },
  scroll: { paddingHorizontal: 28, paddingTop: 56, paddingBottom: 40 },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: '#1B1B1B',
    textAlign: 'center',
    marginTop: 20,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: '#3A4243',
    textAlign: 'center',
    marginTop: 14,
  },
  privacy: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 26,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F1F6F6',
  },
  privacyText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#3A4243' },
  privacyBold: { fontFamily: fonts.semiBold, color: '#1B1B1B' },

  primary: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  selected: { borderWidth: 2, borderColor: colors.accent },
  primaryTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.white },
  primaryDetail: { fontFamily: fonts.regular, fontSize: 13, color: '#CFE3E5', marginTop: 2 },

  secondary: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.soft,
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  secondarySelected: { borderColor: colors.primary, borderWidth: 2 },
  secondaryTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.primary },
  secondaryDetail: { fontFamily: fonts.regular, fontSize: 13, color: '#5E6667', marginTop: 2 },

  link: { marginTop: 22, alignItems: 'center' },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: '#5E6667', textDecorationLine: 'underline' },
  linkDetail: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 4, textAlign: 'center' },
});
