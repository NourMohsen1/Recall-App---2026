import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ActionMenuSheet from '../src/components/ActionMenuSheet';
import MergePeopleSheet from '../src/components/MergePeopleSheet';
import PersonEditSheet from '../src/components/PersonEditSheet';
import PersonAvatar from '../src/components/PersonAvatar';
import ScreenHeader from '../src/components/ScreenHeader';
import { LoggedMemory, getMemoriesByDay } from '../src/memoryLog';
import {
  PersonMeta,
  PersonSummary,
  avatarTint,
  createPerson,
  getAllPersonMeta,
  getPeopleSummaries,
  getRejectedMerges,
  isRejectedMerge,
  lastSeenLabel,
  rejectMerge,
} from '../src/peopleTags';
import { mergePersonEverywhere } from '../src/peopleMerge';
import { DuplicateSuggestion, findDuplicatePeople } from '../src/personIdentity';
import { DetectedPlace, getAllDayPlaces } from '../src/placesFromPhotos';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';

// Wraps a name in Unicode direction isolates so an Arabic name dropped into
// an English sentence doesn't drag the punctuation and surrounding words
// around with it. Without this, "بابا and Baba look like…" renders with the
// name and the full stop in the wrong places.
function isolate(name: string): string {
  return `⁨${name}⁩`;
}

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
  // Someone added by hand hasn't been seen anywhere yet — saying "Last seen"
  // about a day that doesn't exist would be a small lie.
  const seenLine = person.lastSeenDay
    ? [`Last seen ${lastSeenLabel(person.lastSeenDay)}`, lastPlace ? `at ${lastPlace}` : null]
        .filter(Boolean)
        .join(' ')
    : 'Not on any day yet';
  const unverified = meta ? meta.verified === false : false;

  return (
    <Link href={{ pathname: '/person/[name]', params: { name: person.name } }} asChild>
      {/* Link's <a> on web can't take a style array — flatten to one object */}
      <Pressable style={StyleSheet.flatten([styles.card, unverified && styles.cardUnverified])}>
        <PersonAvatar name={person.name} photoUri={meta?.photoUri} size={56} />
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
  const router = useRouter();
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [dayPlaces, setDayPlaces] = useState<Record<string, DetectedPlace[]>>({});
  const [meta, setMeta] = useState<Record<string, PersonMeta>>({});
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getPeopleSummaries(),
        getMemoriesByDay(),
        getAllDayPlaces(),
        getAllPersonMeta(),
        getRejectedMerges(),
      ]).then(([summaries, memories, places, personMeta, rejects]) => {
        setPeople(summaries);
        setByDay(memories);
        setDayPlaces(places);
        setMeta(personMeta);
        setRejected(rejects);
        setLoaded(true);
      });
    }, []),
  );

  // The recap details for each person's most recent day together.
  const lastPlaceOf = (p: PersonSummary) =>
    p.lastSeenDay ? dayPlaces[p.lastSeenDay]?.[0]?.label : undefined;
  const lastNoteOf = (p: PersonSummary) =>
    (p.lastSeenDay ? byDay.get(p.lastSeenDay)?.map((m) => m.text).find(Boolean) : undefined) ??
    undefined;

  // Names that look like one person logged under two spellings. Suggested,
  // never applied on their own — see personIdentity.ts for why merging
  // without asking would be the wrong call.
  // Weight decides which name survives a merge, so it has to mean "the
  // profile the user has actually built". Days together dominate, but a
  // descriptor or a photo counts too — a profile that says "Father" and has
  // a face is the one worth keeping, even against a spelling with an equal
  // number of days.
  const profileWeight = (n: string) => {
    const days = people.find((p) => p.name === n)?.days.length ?? 0;
    const m = meta[n];
    return days * 10 + (m?.descriptor ? 4 : 0) + (m?.photoUri ? 4 : 0) + (m?.mentions.length ?? 0);
  };

  const duplicates = findDuplicatePeople(
    people.map((p) => p.name),
    profileWeight,
  ).filter((d) => !isRejectedMerge(rejected, d.keep, d.merge));

  const reload = () =>
    Promise.all([getPeopleSummaries(), getAllPersonMeta(), getRejectedMerges()]).then(
      ([summaries, personMeta, rejects]) => {
        setPeople(summaries);
        setMeta(personMeta);
        setRejected(rejects);
      },
    );

  // Creating someone the user knows before they appear in any memory. Typing
  // a name that already exists opens that person rather than making a second
  // copy — then straight to their profile, which is where the useful next
  // step is (giving them a face, which starts the photo search).
  const addPerson = async (personName: string, descriptor: string) => {
    const landedOn = await createPerson(personName, descriptor || undefined);
    await reload();
    setAddOpen(false);
    if (landedOn) {
      router.push({ pathname: '/person/[name]', params: { name: landedOn } });
    }
  };

  // The user pointed at two profiles themselves — no name similarity
  // needed, which is the whole reason this exists alongside the automatic
  // suggestions.
  const manualMerge = async (mergeName: string, keepName: string) => {
    await mergePersonEverywhere(mergeName, keepName);
    await reload();
    setMergeOpen(false);
  };

  const acceptMerge = async (d: DuplicateSuggestion) => {
    await mergePersonEverywhere(d.merge, d.keep);
    await reload();
  };
  const declineMerge = async (d: DuplicateSuggestion) => {
    await rejectMerge(d.keep, d.merge);
    await reload();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="People"
        action={{
          icon: 'ellipsis-horizontal',
          label: 'People options',
          onPress: () => setMenuOpen(true),
        }}
      />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        {loaded && people.length === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="account-heart-outline" size={40} color="#AEB6B7" />
            <Text style={styles.emptyTitle}>No people yet</Text>
            <Text style={styles.emptyText}>
              Tag who you were with on any day in your Timeline — or add someone here with the
              menu above. Everyone you add starts building their own story.
            </Text>
          </View>
        )}

        {duplicates.map((d) => (
          <View key={`${d.keep}|${d.merge}`} style={styles.mergeCard}>
            <View style={styles.mergeHeader}>
              <MaterialCommunityIcons name="account-multiple-outline" size={18} color={colors.teal} />
              <Text style={styles.mergeTitle}>Same person?</Text>
            </View>
            <Text style={styles.mergeText}>
              <Text style={styles.mergeName}>{isolate(d.merge)}</Text> and{' '}
              <Text style={styles.mergeName}>{isolate(d.keep)}</Text> look like {d.reason}.
              Putting them together keeps every memory under {isolate(d.keep)}.
            </Text>
            <View style={styles.mergeRow}>
              <Pressable style={styles.mergeBtn} onPress={() => acceptMerge(d)}>
                <Text style={styles.mergeBtnText}>Yes, same person</Text>
              </Pressable>
              <Pressable style={styles.mergeSkip} onPress={() => declineMerge(d)}>
                <Text style={styles.mergeSkipText}>Different people</Text>
              </Pressable>
            </View>
          </View>
        ))}

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

      <ActionMenuSheet
        visible={menuOpen}
        title="People"
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            key: 'add',
            icon: 'account-plus-outline',
            label: 'Add a person',
            hint: 'Someone you know, before they show up in a memory',
            onPress: () => {
              setMenuOpen(false);
              setAddOpen(true);
            },
          },
          {
            key: 'merge',
            icon: 'account-multiple-outline',
            label: 'Merge two people',
            hint:
              people.length >= 2
                ? 'One person you logged twice under different names'
                : 'Needs at least two people',
            disabled: people.length < 2,
            onPress: () => {
              setMenuOpen(false);
              setMergeOpen(true);
            },
          },
        ]}
      />

      <PersonEditSheet
        visible={addOpen}
        mode="add"
        name=""
        onSave={addPerson}
        onClose={() => setAddOpen(false)}
      />

      <MergePeopleSheet
        visible={mergeOpen}
        people={people}
        meta={meta}
        onMerge={manualMerge}
        onClose={() => setMergeOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },

  // Sits above the list because it's a question, not a person — the user
  // answers it once and it disappears for good either way.
  mergeCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.teal,
    padding: 16,
    marginBottom: 14,
  },
  mergeHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mergeTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B' },
  mergeText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#3E4647',
    marginTop: 8,
    // This sentence is English copy that happens to contain names. Without
    // pinning the direction, a name like "بابا" landing first makes the
    // text engine lay the whole paragraph out right-to-left and strand the
    // full stop at the start of the line.
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  mergeName: { fontFamily: fonts.semiBold, color: '#1B1B1B' },
  mergeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  mergeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  mergeBtnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },
  mergeSkip: { paddingVertical: 10, paddingHorizontal: 8 },
  mergeSkipText: { fontFamily: fonts.medium, fontSize: 13, color: '#8B9394' },

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
