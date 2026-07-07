import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

export default function BackArrow() {
  const router = useRouter();
  if (!router.canGoBack()) return null;
  return (
    <Pressable onPress={() => router.back()} style={styles.btn} hitSlop={12}>
      <Ionicons name="arrow-back" size={32} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { marginTop: 24, alignSelf: 'flex-start' },
});
