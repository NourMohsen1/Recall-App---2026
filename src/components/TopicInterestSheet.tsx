import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Topic } from '../onThisDay';
import { colors, fonts } from '../theme';

// Per-topic examples so the user instantly gets what to type.
const PLACEHOLDERS: Record<string, string> = {
  sports: 'Premier League, Real Madrid, Formula 1, NBA…',
  music: 'Drake, indie rock, Arabic pop, new album drops…',
  news: 'Tech industry, Egypt, climate, space…',
  movies: 'A24, Marvel, Oscar season, anime films…',
  design: 'Product design, typography, architecture…',
  travel: 'Japan, budget travel, national parks…',
  books: 'Sci-fi, memoirs, Arabic literature…',
};

type Props = {
  visible: boolean;
  topic: Topic | null;
  initialText: string;
  onSave: (text: string) => void;
  onClose: () => void;
};

// Bottom sheet where the user types what they actually care about inside a
// topic — "Sports" becomes *their* sports.
export default function TopicInterestSheet({ visible, topic, initialText, onSave, onClose }: Props) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (visible) setText(initialText);
  }, [visible, initialText]);

  if (!topic) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <View style={styles.titleRow}>
              <MaterialCommunityIcons name="tune-variant" size={20} color={colors.teal} />
              <Text style={styles.title}>Tune {topic.label} to your taste</Text>
            </View>
            <Text style={styles.subtitle}>
              Tell Recall what you love in {topic.label} — teams, artists, leagues, genres,
              anything. Your daily picks will lean toward it.
            </Text>

            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={PLACEHOLDERS[topic.key] ?? 'What do you care about most?'}
              placeholderTextColor="#A9B0B1"
              multiline
              autoFocus
            />

            <Pressable style={styles.saveBtn} onPress={() => onSave(text)}>
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
            {initialText.trim().length > 0 && (
              <Pressable style={styles.clearBtn} onPress={() => onSave('')}>
                <Text style={styles.clearText}>Clear — back to general {topic.label}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,18,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 32,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE2E2',
    alignSelf: 'center',
    marginBottom: 18,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.semiBold, fontSize: 19, color: '#1B1B1B' },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#8B9394', marginTop: 6 },

  input: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 16,
    padding: 14,
    minHeight: 80,
    marginTop: 16,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#2B2B2B',
    textAlignVertical: 'top',
  },

  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  saveText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },
  clearBtn: { alignItems: 'center', paddingVertical: 12 },
  clearText: { fontFamily: fonts.medium, fontSize: 13, color: '#8B9394' },
});
