import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PillButton from '../../src/components/PillButton';
import ScreenHeader from '../../src/components/ScreenHeader';
import { MISC } from '../../src/images';
import { colors, fonts } from '../../src/theme';

export default function Devices() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Devices" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Connected to Recall</Text>

        {/* Connected glasses */}
        <Pressable style={styles.connectedCard} onPress={() => router.push('/devices/glasses' as Parameters<typeof router.push>[0])}>
          <Image source={MISC.glasses} style={styles.glassesImg} resizeMode="contain" />
          <View style={styles.connectedInfo}>
            <Text style={styles.deviceName}>Ray-Ban Meta Wayfarer Gen 1 Glasses</Text>
            <Text style={styles.deviceSub}>Synced just now</Text>
          </View>
          <View style={styles.battery}>
            <Ionicons name="battery-half" size={26} color={colors.primary} />
            <Text style={styles.batteryText}>88%</Text>
          </View>
        </Pressable>

        <Text style={styles.section}>Add New Devices</Text>

        {/* Add AirPods */}
        <View style={styles.addCard}>
          <Image source={MISC.airpods} style={styles.airpodsImg} resizeMode="contain" />
          <View style={styles.addInfo}>
            <Text style={styles.deviceName}>Airpods</Text>
            <Text style={styles.addDesc}>Add your AirPods to help catch your logs</Text>
            <Pressable>
              <Text style={styles.addLink}>Add Airpods</Text>
            </Pressable>
          </View>
        </View>

        <PillButton label="Add more devices" style={styles.addMore} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.white },
  scroll: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 140 },
  section: { fontFamily: fonts.bold, fontSize: 24, color: '#1B1B1B', marginTop: 24, marginBottom: 16 },

  connectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.pale,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  glassesImg: { width: 90, height: 60 },
  connectedInfo: { flex: 1 },
  deviceName: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B', lineHeight: 22 },
  deviceSub: { fontFamily: fonts.regular, fontSize: 14, color: '#5B6364', marginTop: 8 },
  battery: { alignItems: 'center' },
  batteryText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#1B1B1B', marginTop: 2 },

  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.pale,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  airpodsImg: { width: 100, height: 100 },
  addInfo: { flex: 1 },
  addDesc: { fontFamily: fonts.regular, fontSize: 14, color: '#3E4647', marginTop: 8, lineHeight: 21 },
  addLink: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#0E7C66',
    marginTop: 16,
    alignSelf: 'flex-end',
  },

  addMore: { alignSelf: 'stretch', marginTop: 40, marginHorizontal: 8 },
});
