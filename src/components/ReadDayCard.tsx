import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PHOTO_READER } from '../photoReading';
import { colors, fonts } from '../theme';

// In place of a day's story, when the user hasn't allowed this day's photos
// to be read: the invitation, on the day itself. One tap reads just this
// day. See src/readDayPrompt.ts.
export default function ReadDayCard({
  photoCount,
  reading,
  onRead,
  style,
}: {
  photoCount: number;
  reading: boolean;
  onRead: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="image-multiple-outline" size={17} color={colors.teal} />
        <Text style={styles.title}>
          {photoCount} {photoCount === 1 ? 'photo' : 'photos'} from this day
        </Text>
      </View>
      <Text style={styles.text}>
        Want Recall to read {photoCount === 1 ? 'it' : 'them'} and tell you what happened?
      </Text>
      <Pressable style={[styles.button, reading && styles.buttonReading]} onPress={onRead} disabled={reading}>
        {reading ? (
          <>
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={styles.buttonText}>Reading the photos…</Text>
          </>
        ) : (
          <Text style={styles.buttonText}>Tell me about this day</Text>
        )}
      </Pressable>
      <Text style={styles.note}>Sent to {PHOTO_READER.name} to be read.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F4F8F8',
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
    padding: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.semiBold, fontSize: 14, color: '#1B1B1B' },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#3A4243', marginTop: 6 },
  button: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 11,
  },
  buttonReading: { opacity: 0.85 },
  buttonText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  note: { fontFamily: fonts.regular, fontSize: 11, color: '#8B9394', marginTop: 8, textAlign: 'center' },
});
