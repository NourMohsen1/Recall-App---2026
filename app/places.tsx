import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ActionMenuSheet from '../src/components/ActionMenuSheet';
import FilterPill from '../src/components/FilterPill';
import AddPlaceSheet from '../src/components/AddPlaceSheet';
import PlaceTile from '../src/components/PlaceTile';
import ScreenHeader from '../src/components/ScreenHeader';
import {
  PLACE_KINDS,
  getPlaces,
  mergePlaces,
  onPlacesChanged,
  relativeDay,
  startPlaceIndexing,
  type PlaceKind,
  type PlaceSummary,
} from '../src/places';
import { colors, fonts } from '../src/theme';
import { withAppNav } from '../src/components/AppNav';
import { syncPhotosWithLibrary } from '../src/photoGuard';
import { syncNewPhotosIfOn } from '../src/photoImport';

// Every place the user has been, from their own photos and their own words
// (src/places.ts). Most visited first: the places someone goes to are the
// ones they come here to find.

const ALL_YEARS = 'All years';
const GAP = 14;

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Places() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - 40 - GAP * 2) / 3);

  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [kind, setKind] = useState<PlaceKind | 'all'>('all');
  const [menu, setMenu] = useState<'kind' | 'merge' | null>(null);
  const [showOnce, setShowOnce] = useState(false);
  const [adding, setAdding] = useState(false);
  // Choosing places that are really one, to merge them.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const startSelecting = (id?: string) => {
    setSelecting(true);
    setSelected(id ? [id] : []);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setNaming(null);
    setMenu(null);
  };
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const load = useCallback(() => {
    getPlaces().then(setPlaces);
  }, []);
  useFocusEffect(load);
  useEffect(() => onPlacesChanged(load), [load]);

  // Pull down: new photos brought in and filed, deleted ones taken out,
  // then the list. Filing older photos carries on quietly after.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncPhotosWithLibrary();
      await syncNewPhotosIfOn();
      startPlaceIndexing();
    } catch (e) {
      console.warn('[places] refresh failed:', e);
    } finally {
      load();
      setRefreshing(false);
    }
  }, [load]);


  // Every year at once: the year menu gave way to "Add".
  const activeYear = ALL_YEARS;

  const kinds = useMemo(() => {
    const set = new Set<PlaceKind>();
    for (const p of places ?? []) if (p.kind) set.add(p.kind);
    return [...set];
  }, [places]);

  // Days inside the chosen year decide both what is shown and its order.
  const shown = useMemo(() => {
    const list = (places ?? [])
      .map((p) => ({
        place: p,
        days: activeYear === ALL_YEARS ? p.days : p.days.filter((d) => d.startsWith(activeYear)),
      }))
      .filter((x) => x.days.length > 0 || x.place.addedByUser)
      .filter((x) => kind === 'all' || x.place.kind === kind);
    // A place added by hand with no visits yet comes first, so what was
    // just added is in sight; once a day names it, it takes its place.
    const fresh = (x: (typeof list)[number]) => (x.days.length === 0 && x.place.addedByUser ? 1 : 0);
    list.sort(
      (a, b) =>
        fresh(b) - fresh(a) ||
        b.days.length - a.days.length ||
        (b.days[b.days.length - 1] ?? '').localeCompare(a.days[a.days.length - 1] ?? ''),
    );
    return list;
  }, [places, activeYear, kind]);

  // A street you walked down once is not one of "your places". Kept, but
  // folded away below the ones that are.
  const regular = shown.filter((x) => x.days.length > 1 || x.place.named);
  const once = shown.filter((x) => !(x.days.length > 1 || x.place.named));

  const top = regular[0];
  const summary =
    shown.length === 0
      ? null
      : `${shown.length} ${shown.length === 1 ? 'place' : 'places'}` +
        (activeYear === ALL_YEARS ? '' : ` in ${activeYear}`) +
        (top && top.days.length > 1 ? ` · most often ${top.place.label}` : '');

  const open = (id: string) => router.push({ pathname: '/place/[name]', params: { name: id } });

  const chosen = (places ?? []).filter((p) => selected.includes(p.id));
  const merge = async (keepId: string, name: string) => {
    const clean = name.trim();
    if (!clean || chosen.length < 2) return;
    setMenu(null);
    setNaming(null);
    await mergePlaces(
      chosen.map((p) => p.id),
      keepId,
      clean,
    );
    stopSelecting();
    load();
  };
  // A typed name goes on the place with the most history.
  const busiest = [...chosen].sort((a, b) => b.days.length - a.days.length)[0];

  const renderGrid = (items: typeof shown) => (
    <View style={styles.grid}>
      {items.map(({ place, days }) => (
        <PlaceTile
          key={place.id}
          label={place.label}
          cover={place.cover}
          kind={place.kind}
          size={tile}
          radius={18}
          labelSize={14}
          caption={days.length ? cap(relativeDay(days[days.length - 1]).replace(/^on /, '')) : 'Added by you'}
          onPress={() => (selecting ? toggle(place.id) : open(place.id))}
          // Always a long-press handler, even while choosing: swapping it out
          // mid-touch (the press that starts choosing) made the finger's
          // release count as a tap, which unchecked the place just chosen.
          onLongPress={() => (selecting ? toggle(place.id) : startSelecting(place.id))}
          selected={selecting ? selected.includes(place.id) : undefined}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={selecting ? 'Select places' : 'Places'} />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}
      >
        <View style={styles.filterRow}>
          <FilterPill
            label={kind === 'all' ? 'All' : PLACE_KINDS[kind].label}
            onPress={() => setMenu('kind')}
          />
          {/* A place Recall hasn't met yet, added here. */}
          <Pressable style={styles.addBtn} onPress={() => setAdding(true)}>
            <Ionicons name="add" size={18} color={colors.white} />
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        </View>

        {(summary || selecting) && (
          <View style={styles.summaryRow}>
            <Text style={[styles.summary, { flex: 1 }]}>
              {selecting ? 'Tap the places that are really one place, then merge them.' : summary}
            </Text>
            <Pressable
              onPress={selecting ? stopSelecting : () => startSelecting()}
              hitSlop={10}
              style={styles.selectBtn}
            >
              <Text style={styles.selectText}>{selecting ? 'Cancel' : 'Select'}</Text>
            </Pressable>
          </View>
        )}

        {places && places.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No places yet</Text>
            <Text style={styles.emptyText}>
              Places appear on their own from where your photos were taken and the places you
              mention when you log your day. Everything stays on your phone.
            </Text>
          </View>
        )}

        {places && places.length > 0 && shown.length === 0 && (
          <Text style={styles.emptyText}>Nothing here for this filter.</Text>
        )}

        {renderGrid(regular)}

        {once.length > 0 && (
          <>
            <Pressable onPress={() => setShowOnce((v) => !v)} style={styles.onceToggle}>
              <Text style={styles.onceText}>
                {showOnce
                  ? 'Hide places you went to once'
                  : `${once.length} ${once.length === 1 ? 'place' : 'places'} you went to once`}
              </Text>
            </Pressable>
            {(showOnce || selecting) && renderGrid(once)}
          </>
        )}
      </ScrollView>

      <ActionMenuSheet
        visible={menu === 'kind'}
        title="Show"
        onClose={() => setMenu(null)}
        actions={[
          {
            key: 'all',
            icon: 'map-marker-multiple-outline',
            label: 'All places',
            onPress: () => {
              setKind('all');
              setMenu(null);
            },
          },
          ...kinds.map((k) => ({
            key: k,
            icon: PLACE_KINDS[k].icon,
            label: PLACE_KINDS[k].label,
            onPress: () => {
              setKind(k);
              setMenu(null);
            },
          })),
        ]}
      />
      <AddPlaceSheet
        visible={adding}
        onClose={(added) => {
          setAdding(false);
          if (added) load();
        }}
      />
      {selecting && (
        <View style={styles.mergeBar}>
          <Pressable
            style={[styles.mergeBtn, chosen.length < 2 && styles.mergeBtnOff]}
            disabled={chosen.length < 2 || merging}
            onPress={() => setMenu('merge')}
          >
            <Text style={styles.mergeBtnText}>
              {chosen.length < 2 ? 'Select 2 or more to merge' : `Merge ${chosen.length} places`}
            </Text>
          </Pressable>
        </View>
      )}

      <ActionMenuSheet
        visible={menu === 'merge'}
        title="Which name should they go by?"
        onClose={() => setMenu(null)}
        actions={[
          ...chosen.map((p) => ({
            key: p.id,
            icon: (p.named ? 'map-marker-check-outline' : 'map-marker-outline') as 'map-marker-outline',
            label: p.label,
            hint: `${p.days.length} ${p.days.length === 1 ? 'day' : 'days'}${p.named ? '' : ' · street name'}`,
            onPress: () => {
              setMerging(true);
              merge(p.id, p.label).finally(() => setMerging(false));
            },
          })),
          {
            key: 'new',
            icon: 'pencil-outline' as const,
            label: 'A new name…',
            onPress: () => {
              setMenu(null);
              setNaming('');
            },
          },
        ]}
      />

      <Modal visible={naming != null} transparent animationType="fade" onRequestClose={() => setNaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setNaming(null)}>
          <Pressable style={styles.nameCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.nameTitle}>Name this place</Text>
            <TextInput
              value={naming ?? ''}
              onChangeText={setNaming}
              placeholder="Home, College, Dunkin…"
              placeholderTextColor="#9AA3A4"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => busiest && merge(busiest.id, naming ?? '')}
              style={styles.nameInput}
            />
            <View style={styles.nameButtons}>
              <Pressable onPress={() => setNaming(null)} hitSlop={8}>
                <Text style={styles.nameCancel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => busiest && merge(busiest.id, naming ?? '')} hitSlop={8}>
                <Text style={styles.nameSave}>Merge</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Same size and corners as the filter pill beside it.
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  addText: { color: colors.white, fontFamily: fonts.medium, fontSize: 14 },
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  selectBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.white,
  },
  selectText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  summary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#4A5253',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GAP,
    rowGap: 18,
    marginTop: 18,
  },
  empty: { marginTop: 40, alignItems: 'center', paddingHorizontal: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B', marginBottom: 8 },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#4A5253',
    textAlign: 'center',
    marginTop: 16,
  },
  onceToggle: {
    alignSelf: 'center',
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.white,
  },
  onceText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },

  // Above the bottom menu.
  mergeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 84,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E5E8E8',
  },
  mergeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  mergeBtnOff: { backgroundColor: colors.soft },
  mergeBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,18,0.35)', justifyContent: 'center', padding: 28 },
  nameCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20 },
  nameTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },
  nameInput: {
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
  nameButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 18 },
  nameCancel: { fontFamily: fonts.medium, fontSize: 15, color: '#8B9394' },
  nameSave: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
});

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(Places);
