import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import PhotoSlideshow from './PhotoSlideshow';
import RecapCompany from './RecapCompany';
import {
  periodPhotos,
  recapLine,
  recapPeriod,
  unitsWithContent,
  type RecapKind,
  type RecapLine,
  type RecapUnit,
} from '../recap';
import { colors, fonts } from '../theme';

// A week, a month or a year — the Recap design: a header card with the
// period and a strip of photo tiles, then a timeline of short summaries.
// Weekly rows are days, monthly rows are weeks, yearly rows are months.
// Lines are written one after another and appear as they are ready.

type Row = { unit: RecapUnit; line?: RecapLine | null; loading: boolean };

export default function RecapView({
  kind,
  offset,
  onOffset,
  onOpenUnit,
}: {
  kind: RecapKind;
  offset: number;
  onOffset: (next: number) => void;
  onOpenUnit: (unit: RecapUnit) => void;
}) {
  const period = recapPeriod(kind, offset);
  const [tiles, setTiles] = useState<RecapUnit[]>(period.units);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [slides, setSlides] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setRows(null);
    setTiles(period.units);
    (async () => {
      if (kind === 'month') periodPhotos(period).then((p) => live && setSlides(p));
      const units = await unitsWithContent(period);
      if (!live) return;
      setTiles(units.map((u) => u.unit));
      const withContent = units.filter((u) => u.hasContent).map((u) => u.unit);
      const next: Row[] = withContent.map((unit) => ({ unit, loading: true }));
      setRows([...next]);
      // One at a time: each line is a request, and the page fills in top to
      // bottom as they come back.
      for (let i = 0; i < next.length; i++) {
        const line = await recapLine(kind, next[i].unit).catch((e) => {
          console.warn('[recap] line failed:', e);
          return null;
        });
        if (!live) return;
        next[i] = { ...next[i], line, loading: false };
        setRows([...next]);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, offset]);

  const anyGuess = rows?.some((r) => r.line?.guessed) ?? false;
  const shown = rows?.filter((r) => r.loading || r.line) ?? [];
  const canGoForward = offset < 0;
  const scrollTiles = kind === 'year';

  const strip = tiles.map((u) => (
    <Pressable key={u.key} onPress={() => onOpenUnit(u)} style={[styles.tile, scrollTiles && styles.tileFixed]}>
      <Text style={styles.tileLabel}>{u.tile}</Text>
      {u.photo ? (
        <PhotoImage uri={u.photo} style={styles.tilePhoto} />
      ) : (
        <View style={[styles.tilePhoto, styles.tileEmpty]} />
      )}
    </Pressable>
  ));

  const unit = kind === 'week' ? 'Week' : kind === 'month' ? 'Month' : 'Year';

  return (
    <>
      {/* Step a period back or forward — one line above the card. */}
      <View style={styles.navRow}>
        <Pressable onPress={() => onOffset(offset - 1)} hitSlop={10} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
          <Text style={styles.navText}>Last {unit}</Text>
        </Pressable>
        <Pressable
          onPress={() => canGoForward && onOffset(offset + 1)}
          hitSlop={10}
          disabled={!canGoForward}
          style={[styles.navBtn, !canGoForward && { opacity: 0.3 }]}
        >
          <Text style={styles.navText}>Next {unit}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      </View>

    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{period.title}</Text>
          <Text style={styles.range}>{period.range}</Text>
        </View>
        {/* A month is one photo at a time, fading through the month. */}
        {kind === 'month' ? (
          <PhotoSlideshow uris={slides} style={styles.slideshow} />
        ) : scrollTiles ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripScroll}>
            {strip}
          </ScrollView>
        ) : (
          <View style={styles.strip}>{strip}</View>
        )}
      </View>

      <View style={styles.list}>
        {rows === null ? (
          <ActivityIndicator color={colors.teal} style={{ marginVertical: 30 }} />
        ) : shown.length === 0 ? (
          <Text style={styles.empty}>
            {tiles.some((t) => t.photo) || slides.length > 0
              ? `Only photos from this ${kind} so far. Turn on Reading your photos in Profile and Recall will tell their story.`
              : `Nothing recorded in this ${kind} yet.`}
          </Text>
        ) : (
          <>
            {shown.map((r, i) => (
              <Pressable key={r.unit.key} onPress={() => onOpenUnit(r.unit)} style={styles.row}>
                {/* The dot, and the line down to the next one — so the
                    timeline stops at the last entry. */}
                <View style={styles.rail}>
                  <View style={styles.dot} />
                  {i < shown.length - 1 && <View style={styles.railLine} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowTitle}>{r.unit.title}</Text>
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{r.unit.chip}</Text>
                    </View>
                  </View>
                  {r.loading ? (
                    <Text style={[styles.rowText, styles.rowLoading]}>Writing this up…</Text>
                  ) : (
                    <Text style={styles.rowText}>{r.line?.summary}</Text>
                  )}
                  {i < shown.length - 1 && <View style={styles.separator} />}
                </View>
              </Pressable>
            ))}
          </>
        )}

        {/* Who and where, for a week only for now. */}
        {kind === 'week' && rows !== null && (
          <RecapCompany
            from={period.units[0].from}
            to={period.units[period.units.length - 1].to}
            style={{ marginLeft: DOT_LEFT }}
          />
        )}

        {/* One line at the end whenever any of this leaned on a guess: what
            the photos seemed to show, or faces not confirmed. */}
        {anyGuess && (
          <View style={styles.disclaimer}>
            <MaterialCommunityIcons name="creation-outline" size={14} color="#8B9394" />
            <Text style={styles.disclaimerText}>
              Parts of this recap are Recall's guesses from your photos and may not be accurate.
            </Text>
          </View>
        )}
      </View>
    </View>
    </>
  );
}

