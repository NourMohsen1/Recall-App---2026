import { useEffect, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import { PLACE_KINDS, getPlace, getPlaces, type PlaceKind, type PlaceSummary } from '../places';
import { colors, fonts } from '../theme';

// A place's picture: the user's own photo from there, or — when there is
// none yet — a quiet tile with the kind of place it is, the grey storefront
// from the design for anything unknown. Never a stock photo.
export function PlaceCover({
  cover,
  kind,
  size,
  radius = 16,
  style,
}: {
  cover?: string;
  kind?: PlaceKind;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = [
    styles.frame,
    size != null && { width: size, height: size },
    { borderRadius: radius },
    style,
  ];
  if (cover) {
    return (
      <View style={frame}>
        <PhotoImage uri={cover} style={StyleSheet.absoluteFill} />
      </View>
    );
  }
  const icon = PLACE_KINDS[kind ?? 'other'].icon;
  return (
    <View style={[frame, styles.empty]}>
      <MaterialCommunityIcons
        name={icon}
        size={size ? Math.round(size * 0.42) : 48}
        color="#B9C1C2"
      />
    </View>
  );
}

/** The cover of a place known only by name — a chat answer that mentions
 *  it. Or, with no name, the place the user goes to most (the Home screen's
 *  Places shortcut). */
export function PlaceThumb({
  name,
  size,
  radius = 16,
  style,
}: {
  name?: string;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [place, setPlace] = useState<PlaceSummary | null>(null);
  useEffect(() => {
    let live = true;
    const find = name
      ? getPlace(name)
      : getPlaces().then(
          (all) => [...all].filter((p) => p.cover).sort((a, b) => b.days.length - a.days.length)[0] ?? null,
        );
    find.then((p) => live && setPlace(p));
    return () => {
      live = false;
    };
  }, [name]);
  return <PlaceCover cover={place?.cover} kind={place?.kind} size={size} radius={radius} style={style} />;
}

/** A place with its name under it — the Timeline card, the day screen and
 *  the Places grid all use this. */
export default function PlaceTile({
  label,
  cover,
  kind,
  size,
  radius,
  labelSize = 12,
  caption,
  onPress,
  onLongPress,
  selected,
}: {
  label: string;
  cover?: string;
  kind?: PlaceKind;
  size: number;
  radius?: number;
  labelSize?: number;
  /** A second, quieter line: "12 days". */
  caption?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Choosing places to merge: true/false draws the check; undefined means
   *  the grid is not in choosing mode. */
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={!onPress && !onLongPress}
      style={{ width: size, alignItems: 'center' }}
    >
      <View style={selected === false && { opacity: 0.55 }}>
        <PlaceCover cover={cover} kind={kind} size={size} radius={radius} />
        {selected !== undefined && (
          <View style={[styles.check, selected && styles.checkOn]}>
            {selected && <MaterialCommunityIcons name="check" size={16} color={colors.white} />}
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.label, { fontSize: labelSize }]}>
        {label}
      </Text>
      {caption ? (
        <Text numberOfLines={1} style={styles.caption}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.pale,
    borderWidth: 3,
    borderColor: colors.white,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'rgba(8,17,18,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.teal },
  empty: {
    backgroundColor: '#EEF1F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.regular,
    color: '#2B2B2B',
    marginTop: 6,
    textAlign: 'center',
    maxWidth: '100%',
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#8B9394',
    marginTop: 1,
  },
});
