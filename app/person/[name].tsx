import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { WEEKDAYS } from '../../src/data';
import { LoggedMemory, getMemoriesByDay } from '../../src/memoryLog';
import {
  PersonMeta,
  PersonSummary,
  avatarTint,
  getPeopleSummaries,
  getPersonMeta,
  lastSeenLabel,
  removePersonEverywhere,
  verifyPerson,
} from '../../src/peopleTags';
import { DetectedPlace, getAllDayPlaces } from '../../src/placesFromPhotos';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function parseDay(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function offsetFromDay(dayKey: string): number {
  const target = parseDay(dayKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function longDay(dayKey: string): string {
  const d = parseDay(dayKey);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export default function PersonProfile() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();

  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [dayPlaces, setDayPlaces] = useState<Record<string, DetectedPlace[]>>({});
  const [meta, setMeta] = useState<PersonMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getPeopleSummaries(),
        getMemoriesByDay(),
        getAllDayPlaces(),
        name ? getPersonMeta(name) : Promise.resolve(null),
      ]).then(([summaries, memories, places, personMeta]) => {
        setPerson(summaries.find((p) => p.name === name) ?? null);
        setByDay(memories);
        setDayPlaces(places);
        setMeta(personMeta);
        setLoaded(true);
      });
    }, [name]),
  );

  const openDay = (dayKey: string) =>
    router.push(`/day/${offsetFromDay(dayKey)}` as Parameters<typeof router.push>[0]);

  const confirmPerson = async () => {
    if (!name) return;
    await verifyPerson(name);
    setMeta((prev) => (prev ? { ...prev, verified: true } : { verified: true, mentions: [] }));
  };
  const removePerson = async () => {
    if (!name) return;
    await removePersonEverywhere(name);
    router.dismissTo('/people');
  };

  // The most recent day together drives the "quick recap" block.
  const lastDay = person?.lastSeenDay;
  const lastMemories = lastDay ? (byDay.get(lastDay) ?? []) : [];
  const lastNotes = lastMemories.map((m) => m.text).filter(Boolean) as string[];
  const lastPhotos = lastMemories
    .filter((m) => m.kind === 'photo')
    .flatMap((m) => m.photoUris ?? []);
  const lastPlaces = lastDay ? (dayPlaces[lastDay] ?? []) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* Primary entry is the People list — explicit target for the same
            reason noted in day/[offset]/index.tsx. */}
        <Pressable onPress={() => router.dismissTo('/people')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loaded && !person && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="account-question-outline" size={40} color="#AEB6B7" />
            <Text style={styles.emptyText}>
              No days tagged with {name ?? 'this person'} yet — open a day in your Timeline and
              add them under People.
            </Text>
          </View>
        )}

        {person && (
          <>
            {/* Identity */}
            <View style={styles.identity}>
              <View style={[styles.bigAvatar, { backgroundColor: avatarTint(person.name) }]}>
                <Text style={styles.bigAvatarText}>{initials(person.name)}</Text>
              </View>
              <Text style={styles.name}>{person.name}</Text>
              {meta?.descriptor && <Text style={styles.descriptor}>{meta.descriptor}</Text>}
              <Text style={styles.subLine}>
                {person.days.length === 1
                  ? 'You’ve shared 1 day together'
                  : `You’ve shared ${person.days.length} days together`}
                {' · '}since {lastSeenLabel(person.firstSeenDay)}
              </Text>
            </View>

            {/* AI-created and not confirmed yet — ask the user to verify */}
            {meta && meta.verified === false && (
              <View style={styles.verifyCard}>
                <MaterialCommunityIcons name="auto-fix" size={18} color={colors.teal} />
                <Text style={styles.verifyText}>
                  Recall added {person.name} from something you logged — does this look right?
                </Text>
                <View style={styles.verifyRow}>
                  <Pressable style={styles.verifyBtn} onPress={confirmPerson}>
                    <Text style={styles.verifyBtnText}>Looks right</Text>
                  </Pressable>
                  <Pressable style={styles.verifyRemove} onPress={removePerson}>
                    <Text style={styles.verifyRemoveText}>Remove person</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Quick recap of the last time together */}
            <Pressable style={styles.recapCard} onPress={() => openDay(person.lastSeenDay)}>
              <View style={styles.recapHeader}>
                <Text style={styles.recapTitle}>
                  Last seen {lastSeenLabel(person.lastSeenDay)}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#B4B8B8" />
              </View>
              <Text style={styles.recapDate}>{longDay(person.lastSeenDay)}</Text>

              {lastPlaces.length > 0 && (
                <View style={styles.placeRow}>
                  <MaterialCommunityIcons name="map-marker" size={15} color={colors.teal} />
                  <Text style={styles.placeText}>
                    {lastPlaces.map((p) => p.label).join(' · ')}
                  </Text>
                </View>
              )}

              {lastNotes.slice(0, 3).map((line, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={[styles.bulletText, rtlIfArabic(line)]}>{line}</Text>
                </View>
              ))}
              {lastNotes.length === 0 && lastPhotos.length === 0 && (
                <Text style={styles.recapMuted}>Nothing else was logged that day.</Text>
              )}

              {lastPhotos.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                  <View style={styles.photoRow}>
                    {lastPhotos.slice(0, 6).map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.photoTile} resizeMode="cover" />
                    ))}
                  </View>
                </ScrollView>
              )}
            </Pressable>

            {/* What the user has said about this person across loggings */}
            {meta && meta.mentions.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>What you’ve logged about {person.name}</Text>
                {meta.mentions.map((m) => (
                  <Pressable
                    key={`${m.day}-${m.text}`}
                    style={styles.mentionRow}
                    onPress={() => openDay(m.day)}
                  >
                    <MaterialCommunityIcons name="text-long" size={15} color={colors.teal} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.mentionText, rtlIfArabic(m.text)]}>{m.text}</Text>
                      <Text style={styles.mentionDay}>{longDay(m.day)}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* Every day you've been together */}
            <Text style={styles.sectionTitle}>Days with {person.name}</Text>
            {person.days.map((day) => {
              const note = byDay.get(day)?.map((m) => m.text).find(Boolean);
              const place = dayPlaces[day]?.[0]?.label;
              return (
                <Pressable key={day} style={styles.dayRow} onPress={() => openDay(day)}>
                  <View style={styles.dayDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dayLabel}>{longDay(day)}</Text>
                    {(place || note) && (
                      <Text numberOfLines={1} style={[styles.daySnippet, note ? rtlIfArabic(note) : undefined]}>
                        {[place, note].filter(Boolean).join(' — ')}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#B4B8B8" />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 24, paddingBottom: 140 },

  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 20, gap: 14 },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#8B9394',
    textAlign: 'center',
  },

  identity: { alignItems: 'center', marginTop: 26 },
  bigAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigAvatarText: { fontFamily: fonts.semiBold, fontSize: 38, color: colors.white },
  name: { fontFamily: fonts.bold, fontSize: 30, color: '#1B1B1B', marginTop: 14 },
  descriptor: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.teal, marginTop: 2 },
  subLine: { fontFamily: fonts.regular, fontSize: 13, color: '#5B6364', marginTop: 4 },

  verifyCard: {
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 20,
    padding: 16,
    marginTop: 22,
    alignItems: 'center',
    gap: 8,
  },
  verifyText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: '#3E4647',
    textAlign: 'center',
  },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  verifyBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  verifyBtnText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  verifyRemove: { paddingVertical: 10 },
  verifyRemoveText: { fontFamily: fonts.medium, fontSize: 13, color: '#B24545' },

  mentionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF1F1',
  },
  mentionText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#3E4647' },
  mentionDay: { fontFamily: fonts.regular, fontSize: 12, color: '#9AA4A5', marginTop: 2 },

  recapCard: {
    backgroundColor: colors.pale,
    borderRadius: 22,
    padding: 18,
    marginTop: 26,
  },
  recapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recapTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B' },
  recapDate: { fontFamily: fonts.regular, fontSize: 13, color: '#5B6364', marginTop: 2 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  placeText: { fontFamily: fonts.medium, fontSize: 13, color: colors.teal, flex: 1 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginTop: 7 },
  bulletText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#3E4647' },
  recapMuted: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', marginTop: 12 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoTile: { width: 96, height: 96, borderRadius: 14, overflow: 'hidden' },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B', marginTop: 30, marginBottom: 6 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF1F1',
  },
  dayDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  dayLabel: { fontFamily: fonts.medium, fontSize: 14, color: '#2B2B2B' },
  daySnippet: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },
});
