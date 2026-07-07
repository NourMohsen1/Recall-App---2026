import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FilterPill from '../../src/components/FilterPill';
import ScreenHeader from '../../src/components/ScreenHeader';
import { PEOPLE } from '../../src/data';
import { PERSON_PLACEHOLDER, personPhoto } from '../../src/images';
import { colors, fonts } from '../../src/theme';

function Avatar({ name, hasPhoto }: { name: string; hasPhoto: boolean }) {
  return (
    <Link href={{ pathname: '/person/[name]', params: { name } }} asChild>
      <Pressable style={styles.personCol}>
        <View style={styles.avatarRing}>
          <Image
            source={hasPhoto ? personPhoto(name) : PERSON_PLACEHOLDER}
            style={styles.avatar}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.personName}>{name}</Text>
      </Pressable>
    </Link>
  );
}

export default function People() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="People" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <View style={styles.filterRow}>
          <FilterPill label="All" />
          <FilterPill label="2025" />
        </View>
        <View style={styles.grid}>
          {PEOPLE.map((p) => (
            <Avatar key={p.name} name={p.name} hasPhoto={p.hasPhoto} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  personCol: { width: '30%', alignItems: 'center', marginTop: 24 },
  avatarRing: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: colors.white,
    padding: 4,
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  personName: { fontFamily: fonts.regular, fontSize: 14, color: '#2B2B2B', marginTop: 8 },
});
