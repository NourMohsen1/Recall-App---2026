import { useCallback, useEffect, useRef, useState } from 'react';
import { goBack } from '../../../src/navigation';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import AddPlaceSheet from '../../../src/components/AddPlaceSheet';
import ReorderableList from '../../../src/components/ReorderableList';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../../../src/components/AnalyzingBanner';
import PeopleEditor from '../../../src/components/PeopleEditor';
import { SirPicker, SirRow } from '../../../src/components/SirCluster';
import {
  getMarkersForDay,
  markDay,
  removeMarker,
  setMarkerNote,
  type ShownMarker,
  type SirKind,
} from '../../../src/dayMarkers';
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
  reorderDay,
  saveMemory,
  setMemoryTime,
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
import { AttachmentThumb } from '../../../src/components/AttachmentViewer';
import PlaceTile, { PlaceCover } from '../../../src/components/PlaceTile';
import ReadDayCard from '../../../src/components/ReadDayCard';
import { mayReadDay, onPhotoReadingChanged } from '../../../src/photoReading';
import { askToReadDay, offerAllIfTime } from '../../../src/readDayPrompt';
import { DayPlace, getPlacesForDay, hidePlaceOnDay, setDayPlaceOrder } from '../../../src/places';
import { rtlIfArabic } from '../../../src/transcription';
import { colors, fonts } from '../../../src/theme';
import { withAppNav } from '../../../src/components/AppNav';
import { makeStyles, useColors } from '../../../src/appearance';
import TimeEditSheet from '../../../src/components/TimeEditSheet';
import { realClock } from '../../../src/logicalDay';

