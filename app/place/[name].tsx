import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ActionMenuSheet, { type MenuAction } from '../../src/components/ActionMenuSheet';
import PersonAvatar from '../../src/components/PersonAvatar';
import PhotoImage from '../../src/components/PhotoImage';
import { PlaceCover } from '../../src/components/PlaceTile';
import { getAllDayMarkers } from '../../src/dayMarkers';
import { getMemoriesByDay, memoryDisplayText, persistFile } from '../../src/memoryLog';
import { isPrivateFile } from '../../src/photoGuard';
import { resolvePhotoUri } from '../../src/photoUri';
import { getAllPersonMeta, getPeopleSummaries } from '../../src/peopleTags';
import {
  PLACE_KINDS,
  PLACE_KIND_LIST,
  describeFrequency,
  getPlace,
  nameSpotAs,
  offsetOfDay,
  onPlacesChanged,
  relativeDay,
  removePlace,
  renamePlace,
  setPlaceCover,
  setPlaceKind,
  type PlaceSummary,
} from '../../src/places';
import { colors, fonts } from '../../src/theme';
import { withAppNav } from '../../src/components/AppNav';

// A place's profile: what it looks like, how often the user goes, what
// happened last time, who they go with, and every day they were there.
// Everything on it is the user's own — their photos, their words, their
// people. See src/places.ts for where each piece comes from.

type Companion = { name: string; count: number; photoUri?: string };

