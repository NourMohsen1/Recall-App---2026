import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import PersonEditSheet from '../../src/components/PersonEditSheet';
import PersonPhotoSheet from '../../src/components/PersonPhotoSheet';
import PhotoImage from '../../src/components/PhotoImage';
import { getAllAssumedMemories } from '../../src/assumedMemory';
import { WEEKDAYS } from '../../src/data';
import {
  getScanState,
  isScanBusy,
  onScanStateChange,
  scanForPerson,
  stopBackgroundFaceScan,
} from '../../src/faceMatching';
import { referenceFaceUri } from '../../src/faceCrop';
import { renamePersonEverywhere } from '../../src/peopleMerge';
import {
  PersonSuggestion,
  acceptSuggestion,
  clearExaminedFor,
  clearSuggestionsFor,
  getSuggestionsForPerson,
  rejectSuggestion,
} from '../../src/personSuggestions';
import { LoggedMemory, getMemoriesByDay, persistFile } from '../../src/memoryLog';
import {
  PersonMeta,
  PersonSummary,
  avatarTint,
  getPeopleSummaries,
  getPersonMeta,
  lastSeenLabel,
  removePersonEverywhere,
  setPersonDescriptor,
  setPersonPhoto,
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

// Label under a memory tile. A day within the last week reads as its
// weekday ("Wednesday") because that's how people refer to it; anything
// older needs the date to mean anything ("Sep, 21").
function railLabel(dayKey: string): string {
  const d = parseDay(dayKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  // Only the week either side reads as a weekday. Anything further needs a
  // date — a day three months out labelled 'Tuesday' tells you nothing.
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()];
  if (diff < -1 && diff > -7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]}, ${d.getDate()}`;
}

// How far back a running search has reached. Deliberately not railLabel:
// "back to Tuesday" is meaningless for a search whose whole point is how many
// weeks it has covered, and the number of days is the thing being asked about.
function reachLabel(dayKey: string): string {
  const d = parseDay(dayKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days <= 1) return 'today';
  if (days < 14) return `${days} days ago`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export default function PersonProfile() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();

  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [dayPlaces, setDayPlaces] = useState<Record<string, DetectedPlace[]>>({});
  const [meta, setMeta] = useState<PersonMeta | null>(null);
  // Photo analysis per day, so the recap line can fall back to what the
  // photos showed when the user never wrote anything down themselves.
  const [assumed, setAssumed] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([]);
  // Mirrors the module's scan state rather than owning it, so leaving the
  // page and coming back still shows a scan in progress.
  const [scan, setScan] = useState(getScanState());
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [cuttingFace, setCuttingFace] = useState(false);
  const scanning = scan.person === name;
  const scanProgress = scanning && scan.total > 0 ? { done: scan.done, total: scan.total } : null;

  // Live progress, and a refresh the moment somebody else's scan ends.
  useEffect(() => {
    let lastFound = 0;
    const off = onScanStateChange((next) => {
      setScan(next);
      if (!name) return;
      // A search that reaches months back takes a while, so anything it finds
      // is shown as it turns up rather than banked until the end.
      if (next.person === null || next.found > lastFound) {
        lastFound = next.person === null ? 0 : next.found;
        getSuggestionsForPerson(name).then(setSuggestions);
      }
    });
    setScan(getScanState());
    return off;
  }, [name]);

  // A photo set before the app could cut faces has none, and the matcher
  // would otherwise keep comparing against the whole picture until the next
  // background pass happened to reach this person. Opening their profile is
  // as good a moment as any, and it's the one place the result can be shown.
  useEffect(() => {
    if (!name || !meta?.photoUri || meta.faceUri) return;
    let live = true;
    setCuttingFace(true);
    referenceFaceUri(name, meta.photoUri)
      .then(async () => {
        if (live) setMeta(await getPersonMeta(name));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setCuttingFace(false);
      });
    return () => {
      live = false;
    };
  }, [name, meta?.photoUri, meta?.faceUri]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getPeopleSummaries(),
        getMemoriesByDay(),
        getAllDayPlaces(),
        name ? getPersonMeta(name) : Promise.resolve(null),
        getAllAssumedMemories(),
        name ? getSuggestionsForPerson(name) : Promise.resolve([]),
      ]).then(([summaries, memories, places, personMeta, assumedByDay, pending]) => {
        setPerson(summaries.find((p) => p.name === name) ?? null);
        setByDay(memories);
        setDayPlaces(places);
        setMeta(personMeta);
        setAssumed(
          Object.fromEntries(Object.entries(assumedByDay).map(([day, rec]) => [day, rec.summary])),
        );
        setSuggestions(pending);
        setLoaded(true);
      });
    }, [name]),
  );

  // Settling a guess from the profile. Yes files it as a real day with
  // them; no keeps it from being offered again.
  const confirmDay = async (day: string) => {
    if (!name) return;
    await acceptSuggestion(name, day);
    const [summaries, pending] = await Promise.all([
      getPeopleSummaries(),
      getSuggestionsForPerson(name),
    ]);
    setPerson(summaries.find((p) => p.name === name) ?? null);
    setSuggestions(pending);
  };
  const rejectDay = async (day: string) => {
    if (!name) return;
    await rejectSuggestion(name, day);
    setSuggestions(await getSuggestionsForPerson(name));
  };

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

  // Stores whatever the user chose as this person's reference face. Always
  // copied into the app's own storage first: both the image picker and the
  // contacts thumbnail hand back paths that the OS is free to clean up.
  const savePhoto = async (uri: string) => {
    if (!name) return;
    const permanent = await persistFile(uri, 'person');
    await setPersonPhoto(name, permanent);
    setMeta((prev) => ({ ...(prev ?? { verified: true, mentions: [] }), photoUri: permanent }));
    setSheetOpen(false);

    // A new face invalidates every guess made against the old one, so those
    // are cleared. The search itself is NOT started automatically any more:
    // it costs real vision calls, and the user decides when to spend them
    // with 'Run face match'.
    await clearSuggestionsFor(name);
    // Every past search compared against the OLD face, so those days are
    // worth looking at again.
    await clearExaminedFor(name);
    setSuggestions([]);
  };

  // The explicit scan. Closes the sheet first so the progress is visible on
  // the profile itself — the previous version left the user on a sheet with
  // no sign anything was happening, which read as a dead button.
  const runFaceMatch = async () => {
    if (!name) return;
    setSheetOpen(false);
    setScanNote(null);
    // Take the machine back off the background pass, then wait for it to
    // notice — otherwise the user's own scan is refused as 'busy'.
    stopBackgroundFaceScan();
    for (let i = 0; i < 40 && isScanBusy(); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    try {
      const outcome = await scanForPerson(name);
      const pending = await getSuggestionsForPerson(name);
      setSuggestions(pending);
      // Always say what happened. A scan that legitimately finds nothing
      // must not look identical to one that never ran.
      setScanNote(
        outcome.status === 'done'
          ? outcome.found > 0
            ? null // the suggestions themselves are the answer
            : // Say what was actually covered. "No new matches" on its own
              // reads as a broken button, and gives no hint that running it
              // again goes further back through the library.
              `Looked through ${outcome.searched} ${outcome.searched === 1 ? 'day' : 'days'} of photos — no sign of ${firstName}. Run it again to go further back.`
          : outcome.status === 'busy'
            ? `Still searching for ${scan.person} — that has to finish first.`
            : outcome.status === 'no-photo'
              ? `Add a photo of ${firstName} first.`
              : outcome.status === 'nothing-to-search'
                ? 'Every day with photos has already been checked or decided.'
                : 'Face matching is off while it is rebuilt on real face recognition.',
      );
    } catch {
      setScanNote('That scan didn’t finish — try again in a moment.');
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    await savePhoto(result.assets[0].uri);
  };

  // Saves the name and the "how do I know them" line together. A rename can
  // land the person under a different name than was typed — typing an
  // existing person's name joins the two — so the screen follows whatever
  // name comes back rather than assuming.
  const saveEdits = async (nextName: string, nextDescriptor: string) => {
    if (!person) return;
    const landedOn = await renamePersonEverywhere(person.name, nextName);
    setEditOpen(false);

    if (landedOn !== person.name) {
      // The rename joined this person into somebody who already existed.
      // That person's own details win — writing the form's bio over theirs
      // would quietly delete a description they'd already written, which is
      // not what "these two are the same person" asked for. mergePeople has
      // already filled in anything they were missing.
      router.replace({ pathname: '/person/[name]', params: { name: landedOn } });
      return;
    }

    await setPersonDescriptor(landedOn, nextDescriptor || undefined);
    setMeta((prev) => ({
      ...(prev ?? { verified: true, mentions: [] }),
      descriptor: nextDescriptor || undefined,
    }));
  };

  const removePhoto = async () => {
    if (!name) return;
    await setPersonPhoto(name, undefined);
    setMeta((prev) => (prev ? { ...prev, photoUri: undefined } : prev));
    setSheetOpen(false);
  };

  // The single recap line under the name: the most recent thing the app
  // knows about this person, from whichever source knew it last — a note
  // the user logged, or the photo analysis of a day they were on.
  const lastDay = person?.lastSeenDay;
  const lastPlace = lastDay ? dayPlaces[lastDay]?.[0]?.label : undefined;
  const latestNote =
    // A note about this person on the most recent day together wins; then
    // any note at all (mentions are stored newest-first); then what the
    // photos of that day showed; then whatever was logged that day.
    meta?.mentions.find((m) => m.day === lastDay)?.text ??
    meta?.mentions[0]?.text ??
    (lastDay ? assumed[lastDay] : undefined) ??
    (lastDay ? byDay.get(lastDay)?.map((m) => m.text).find(Boolean) : undefined);
  const recapLine = person?.lastSeenDay
    ? [
        `Last seen ${lastSeenLabel(person.lastSeenDay)}${lastPlace ? ` at ${lastPlace}` : ''}`,
        // Notes are written as sentence fragments ("you both spoke about…"),
        // so they need a capital to follow a full stop without reading as a
        // typo.
        latestNote && latestNote.charAt(0).toUpperCase() + latestNote.slice(1),
      ]
        .filter(Boolean)
        .join('. ')
    : '';

  // Chips: everywhere the user has been with this person, most recent first.
  const sharedPlaces = person
    ? [...new Set(person.days.flatMap((d) => (dayPlaces[d] ?? []).map((p) => p.label)))]
    : [];

  // One tile per day together — the design's "Memories With X" rail. Days
  // with photos lead with a photo; a day they only wrote about still gets a
  // tile, because this rail replaced the vertical day list and losing those
  // days entirely would make them unreachable from the profile.
  const memoryTiles = (person?.days ?? []).map((day) => ({
    day,
    uri: (byDay.get(day) ?? [])
      .filter((m) => m.kind === 'photo')
      .flatMap((m) => m.photoUris ?? [])[0],
  }));

  const firstName = (person?.name ?? '').trim().split(/\s+/)[0];


  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* Primary entry is the People list — explicit target for the same
            reason noted in day/[offset]/index.tsx. */}
        <Pressable onPress={() => router.dismissTo('/people')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        {person && (
          <Pressable onPress={() => setEditOpen(true)} hitSlop={12} style={styles.headerAction}>
            <Ionicons name="create-outline" size={24} color={colors.primary} />
          </Pressable>
        )}
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
            {/* Identity — the photo is the person's reference face, tapped
                to set or replace. Until one is set it stays the initials
                tile, at the same size so the layout never shifts. */}
            <Pressable onPress={() => setSheetOpen(true)} style={styles.heroWrap}>
              {meta?.photoUri ? (
                <Image source={{ uri: meta.photoUri }} style={styles.hero} resizeMode="cover" />
              ) : (
                <View style={[styles.hero, styles.heroEmpty, { backgroundColor: avatarTint(person.name) }]}>
                  <Text style={styles.heroInitials}>{initials(person.name)}</Text>
                  <Text style={styles.heroHint}>Tap to add a photo</Text>
                </View>
              )}
            </Pressable>

            <Text style={styles.name}>{person.name}</Text>
            {meta?.descriptor && <Text style={styles.descriptor}>{meta.descriptor}</Text>}

            {recapLine.length > 0 && (
              <Pressable onPress={() => person.lastSeenDay && openDay(person.lastSeenDay)}>
                <Text numberOfLines={2} style={[styles.recapLine, rtlIfArabic(latestNote)]}>
                  {recapLine}
                </Text>
              </Pressable>
            )}


            {sharedPlaces.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipRow}
              >
                {sharedPlaces.map((label) => (
                  <Pressable
                    key={label}
                    style={styles.chip}
                    onPress={() =>
                      router.push({ pathname: '/place/[name]', params: { name: label } })
                    }
                  >
                    <Text style={styles.chipText}>{label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

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

            {/* Days the app thinks they were there, from their face in that
                day's photos. Deliberately its own block, above the confirmed
                rail and visibly unsettled — a guess must never sit silently
                among the days the user actually recorded. */}
            {(scanning || suggestions.length > 0 || scanNote) && (
              <View style={styles.suggestBlock}>
                <View style={styles.suggestHeader}>
                  <MaterialCommunityIcons name="account-search-outline" size={17} color={colors.slate} />
                  <Text style={styles.suggestTitle}>
                    {scanning ? `Looking for ${firstName} in your photos…` : `Is this ${firstName}?`}
                  </Text>
                  {scanning && <ActivityIndicator size="small" color={colors.slate} />}
                </View>

                {/* Real progress, not just a spinner — a scan takes the best
                    part of a minute, and "3 of 12" is the difference between
                    waiting and wondering whether it's stuck. */}
                {scanning && (
                  <>
                    <Text style={styles.suggestSub}>
                      {scanProgress
                        ? `Looked at ${scanProgress.done} of ${scanProgress.total} photos${
                            scan.oldestDay ? `, back to ${reachLabel(scan.oldestDay)}` : ''
                          }.`
                        : 'Getting your photos ready…'}
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: scanProgress
                              ? `${Math.round((scanProgress.done / scanProgress.total) * 100)}%`
                              : '4%',
                          },
                        ]}
                      />
                    </View>
                  </>
                )}

                {!scanning && scanNote && <Text style={styles.suggestSub}>{scanNote}</Text>}
                {suggestions.length > 0 && (
                  <>
                    <Text style={styles.suggestSub}>
                      Recall thinks it recognised them on these days. Nothing is added until you say
                      so.
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.railRow}
                    >
                      {suggestions.map((s) => (
                        <View key={s.day} style={styles.suggestCell}>
                          <Pressable onPress={() => openDay(s.day)}>
                            <PhotoImage uri={s.photoUri} style={[styles.railTile, styles.suggestTile]} />
                          </Pressable>
                          <Text style={styles.railLabel}>{railLabel(s.day)}</Text>
                          {/* What the model claims it matched. A vague or
                              obviously wrong line here is the fastest way to
                              spot a bad guess without opening the photo. */}
                          {s.why && (
                            <Text numberOfLines={3} style={styles.suggestWhy}>
                              {s.why}
                            </Text>
                          )}
                          {/* Labelled buttons rather than bare icons: these
                              were two 26px glyphs, well under a comfortable
                              touch target, and nothing said which was which. */}
                          <View style={styles.suggestActions}>
                            <Pressable
                              style={({ pressed }) => [
                                styles.answerBtn,
                                styles.answerYes,
                                pressed && styles.answerPressed,
                              ]}
                              onPress={() => confirmDay(s.day)}
                            >
                              <Ionicons name="checkmark" size={17} color={colors.white} />
                              <Text style={styles.answerYesText}>Yes</Text>
                            </Pressable>
                            <Pressable
                              style={({ pressed }) => [
                                styles.answerBtn,
                                styles.answerNo,
                                pressed && styles.answerPressed,
                              ]}
                              onPress={() => rejectDay(s.day)}
                            >
                              <Ionicons name="close" size={17} color="#5B6364" />
                              <Text style={styles.answerNoText}>No</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}
              </View>
            )}

            {/* Every day together, as a rail — this IS the day list, just
                shown as photos. Tapping a tile opens that day. */}
            {memoryTiles.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Memories With {firstName}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.railRow}
                >
                  {memoryTiles.map((tile) => (
                    <Pressable key={tile.day} onPress={() => openDay(tile.day)}>
                      {tile.uri ? (
                        <PhotoImage uri={tile.uri} style={styles.railTile} />
                      ) : (
                        // A day they only wrote about still belongs here.
                        <View style={[styles.railTile, styles.railTileEmpty]}>
                          <MaterialCommunityIcons name="text-long" size={20} color="#A8B0B1" />
                        </View>
                      )}
                      <Text style={styles.railLabel}>{railLabel(tile.day)}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}

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

          </>
        )}
      </ScrollView>

      {person && (
        <PersonEditSheet
          visible={editOpen}
          name={person.name}
          descriptor={meta?.descriptor}
          onSave={saveEdits}
          onClose={() => setEditOpen(false)}
        />
      )}

      {person && (
        <PersonPhotoSheet
          visible={sheetOpen}
          personName={person.name}
          hasPhoto={!!meta?.photoUri}
          faceUri={meta?.faceUri}
          cuttingFace={cuttingFace}
          scanning={scanning}
          onPickFromLibrary={pickFromLibrary}
          onRunFaceMatch={runFaceMatch}
          onRemove={removePhoto}
          onClose={() => setSheetOpen(false)}
        />
      )}
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
  headerAction: { position: 'absolute', right: 20, top: 16 },
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

  // Tall portrait, full content width — the person is the page, so their
  // face leads it rather than sitting in a small circle above the name.
  heroWrap: { marginTop: 18 },
  hero: { width: '100%', aspectRatio: 0.92, borderRadius: 20, overflow: 'hidden' },
  heroEmpty: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  heroBusy: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroInitials: { fontFamily: fonts.semiBold, fontSize: 64, color: colors.white },
  heroHint: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.9)' },

  name: { fontFamily: fonts.bold, fontSize: 38, color: '#1B1B1B', marginTop: 18 },
  descriptor: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B', marginTop: 4 },
  recapLine: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 25,
    color: '#3E4647',
    marginTop: 14,
  },

  chipScroll: { marginTop: 16, marginHorizontal: -24 },
  chipRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24 },
  chip: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  chipText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },

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

  // Unconfirmed guesses. Same teal family as the rest of the app but a stop
  // lighter, on a tinted panel with a dashed edge — recognisably Recall,
  // recognisably not settled.
  suggestBlock: {
    backgroundColor: colors.pale,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
    padding: 16,
    marginTop: 26,
  },
  suggestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggestTitle: { flex: 1, fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
  suggestSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#5B7377',
    marginTop: 6,
    marginBottom: 12,
  },
  suggestCell: { alignItems: 'center', width: 132 },
  suggestWhy: {
    width: 132,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: '#5B7377',
    textAlign: 'center',
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(92,135,141,0.25)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.teal },

  // Comfortable touch targets with words on them — see the call site.
  answerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 62,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  answerPressed: { opacity: 0.65 },
  answerYes: { backgroundColor: colors.teal },
  answerYesText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.white },
  answerNo: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#C6CDCD' },
  answerNoText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#5B6364' },
  suggestTile: { opacity: 0.85 },
  suggestActions: { flexDirection: 'row', gap: 8, marginTop: 10 },

  sectionTitle: { fontFamily: fonts.bold, fontSize: 20, color: '#1B1B1B', marginTop: 26, marginBottom: 12 },

  // Bleeds to both screen edges so the rail reads as scrollable rather than
  // as a row that happens to be clipped.
  railRow: { flexDirection: 'row', gap: 12, paddingRight: 24 },
  railTile: { width: 116, height: 116, borderRadius: 14, overflow: 'hidden' },
  railTileEmpty: { backgroundColor: '#EDF1F1', alignItems: 'center', justifyContent: 'center' },
  railLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#3E4647',
    marginTop: 8,
    textAlign: 'center',
  },
});
