import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WEEKDAYS, dateWithOffset, getDayDetail, shortDate } from '../../../../src/data';
import { PERSON_PLACEHOLDER, personPhoto } from '../../../../src/images';
import { colors, fonts } from '../../../../src/theme';

export default function DayPeople() {
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
          {(detail?.people ?? []).map((p) => (
            <Link key={p.name} href={{ pathname: '/person/[name]', params: { name: p.name } }} asChild>
              <Pressable style={styles.col}>
                <Image
                  source={p.hasPhoto ? personPhoto(p.name) : PERSON_PLACEHOLDER}
                  style={styles.circle}
                  resizeMode="cover"
                />
                <Text style={styles.name}>{p.name}</Text>
              </Pressable>
            </Link>
          ))}
          {(detail?.places ?? []).slice(0, 3).map((place, i) => (
            <Pressable
              key={i}
              style={styles.col}
              onPress={() =>
                router.push({ pathname: '/day/[offset]/places', params: { offset: offsetNum } })
              }
            >
              <View style={styles.emptyCircle} />
              <Text style={styles.name}>Places</Text>
            </Pressable>
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
  col: { width: '30%', alignItems: 'center', marginBottom: 30 },
  circle: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    overflow: 'hidden',
  },
  emptyCircle: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C4C8C9',
    backgroundColor: colors.white,
  },
  name: { fontFamily: fonts.regular, fontSize: 14, color: '#2B2B2B', marginTop: 8 },
});
