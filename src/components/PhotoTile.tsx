import { Image, StyleSheet } from 'react-native';
import PhotoImage from './PhotoImage';
import { colors } from '../theme';
import { makeStyles } from '../appearance';

// The standard rounded-square photo frame used across the app:
// 110 x 110 with a 3px white border.
export const TILE_SIZE = 110;

export default function PhotoTile({ source }: { source: any }) {
  const styles = useStyles();
  // A stored photo URI may need resolving first (see src/photoUri.ts);
  // a bundled require() asset never does.
  if (source && typeof source === 'object' && typeof source.uri === 'string') {
    return <PhotoImage uri={source.uri} style={styles.tile} />;
  }
  return <Image source={source} style={styles.tile} resizeMode="cover" />;
}

const useStyles = makeStyles((c) => ({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: c.surface,
    overflow: 'hidden',
  },
}));
