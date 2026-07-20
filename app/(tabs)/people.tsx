import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ScreenHeader from '../../src/components/ScreenHeader';
import { LoggedMemory, getMemoriesByDay } from '../../src/memoryLog';
import {
  PersonMeta,
  PersonSummary,
  avatarTint,
  getAllPersonMeta,
  getPeopleSummaries,
  lastSeenLabel,
} from '../../src/peopleTags';
import { DetectedPlace, getAllDayPlaces } from '../../src/placesFromPhotos';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

// One person, recap-style: who they are to your log — when you last saw
// them, where that was, and what you noted that day.
function PersonCard({
  person,
  meta,
  lastPlace,
  lastNote,
}: {
  person: PersonSummary;
  meta?: PersonMeta;
  lastPlace?: string;
  lastNote?: string;
}) {
  const seenLine = [`Last seen ${lastSeenLabel(person.lastSeenDay)}`, lastPlace ? `at ${lastPlace}` : null]
    .filter(Boolean)
    .join(' ');
  const unverified = meta ? meta.verified === false : false;

  return (
    <Link href={{ pathname: '/person/[name]', params: { name: person.name } }} asChild>
      {/* Link's <a> on web can't take a style array — flatten to one object */}
      <Pressable style={StyleSheet.flatten([styles.card, unverified && styles.cardUnverified])}>
        <View style={[styles.avatar, { backgroundColor: avatarTint(person.name) }]}>
          <Text style={styles.avatarText}>{initials(person.name)}</Text>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.nameRow}>
            <Text style={styles.personName}>{person.name}</Text>
            {unverified && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>New — review</Text>
              </View>
            )}
          </View>
          {meta?.descriptor && <Text style={styles.descriptor}>{meta.descriptor}</Text>}
          <Text style={styles.seenLine}>{seenLine}</Text>
          {lastNote ? (
            <Text numberOfLines={2} style={[styles.noteLine, rtlIfArabic(lastNote)]}>
              “{lastNote}”
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="calendar-heart" size={13} color={colors.teal} />
            <Text style={styles.metaText}>
              {person.days.length === 1 ? '1 day together' : `${person.days.length} days together`}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#B4B8B8" />
      </Pressable>
    </Link>
  );
}

export default function People() {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [dayPlaces, setDayPlaces] = useState<Record<string, DetectedPlace[]>>({});
  const [meta, setMeta] = useState<Record<string, PersonMeta>>({});
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getPeopleSummaries(),
        getMemoriesByDay(),
        getAllDayPlaces(),
        getAllPersonMeta(),
      ]).then(([summaries, memories, places, personMeta]) => {
        setPeople(summaries);
        setByDay(memories);
        setDayPlaces(places);
        setMeta(personMeta);
        setLoaded(true);
      });
    }, []),
  );

  // The recap details for each person's most recent day together.
  const lastPlaceOf = (p: PersonSummary) => dayPlaces[p.lastSeenDay]?.[0]?.label;
  const lastNoteOf = (p: PersonSummary) =>
    byDay.get(p.lastSeenDay)?.map((m) => m.text).find(Boolean) ?? undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="People" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        {loaded && people.length === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="account-heart-outline" size={40} color="#AEB6B7" />
            <Text style={styles.emptyTitle}>No people yet</Text>
            <Text style={styles.emptyText}>
              Open any day in your Timeline and tag who you were with — everyone you add starts
              building their own story here.
            </Text>
          </View>
        )}

        {people.map((p) => (
          <PersonCard
            key={p.name}
            person={p}
            meta={meta[p.name]}
            lastPlace={lastPlaceOf(p)}
            lastNote={lastNoteOf(p)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },

  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 30, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#5B6364' },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#8B9394',
    textAlign: 'center',
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white },
  cardUnverified: { borderWidth: 2, borderColor: colors.accent },
  cardBody: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  personName: { fontFamily: fonts.semiBold, fontSize: 16, color: '#2B2B2B' },
  newBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  newBadgeText: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.ink },
  descriptor: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal, marginTop: 1 },
  seenLine: { fontFamily: fonts.regular, fontSize: 13, color: '#5B6364', marginTop: 2 },
  noteLine: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#8B9394',
    fontStyle: 'italic',
    marginTop: 4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  metaText: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal },
});
