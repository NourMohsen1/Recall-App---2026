import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

// White page header with a teal back arrow and centered title,
// used by People / Places / On This Day / Recap.
//
// `backTo` names this screen's known primary entry point (e.g. "/home").
// Plain `router.back()`/`canGoBack()` looks right but isn't reliable here:
// this screen is pushed onto the root Stack from *inside* the bottom Tabs
// navigator, and Expo Router's implicit back-resolution doesn't restore
// which tab was active — it lands on the tab bar's first tab instead. An
// explicit `dismissTo` sidesteps that entirely.
export default function ScreenHeader({
  title,
  backTo = '/home',
  action,
}: {
  title: string;
  backTo?: string;
  /** Optional top-right control, mirroring the back arrow on the left. */
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label?: string };
}) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.dismissTo(backTo as Parameters<typeof router.dismissTo>[0])}
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
