import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Topic } from '../onThisDay';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  topic: Topic | null;
  expanded: boolean;
  tuned: boolean;
  onTune: () => void;
  onSwap: () => void;
  onToggleExpand: () => void;
  onClose: () => void;
};

// One "…" button per topic card opens this — every topic action in one
// place instead of a row of tiny icons crowding the card header.
export default function TopicActionSheet({
  visible,
  topic,
  expanded,
  tuned,
  onTune,
  onSwap,
  onToggleExpand,
  onClose,
}: Props) {
  if (!topic) return null;

  const rows: { icon: string; label: string; sub?: string; onPress: () => void }[] = [
    {
      icon: 'unfold-more-horizontal',
      label: expanded ? 'Collapse this card' : `More ${topic.label} from this day`,
      sub: expanded ? undefined : 'Swipe through up to 4 events',
      onPress: onToggleExpand,
    },
    {
      icon: 'tune-variant',
      label: `Tune ${topic.label} to your taste`,
      sub: tuned ? 'Tuned — tap to change' : 'Teams, artists, leagues you care about',
      onPress: onTune,
    },
    {
      icon: 'swap-horizontal',
      label: 'Swap this topic',
      sub: `Not into ${topic.label}? Pick another`,
      onPress: onSwap,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{topic.label}</Text>

          {rows.map((r) => (
            <Pressable key={r.label} style={styles.row} onPress={r.onPress}>
              <View style={styles.rowIcon}>
                <MaterialCommunityIcons name={r.icon as any} size={20} color={colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                {r.sub && <Text style={styles.rowSub}>{r.sub}</Text>}
              </View>
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
  title: { fontFamily: fonts.semiBold, fontSize: 19, color: '#1B1B1B', marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
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
  rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: '#2B2B2B' },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: '#9AA4A5', marginTop: 1 },
  cancelBtn: { alignItems: 'center', marginTop: 18 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },
});
