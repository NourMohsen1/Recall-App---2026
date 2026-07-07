import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PillButton from '../src/components/PillButton';
import { ImportProgress, importRecentPhotos, requestLibraryPermission } from '../src/photoImport';
import { colors, fonts } from '../src/theme';

const PERIODS = [
  { days: 10, label: 'Last 10 days' },
  { days: 20, label: 'Last 20 days' },
  { days: 30, label: 'Last 30 days' },
];

type Phase = 'idle' | 'scanning' | 'done' | 'error';

export default function ImportPhotos() {
  const router = useRouter();
  const [selectedDays, setSelectedDays] = useState(10);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<ImportProgress>({ scanned: 0, imported: 0 });
  const [result, setResult] = useState<{ imported: number; days: number } | null>(null);

  const runImport = async () => {
    const granted = await requestLibraryPermission();
    if (!granted) {
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
      const res = await importRecentPhotos(selectedDays, setProgress);
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('idle');
    setResult(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
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
            <Text style={styles.sectionLabel}>How far back?</Text>
            <View style={styles.periodRow}>
              {PERIODS.map((p) => (
                <Pressable
                  key={p.days}
                  style={[styles.periodChip, selectedDays === p.days && styles.periodChipActive]}
                  onPress={() => setSelectedDays(p.days)}
                >
                  <Text
                    style={[
                      styles.periodText,
                      selectedDays === p.days && styles.periodTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.hint}>
              Keeping this bounded is intentional — a shorter window scans faster and keeps the
              app responsive. You can always run it again later to bring in more.
            </Text>

            <PillButton label="Import Photos" onPress={runImport} style={styles.cta} />
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
                : 'No new photos found in that window.'}
            </Text>
            <View style={styles.doneRow}>
              <PillButton label="Import again" variant="ghost" onPress={reset} style={styles.doneBtn} />
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

  sectionLabel: {
    alignSelf: 'flex-start',
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#1B1B1B',
    marginTop: 32,
    marginBottom: 12,
  },
  periodRow: { alignSelf: 'stretch', gap: 10 },
  periodChip: {
    borderWidth: 1.5,
    borderColor: '#DCE6E7',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  periodChipActive: { borderColor: colors.accent, backgroundColor: colors.pale },
  periodText: { fontFamily: fonts.medium, fontSize: 15, color: '#2B2B2B' },
  periodTextActive: { color: colors.primary, fontFamily: fonts.semiBold },

  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#8B9394',
    textAlign: 'center',
    marginTop: 20,
  },
  cta: { alignSelf: 'stretch', marginTop: 24 },

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
