import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { DayPlace, getAllDayPlaces } from '../src/places';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';
import { withAppNav } from '../src/components/AppNav';

// Wraps a name in Unicode direction isolates so an Arabic name dropped into
// an English sentence doesn't drag the punctuation and surrounding words
// around with it. Without this, "بابا and Baba look like…" renders with the
// name and the full stop in the wrong places.
const VIEW_KEY = 'peopleView';

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
/** Lowercase, without accents — so "omar", "Omar" and "Ómar" match. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** The name with the typed part in bold, like a search bar's suggestions. */
function Highlight({ text, query, style, boldStyle }: { text: string; query: string; style: object; boldStyle: object }) {
  const at = query ? fold(text).indexOf(fold(query)) : -1;
  if (at < 0) return <Text numberOfLines={1} style={style}>{text}</Text>;
  return (
    <Text numberOfLines={1} style={style}>
      {text.slice(0, at)}
      <Text style={boldStyle}>{text.slice(at, at + query.length)}</Text>
      {text.slice(at + query.length)}
    </Text>
  );
}

// The design's view: a grid of faces, the name under each — many people at
// a glance, no scrolling through cards.
function PersonTile({ person, meta, size, query }: { person: PersonSummary; meta?: PersonMeta; size: number; query: string }) {
  const unverified = meta ? meta.verified === false : false;
  return (
    <Link href={{ pathname: '/person/[name]', params: { name: person.name } }} asChild>
      <Pressable style={StyleSheet.flatten([styles.tile, { width: size + 12 }])}>
        <View style={StyleSheet.flatten([styles.tileRing, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }])}>
          <PersonAvatar name={person.name} photoUri={meta?.photoUri} size={size} />
          {unverified && <View style={styles.tileNewDot} />}
        </View>
        <Highlight text={person.name} query={query} style={styles.tileName} boldStyle={styles.matchBold} />
      </Pressable>
    </Link>
  );
}

function PersonCard({
  person,
  meta,
  lastPlace,
  lastNote,
  query = '',
}: {
  person: PersonSummary;
  meta?: PersonMeta;
  lastPlace?: string;
  lastNote?: string;
  query?: string;
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
            <Highlight text={person.name} query={query} style={styles.personName} boldStyle={styles.matchBold} />
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

function People() {
  const router = useRouter();
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [dayPlaces, setDayPlaces] = useState<Record<string, DayPlace[]>>({});
  const [meta, setMeta] = useState<Record<string, PersonMeta>>({});
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Faces (the design's grid) or cards; remembered between visits.
  const [view, setView] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY).then((v) => v === 'list' && setView('list')).catch(() => {});
  }, []);
  const chooseView = (v: 'grid' | 'list') => {
    setView(v);
    AsyncStorage.setItem(VIEW_KEY, v).catch(() => {});
  };
  const [query, setQuery] = useState('');
  const { width: screenW } = useWindowDimensions();
  // Three faces a row, as in the design.
  const tileSize = Math.min(104, Math.floor((screenW - 40 - 2 * 18) / 3) - 12);

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

  // Search: names starting with what's typed first, then a later word in
  // the name, then anywhere in it, then who they are ("Dad", "coworker").
  const q = fold(query.trim());
  const rank = (p: PersonSummary): number => {
    const n = fold(p.name);
    if (n.startsWith(q)) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (n.includes(q)) return 2;
    if (fold(meta[p.name]?.descriptor ?? '').includes(q)) return 3;
    return -1;
  };
  const shown = q
    ? people
        .map((p) => ({ p, r: rank(p) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r)
        .map((x) => x.p)
    : people;

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
      {/* Find someone fast, and how to see everyone. */}
      {people.length > 0 && (
        <View style={styles.toolbar}>
          <View style={styles.search}>
            <Ionicons name="search" size={17} color="#7D8B8D" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people"
              placeholderTextColor="#8B9394"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
          <View style={styles.viewSwitch}>
            {(['grid', 'list'] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => chooseView(v)}
                style={[styles.viewBtn, view === v && styles.viewBtnOn]}
                accessibilityLabel={v === 'grid' ? 'Faces' : 'Cards'}
              >
                <Ionicons
                  name={v === 'grid' ? 'grid-outline' : 'list-outline'}
                  size={18}
                  color={view === v ? colors.white : colors.primary}
                />
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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

        {!q && duplicates.map((d) => (
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

        {view === 'grid' ? (
          <View style={styles.grid}>
            {shown.map((p) => (
              <PersonTile key={p.name} person={p} meta={meta[p.name]} size={tileSize} query={query.trim()} />
            ))}
          </View>
        ) : (
          shown.map((p) => (
            <PersonCard
              key={p.name}
              person={p}
              meta={meta[p.name]}
              lastPlace={lastPlaceOf(p)}
              lastNote={lastNoteOf(p)}
              query={query.trim()}
            />
          ))
        )}

        {/* Nobody by that name: offer to add them, named already. */}
        {!!q && shown.length === 0 && (
          <Pressable style={styles.noMatch} onPress={() => setAddOpen(true)}>
            <Ionicons name="person-add-outline" size={20} color={colors.teal} />
            <Text style={styles.noMatchText}>Add “{query.trim()}”</Text>
          </Pressable>
        )}
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
        name={shown.length === 0 ? query.trim() : ''}
        onSave={async (n, d) => {
          await addPerson(n, d);
          setQuery('');
        }}
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
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 2,
    backgroundColor: colors.pale,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: '#1B1B1B', paddingVertical: 0 },
  viewSwitch: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 999, padding: 3 },
  viewBtn: { width: 38, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  viewBtnOn: { backgroundColor: colors.primary },
  matchBold: { fontFamily: fonts.bold, color: colors.primary },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
  tile: { alignItems: 'center' },
  tileRing: {
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tileNewDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
  },
  tileName: { fontFamily: fonts.regular, fontSize: 15, color: '#1B1B1B', marginTop: 8, textAlign: 'center', maxWidth: '100%' },
  noMatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  noMatchText: { fontFamily: fonts.medium, fontSize: 15, color: colors.teal },

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

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(People);
