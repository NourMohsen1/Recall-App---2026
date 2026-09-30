import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import FaceIndexCard from '../../src/components/FaceIndexCard';
import Toggle from '../../src/components/Toggle';
import { PERSON_PLACEHOLDER } from '../../src/images';
import { UserProfile, getUserProfile, joinedDate, memoryCount } from '../../src/userProfile';
import { colors, fonts } from '../../src/theme';

function InfoRow({
  icon,
  label,
  last,
  muted,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  last?: boolean;
  muted?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[styles.infoRow, !last && styles.rowDivider]}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={20} color={colors.white} />
      </View>
      <Text style={[styles.infoText, muted && styles.infoTextMuted]}>{label}</Text>
      {onPress && <Ionicons name="chevron-forward" size={18} color="#B4B8B8" />}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Profile() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>({});
  const [joined, setJoined] = useState<Date | null>(null);
  const [entries, setEntries] = useState(0);

  useFocusEffect(
    useCallback(() => {
      getUserProfile().then(async (p) => {
        setProfile(p);
        setJoined(await joinedDate(p));
      });
      memoryCount().then(setEntries);
    }, []),
  );

  const openMe = () => router.push('/me' as Parameters<typeof router.push>[0]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.push('/home')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={26} color={colors.primary} />
        </Pressable>

        {/* Header block — the whole thing opens the user's own profile,
            which is where the photo and the name are actually set. */}
        <Pressable style={styles.headerBlock} onPress={openMe}>
          <Image
            source={profile.photoUri ? { uri: profile.photoUri } : PERSON_PLACEHOLDER}
            style={styles.avatar}
            resizeMode="cover"
          />
          <Text style={styles.name}>{profile.name ?? 'Add your name'}</Text>
          {joined && (
            <Text style={styles.joined}>
              Joined {MONTHS_LONG[joined.getMonth()]} {joined.getDate()}, {joined.getFullYear()}
            </Text>
          )}
        </Pressable>

        {/* General */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>General</Text>
          <InfoRow
            icon="person"
            label={profile.name ?? 'Tell Recall who you are'}
            muted={!profile.name}
            onPress={openMe}
          />
          {profile.email && <InfoRow icon="mail" label={profile.email} />}
          {profile.phone && <InfoRow icon="phone-portrait" label={profile.phone} />}
          <InfoRow
            icon="radio-button-on"
            label={`${entries} ${entries === 1 ? 'Memory Entry' : 'Memory Entries'}`}
            last
          />
        </View>

        {/* Memories */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Memories</Text>
          <Pressable
            style={styles.toggleRow}
            onPress={() => router.push('/import-photos' as Parameters<typeof router.push>[0])}
          >
            <Text style={styles.toggleLabel}>Import from Photos</Text>
            <Ionicons name="chevron-forward" size={20} color="#8B9394" />
          </Pressable>
        </View>

        {/* Reading photos for faces: once, in the background. Placed under
            Memories because that is what it is — the same photos, read for
            who is in them. */}
        <FaceIndexCard />

        {/* Devices */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Devices</Text>
          <Pressable
            style={styles.toggleRow}
            onPress={() => router.push('/devices' as Parameters<typeof router.push>[0])}
          >
            <Text style={styles.toggleLabel}>Meta Glasses</Text>
            <Toggle value />
          </Pressable>
        </View>

        {/* Notifications */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notifications</Text>
          <View style={[styles.toggleRow, styles.rowDivider]}>
            <Text style={styles.toggleLabel}>Daily</Text>
            <Toggle value />
          </View>
          <View style={[styles.toggleRow, styles.rowDivider]}>
            <Text style={styles.toggleLabel}>Weekly</Text>
            <Toggle value />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Monthly</Text>
            <Toggle />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingBottom: 130 },
  back: { marginTop: 12 },

  headerBlock: { alignItems: 'center', marginTop: 8 },
  avatar: { width: 150, height: 150, borderRadius: 75, overflow: 'hidden' },
  name: { fontFamily: fonts.bold, fontSize: 24, color: '#1B1B1B', marginTop: 16 },
  joined: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394', marginTop: 4 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 22,
    marginTop: 24,
  },
  cardTitle: { fontFamily: fonts.bold, fontSize: 20, color: '#1B1B1B', marginBottom: 8 },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#EAEDED' },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: '#2B2B2B' },
  infoTextMuted: { color: '#9AA4A5' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  toggleLabel: { fontFamily: fonts.semiBold, fontSize: 16, color: '#2B2B2B' },
});
