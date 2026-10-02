import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/** `onPress` replaces going back a screen — a step back inside one screen,
 *  like the setup questions. */
export default function BackArrow({ onPress }: { onPress?: () => void } = {}) {
  const router = useRouter();
  if (!onPress && !router.canGoBack()) return null;
  return (
    <Pressable onPress={onPress ?? (() => router.back())} style={styles.btn} hitSlop={12}>
      <Ionicons name="arrow-back" size={32} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { marginTop: 24, alignSelf: 'flex-start' },
});
