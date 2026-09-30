import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../src/components/ScreenHeader';
import { photoUnderstandingAvailable, runPhotoPilot, type PilotReport } from '../../src/photoPilot';
import { colors, fonts } from '../../src/theme';

// The photo-understanding test (development builds only). Runs on the
// phone, compares with DeepSeek day by day, and changes nothing.

const LONG_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${LONG_DAY[dt.getDay()]} ${d} ${MONTH[m - 1]} ${y}`;
}

export default function PhotoPilot() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<PilotReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(
        await runPhotoPilot({
          onProgress: (p) => setProgress(`Day ${p.day} of ${p.days} · photo ${p.photo} of ${p.photos}`),
        }),
      );
    } catch (e) {
      console.warn('[pilot] failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const avg = (k: 'fetch' | 'vision' | 'clip') =>
    report && report.days.length
      ? Math.round(report.days.reduce((s, d) => s + d.msPerPhoto[k], 0) / report.days.length)
      : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Photo test" backTo="/profile" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Reads about 20 of your days with photos entirely on this phone, then shows what it found
          next to what DeepSeek wrote. Nothing is sent anywhere and nothing in the app changes.
        </Text>

        {!photoUnderstandingAvailable ? (
          <Text style={styles.error}>This build doesn't have the photo model yet — it needs the new install.</Text>
        ) : (
          <Pressable style={[styles.run, running && { opacity: 0.6 }]} onPress={run} disabled={running}>
            {running ? <ActivityIndicator color={colors.white} /> : <Text style={styles.runText}>Run the test</Text>}
          </Pressable>
        )}
        {running && <Text style={styles.progress}>{progress}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        {report && (
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              {report.days.length} days in {Math.round(report.totalMs / 1000)} s · model loaded in{' '}
              {report.modelLoadMs} ms · per photo: {avg('clip')} ms model, {avg('vision')} ms labels,{' '}
              {avg('fetch')} ms fetching
            </Text>
          </View>
        )}

        {report?.days.map((d) => (
          <View key={d.day} style={styles.card}>
            <Text style={styles.day}>{dayLabel(d.day)}</Text>
            <Text style={styles.meta}>
              {d.analyzed} of {d.photos} photos read{d.failed ? ` · ${d.failed} unreadable` : ''}
            </Text>

            <Text style={styles.label}>On this phone</Text>
            <Text style={styles.text}>{d.draft}</Text>
            <View style={styles.tags}>
              {d.tags.slice(0, 6).map((t) => (
                <View key={t.id} style={[styles.tag, t.score < 0.02 && styles.tagWeak]}>
                  <Text style={styles.tagText}>
                    {t.label} {Math.round(t.score * 100)}%
                  </Text>
                </View>
              ))}
            </View>
            {d.vision.length > 0 && (
              <Text style={styles.vision}>Apple labels: {d.vision.map((v) => v.id.replace(/_/g, ' ')).join(', ')}</Text>
            )}

            <Text style={styles.label}>DeepSeek</Text>
            <Text style={[styles.text, !d.deepseek && styles.muted]}>
              {d.deepseek ?? 'No DeepSeek summary for this day.'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: '#EFF3F3' },
  scroll: { padding: 20, paddingBottom: 80 },
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#3A4243' },
  run: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  runText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },
  progress: { fontFamily: fonts.medium, fontSize: 13, color: colors.teal, marginTop: 10, textAlign: 'center' },
  error: { fontFamily: fonts.medium, fontSize: 13, color: '#B24545', marginTop: 12 },
  summary: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: colors.white },
  summaryText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: '#2B2B2B' },
  card: { marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: colors.white },
  day: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B' },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },
  label: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.teal, marginTop: 12, textTransform: 'uppercase' },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#2B2B2B', marginTop: 4 },
  muted: { color: '#9AA4A5' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { backgroundColor: colors.pale, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  tagWeak: { opacity: 0.5 },
  tagText: { fontFamily: fonts.medium, fontSize: 11, color: colors.primary },
  vision: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: '#6B7475', marginTop: 8 },
});
