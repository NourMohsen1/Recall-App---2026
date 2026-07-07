import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FilterPill from '../../src/components/FilterPill';
import PhotoTile, { TILE_SIZE } from '../../src/components/PhotoTile';
import ScreenHeader from '../../src/components/ScreenHeader';
import { PLACES } from '../../src/data';
import { PLACE_PLACEHOLDER, placePhoto } from '../../src/images';
import { colors, fonts } from '../../src/theme';

export default function Places() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Places" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <View style={styles.filterRow}>
          <FilterPill label="All" />
          <FilterPill label="2025" />
        </View>
        <View style={styles.grid}>
          {PLACES.map((place) => (
            <Link
              key={place.name}
              href={{ pathname: '/place/[name]', params: { name: place.name } }}
              asChild
            >
              <Pressable style={styles.placeCol}>
                <PhotoTile source={place.hasPhoto ? placePhoto(place.name) : PLACE_PLACEHOLDER} />
                <Text style={styles.placeName}>{place.name}</Text>
              </Pressable>
            </Link>
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
  placeCol: { width: TILE_SIZE, alignItems: 'center', marginTop: 24 },
  placeName: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#2B2B2B',
    marginTop: 8,
    textAlign: 'center',
  },
});
