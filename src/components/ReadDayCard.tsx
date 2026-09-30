import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import { PHOTO_READER } from '../photoReading';
import { colors, fonts } from '../theme';

// In place of a day's story, when the user hasn't allowed this day's photos
// to be read: the day's own photos, a question, and one button. See
// src/readDayPrompt.ts for what the tap does.
export default function ReadDayCard({
  photoUris,
  reading,
  onRead,
  style,
}: {
  photoUris: string[];
  reading: boolean;
  onRead: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const count = photoUris.length;
  const shown = photoUris.slice(0, 3);
  return (
    <View style={[styles.card, style]}>
      <View style={styles.top}>
        {/* The photos themselves are the cue: this day has something to tell. */}
        <View style={[styles.stack, { width: 44 + (shown.length - 1) * 18 }]}>
          {shown.map((uri, i) => (
            <View key={uri} style={[styles.thumbWrap, { left: i * 18, zIndex: 3 - i }]}>
              <PhotoImage uri={uri} style={styles.thumb} />
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>What happened this day?</Text>
          <Text style={styles.count}>
            {count} {count === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
      </View>

      <Pressable style={styles.button} onPress={onRead} disabled={reading}>
        {reading ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <MaterialCommunityIcons name="auto-fix" size={16} color={colors.white} />
        )}
        <Text style={styles.buttonText}>{reading ? 'Reading…' : 'Tell me about this day'}</Text>
      </Pressable>

      <View style={styles.noteRow}>
        <MaterialCommunityIcons name="earth" size={12} color="#8B9394" />
        <Text style={styles.note}>Read by {PHOTO_READER.name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
    padding: 16,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stack: { height: 44 },
  thumbWrap: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
    overflow: 'hidden',
    backgroundColor: colors.pale,
  },
  thumb: { width: '100%', height: '100%' },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B' },
  count: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 1 },
  button: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 11,
  },
  buttonText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  noteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8 },
  note: { fontFamily: fonts.regular, fontSize: 11, color: '#8B9394' },
});