// The first sentence of a day's memory, for a visit with no line of its own.
function firstLine(text: string): string {
  const m = text.match(/^(.+?[.!?؟])(\s|$)/);
  const line = (m ? m[1] : text).trim();
  return line.length > 110 ? `${line.slice(0, 107).trimEnd()}…` : line;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function PlaceProfile() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { name } = useLocalSearchParams<{ name: string }>();
  const [place, setPlace] = useState<PlaceSummary | null | undefined>(undefined);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [dayLines, setDayLines] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<'more' | 'photo' | 'kind' | null>(null);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [allVisits, setAllVisits] = useState(false);

  const load = useCallback(async () => {
    const found = await getPlace(name ?? '');
    setPlace(found);
    if (!found) return;
    const days = new Set(found.days);

    const [summaries, meta, markers, byDay] = await Promise.all([
      getPeopleSummaries(),
      getAllPersonMeta(),
      getAllDayMarkers(),
      getMemoriesByDay(),
    ]);

    // Who the user was with on days they were here. Confirmed people only —
    // a face the app merely thinks it saw is not "who you go with".
    setCompanions(
      summaries
        .map((p) => ({
          name: p.name,
          count: p.days.filter((d) => days.has(d)).length,
          photoUri: meta[p.name]?.photoUri,
        }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    );

    // Moments marked on days here — "Workout", "Exam", "أخدت الدوا".
    const labels: string[] = [];
    for (const d of [...found.days].reverse()) {
      for (const m of markers[d] ?? []) {
        if (!labels.some((l) => l.toLowerCase() === m.label.toLowerCase())) labels.push(m.label);
      }
    }
    setChips(labels.slice(0, 6));

    const lines: Record<string, string> = {};
    for (const d of found.days) {
      const text = (byDay.get(d) ?? []).map(memoryDisplayText).find((t): t is string => !!t);
      if (text) lines[d] = firstLine(text);
    }
    setDayLines(lines);
  }, [name]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => onPlacesChanged(() => load()), [load]);

  const back = () => (router.canGoBack() ? router.back() : router.dismissTo('/places'));

  // A rename can fold this place into another one with the same name; the
  // screen follows whichever place remains.
  const follow = (id: string) => {
    if (id !== name) router.setParams({ name: id });
    else load();
  };

  const saveRename = async () => {
    if (!place || renaming == null) return;
    const next = renaming.trim();
    setRenaming(null);
    if (!next || next === place.label) return;
    follow(await renamePlace(place.id, next));
  };

  const pickNewPhoto = async (source: 'camera' | 'library') => {
    setMenu(null);
    if (!place) return;
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo'} access to set a picture.`);
      return;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    if (await isPrivateFile(result.assets[0].uri)) {
      Alert.alert('Not added', 'This photo looks private, so Recall left it out.');
      return;
    }
    await setPlaceCover(place.id, await persistFile(result.assets[0].uri, 'place'));
  };

  if (place === undefined) return <SafeAreaView style={styles.safe} />;

  if (place === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={back} />
        <View style={styles.missing}>
          <Text style={styles.missingText}>
            This place isn't in your memories any more.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const last: string | undefined = place.days[place.days.length - 1];
  const lastLine = last ? (place.moments[last] ?? dayLines[last]) : undefined;
  const hasLocation = place.latitude != null && place.longitude != null;
  const pickable = place.photos.length > 0 ? place.photos : place.dayPhotos;
  const visits = [...place.days].reverse();
  const shownVisits = allVisits ? visits : visits.slice(0, 5);
  const tile = Math.floor((width - 48 - 16) / 3);

  const openDay = (day: string) => {
    if (day) router.push(`/day/${offsetOfDay(day)}` as Parameters<typeof router.push>[0]);
  };

  const openInMaps = () => {
    setMenu(null);
    if (!hasLocation) return;
    Linking.openURL(
      `http://maps.apple.com/?ll=${place.latitude},${place.longitude}&q=${encodeURIComponent(place.label)}`,
    );
  };

  const moreActions: MenuAction[] = [
    {
      key: 'rename',
      icon: 'pencil-outline',
      label: place.named ? 'Rename' : 'Name this place',
      onPress: () => {
        setMenu(null);
        setRenaming(place.named ? place.label : '');
      },
    },
    {
      key: 'photo',
      icon: 'image-outline',
      label: 'Change photo',
      onPress: () => setMenu('photo'),
    },
    {
      key: 'kind',
      icon: PLACE_KINDS[place.kind ?? 'other'].icon,
      label: 'What kind of place',
      hint: place.kind ? PLACE_KINDS[place.kind].label : 'Not set',
      onPress: () => setMenu('kind'),
    },
    ...(hasLocation
      ? [{ key: 'maps', icon: 'map-outline' as const, label: 'Open in Maps', onPress: openInMaps }]
      : []),
    // Only a place with nothing in it yet — one added by hand, by mistake.
    ...(place.days.length === 0 && place.photos.length === 0
      ? [
          {
            key: 'remove',
            icon: 'trash-can-outline' as const,
            label: 'Remove place',
            onPress: async () => {
              setMenu(null);
              if (await removePlace(place.id)) back();
            },
          },
        ]
      : []),
  ];

  const photoActions: MenuAction[] = [
    ...(pickable.length > 0
      ? [
          {
            key: 'pick',
            icon: 'image-multiple-outline' as const,
            label: place.photos.length > 0 ? 'One of your photos from here' : 'A photo from a day you were here',
            onPress: () => {
              setMenu(null);
              setPicking(true);
            },
          },
        ]
      : []),
    { key: 'camera', icon: 'camera-outline', label: 'Take a photo', onPress: () => pickNewPhoto('camera') },
    {
      key: 'library',
      icon: 'folder-image',
      label: 'Choose from your library',
      onPress: () => pickNewPhoto('library'),
    },
    ...(place.coverUri
      ? [
          {
            key: 'auto',
            icon: 'autorenew' as const,
            label: 'Let Recall choose',
            hint: 'Your best photo from here',
            onPress: () => {
              setMenu(null);
              setPlaceCover(place.id, null);
            },
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={back} onMore={() => setMenu('more')} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => setMenu('photo')} style={styles.heroWrap}>
          <PlaceCover cover={place.cover} kind={place.kind} radius={24} style={styles.hero} />
          {!place.cover && (
            <View style={styles.addPhoto}>
              <MaterialCommunityIcons name="camera-plus-outline" size={18} color={colors.primary} />
              <Text style={styles.addPhotoText}>Add a photo of this place</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.nameRow}>
          <Text style={styles.name}>{place.label}</Text>
        </View>
        {/* A place added by hand has no visits until a day names it. */}
        <Text style={styles.subtitle}>{last ? describeFrequency(place.days) : 'Added by you'}</Text>
        {last && (
          <Text style={styles.lastVisited}>
            Last visited {relativeDay(last)}
            {lastLine ? `: ${lastLine}` : ''}
          </Text>
        )}

        {(place.kind || chips.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }}>
            <View style={styles.tagRow}>
              {place.kind && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{PLACE_KINDS[place.kind].label}</Text>
                </View>
              )}
              {chips.map((c) => (
                <View key={c} style={styles.tag}>
                  <Text style={styles.tagText}>{c}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* A spot nobody has named. The app never names it on its own — it
            asks, with the places the user mentioned on days they were here. */}
        {!place.named && (
          <View style={styles.askCard}>
            <Text style={styles.askTitle}>What is this place?</Text>
            <Text style={styles.askText}>
              {place.maybeNames.length > 0
                ? 'You mentioned these on days you were here. Is it one of them?'
                : "Give it the name you'd use — Recall will know it by that from now on."}
            </Text>
            <View style={styles.askChips}>
              {place.maybeNames.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.askChip}
                  onPress={async () => follow(await nameSpotAs(place.id, m.id))}
                >
                  <Text style={styles.askChipText}>{m.name}</Text>
                </Pressable>
              ))}
              <Pressable style={[styles.askChip, styles.askChipOther]} onPress={() => setRenaming('')}>
                <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.primary} />
                <Text style={styles.askChipText}>
                  {place.maybeNames.length > 0 ? 'Something else' : 'Name it'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {companions.length > 0 && (
          <>
            {/* People are tagged on DAYS, not on places, so "who you were
                here with" would claim more than the app knows — Omar at
                the café in the morning is not Omar at college in the
                afternoon. The heading says only what is true. */}
            <Text style={styles.sectionTitle}>People from your days here</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.peopleRow}>
                {companions.map((c) => (
                  <Pressable
                    key={c.name}
                    style={styles.person}
                    onPress={() => router.push({ pathname: '/person/[name]', params: { name: c.name } })}
                  >
                    <PersonAvatar name={c.name} photoUri={c.photoUri} size={56} />
                    <Text numberOfLines={1} style={styles.personName}>
                      {c.name}
                    </Text>
                    <Text style={styles.personCount}>
                      {c.count} {c.count === 1 ? 'day' : 'days'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {pickable.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              {place.photos.length > 0 ? 'Memories Here' : 'From days you were here'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.memoryRow}>
                {pickable.slice(0, 20).map((uri) => (
                  <Pressable key={uri} onPress={() => openDay(place.photoDay[uri])}>
                    <PhotoImage uri={uri} style={styles.memoryTile} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {visits.length > 0 && (
          <Text style={styles.sectionTitle}>
            {place.days.length === 1 ? 'Your visit' : `Your visits · ${place.days.length}`}
          </Text>
        )}
        {shownVisits.map((day) => {
          const line = place.moments[day] ?? dayLines[day];
          return (
            <Pressable key={day} style={styles.visit} onPress={() => openDay(day)}>
              <View style={styles.visitDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.visitDay}>{cap(relativeDay(day).replace(/^on /, ''))}</Text>
                {line ? (
                  <Text numberOfLines={2} style={styles.visitLine}>
                    {line}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.soft} />
            </Pressable>
          );
        })}
        {visits.length > 5 && (
          <Pressable onPress={() => setAllVisits((v) => !v)} style={styles.moreVisits}>
            <Text style={styles.moreVisitsText}>
              {allVisits ? 'Show fewer' : `Show all ${visits.length} visits`}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <ActionMenuSheet visible={menu === 'more'} title={place.label} actions={moreActions} onClose={() => setMenu(null)} />
      <ActionMenuSheet
        visible={menu === 'photo'}
        title="Photo for this place"
        actions={photoActions}
        onClose={() => setMenu(null)}
      />
      <ActionMenuSheet
        visible={menu === 'kind'}
        title="What kind of place is it?"
        onClose={() => setMenu(null)}
        actions={PLACE_KIND_LIST.map((k) => ({
          key: k,
          icon: k === place.kind ? 'check' : PLACE_KINDS[k].icon,
          label: PLACE_KINDS[k].label,
          onPress: () => {
            setMenu(null);
            setPlaceKind(place.id, k);
          },
        }))}
      />

      {/* Choosing the cover from the user's own photos of the place. */}
      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        {/* Insets by hand: SafeAreaView measures nothing inside a Modal. */}
        <View style={[styles.safe, { paddingTop: insets.top }]}>
          <View style={styles.pickHeader}>
            <Pressable onPress={() => setPicking(false)} hitSlop={12}>
              <Ionicons name="close" size={26} color={colors.primary} />
            </Pressable>
            <Text style={styles.pickTitle}>Choose a photo</Text>
            <View style={{ width: 26 }} />
          </View>
          <ScrollView contentContainerStyle={styles.pickGrid}>
            {pickable.map((uri) => (
              <Pressable
                key={uri}
                onPress={async () => {
                  setPicking(false);
                  // A cover chosen by hand is the user's decision, so the app
                  // keeps its own copy: deleting the photo from Photos later
                  // must not take the place's picture with it.
                  const readable = await resolvePhotoUri(uri);
                  await setPlaceCover(place.id, readable ? await persistFile(readable, 'place') : uri);
                }}
              >
                <PhotoImage uri={uri} style={[styles.pickTile, { width: tile, height: tile }]} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Naming, in place. */}
      <Modal visible={renaming != null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.renameCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.renameTitle}>{place.named ? 'Rename' : 'Name this place'}</Text>
            <TextInput
              value={renaming ?? ''}
              onChangeText={setRenaming}
              placeholder="Dunkin, College, Home…"
              placeholderTextColor="#9AA3A4"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveRename}
              style={styles.renameInput}
            />
            <View style={styles.renameButtons}>
              <Pressable onPress={() => setRenaming(null)} hitSlop={8}>
                <Text style={styles.renameCancel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveRename} hitSlop={8}>
                <Text style={styles.renameSave}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ onBack, onMore }: { onBack: () => void; onMore?: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
        <Ionicons name="arrow-back" size={28} color={colors.primary} />
      </Pressable>
      <Text style={styles.headerTitle}>Profile</Text>
      {onMore && (
        <Pressable onPress={onMore} hitSlop={12} style={styles.more}>
          <MaterialCommunityIcons name="dots-horizontal" size={26} color={colors.primary} />
        </Pressable>
      )}
    </View>
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
  more: { position: 'absolute', right: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 24, paddingBottom: 140 },

  heroWrap: { marginTop: 14 },
  hero: { width: '100%', aspectRatio: 0.97, borderWidth: 0 },
  addPhoto: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  addPhotoText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 34, color: '#1B1B1B', lineHeight: 42 },
  subtitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#2B2B2B', marginTop: 2 },
  lastVisited: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#3A4243',
    marginTop: 12,
  },
  tagRow: { flexDirection: 'row', gap: 10 },
  tag: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  tagText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.white },

  askCard: {
    marginTop: 22,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
    backgroundColor: '#F4F8F8',
  },
  askTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B' },
  askText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#4A5253', marginTop: 4 },
  askChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  askChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.soft,
  },
  askChipOther: { borderStyle: 'dashed' },
  askChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B', marginTop: 26, marginBottom: 12 },
  peopleRow: { flexDirection: 'row', gap: 16 },
  person: { width: 68, alignItems: 'center' },
  personName: { fontFamily: fonts.medium, fontSize: 12, color: '#2B2B2B', marginTop: 6 },
  personCount: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },

  memoryRow: { flexDirection: 'row', gap: 12 },
  memoryTile: { width: 150, height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.pale },

  visit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F1',
  },
  visitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  visitDay: { fontFamily: fonts.medium, fontSize: 14, color: '#1B1B1B' },
  visitLine: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#5E6667', marginTop: 2 },
  moreVisits: { alignSelf: 'flex-start', paddingVertical: 12 },
  moreVisitsText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  missingText: { fontFamily: fonts.regular, fontSize: 15, color: '#4A5253', textAlign: 'center' },

  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pickTitle: { fontFamily: fonts.medium, fontSize: 18, color: '#2B2B2B' },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingBottom: 60 },
  pickTile: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.pale },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,18,0.35)', justifyContent: 'center', padding: 28 },
  renameCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20 },
  renameTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },
  renameInput: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.soft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: '#1B1B1B',
  },
  renameButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 18 },
  renameCancel: { fontFamily: fonts.medium, fontSize: 15, color: '#8B9394' },
  renameSave: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
});

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(PlaceProfile);
