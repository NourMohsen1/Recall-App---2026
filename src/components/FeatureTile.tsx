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

// Home's three shortcuts — Places, People, Recap — each showing a photo
// from inside the feature itself, picked again every time Home comes back
// into view, so the row keeps reminding the user what's in there. A new
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

const pick = <T,>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** One photo from inside the feature, or none yet. */
async function photoFor(feature: Feature): Promise<string | undefined> {
  if (feature === 'places') {
    return pick((await getPlaces()).map((p) => p.cover).filter((c): c is string => !!c));
  }
  if (feature === 'people') {
    return pick(
      Object.values(await getAllPersonMeta())
        .map((m) => m.photoUri)
        .filter((u): u is string => !!u),
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
  return pick(recent);
}

export default function FeatureTile({ feature, size }: { feature: Feature; size: number }) {
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
            <MaterialCommunityIcons name={ICON[feature]} size={Math.round(size * 0.4)} color={colors.white} />
          </View>
        )}
        <Text style={styles.label}>{LABEL[feature]}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center' },
  frame: {
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.white,
    overflow: 'hidden',
    backgroundColor: colors.pale,
  },
  empty: { backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, marginTop: 8 },
});
