import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PhotoTile, { TILE_SIZE } from '../../../../src/components/PhotoTile';
import { WEEKDAYS, dateWithOffset, getDayDetail, shortDate } from '../../../../src/data';
import { PLACE_PLACEHOLDER, placePhoto } from '../../../../src/images';
import { colors, fonts } from '../../../../src/theme';

export default function DayPlaces() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const detail = getDayDetail(offsetNum);
  const date = dateWithOffset(offsetNum);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {WEEKDAYS[date.getDay()]}, {shortDate(date)}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.grid}>
          {(detail?.places ?? []).map((place) => (
            <Link
              key={place.name}
              href={{ pathname: '/place/[name]', params: { name: place.name } }}
              asChild
            >
              <Pressable style={styles.col}>
                <PhotoTile source={place.hasPhoto ? placePhoto(place.name) : PLACE_PLACEHOLDER} />
                <Text style={styles.name}>{place.name}</Text>
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
  header: { paddingTop: 12, paddingBottom: 20, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 140 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  col: { width: TILE_SIZE, alignItems: 'center', marginBottom: 30 },
  name: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#2B2B2B',
    marginTop: 8,
    textAlign: 'center',
  },
});
