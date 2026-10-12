import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import ScreenHeader from '../src/components/ScreenHeader';
import { colors, fonts } from '../src/theme';

// About Recall: the version, the privacy and support pages, and the credits
// the 3D models' licences ask for (CC BY 4.0). They used to sit as two lines
// at the bottom of Profile; here they have room and their own place.

const SITE = 'https://recall-keys.nourmohsen-recall.workers.dev';

const CREDITS = [
  { what: 'Brain animation', title: '“Human Brain”', by: 'agher08', where: 'Sketchfab', licence: 'CC BY 4.0' },
  { what: 'Ear animation', title: '“Human Ear Model”', by: 'ssavish274', where: 'Sketchfab', licence: 'CC BY 4.0' },
];

function LinkRow({ icon, label, url }: { icon: keyof typeof Ionicons.glyphMap; label: string; url: string }) {
  return (
    <Pressable style={styles.row} onPress={() => Linking.openURL(url).catch(() => {})}>
      <Ionicons name={icon} size={20} color={colors.teal} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="open-outline" size={16} color="#A3ABAC" />
    </Pressable>
  );
}

export default function About() {
  const version = Constants.expoConfig?.version ?? '';
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="About Recall" backTo="/profile" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.appName}>Recall: Memory Journal</Text>
          {version ? <Text style={styles.version}>Version {version}</Text> : null}
        </View>

        <View style={styles.card}>
          <LinkRow icon="shield-checkmark-outline" label="Privacy" url={`${SITE}/privacy`} />
          <View style={styles.divider} />
          <LinkRow icon="help-circle-outline" label="Support" url={`${SITE}/support`} />
        </View>

        <Text style={styles.sectionTitle}>Credits</Text>
        <View style={styles.card}>
          {CREDITS.map((c, i) => (
            <View key={c.what}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.credit}>
                <Text style={styles.creditWhat}>{c.what}</Text>
                <Text style={styles.creditText}>
                  {c.title} by {c.by} ({c.where}), {c.licence}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { padding: 20, paddingBottom: 60, gap: 14 },
  card: { backgroundColor: colors.white, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 6 },
  appName: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.ink, paddingTop: 12 },
  version: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', paddingBottom: 12, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#D9E0E0' },
  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#5B6364', marginTop: 8, marginLeft: 6 },
  credit: { paddingVertical: 12 },
  creditWhat: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  creditText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#6B7475', marginTop: 2 },
});
