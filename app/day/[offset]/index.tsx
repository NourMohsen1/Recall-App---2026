import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../../../src/components/AnalyzingBanner';
import PeopleEditor from '../../../src/components/PeopleEditor';
import PhotoImage from '../../../src/components/PhotoImage';
import {
  AssumedMemory,
  assumedMemoryAvailable,
  dayLoggedText,
  dismissAssumedMemory,
  getAssumedMemory,
  getCachedAssumedMemory,
  onAssumedMemoryUpdated,
  isAssumedMemoryDismissed,
  translateAssumedMemory,
} from '../../../src/assumedMemory';
import { WEEKDAYS, dateWithOffset, shortDate } from '../../../src/data';
import MemoryEditSheet from '../../../src/components/MemoryEditSheet';
import { processMemoryIntake, useMemoryPolish } from '../../../src/memoryIntake';
import {
  LoggedMemory,
  dateKey,
  deleteMemory,
  formatClockTime,
  getMemoriesByDay,
  memoryDisplayText,
  saveMemory,
  updateMemory,
} from '../../../src/memoryLog';
import {
  addPersonForDay,
  getAllPersonMeta,
  getAllTaggedPeople,
  getPeopleForDay,
  removePersonForDay,
} from '../../../src/peopleTags';
import {
  PersonSuggestion,
  acceptSuggestion,
  getSuggestionsForDay,
  rejectSuggestion,
} from '../../../src/personSuggestions';
import { approveGuess, getGuessesForDay, rejectGuess } from '../../../src/guessedPeople';
import { ensureDayScanned, faceMatchingAvailable } from '../../../src/faceMatching';
import { getAllPhotoSources, getPhotoTimestamps } from '../../../src/photoMeta';
import { DetectedPlace, getPlacesForDay } from '../../../src/placesFromPhotos';
import { rtlIfArabic } from '../../../src/transcription';
import { colors, fonts } from '../../../src/theme';

