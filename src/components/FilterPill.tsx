import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

export default function FilterPill({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.pill} onPress={onPress} disabled={!onPress}>
      <Text style={styles.label}>{label}</Text>
      <Ionicons name="chevron-down" size={15} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.teal,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  label: { color: colors.white, fontFamily: fonts.medium, fontSize: 14 },
});
