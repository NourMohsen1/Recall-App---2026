import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

export default function FilterPill({ label, onPress }: { label: string; onPress?: () => void }) {
  const c = useColors();
  const styles = useStyles();
  return (
    <Pressable style={styles.pill} onPress={onPress} disabled={!onPress}>
      <Text style={styles.label}>{label}</Text>
      <Ionicons name="chevron-down" size={15} color={c.onTile} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.tileAlt,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  label: { color: c.onTile, fontFamily: fonts.medium, fontSize: 14 },
}));
