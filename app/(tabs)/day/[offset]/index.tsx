import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { WEEKDAYS, dateWithOffset, getDayDetail, shortDate } from '../../../../src/data';
import { placePhoto } from '../../../../src/images';
import {
  LoggedMemory,
  dateKey,
  formatClockTime,
  getMemoriesByDay,
} from '../../../../src/memoryLog';
import { rtlIfArabic } from '../../../../src/transcription';
import { colors, fonts } from '../../../../src/theme';

export default function DayDetailScreen() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const detail = getDayDetail(offsetNum);
  const date = dateWithOffset(offsetNum);

  const [real, setReal] = useState<LoggedMemory[]>([]);
  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then((byDay) => setReal(byDay.get(dateKey(dateWithOffset(offsetNum))) ?? []));
    }, [offsetNum]),
  );
  const realPhotoUris = real.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []);
  const entries = real.filter((m) => m.kind !== 'photo' || m.text);
  const hasVoice = real.some((m) => m.kind === 'voice');

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
        {/* What the user actually logged that day */}
        {entries.length > 0 && (
          <View style={[styles.segments, { marginBottom: 10 }]}>
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

        {detail && (
          <View style={styles.segments}>
            {/* Timeline spine */}
            <View style={styles.spine} />
            {detail.segments.map((segment) => (
              <View key={segment.period} style={styles.segment}>
                <View style={styles.spineDot} />
                <View style={{ flex: 1 }}>
                  <View style={styles.segmentHeader}>
                    <Text style={styles.segmentTitle}>{segment.period}</Text>
                    <View style={styles.timePill}>
                      <Text style={styles.timePillText}>{segment.time}</Text>
                    </View>
                  </View>
                  <Text style={styles.segmentText}>{segment.text}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {(detail || hasVoice) && (
          <Pressable
            style={styles.sourceBtn}
            onPress={() =>
              router.push({ pathname: '/day/[offset]/source', params: { offset: offsetNum } })
            }
          >
            <Text style={styles.sourceBtnText}>Source</Text>
          </Pressable>
        )}

        {(detail || realPhotoUris.length > 0) && (
          <>
            <View style={styles.divider} />
            {/* Photos from the day — real logged photos first */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photoRow}>
                {realPhotoUris.length > 0
                  ? realPhotoUris.map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.photo} resizeMode="cover" />
                    ))
                  : detail?.places
                      .slice(0, 3)
                      .map((place) => (
                        <Image
                          key={place.name}
                          source={placePhoto(place.name)}
                          style={styles.photo}
                          resizeMode="cover"
                        />
                      ))}
              </View>
            </ScrollView>
          </>
        )}

        {!detail && entries.length === 0 && realPhotoUris.length === 0 && (
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

  segments: { position: 'relative' },
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

  empty: { paddingTop: 80, alignItems: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },
});
