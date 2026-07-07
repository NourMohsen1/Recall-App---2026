import { Image, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The standard rounded-square photo frame used across the app:
// 110 x 110 with a 3px white border.
export const TILE_SIZE = 110;

export default function PhotoTile({ source }: { source: any }) {
  return <Image source={source} style={styles.tile} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.white,
    overflow: 'hidden',
  },
});