const SPINE_X = 22;
/** Where the timeline's dots start; what follows them lines up here. */
const DOT_LEFT = SPINE_X - 14;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 26,
    overflow: 'hidden',
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#C9D5D6',
  },
  header: { backgroundColor: '#ADC3C5', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16 },
  // Title and dates share a top edge, at the card's two sides.
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
  // Sized against the rest of the page: the day titles are 17.
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 22, color: '#1B1B1B' },
  range: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 22, color: '#1B1B1B', textAlign: 'right' },
  slideshow: { width: '100%', aspectRatio: 2.4, borderRadius: 18, marginTop: 14 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  stripScroll: { gap: 8, marginTop: 14 },
  tile: {
    width: '13%',
    backgroundColor: colors.white,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C9D2D3',
    alignItems: 'center',
    paddingTop: 8,
    overflow: 'hidden',
  },
  tileFixed: { width: 46 },
  tileLabel: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.teal, marginBottom: 6 },
  tilePhoto: { width: '100%', aspectRatio: 0.55, borderRadius: 999, overflow: 'hidden' },
  tileEmpty: { backgroundColor: '#E7EDEE' },

  list: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 18 },
  row: { flexDirection: 'row', gap: 14 },
  rail: { width: 28, alignItems: 'center', marginLeft: DOT_LEFT },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary },
  railLine: { flex: 1, width: 8, backgroundColor: '#8FA6A9', marginTop: -2, marginBottom: -2 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#111', flexShrink: 1 },
  chip: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 },
  chipText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.white, letterSpacing: 0.5 },
  rowText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: '#6B7475', marginTop: 8 },
  rowLoading: { fontStyle: 'italic', color: '#A3ABAC' },
  separator: { height: 1, backgroundColor: '#A9C0C3', marginTop: 16, marginBottom: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394', textAlign: 'center', marginVertical: 26 },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 22, paddingLeft: DOT_LEFT, paddingRight: 4 },
  disclaimerText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: '#8B9394' },
});
