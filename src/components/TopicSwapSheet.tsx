import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Topic, TopicKey, TOPIC_OPTIONS, topicIcon } from '../onThisDay';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

type Props = {
  visible: boolean;
  topic: Topic | null;
  selectedKeys: TopicKey[];
  onSelect: (newKey: TopicKey) => void;
  onClose: () => void;
};

export default function TopicSwapSheet({ visible, topic, selectedKeys, onSelect, onClose }: Props) {
  const c = useColors();
  const styles = useStyles();
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
                  name={topicIcon(t.key) as any}
                  size={20}
                  color={c.brandSoft}
                />
              </View>
              <Text style={styles.rowLabel}>{t.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={c.textGhost} />
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

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.raised,
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
    backgroundColor: c.grabber,
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 19, color: c.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: c.textFaint, marginTop: 4, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: c.textBody },
  cancelBtn: { alignItems: 'center', marginTop: 18 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, color: c.textFaint },
}));
