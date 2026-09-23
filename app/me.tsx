import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import PersonEditSheet from '../src/components/PersonEditSheet';
import PhotoImage from '../src/components/PhotoImage';
import { WEEKDAYS } from '../src/data';
import { LoggedMemory, dateKey, getMemoriesByDay, persistFile } from '../src/memoryLog';
import { UserProfile, getUserProfile, setUserProfile } from '../src/userProfile';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function offsetFromDay(key: string): number {
  const target = parseDay(key);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Same labelling as a person's memory rail — recent days read as weekdays,
// older ones need the date.
function railLabel(key: string): string {
  const d = parseDay(key);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]}, ${d.getDate()}`;
}

// The user's own profile — the same shape as everyone else's, because they
// are a person in their own memory log, not a settings screen.
export default function MyProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>({});
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [editOpen, setEditOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getUserProfile().then(setProfile);
      getMemoriesByDay().then(setByDay);
    }, []),
  );

  // The most recent days the user logged anything, newest first — "Latest
  // Logs" in the design.
  const latest = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 20)
    .map(([day, memories]) => ({
      day,
      uri: memories.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? [])[0],
      text: memories.map((m) => m.text).find(Boolean),
    }))
    .filter((d) => d.uri || d.text);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to set your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    // Copied out of the picker's cache, same as everywhere else — that path
    // is temporary and the OS will clear it.
    const permanent = await persistFile(result.assets[0].uri, 'me');
    setProfile(await setUserProfile({ photoUri: permanent }));
  };

  const saveIdentity = async (name: string, bio: string) => {
    setProfile(await setUserProfile({ name, bio: bio || undefined }));
    setEditOpen(false);
  };

  const firstName = (profile.name ?? '').trim().split(/\s+/)[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.dismissTo('/profile')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <Pressable onPress={() => setEditOpen(true)} hitSlop={12} style={styles.headerAction}>
          <Ionicons name="create-outline" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={pickPhoto} style={styles.heroWrap}>
          {profile.photoUri ? (
            <Image source={{ uri: profile.photoUri }} style={styles.hero} resizeMode="cover" />
          ) : (
            <View style={[styles.hero, styles.heroEmpty]}>
              <MaterialCommunityIcons name="camera-plus-outline" size={40} color={colors.white} />
              <Text style={styles.heroHint}>Tap to add your photo</Text>
            </View>
          )}
        </Pressable>

        {profile.name ? (
          <Text style={[styles.name, rtlIfArabic(profile.name)]}>{profile.name}</Text>
        ) : (
          <Pressable onPress={() => setEditOpen(true)}>
            <Text style={styles.namePlaceholder}>Add your name</Text>
          </Pressable>
        )}
        <Text style={styles.you}>You</Text>

        {profile.bio ? (
          <Text style={[styles.bio, rtlIfArabic(profile.bio)]}>{profile.bio}</Text>
        ) : (
          <Pressable onPress={() => setEditOpen(true)}>
            <Text style={styles.bioPlaceholder}>
              Tell Recall about yourself — it uses this to understand your days.
            </Text>
          </Pressable>
        )}

        {latest.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Latest Logs</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.railRow}
            >
              {latest.map((d) => (
                <Pressable
                  key={d.day}
                  onPress={() =>
                    router.push(`/day/${offsetFromDay(d.day)}` as Parameters<typeof router.push>[0])
                  }
                >
                  {d.uri ? (
                    <PhotoImage uri={d.uri} style={styles.railTile} />
                  ) : (
                    <View style={[styles.railTile, styles.railTileEmpty]}>
                      <MaterialCommunityIcons name="text-long" size={20} color="#A8B0B1" />
                    </View>
                  )}
                  <Text style={styles.railLabel}>{railLabel(d.day)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
      </ScrollView>

      <PersonEditSheet
        visible={editOpen}
        mode="self"
        name={profile.name ?? ''}
        descriptor={profile.bio}
        onSave={saveIdentity}
        onClose={() => setEditOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 16 },
  headerAction: { position: 'absolute', right: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 24, paddingBottom: 140 },

  heroWrap: { marginTop: 18 },
  hero: { width: '100%', aspectRatio: 0.92, borderRadius: 20, overflow: 'hidden' },
  heroEmpty: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroHint: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.9)' },

  name: { fontFamily: fonts.bold, fontSize: 38, color: '#1B1B1B', marginTop: 18 },
  namePlaceholder: { fontFamily: fonts.bold, fontSize: 32, color: '#B4BBBB', marginTop: 18 },
  you: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B', marginTop: 4 },
  bio: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 25,
    color: '#3E4647',
    marginTop: 14,
  },
  bioPlaceholder: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: '#9AA4A5',
    marginTop: 14,
  },

  sectionTitle: { fontFamily: fonts.bold, fontSize: 20, color: '#1B1B1B', marginTop: 26, marginBottom: 12 },
  railRow: { flexDirection: 'row', gap: 12, paddingRight: 24 },
  railTile: { width: 116, height: 116, borderRadius: 14, overflow: 'hidden' },
  railTileEmpty: { backgroundColor: '#EDF1F1', alignItems: 'center', justifyContent: 'center' },
  railLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#3E4647',
    marginTop: 8,
    textAlign: 'center',
  },
});
