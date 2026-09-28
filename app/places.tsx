import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActionMenuSheet from '../src/components/ActionMenuSheet';
import FilterPill from '../src/components/FilterPill';
import PlaceTile from '../src/components/PlaceTile';
import ScreenHeader from '../src/components/ScreenHeader';
import {
  PLACE_KINDS,
  getPlaces,
  onPlacesChanged,
  relativeDay,
  type PlaceKind,
  type PlaceSummary,
} from '../src/places';
import { colors, fonts } from '../src/theme';

// Every place the user has been, from their own photos and their own words
// (src/places.ts). Most visited first: the places someone goes to are the
// ones they come here to find.

const ALL_YEARS = 'All years';
const GAP = 14;

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Places() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - 40 - GAP * 2) / 3);

  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [kind, setKind] = useState<PlaceKind | 'all'>('all');
  const [year, setYear] = useState<string | null>(null);
  const [menu, setMenu] = useState<'kind' | 'year' | null>(null);
  const [showOnce, setShowOnce] = useState(false);

  const load = useCallback(() => {
    getPlaces().then(setPlaces);
  }, []);
  useFocusEffect(load);
  useEffect(() => onPlacesChanged(load), [load]);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of places ?? []) for (const d of p.days) set.add(d.slice(0, 4));
    return [...set].sort().reverse();
  }, [places]);

  // Opens on this year when there is anything this year, like the design.
  const thisYear = String(new Date().getFullYear());
  const activeYear = year ?? (years.includes(thisYear) ? thisYear : ALL_YEARS);

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
      .filter((x) => x.days.length > 0)
      .filter((x) => kind === 'all' || x.place.kind === kind);
    list.sort(
      (a, b) =>
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
          caption={cap(relativeDay(days[days.length - 1]).replace(/^on /, ''))}
          onPress={() => open(place.id)}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Places" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        <View style={styles.filterRow}>
          <FilterPill
            label={kind === 'all' ? 'All' : PLACE_KINDS[kind].label}
            onPress={() => setMenu('kind')}
          />
          <FilterPill label={activeYear} onPress={() => setMenu('year')} />
        </View>

        {summary && <Text style={styles.summary}>{summary}</Text>}

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
            {showOnce && renderGrid(once)}
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
      <ActionMenuSheet
        visible={menu === 'year'}
        title="Year"
        onClose={() => setMenu(null)}
        actions={[ALL_YEARS, ...years].map((y) => ({
          key: y,
          icon: y === activeYear ? 'check' : 'calendar-blank-outline',
          label: y,
          onPress: () => {
            setYear(y);
            setMenu(null);
          },
        }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 120 },
  filterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#4A5253',
    marginTop: 16,
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
});
