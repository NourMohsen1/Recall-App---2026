import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import PhotoImage from './PhotoImage';
import { recapPeriod, unitsWithContent, type RecapKind, type RecapUnit } from '../recap';
import { colors, fonts } from '../theme';

// The first screen of each Recap tab, as designed: a card per week (with a
// photo tile for each day), per month (one photo), or per year (one photo,
// the year across it). Tapping a card opens that period's full recap.

type Card = { offset: number; title: string; range: string; tiles: RecapUnit[]; photo?: string; has: boolean };

const HOW_MANY: Record<RecapKind, number> = { week: 8, month: 12, year: 6 };

export default function RecapOverview({ kind, onOpen }: { kind: RecapKind; onOpen: (offset: number) => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let live = true;
    setCards(null);
    (async () => {
      const out: Card[] = [];
      for (let i = 0; i < HOW_MANY[kind]; i++) {
        const period = recapPeriod(kind, -i);
        const units = await unitsWithContent(period);
        const tiles = units.map((u) => u.unit);
        const has = units.some((u) => u.hasContent);
        out.push({
          offset: -i,
          title: period.title,
          range: period.range,
          tiles,
          photo: tiles.find((t) => t.photo)?.photo,
          has,
        });
      }
      if (!live) return;
      // The current period always shows; older ones only when something
      // happened in them — or there are photos from them.
      setCards(out.filter((c, i) => i === 0 || c.has || !!c.photo));
    })();
    return () => {
      live = false;
    };
  }, [kind]);

  if (!cards) return null;

  return (
    <>
      {cards.map((c) => (
        <Pressable key={c.offset} onPress={() => onOpen(c.offset)} style={styles.card}>
          {kind === 'year' ? (
            <View>
              {c.photo ? (
                <PhotoImage uri={c.photo} style={styles.yearPhoto} />
              ) : (
                <View style={[styles.yearPhoto, styles.empty]} />
              )}
              <View style={styles.yearOverlay}>
                <Text style={styles.yearText}>{c.range}</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.head}>
                <Text style={styles.title}>{kind === 'month' ? c.title.toUpperCase() : c.title}</Text>
                <Text style={styles.range}>{c.range}</Text>
              </View>
              {kind === 'month' ? (
                c.photo ? (
                  <PhotoImage uri={c.photo} style={styles.monthPhoto} />
                ) : (
                  <View style={[styles.monthPhoto, styles.empty]} />
                )
              ) : (
                <View style={styles.days}>
                  {c.tiles.map((t) => (
                    <View key={t.key} style={styles.pill}>
                      <Text style={styles.pillNum}>{t.tile}</Text>
                      {t.photo ? (
                        <PhotoImage uri={t.photo} style={styles.pillPhoto} />
                      ) : (
                        <View style={[styles.pillPhoto, styles.empty]} />
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 26, padding: 16, marginTop: 18 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 22, color: '#1B1B1B' },
  range: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 22, color: '#1B1B1B', textAlign: 'right' },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  pill: {
    width: '13%',
    backgroundColor: colors.pale,
    borderRadius: 999,
    alignItems: 'center',
    paddingTop: 6,
    overflow: 'hidden',
  },
  pillNum: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.teal, marginBottom: 5 },
  pillPhoto: { width: '100%', aspectRatio: 0.6, borderRadius: 999, overflow: 'hidden' },
  monthPhoto: { width: '100%', aspectRatio: 2.4, borderRadius: 18, marginTop: 12, overflow: 'hidden' },
  yearPhoto: { width: '100%', aspectRatio: 1.95, borderRadius: 18, overflow: 'hidden' },
  yearOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,17,18,0.28)',
    borderRadius: 18,
  },
  yearText: { fontFamily: fonts.bold, fontSize: 56, color: colors.accent },
  empty: { backgroundColor: '#E7EDEE' },
});
