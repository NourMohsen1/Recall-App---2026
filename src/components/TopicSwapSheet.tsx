import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Topic, TopicKey, TOPIC_OPTIONS } from '../onThisDay';
import { colors, fonts } from '../theme';

const TOPIC_ICONS: Record<string, string> = {
  sports: 'soccer',
  music: 'music-note',
  news: 'newspaper-variant-outline',
  movies: 'movie-open-outline',
  design: 'palette-outline',
  travel: 'airplane',
  books: 'book-open-variant',
};

type Props = {
  visible: boolean;
  topic: Topic | null;
  selectedKeys: TopicKey[];
  onSelect: (newKey: TopicKey) => void;
  onClose: () => void;
};

export default function TopicSwapSheet({ visible, topic, selectedKeys, onSelect, onClose }: Props) {
  if (!topic) return null;
  const choices = TOPIC_OPTIONS.filter((t) => t.key !== topic.key && !selectedKeys.includes(t.key));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Not into {topic.label}?</Text>
          <Text style={styles.subtitle}>Swap it for a topic that fits you better:</Text>

          {choices.map((t) => (
            <Pressable key={t.key} style={styles.row} onPress={() => onSelect(t.key)}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons
                  name={(TOPIC_ICONS[t.key] ?? 'earth') as any}
                  size={20}
                  color={colors.teal}
                />
              </View>
              <Text style={styles.rowLabel}>{t.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#B9BEBF" />
            </Pressable>
          ))}

          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
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
  title: { fontFamily: fonts.semiBold, fontSize: 19, color: '#1B1B1B' },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', marginTop: 4, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F2',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: '#2B2B2B' },
  cancelBtn: { alignItems: 'center', marginTop: 18 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },
});
