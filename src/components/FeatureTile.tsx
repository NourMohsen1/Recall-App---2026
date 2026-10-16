import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import { dateKey, getMemoriesByDay } from '../memoryLog';
import { getAllPersonMeta } from '../peopleTags';
import { getAllPhotoSources } from '../photoMeta';
import { getPlaces } from '../places';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// Home's three shortcuts — Places, People, Recap — each showing a photo
// from inside the feature itself. One photo per day: the same all day, a
// different one tomorrow. (Picking again on every return to Home looked
// noisy — Nour.) A new
// user has none yet: the tile is the feature's icon on teal instead,
// never a stock picture.

export type Feature = 'places' | 'people' | 'recap';

const ICON: Record<Feature, keyof typeof MaterialCommunityIcons.glyphMap> = {
  places: 'map-marker-radius',
  people: 'account-group',
  recap: 'book-open-page-variant',
};
const LABEL: Record<Feature, string> = { places: 'Places', people: 'People', recap: 'Recap' };
const HREF: Record<Feature, Href> = { places: '/places', people: '/people', recap: '/recap' };

/** How far back the Recap tile looks for a photo. */
const RECAP_DAYS = 14;

/** The day's choice: the same for every visit today, another tomorrow. */
function pick(list: string[], feature: Feature): string | undefined {
  if (list.length === 0) return undefined;
  const sorted = [...new Set(list)].sort();
  const seed = `${dateKey(new Date())}|${feature}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return sorted[Math.abs(h) % sorted.length];
}

/** One photo from inside the feature, or none yet. */
async function photoFor(feature: Feature): Promise<string | undefined> {
  if (feature === 'places') {
    return pick((await getPlaces()).map((p) => p.cover).filter((c): c is string => !!c), feature);
  }
  if (feature === 'people') {
    return pick(
      Object.values(await getAllPersonMeta())
        .map((m) => m.photoUri)
        .filter((u): u is string => !!u),
      feature,
    );
  }
  // Recap: a photo from the last two weeks — what a recap is about. Never
  // a screenshot or a saved image: those are documents, not moments.
  const [byDay, sources] = await Promise.all([getMemoriesByDay(), getAllPhotoSources()]);
  const since = new Date();
  since.setDate(since.getDate() - RECAP_DAYS);
  const from = dateKey(since);
  const recent: string[] = [];
  for (const [day, list] of byDay) {
    if (day < from) continue;
    for (const m of list) {
      if (m.kind !== 'photo') continue;
      for (const uri of m.photoUris ?? []) if (!sources[uri]) recent.push(uri);
    }
  }
  return pick(recent, feature);
}

export default function FeatureTile({ feature, size }: { feature: Feature; size: number }) {
  const c = useColors();
  const styles = useStyles();
  const [photo, setPhoto] = useState<string | undefined>();
  useFocusEffect(
    useCallback(() => {
      let live = true;
      photoFor(feature)
        .then((p) => live && setPhoto(p))
        .catch((e) => console.warn(`[home] no ${feature} photo:`, e));
      return () => {
        live = false;
      };
    }, [feature]),
  );

  const box = { width: size, height: size };
  return (
    <Link href={HREF[feature]} asChild>
      {/* Flattened: Link passes its child one style object, not an array. */}
      <Pressable style={StyleSheet.flatten([styles.tile, { width: size }])}>
        {photo ? (
          <View style={[styles.frame, box]}>
            <PhotoImage uri={photo} style={StyleSheet.absoluteFill} />
          </View>
        ) : (
          <View style={[styles.frame, styles.empty, box]}>
            <MaterialCommunityIcons name={ICON[feature]} size={Math.round(size * 0.4)} color={c.onTile} />
          </View>
        )}
        <Text style={styles.label}>{LABEL[feature]}</Text>
      </Pressable>
    </Link>
  );
}

const useStyles = makeStyles((c) => ({
  tile: { alignItems: 'center' },
  frame: {
    borderRadius: 18,
    borderWidth: 3,
    // The page's own colour: a frame that only shows round a photo's edge.
    borderColor: c.bg,
    overflow: 'hidden',
    backgroundColor: c.chip,
  },
  empty: { backgroundColor: c.tileAlt, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.regular, fontSize: 14, color: c.ink, marginTop: 8 },
}));
