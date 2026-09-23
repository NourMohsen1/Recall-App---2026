import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { avatarTint } from '../peopleTags';
import { colors, fonts } from '../theme';

// One person's face, everywhere the app shows a person.
//
// Every screen used to draw its own tinted circle with initials, so a photo
// set on the Profile page appeared only there. This is the single place that
// decides what a person looks like: their photo if they have one, their
// initials on a stable tint if not.
//
// `unconfirmed` is for a person the app THINKS is in a day but the user
// hasn't confirmed — see personSuggestions.ts. It's drawn in the same family
// as everything else, just lighter and dashed, so a guess never looks like a
// fact the user recorded.

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export default function PersonAvatar({
  name,
  photoUri,
  size = 56,
  unconfirmed = false,
  style,
}: {
  name: string;
  photoUri?: string;
  size?: number;
  unconfirmed?: boolean;
  style?: ViewStyle;
}) {
  const box: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (photoUri) {
    return (
      <View style={[box, styles.clip, unconfirmed && styles.unconfirmedRing, style]}>
        <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </View>
    );
  }

  return (
    <View
      style={[
        box,
        styles.center,
        { backgroundColor: unconfirmed ? colors.soft : avatarTint(name) },
        unconfirmed && styles.unconfirmedRing,
        style,
      ]}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.36) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  clip: { overflow: 'hidden' },
  // A lighter ring in the same teal family, dashed — reads as "not settled
  // yet" without introducing a colour that isn't in the brand.
  unconfirmedRing: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.muted,
  },
  initials: { fontFamily: fonts.semiBold, color: colors.white },
});
