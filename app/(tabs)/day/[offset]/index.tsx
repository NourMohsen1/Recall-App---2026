import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../../../../src/components/AnalyzingBanner';
import PeopleEditor from '../../../../src/components/PeopleEditor';
import { WEEKDAYS, dateWithOffset, shortDate } from '../../../../src/data';
import { useMemoryPolish } from '../../../../src/memoryIntake';
import {
  LoggedMemory,
  dateKey,
  formatClockTime,
  getMemoriesByDay,
} from '../../../../src/memoryLog';
import {
  addPersonForDay,
  getAllTaggedPeople,
  getPeopleForDay,
  removePersonForDay,
} from '../../../../src/peopleTags';
import { DetectedPlace, getPlacesForDay } from '../../../../src/placesFromPhotos';
import { rtlIfArabic } from '../../../../src/transcription';
import { colors, fonts } from '../../../../src/theme';

export default function DayDetailScreen() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const date = dateWithOffset(offsetNum);

  const [real, setReal] = useState<LoggedMemory[]>([]);
  const [places, setPlaces] = useState<DetectedPlace[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<string[]>([]);
  const dayKey = dateKey(dateWithOffset(offsetNum));
  const reload = useCallback(() => {
    const key = dateKey(dateWithOffset(offsetNum));
    getMemoriesByDay().then((byDay) => setReal(byDay.get(key) ?? []));
    getPlacesForDay(key).then(setPlaces);
    getPeopleForDay(key).then(setPeople);
    getAllTaggedPeople().then(setPeopleSuggestions);
  }, [offsetNum]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // This screen previously never re-checked for unpolished memories, so a
  // day opened straight from Tasks/People/Recap could show a raw transcript
  // forever even after other screens had "fixed" it. Now every entry point
  // sweeps and refreshes.
  const analyzing = useMemoryPolish(reload);
  const realPhotoUris = real.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []);
  const entries = real.filter((m) => m.kind !== 'photo' || m.text);
  const hasVoice = real.some((m) => m.kind === 'voice');
  const isEmpty =
    entries.length === 0 && realPhotoUris.length === 0 && places.length === 0 && people.length === 0;

  const addPerson = async (name: string) => {
    await addPersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
    setPeopleSuggestions(await getAllTaggedPeople());
  };
  const removePerson = async (name: string) => {
    await removePersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
  };

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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {analyzing && <AnalyzingBanner />}

        {/* What the user actually logged that day */}
        {entries.length > 0 && (
          <View style={styles.segments}>
            <View style={styles.spine} />
            {entries.map((m) => (
              <View key={m.id} style={styles.segment}>
                <View style={styles.spineDot} />
                <View style={{ flex: 1 }}>
                  <View style={styles.segmentHeader}>
                    {/* Voice is just an input method — once transcribed it reads
                        as a plain note, not a distinct "voice note" type. */}
                    <Text style={styles.segmentTitle}>{m.kind === 'photo' ? 'Photos' : 'Note'}</Text>
                    <View style={styles.timePill}>
                      <Text style={styles.timePillText}>
                        ≈ {formatClockTime(new Date(m.takenAt))}
                      </Text>
                    </View>
                  </View>

                  {m.text ? (
                    <Text style={[styles.segmentText, rtlIfArabic(m.text)]}>{m.text}</Text>
                  ) : m.kind === 'voice' ? (
                    // No transcript yet — the audio is the only content we have.
                    <Text style={styles.segmentText}>Voice memory — no transcript yet.</Text>
                  ) : null}

                  {m.note && <Text style={[styles.noteText, rtlIfArabic(m.note)]}>📝 {m.note}</Text>}

                  {m.kind === 'voice' && (
                    <Pressable
                      style={styles.sourceLink}
                      onPress={() =>
                        router.push({
                          pathname: '/day/[offset]/source',
                          params: { offset: offsetNum },
                        })
                      }
                    >
                      <MaterialCommunityIcons name="microphone-outline" size={14} color="#8B9394" />
                      <Text style={styles.sourceLinkText}>Recorded by voice — tap to listen</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {hasVoice && (
          <Pressable
            style={styles.sourceBtn}
            onPress={() =>
              router.push({ pathname: '/day/[offset]/source', params: { offset: offsetNum } })
            }
          >
            <Text style={styles.sourceBtnText}>Source</Text>
          </Pressable>
        )}

        {realPhotoUris.length > 0 && (
          <>
            <View style={styles.divider} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photoRow}>
                {realPhotoUris.map((uri, i) => (
                  <Pressable
                    key={uri}
                    onPress={() =>
                      router.push({
                        pathname: '/day/[offset]/photos',
                        params: { offset: offsetNum, start: i },
                      })
                    }
                  >
                    <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {places.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.placesTitle}>Places</Text>
            <View style={styles.placeGrid}>
              {places.map((place) => (
                <View key={`${place.label}-${place.latitude ?? 'named'}`} style={styles.placeCell}>
                  <View style={styles.placePin}>
                    <MaterialCommunityIcons name="map-marker" size={28} color={colors.teal} />
                  </View>
                  <Text numberOfLines={1} style={styles.placeLabel}>
                    {place.label}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.placesTitle}>People</Text>
        <PeopleEditor
          people={people}
          suggestions={peopleSuggestions}
          onAdd={addPerson}
          onRemove={removePerson}
        />

        {isEmpty && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No memories recorded for this day yet.</Text>
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
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: '#2B2B2B' },
  scroll: { padding: 24, paddingBottom: 140 },

  segments: { position: 'relative', marginBottom: 10 },
  spine: {
    position: 'absolute',
    left: 9,
    top: 10,
    bottom: 30,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#8FA6A9',
  },
  segment: { flexDirection: 'row', gap: 18, marginBottom: 34 },
  spineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    marginTop: 2,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  segmentTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#111' },
  timePill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  timePillText: { fontFamily: fonts.regular, fontSize: 12, color: colors.white },
  segmentText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#5B6364',
    marginTop: 6,
  },

  sourceBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  sourceBtnText: { fontFamily: fonts.regular, fontSize: 14, color: '#0E1B1C' },
  divider: { height: 1, backgroundColor: '#C6CCCC', marginVertical: 20 },
  photoRow: { flexDirection: 'row', gap: 12 },
  photo: {
    width: 170,
    height: 155,
    borderRadius: 16,
    overflow: 'hidden',
  },

  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  sourceLinkText: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },
  noteText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#7C8586', marginTop: 6 },

  placesTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#111', marginBottom: 14 },
  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  placeCell: { width: 88, alignItems: 'center' },
  placePin: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#4A5253', marginTop: 6 },

  empty: { paddingTop: 80, alignItems: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },
});
