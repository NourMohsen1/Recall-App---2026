import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../src/components/ScreenHeader';
import { MISC } from '../../src/images';
import { colors, fonts } from '../../src/theme';
import { withAppNav } from '../../src/components/AppNav';
import { makeStyles } from '../../src/appearance';

function GlassesDetail() {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Devices" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Ray-Ban Meta Glasses</Text>

        <Image source={MISC.glasses} style={styles.hero} resizeMode="contain" />

        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>42</Text>
            <Text style={styles.statLabel}>Scenes Captured</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>18</Text>
            <Text style={styles.statLabel}>Events Created</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingHorizontal: 24, paddingBottom: 140 },
  title: { fontFamily: fonts.bold, fontSize: 24, color: c.text, marginTop: 20 },
  hero: { width: '100%', height: 260, marginTop: 40 },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: c.chip,
    borderRadius: 20,
    paddingVertical: 26,
    marginTop: 40,
  },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: fonts.bold, fontSize: 30, color: c.text },
  statLabel: { fontFamily: fonts.regular, fontSize: 14, color: c.textMuted, marginTop: 6 },
}));

export default withAppNav(GlassesDetail);