function DayDetailScreen() {
  const c = useColors();
  const styles = useStyles();
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const date = dateWithOffset(offsetNum);

  const [real, setReal] = useState<LoggedMemory[]>([]);
  const [places, setPlaces] = useState<DayPlace[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  // A note is being dragged: the page holds still under the finger.
  const [dragging, setDragging] = useState(false);
  // Where People sits on the page, so its search can be lifted above the
  // keyboard — its suggestions open below the field.
  const scrollRef = useRef<any>(null);
  const peopleY = useRef(0);
  const [addingPlace, setAddingPlace] = useState(false);
  const [editTarget, setEditTarget] = useState<LoggedMemory | null>(null);
  // A moment whose time is being set (tap on its time).
  const [timeTarget, setTimeTarget] = useState<LoggedMemory | null>(null);
  const [adding, setAdding] = useState(false);
  const [personPhotos, setPersonPhotos] = useState<Record<string, string | undefined>>({});
  // Only the name is needed to draw a guess; the old type carried the LLM
  // matcher's confidence and source photo, which nothing here used.
  const [faceSuggestions, setFaceSuggestions] = useState<{ name: string }[]>([]);
  const [readingFaces, setReadingFaces] = useState(false);
  // Smart Icon Reminders — the same markers the Timeline floats beside
  // this day, from the same store. See src/dayMarkers.ts.
  const [markers, setMarkers] = useState<ShownMarker[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const dayKey = dateKey(dateWithOffset(offsetNum));
  const reload = useCallback(() => {
    const key = dateKey(dateWithOffset(offsetNum));
    getMarkersForDay(key).then(setMarkers);
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

  const addSir = async (kind: SirKind) => {
    setPickerOpen(false);
    await markDay(dayKey, kind);
    setMarkers(await getMarkersForDay(dayKey));
  };
  const removeSir = async (marker: ShownMarker) => {
    await removeMarker(dayKey, marker);
    setMarkers(await getMarkersForDay(dayKey));
  };
  const noteSir = async (marker: ShownMarker, note: string) => {
    await setMarkerNote(dayKey, marker, note);
    setMarkers(await getMarkersForDay(dayKey));
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
      // A picker left open must not follow the user to the next screen.
      return () => setPickerOpen(false);
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

  // The user's hand on the day's places: off this day, or into their order.
  const removeDayPlace = async (place: DayPlace) => {
    setPlaces((prev) => prev.filter((p) => p.placeId !== place.placeId));
    await hidePlaceOnDay(place.placeId, dayKey);
    reload();
  };
  const reorderPlaces = async (next: DayPlace[]) => {
    setPlaces(next);
    await setDayPlaceOrder(dayKey, next.map((p) => p.placeId));
    reload();
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
  const [assumedStatus, setAssumedStatus] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'ask'>('idle');
  // 'ask': this day has photos, no story, and the user hasn't chosen to have
  // it read — the card becomes the invitation. See src/readDayPrompt.ts.
  const [askPhotoCount, setAskPhotoCount] = useState(0);
  const [readingDay, setReadingDay] = useState(false);
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
      // Not the user's choice to send this day's photos: show a story that
      // was already written, or the invitation to read the day.
      if (!(await mayReadDay(targetDay))) {
        const cached = await getCachedAssumedMemory(targetDay);
        if (targetDay !== dayKeyRef.current) return;
        setAskPhotoCount(photos.length);
        if (!cached) {
          setAssumedStatus('ask');
          return;
        }
        setAssumedMemory(cached);
        setAssumedDismissed(await isAssumedMemoryDismissed(targetDay, cached.signature));
        setAssumedStatus('ready');
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

  // "Tell me about this day": the user's yes, for this day, then the story.
  const readThisDay = async () => {
    const chosen = await askToReadDay(dayKey, askPhotoCount);
    if (chosen === 0) return;
    setReadingDay(true);
    await fetchAssumed(dayKey, realPhotoUris, loggedTextForAssumed);
    setReadingDay(false);
    offerAllIfTime(chosen);
  };

  // A change in Profile ("Bring back my past") shows here straight away.
  useEffect(
    () => onPhotoReadingChanged(() => fetchAssumed(dayKeyRef.current, realPhotoUris, loggedTextForAssumed)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photoUrisKey, loggedTextForAssumed],
  );

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
        {/* Back to wherever the day was opened from (src/navigation.ts). */}
        <Pressable onPress={() => goBack(router, '/timeline')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={c.brand} />
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
            <Ionicons name="create-outline" size={24} color={c.brand} />
          )}
        </Pressable>
      </View>

      <GestureHandlerRootView style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
        // A tap on a suggestion lands while the keyboard is up.
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {analyzing && <AnalyzingBanner />}

        {/* What the user actually logged that day */}
        {entries.length > 0 && (
          <View style={styles.segments}>
            <View style={styles.spine} />
            {/* Hold a note and drag it to put the day in order. */}
            <ReorderableList
              items={entries}
              keyOf={(m) => m.id}
              enabled={entries.length > 1}
              onDragging={(d) => setDragging(d)}
              onReorder={async (next, { to }) => {
                await reorderDay(next.map((m) => m.id), next[to].id);
                reload();
              }}
              renderItem={(m) => (
              <View style={styles.segment}>
                <View style={styles.spineDot} />
                <View style={{ flex: 1 }}>
                  <View style={styles.segmentHeader}>
                    {/* Voice is just an input method — once transcribed it reads
                        as a plain note, not a distinct "voice note" type. */}
                    <Text style={styles.segmentTitle}>
                      {m.kind === 'photo'
                        ? 'Photos'
                        : m.kind === 'document'
                          ? m.attachments?.[0]?.kind === 'pdf'
                            ? 'From a file'
                            : 'From a screenshot'
                          : 'Note'}
                    </Text>
                    {/* When it happened: the AI's guess (≈) until the user
                        sets it with a tap. After midnight shows its real
                        time, not the 11:59 pm it is kept at. */}
                    <Pressable
                      style={styles.timePill}
                      onPress={() => setTimeTarget(m)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Time ${formatClockTime(realClock(new Date(m.takenAt)))}, change`}
                    >
                      <Text style={styles.timePillText}>
                        {m.placedByUser ? '' : '≈ '}
                        {formatClockTime(realClock(new Date(m.takenAt)))}
                      </Text>
                    </Pressable>
                    {editing && (
                      <Pressable onPress={() => setEditTarget(m)} hitSlop={10} style={styles.editDot}>
                        <Ionicons name="create-outline" size={17} color={c.brandSoft} />
                      </Pressable>
                    )}
                  </View>

                  {/* A tap on the words opens them for editing; no mode needed. */}
                  {memoryDisplayText(m) && (
                    <Pressable onPress={() => setEditTarget(m)} disabled={m.kind === 'photo'}>
                      <Text style={[styles.segmentText, rtlIfArabic(memoryDisplayText(m)!)]}>
                        {memoryDisplayText(m)}
                      </Text>
                    </Pressable>
                  )}

                  {m.note && <Text style={[styles.noteText, rtlIfArabic(m.note)]}>📝 {m.note}</Text>}

                  {m.kind === 'document' && m.attachments?.[0] && (
                    <View style={{ marginTop: 10 }}>
                      <AttachmentThumb attachment={m.attachments[0]} size={56} />
                    </View>
                  )}

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
                      <MaterialCommunityIcons name="microphone-outline" size={14} color={c.textFaint} />
                      <Text style={styles.sourceLinkText}>Recorded by voice. Tap to listen</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              )}
            />
          </View>
        )}

        {/* Adding a note to the day, always in reach. It used to appear only
            in edit mode, where Nour never found it. */}
        <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
          <Ionicons name="add-circle-outline" size={20} color={c.brandSoft} />
          <Text style={styles.addText}>Add a note</Text>
        </Pressable>

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

        {/* Always offered on a day that has happened, so a place Recall
            missed can be added by hand. */}
        {(places.length > 0 || offsetNum <= 0) && (
          <>
            <View style={styles.divider} />
            <Text style={styles.placesTitle}>Places</Text>
            {/* Editing: the places as a list, held and dragged into the
                user's order, each with its way off the day. */}
            {editing && places.length > 0 && (
              <ReorderableList
                items={places}
                keyOf={(p) => p.placeId}
                enabled={places.length > 1}
                onDragging={(d) => setDragging(d)}
                onReorder={(next) => reorderPlaces(next)}
                renderItem={(place) => (
                  <View style={styles.placeRow}>
                    <PlaceCover cover={place.cover} kind={place.kind} size={52} radius={12} />
                    <Text style={styles.placeRowName} numberOfLines={1}>
                      {place.label}
                    </Text>
                    <Pressable onPress={() => removeDayPlace(place)} hitSlop={10} style={styles.placeRowBtn}>
                      <Ionicons name="close-circle" size={24} color={c.danger} />
                    </Pressable>
                    {places.length > 1 && (
                      <MaterialCommunityIcons name="drag-horizontal-variant" size={24} color={c.textGhost} />
                    )}
                  </View>
                )}
              />
            )}
            <View style={styles.placeGrid}>
              {!editing && places.map((place) => (
                <PlaceTile
                  key={place.placeId}
                  label={place.label}
                  cover={place.cover}
                  kind={place.kind}
                  size={100}
                  onPress={() =>
                    router.push({ pathname: '/place/[name]', params: { name: place.placeId } })
                  }
                />
              ))}
              {offsetNum <= 0 && !editing && (
                <Pressable style={{ width: 100, alignItems: 'center' }} onPress={() => setAddingPlace(true)}>
                  <View style={[styles.addPlaceTile, { width: 100, height: 100 }]}>
                    <MaterialCommunityIcons name="map-marker-plus-outline" size={30} color={c.brandSoft} />
                  </View>
                  <Text style={styles.addPlaceLabel}>Add</Text>
                </Pressable>
              )}
            </View>
            {offsetNum <= 0 && editing && (
              <Pressable style={styles.addRow} onPress={() => setAddingPlace(true)}>
                <Ionicons name="add-circle-outline" size={20} color={c.brandSoft} />
                <Text style={styles.addText}>Add a place</Text>
              </Pressable>
            )}
          </>
        )}

        <View style={styles.divider} />
        <View style={styles.peopleHeader} onLayout={(e) => (peopleY.current = e.nativeEvent.layout.y)}>
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
          onSearchOpen={() =>
            // After the keyboard starts rising, so the page has room to scroll.
            setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, peopleY.current - 16), animated: true }), 250)
          }
        />

        {/* Moments — the Smart Icon Reminders, as a labelled row. Always
            shown, with its "+", because marking a day you logged nothing on
            ("took my medicine") is one of the reasons it exists. */}
        <View style={styles.divider} />
        <Text style={styles.placesTitle}>Moments</Text>
        <SirRow markers={markers} onAdd={() => setPickerOpen(true)} onRemove={removeSir} onNote={noteSir} />
        <SirPicker visible={pickerOpen} onPick={addSir} onClose={() => setPickerOpen(false)} />

        {/* Assumed Memory, maximized — deliberately its own section, well
            below the real logged content, dashed/tinted so it never reads
            as part of what the user actually wrote above. */}
        {assumedMemory && !assumedDismissed && (
          <>
            <View style={styles.divider} />
            <View style={styles.assumedCard}>
              <View style={styles.assumedHeaderRow}>
                <View style={styles.assumedTitleRow}>
                  <Ionicons name="sparkles-outline" size={18} color={c.brandSoft} />
                  <Text style={styles.assumedTitle}>Assumed Memory</Text>
                </View>
                <Pressable hitSlop={10} onPress={dismissAssumed}>
                  <Ionicons name="close" size={18} color={c.textGhost} />
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
                <Ionicons name="language-outline" size={14} color={c.brandSoft} />
                <Text style={styles.assumedTranslateText}>
                  {translating ? 'Translating…' : assumedLang === 'ar' ? 'Show original' : 'Translate to Arabic'}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {(assumedStatus === 'ask' || readingDay) && !assumedMemory && (
          <>
            <View style={styles.divider} />
            <ReadDayCard photoUris={realPhotoUris} reading={readingDay} onRead={readThisDay} />
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
                <Ionicons name="refresh" size={18} color={c.textFaint} />
                <Text style={styles.assumedTitle}>Assumed Memory</Text>
              </View>
              <Text style={styles.assumedSub}>
                Couldn't analyze this day's photos yet. Tap to try again
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
      </GestureHandlerRootView>

      <AddPlaceSheet
        dayKey={dayKey}
        visible={addingPlace}
        onClose={(added) => {
          setAddingPlace(false);
          if (added) reload();
        }}
      />

      <TimeEditSheet
        visible={!!timeTarget}
        value={timeTarget ? realClock(new Date(timeTarget.takenAt)) : new Date()}
        onCancel={() => setTimeTarget(null)}
        onSave={async (h, min) => {
          const t = timeTarget;
          setTimeTarget(null);
          if (!t) return;
          await setMemoryTime(t.id, h, min);
          reload();
        }}
      />
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

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  back: { position: 'absolute', left: 20, top: 16 },
  headerAction: { position: 'absolute', right: 20, top: 18 },
  headerDone: { fontFamily: fonts.semiBold, fontSize: 16, color: c.brandSoft },
  editDot: { padding: 2 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 12,
    marginTop: 4,
  },
  addText: { fontFamily: fonts.medium, fontSize: 15, color: c.brandSoft },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: c.textBody },
  scroll: { padding: 24, paddingBottom: 140 },

  segments: { position: 'relative', marginBottom: 10 },
  spine: {
    position: 'absolute',
    left: 9,
    top: 10,
    bottom: 30,
    width: 10,
    borderRadius: 5,
    backgroundColor: c.brandLine,
  },
  segment: { flexDirection: 'row', gap: 18, marginBottom: 34 },
  spineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: c.tile,
    marginTop: 2,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  segmentTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: c.text },
  timePill: {
    backgroundColor: c.tile,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  timePillText: { fontFamily: fonts.regular, fontSize: 12, color: c.onTile },
  segmentText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: c.textMuted,
    marginTop: 6,
  },

  sourceBtn: {
    alignSelf: 'flex-end',
    backgroundColor: c.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  sourceBtnText: { fontFamily: fonts.regular, fontSize: 14, color: c.ink },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 20 },
  photoRow: { flexDirection: 'row', gap: 12 },
  photo: {
    width: 170,
    height: 155,
    borderRadius: 16,
    overflow: 'hidden',
  },

  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  sourceLinkText: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint },
  noteText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: c.textFaint, marginTop: 6 },

  peopleHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  peopleReading: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint },
  placesTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: c.text, marginBottom: 14 },
  addPlaceTile: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.brandLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlaceLabel: { fontFamily: fonts.regular, fontSize: 12, color: c.textBody, marginTop: 6, textAlign: 'center' },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    backgroundColor: c.surface,
  },
  placeRowName: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: c.ink },
  placeRowBtn: { padding: 2 },
  placeGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 12 },

  empty: { paddingTop: 80, alignItems: 'center' },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: c.textFaint },

  // Assumed Memory — same dashed/tinted treatment as the Timeline mini
  // card, so it reads as the same feature, just maximized.
  assumedCard: {
    backgroundColor: c.chip,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.brandMuted,
    padding: 18,
  },
  assumedCardFailed: { backgroundColor: c.fillSoft, borderColor: c.border },
  assumedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assumedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assumedTitle: { fontFamily: fonts.medium, fontSize: 16, color: c.brand },
  assumedSub: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: 2 },
  assumedText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: c.textSoft,
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
    borderTopColor: c.border,
  },
  assumedTranslateText: { fontFamily: fonts.medium, fontSize: 12, color: c.brandSoft },
}));

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(DayDetailScreen);
