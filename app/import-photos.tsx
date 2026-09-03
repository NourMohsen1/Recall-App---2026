import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PillButton from '../src/components/PillButton';
import { runPhotoAnalysisNow } from '../src/photoAnalysisQueue';
import {
  ImportProgress,
  backfillPhotoMeta,
  importRecentPhotos,
  requestLibraryPermission,
} from '../src/photoImport';
import { colors, fonts } from '../src/theme';

// Matches the Timeline's own "at least a year back" window — one flat sync
// window instead of asking the user to pick a day count.
const SYNC_DAYS = 365;

type Phase = 'idle' | 'scanning' | 'done' | 'error';

export default function ImportPhotos() {
  const router = useRouter();
  const [syncOn, setSyncOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ImportProgress>({ scanned: 0, imported: 0 });
  const [result, setResult] = useState<{ imported: number; days: number } | null>(null);

  const runImport = async () => {
    const granted = await requestLibraryPermission();
    if (!granted) {
      setSyncOn(false);
      Alert.alert(
        'Photo access needed',
        'Allow photo library access in Settings so Recall can import your photos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    setPhase('scanning');
    setProgress({ scanned: 0, imported: 0 });
    try {
      // One-time-only: labels any photo imported before source detection
      // existed. A no-op on every run after the first.
      await backfillPhotoMeta(SYNC_DAYS, ({ scanned }) => setProgress({ scanned, imported: 0 }));
      const res = await importRecentPhotos(SYNC_DAYS, setProgress);
      setResult(res);
      setPhase('done');
      // Analyzes every day of photos it hasn't seen yet so the Ask chatbot
      // has the whole year available, not just days the user happens to
      // open. Deliberately not awaited — this can take a while on a big
      // library, and there's nothing on this screen for it to update.
      runPhotoAnalysisNow();
    } catch {
      setPhase('error');
    }
  };

  // The toggle IS the trigger: flipping it on starts the sync immediately.
  // Flipping it off before/after a sync is just a visual reset — there's no
  // import to undo, so it's harmless either way.
  const handleToggle = (value: boolean) => {
    setSyncOn(value);
    if (value && phase !== 'scanning') runImport();
  };

  const reset = () => {
    setPhase('idle');
    setResult(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* Only ever opened from Profile — explicit target for the same
            reason noted in day/[offset]/index.tsx. */}
        <Pressable onPress={() => router.dismissTo('/profile')} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={26} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Import Photos</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.iconBadge}>
          <Ionicons name="images-outline" size={36} color={colors.primary} />
        </View>

        <Text style={styles.title}>Bring in photos you already took</Text>
        <Text style={styles.body}>
          Recall scans your photo library and places each photo on the day it was actually taken —
          so your past days fill in automatically, without you logging them one by one.
        </Text>

        {phase === 'idle' && (
          <>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Sync photos</Text>
                <Text style={styles.toggleSubtitle}>Imports everything from the last 12 months</Text>
              </View>
              <Switch
                value={syncOn}
                onValueChange={handleToggle}
                trackColor={{ false: '#DCE0E0', true: colors.accent }}
                thumbColor={colors.white}
              />
            </View>

            <Text style={styles.hint}>
              A full year the first time may take a moment — after that, running it again only
              picks up what's new.
            </Text>
          </>
        )}

        {phase === 'scanning' && (
          <View style={styles.statusBox}>
            <Text style={styles.statusTitle}>Scanning your library…</Text>
            <Text style={styles.statusDetail}>
              {progress.scanned} photo{progress.scanned === 1 ? '' : 's'} checked
            </Text>
          </View>
        )}

        {phase === 'done' && result && (
          <View style={styles.statusBox}>
            <Ionicons name="checkmark-circle" size={40} color={colors.accent} />
            <Text style={styles.statusTitle}>
              {result.imported > 0
                ? `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'} across ${result.days} day${result.days === 1 ? '' : 's'}`
                : 'All caught up'}
            </Text>
            <Text style={styles.statusDetail}>
              {result.imported > 0
                ? 'Check your Timeline to see them on their original days.'
                : 'No new photos found in the last 12 months.'}
            </Text>
            <View style={styles.doneRow}>
              <PillButton label="Sync again" variant="ghost" onPress={runImport} style={styles.doneBtn} />
              <PillButton
                label="Go to Timeline"
                onPress={() => router.replace('/timeline')}
                style={styles.doneBtn}
              />
            </View>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.statusBox}>
            <Ionicons name="alert-circle-outline" size={36} color="#B24545" />
            <Text style={styles.statusTitle}>Something went wrong</Text>
            <PillButton label="Try again" onPress={reset} style={styles.doneBtn} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: '#2B2B2B' },

  scroll: { padding: 28, alignItems: 'center' },
  iconBadge: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 20,
    color: '#1B1B1B',
    textAlign: 'center',
    marginTop: 20,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#5B6364',
    textAlign: 'center',
    marginTop: 12,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.pale,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 32,
    gap: 12,
  },
  toggleTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B' },
  toggleSubtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#5B6364', marginTop: 2 },

  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#8B9394',
    textAlign: 'center',
    marginTop: 20,
  },

  statusBox: { alignItems: 'center', marginTop: 40, gap: 8 },
  statusTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 17,
    color: '#1B1B1B',
    textAlign: 'center',
  },
  statusDetail: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', textAlign: 'center' },
  doneRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  doneBtn: { flex: 1 },
});
