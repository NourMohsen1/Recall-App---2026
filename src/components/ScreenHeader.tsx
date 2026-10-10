import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { goBack } from '../navigation';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

// White page header with a teal back arrow and centered title,
// used by People / Places / On This Day / Recap.
//
// Back returns to the screen this one was opened from (src/navigation.ts);
// `backTo` is only where it goes when there is nothing behind it.
export default function ScreenHeader({
  title,
  backTo = '/home',
  onBack,
  action,
}: {
  title: string;
  backTo?: string;
  /** Replaces leaving the screen — a step back inside it (Recap: from one
   *  week back to the list of weeks). */
  onBack?: () => void;
  /** Optional top-right control, mirroring the back arrow on the left. */
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
}) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack ?? (() => goBack(router, backTo as Href))}
        hitSlop={12}
        style={styles.back}
      >
        <Ionicons name="arrow-back" size={28} color={colors.primary} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          hitSlop={12}
          style={styles.action}
          accessibilityLabel={action.label}
        >
          <Ionicons name={action.icon} size={24} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  action: { position: 'absolute', right: 20, top: 16 },
  title: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
});
