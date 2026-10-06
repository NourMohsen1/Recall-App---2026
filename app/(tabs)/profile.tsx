import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import FaceIndexCard from '../../src/components/FaceIndexCard';
import { deleteAccount, getAccount, onAccountChanged, signInWithApple, signOut } from '../../src/account';
import { localFile } from '../../src/memoryLog';
import { crashReportingOn, sendTestCrashReport } from '../../src/crashReporting';
import {
  getRecapPrefs,
  sendTestRecapNotification,
  setRecapNotification,
  type RecapPrefs,
} from '../../src/recapNotifications';
import { PHOTO_READER, getPhotoReading, type PhotoReading } from '../../src/photoReading';
import { getPositiveFocus, setPositiveFocus } from '../../src/positiveFocus';
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
  const [photoReading, setPhotoReadingState] = useState<PhotoReading | null>(null);
  const [recapPrefs, setRecapPrefs] = useState<RecapPrefs>({ daily: true, weekly: true, monthly: false });
  const [positiveFocus, setPositiveFocusState] = useState(false);
  const [signedIn, setSignedIn] = useState(!!getAccount());
  useEffect(() => onAccountChanged(() => setSignedIn(!!getAccount())), []);

  // Signed in: sign out, or delete the account (Apple requires the option).
  // Signed out: one tap and Face ID.
  const accountPressed = async () => {
    if (!signedIn) {
      const result = await signInWithApple();
      if (!result.ok && !result.canceled) {
        Alert.alert('Couldn’t sign in', result.message ?? 'Try again in a moment.');
      }
      return;
    }
    Alert.alert('Your account', 'Signed in with Apple.', [
      { text: 'Sign out', onPress: () => signOut() },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Delete your account?',
            'Your account is removed. The memories on this phone stay — they are yours.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteAccount() },
            ],
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  useFocusEffect(
    useCallback(() => {
      getUserProfile().then(async (p) => {
        setProfile(p);
        setJoined(await joinedDate(p));
      });
      memoryCount().then(setEntries);
      getPhotoReading().then(setPhotoReadingState);
      getRecapPrefs().then(setRecapPrefs);
      getPositiveFocus().then(setPositiveFocusState);
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
            // Through localFile: the stored path points into the app container,
            // which iOS renames on every reinstall and update (memoryLog.ts).
            source={profile.photoUri ? { uri: localFile(profile.photoUri) } : PERSON_PLACEHOLDER}
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
          <InfoRow
            icon="logo-apple"
            label={signedIn ? 'Signed in with Apple' : 'Sign in with Apple'}
            muted={!signedIn}
            onPress={accountPressed}
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
            style={[styles.toggleRow, styles.rowDivider]}
            onPress={() => router.push('/import-photos' as Parameters<typeof router.push>[0])}
          >
            <Text style={styles.toggleLabel}>Import from Photos</Text>
            <Ionicons name="chevron-forward" size={20} color="#8B9394" />
          </Pressable>
          {/* Whether photos may be read to write each day's story — the
              user's choice, changeable any time. See src/photoReading.ts. */}
          <Pressable
            style={[styles.toggleRow, styles.rowDivider]}
            onPress={() => router.push({ pathname: '/photo-reading', params: { from: 'profile' } })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Reading your photos</Text>
              <Text style={styles.rowHint}>
                {photoReading === 'all'
                  ? `All past days · read by ${PHOTO_READER.name}`
                  : photoReading === 'chosen'
                    ? `Only days you choose · read by ${PHOTO_READER.name}`
                    : photoReading === 'off'
                      ? 'Off — no photos are sent'
                      : 'Not chosen yet'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#8B9394" />
          </Pressable>
          {/* Recaps leave painful moments out; Timeline and Ask keep them.
              See src/positiveFocus.ts. */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Positive Focus</Text>
              <Text style={styles.rowHint}>Recaps leave out painful moments</Text>
            </View>
            <Toggle
              value={positiveFocus}
              onChange={(on) => {
                setPositiveFocusState(on);
                setPositiveFocus(on);
              }}
            />
          </View>
        </View>

        {/* Reading photos for faces: once, in the background. Placed under
            Memories because that is what it is — the same photos, read for
            who is in them. */}
        <FaceIndexCard />

        {/* Development builds only: confirms crash reports reach Sentry. */}
        {__DEV__ && crashReportingOn && (
          <Pressable onPress={sendTestCrashReport} style={styles.devLink}>
            <Text style={styles.devLinkText}>Send a test crash report (development)</Text>
          </Pressable>
        )}
        {__DEV__ && (
          <Pressable onPress={sendTestRecapNotification} style={styles.devLink}>
            <Text style={styles.devLinkText}>Send a test recap notification in 5 s (development)</Text>
          </Pressable>
        )}

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
          {/* "Your recap is ready" — each on its own schedule. */}
          {(
            [
              ['daily', 'Daily recap', 'Every evening at 9 pm'],
              ['weekly', 'Weekly recap', 'Sundays at 7 pm'],
              ['monthly', 'Monthly recap', 'On the 1st of each month'],
            ] as const
          ).map(([cadence, label, when], i) => (
            <View key={cadence} style={[styles.toggleRow, i < 2 && styles.rowDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>{label}</Text>
                <Text style={styles.rowHint}>{when}</Text>
              </View>
              <Toggle
                value={recapPrefs[cadence]}
                onChange={async (on) => {
                  setRecapPrefs((p) => ({ ...p, [cadence]: on }));
                  const ok = await setRecapNotification(cadence, on);
                  if (!ok && on) {
                    setRecapPrefs((p) => ({ ...p, [cadence]: false }));
                    Alert.alert(
                      'Notifications are off',
                      'Allow notifications for Recall in Settings to get your recaps.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Open Settings', onPress: () => Linking.openSettings() },
                      ],
                    );
                  }
                }}
              />
            </View>
          ))}
        </View>
        {/* Licences that ask to be credited. */}
        <Text style={styles.credit}>Brain animation model: “Human Brain” by agher08 (Sketchfab), CC BY 4.0</Text>
        <Text style={styles.credit}>Ear animation model: “Human Ear Model” by ssavish274 (Sketchfab), CC BY 4.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  credit: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ABAC', textAlign: 'center', marginTop: 28 },
  devLink: { marginTop: 12, paddingVertical: 10, alignItems: 'center' },
  devLinkText: { fontFamily: fonts.medium, fontSize: 12, color: '#8B9394', textDecorationLine: 'underline' },
  rowHint: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },
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