export default function DayDetailScreen() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const date = dateWithOffset(offsetNum);

  const [real, setReal] = useState<LoggedMemory[]>([]);
  const [places, setPlaces] = useState<DetectedPlace[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<LoggedMemory | null>(null);
  const [adding, setAdding] = useState(false);
  const [personPhotos, setPersonPhotos] = useState<Record<string, string | undefined>>({});
  // Only the name is needed to draw a guess; the old type carried the LLM
  // matcher's confidence and source photo, which nothing here used.
  const [faceSuggestions, setFaceSuggestions] = useState<{ name: string }[]>([]);
  const [readingFaces, setReadingFaces] = useState(false);
  const dayKey = dateKey(dateWithOffset(offsetNum));
  const reload = useCallback(() => {
    const key = dateKey(dateWithOffset(offsetNum));
    getMemoriesByDay().then((byDay) => setReal(byDay.get(key) ?? []));
    getPlacesForDay(key).then(setPlaces);
    getPeopleForDay(key).then(setPeople);
    getAllTaggedPeople().then(setPeopleSuggestions);
    // Faces and guesses for the People row.
    getAllPersonMeta().then((all) =>
      setPersonPhotos(
        Object.fromEntries(Object.entries(all).map(([n, m]) => [n, m.photoUri])),
      ),
    );
    // Guesses from the on-device face grouping. The old store behind
    // getSuggestionsForDay belonged to the LLM matcher, which is switched
    // off — this reads the same shape from the new one.
    getGuessesForDay(key).then((g) => setFaceSuggestions(g.map((x) => ({ name: x.name }))));
  }, [offsetNum]);

  // The user settling a guess: yes makes it a real tagged day, no stops the
  // app offering that face on that day again.
  const confirmSuggested = async (personName: string) => {
    await approveGuess(dayKey, personName);
    reload();
  };
  const dismissSuggested = async (personName: string) => {
    await rejectGuess(dayKey, personName);
    reload();
  };


  // Rewriting a memory the user already has. Their words replace whatever
  // was there and the entry is marked refined, so the polish sweep never
  // comes back and rewrites what they just typed. The verbatim original is
  // untouched in rawText, and still on the Source page.
  const saveEdit = async (text: string) => {
    if (!editTarget) return;
    await updateMemory(editTarget.id, { text, refined: true });
    setEditTarget(null);
    reload();
  };

  const deleteEntry = async () => {
    if (!editTarget) return;
    await deleteMemory(editTarget.id);
    setEditTarget(null);
    reload();
  };

  // A new memory written onto a day that may be in the past, so takenAt is
  // set to that day rather than now — otherwise it would file itself under
  // today and vanish from the day being looked at. Midday, since there's no
  // real time of day for something written from memory later.
  const saveNew = async (text: string) => {
    const when = dateWithOffset(offsetNum);
    when.setHours(12, 0, 0, 0);
    const saved = await saveMemory({ kind: 'text', text, takenAt: when });
    setAdding(false);
    reload();
    // Same treatment as anything logged the normal way: read it once and
    // file the tasks, people and places out of it.
    processMemoryIntake(saved.id, text, dateKey(when)).catch(() => {});
  };

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
  // A day the app found faces on is not an empty day, even if the user has
  // not written anything or confirmed anyone yet.
  const isEmpty =
    entries.length === 0 &&
    realPhotoUris.length === 0 &&
    places.length === 0 &&
    people.length === 0 &&
    faceSuggestions.length === 0;

  const addPerson = async (name: string) => {
    await addPersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
    setPeopleSuggestions(await getAllTaggedPeople());
  };
  const removePerson = async (name: string) => {
    await removePersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
  };

  // Assumed Memory — the same floating card from the Timeline canvas,
  // maximized: its own section here, styled distinctly (dashed/tinted) so
  // it never reads as part of what the user actually logged above it. When
  // there IS a real logged account, it's handed in as context so the AI
  // fills gaps around it instead of repeating it.
  // Shared helper, so this screen computes the same cache signature as the
  // Timeline and the background pass (they used to differ, which made each
  // one regenerate the others' analysis).
  const loggedTextForAssumed = dayLoggedText(real);
  const [assumedMemory, setAssumedMemory] = useState<AssumedMemory | null>(null);
  const [assumedDismissed, setAssumedDismissed] = useState(false);
  // See the same state on Timeline for what each value means — 'failed'
  // specifically is what lets this screen offer a manual retry instead of
  // just showing nothing when a real attempt came back empty.
  const [assumedStatus, setAssumedStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [assumedLang, setAssumedLang] = useState<'en' | 'ar'>('en');
  const [translating, setTranslating] = useState(false);
  const photoUrisKey = realPhotoUris.join('|');

  const fetchAssumed = useCallback(
    async (targetDay: string, uris: string[], loggedText: string) => {
      if (uris.length === 0 || !assumedMemoryAvailable()) {
        setAssumedStatus('idle');
        return;
      }
      setAssumedStatus('loading');
      const timestamps = await getPhotoTimestamps(uris);
      const sources = await getAllPhotoSources();
      const photos = uris
        .filter((uri) => timestamps[uri])
        .map((uri) => ({ uri, takenAt: timestamps[uri], source: sources[uri] }));
      if (photos.length === 0) {
        setAssumedStatus('idle');
        return;
      }
      const record = await getAssumedMemory(targetDay, photos, loggedText || undefined);
      if (targetDay !== dayKeyRef.current) return;
      if (!record) {
        setAssumedStatus('failed');
        return;
      }
      const dismissed = await isAssumedMemoryDismissed(targetDay, record.signature);
      if (targetDay !== dayKeyRef.current) return;
      setAssumedMemory(record);
      setAssumedDismissed(dismissed);
      setAssumedStatus('ready');
    },
    [],
  );

  const dayKeyRef = useRef(dayKey);
  dayKeyRef.current = dayKey;

  useEffect(() => {
    setAssumedMemory(null);
    setAssumedDismissed(false);
    setAssumedStatus('idle');
    setAssumedLang('en');
    fetchAssumed(dayKey, realPhotoUris, loggedTextForAssumed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, photoUrisKey, loggedTextForAssumed]);

  const retryAssumed = () => fetchAssumed(dayKey, realPhotoUris, loggedTextForAssumed);

  // Who was here? Asked of the day rather than of a person: this day's photos
  // go in against every face the app knows, and whoever it recognises turns up
  // in the People row below as a question, next to the people the user tagged
  // themselves.
  //
  // It runs on opening a day and then never again for the same day — the pass
  // remembers which people it has already read this day for, so coming back
  // costs nothing, while a person added next week makes the day worth one more
  // look, for them alone.
  useEffect(() => {
    if (realPhotoUris.length === 0 || !faceMatchingAvailable()) return;
    let live = true;
    setReadingFaces(true);
    ensureDayScanned(dayKey)
      .then(async (outcome) => {
        if (!live || outcome.status !== 'done' || outcome.found === 0) return;
        setFaceSuggestions(await getSuggestionsForDay(dayKey));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setReadingFaces(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, photoUrisKey]);


  // A day analyzed by the background pass appears here on its own — no
  // need to tap the day to make it show up.
  useEffect(() => {
    return onAssumedMemoryUpdated(async (updatedDay) => {
      if (updatedDay !== dayKey) return;
      const record = await getCachedAssumedMemory(updatedDay);
      if (!record) return;
      setAssumedMemory(record);
      setAssumedDismissed(await isAssumedMemoryDismissed(updatedDay, record.signature));
    });
  }, [dayKey]);

  const dismissAssumed = () => {
    if (!assumedMemory) return;
    setAssumedDismissed(true);
    dismissAssumedMemory(dayKey, assumedMemory.signature);
  };

  const toggleAssumedLang = async () => {
    if (!assumedMemory) return;
    if (assumedLang === 'ar') {
      setAssumedLang('en');
      return;
    }
    if (assumedMemory.translations?.ar) {
      setAssumedLang('ar');
      return;
    }
    setTranslating(true);
    const translated = await translateAssumedMemory(dayKey, assumedMemory, 'ar');
    setTranslating(false);
    if (!translated) return;
    setAssumedMemory((prev) =>
      prev ? { ...prev, translations: { ...prev.translations, ar: translated } } : prev,
    );
    setAssumedLang('ar');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {/* Day Detail is pushed onto the root Stack from inside the Tabs
            navigator (usually Timeline) — plain back()/canGoBack() looks
            right but doesn't restore which tab was active, landing on Home
            instead. An explicit dismissTo target sidesteps that. */}
        <Pressable onPress={() => router.dismissTo('/timeline')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {WEEKDAYS[date.getDay()]}, {shortDate(date)}
        </Text>
        {/* Editing is a mode rather than a one-shot action: the day can hold
            several memories, and turning it on marks every one of them
            editable at once instead of asking which before you can see them. */}
        <Pressable onPress={() => setEditing((v) => !v)} hitSlop={12} style={styles.headerAction}>
          {editing ? (
            <Text style={styles.headerDone}>Done</Text>
          ) : (
            <Ionicons name="create-outline" size={24} color={colors.primary} />
          )}
        </Pressable>
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
                    {editing && (
                      <Pressable onPress={() => setEditTarget(m)} hitSlop={10} style={styles.editDot}>
                        <Ionicons name="create-outline" size={17} color={colors.teal} />
                      </Pressable>
                    )}
                  </View>

                  {memoryDisplayText(m) && (
                    <Text style={[styles.segmentText, rtlIfArabic(memoryDisplayText(m)!)]}>
                      {memoryDisplayText(m)}
                    </Text>
                  )}

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

        {/* Adding to a past day. Offered whenever editing is on, and also on
            an empty day — a day with nothing on it is exactly when you most
            want to write something, and there'd otherwise be no way in. */}
        {(editing || entries.length === 0) && (
          <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
            <Ionicons name="add-circle-outline" size={20} color={colors.teal} />
            <Text style={styles.addText}>Add to this day</Text>
          </Pressable>
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
                    <PhotoImage uri={uri} style={styles.photo} />
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
        <View style={styles.peopleHeader}>
          <Text style={styles.placesTitle}>People</Text>
          {/* Said out loud rather than left as a silent pause — a row that
              gains a face ten seconds after you opened the day is confusing
              if nothing ever mentioned it was looking. */}
          {readingFaces && <Text style={styles.peopleReading}>Reading faces…</Text>}
        </View>
        <PeopleEditor
          people={people}
          suggestions={peopleSuggestions}
          photos={personPhotos}
          suggested={faceSuggestions}
          onConfirm={confirmSuggested}
          onDismiss={dismissSuggested}
          onAdd={addPerson}
          onRemove={removePerson}
        />

        {/* Assumed Memory, maximized — deliberately its own section, well
            below the real logged content, dashed/tinted so it never reads
            as part of what the user actually wrote above. */}
        {assumedMemory && !assumedDismissed && (
          <>
            <View style={styles.divider} />
            <View style={styles.assumedCard}>
              <View style={styles.assumedHeaderRow}>
                <View style={styles.assumedTitleRow}>
                  <Ionicons name="sparkles-outline" size={18} color={colors.teal} />
                  <Text style={styles.assumedTitle}>Assumed Memory</Text>
                </View>
                <Pressable hitSlop={10} onPress={dismissAssumed}>
                  <Ionicons name="close" size={18} color="#9AA4A5" />
                </Pressable>
              </View>
              <Text style={styles.assumedSub}>The AI's best guess from this day's photos</Text>
              <Text
                style={[
                  styles.assumedText,
                  assumedLang === 'ar' && rtlIfArabic(assumedMemory.translations?.ar),
                ]}
              >
                {assumedLang === 'ar' && assumedMemory.translations?.ar
                  ? assumedMemory.translations.ar
                  : assumedMemory.summary}
              </Text>
              <Pressable
                style={styles.assumedTranslateBtn}
                onPress={toggleAssumedLang}
                disabled={translating}
              >
                <Ionicons name="language-outline" size={14} color={colors.teal} />
                <Text style={styles.assumedTranslateText}>
                  {translating ? 'Translating…' : assumedLang === 'ar' ? 'Show original' : 'Translate to Arabic'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {assumedStatus === 'failed' && (
          <>
            <View style={styles.divider} />
            <Pressable
              style={[styles.assumedCard, styles.assumedCardFailed]}
              onPress={retryAssumed}
            >
              <View style={styles.assumedTitleRow}>
                <Ionicons name="refresh" size={18} color="#8B9394" />
                <Text style={styles.assumedTitle}>Assumed Memory</Text>
              </View>
              <Text style={styles.assumedSub}>
                Couldn't analyze this day's photos yet — tap to try again
              </Text>
            </Pressable>
          </>
        )}

        {isEmpty && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No memories recorded for this day yet.</Text>
          </View>
        )}
      </ScrollView>

      <MemoryEditSheet
        visible={!!editTarget || adding}
        mode={editTarget ? 'edit' : 'add'}
        dayLabel={`${WEEKDAYS[date.getDay()]}, ${shortDate(date)}`}
        initialText={editTarget?.text ?? ''}
        onSave={editTarget ? saveEdit : saveNew}
        onDelete={editTarget ? deleteEntry : undefined}
        onClose={() => {
          setEditTarget(null);
          setAdding(false);
        }}
      />
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
  headerAction: { position: 'absolute', right: 20, top: 18 },
  headerDone: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.teal },
  editDot: { padding: 2 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 12,
    marginTop: 4,
  },
  addText: { fontFamily: fonts.medium, fontSize: 15, color: colors.teal },
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

  peopleHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  peopleReading: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },
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

  // Assumed Memory — same dashed/tinted treatment as the Timeline mini
  // card, so it reads as the same feature, just maximized.
  assumedCard: {
    backgroundColor: colors.pale,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slate,
    padding: 18,
  },
  assumedCardFailed: { backgroundColor: '#F5F5F5', borderColor: '#D5DBDB' },
  assumedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assumedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assumedTitle: { fontFamily: fonts.medium, fontSize: 16, color: colors.primary },
  assumedSub: { fontFamily: fonts.regular, fontSize: 12, color: '#5B7377', marginTop: 2 },
  assumedText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#324547',
    marginTop: 12,
  },
  assumedTranslateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#C7D6D8',
  },
  assumedTranslateText: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal },
});
