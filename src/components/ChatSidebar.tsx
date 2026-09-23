import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ChatSessionMeta, groupSessions, listSessions } from '../chatSessions';
import { colors, fonts } from '../theme';

// Past conversations, in a panel that slides in from the left.
//
// Grouped by roughly-when rather than listed flat, because that's how people
// look for a conversation they half-remember — "it was some time last week"
// gets you there faster than a name would.

export default function ChatSidebar({
  visible,
  currentId,
  onOpen,
  onNewChat,
  onDelete,
  onClose,
}: {
  visible: boolean;
  currentId: string | null;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);

  // Reloaded every time it opens — a conversation may have gained messages
  // (or a title) since the last look.
  useEffect(() => {
    if (visible) listSessions().then(setSessions);
  }, [visible]);

  const confirmDelete = (s: ChatSessionMeta) => {
    Alert.alert('Delete this chat?', `"${s.title}" will be removed for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await onDelete(s.id);
          setSessions(await listSessions());
        },
      },
    ]);
  };

  const groups = groupSessions(sessions);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Tapping the exposed strip of the chat closes the panel, the way
          every drawer of this shape behaves. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.brand}>Ask</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <Pressable style={styles.newChat} onPress={onNewChat}>
            <Ionicons name="create-outline" size={19} color={colors.white} />
            <Text style={styles.newChatText}>New chat</Text>
          </Pressable>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {sessions.length === 0 && (
              <Text style={styles.empty}>
                Your conversations will collect here — nothing you ask is lost when you leave.
              </Text>
            )}

            {groups.map((g) => (
              <View key={g.label}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                {g.sessions.map((s) => {
                  const active = s.id === currentId;
                  return (
                    <Pressable
                      key={s.id}
                      style={[styles.row, active && styles.rowActive]}
                      onPress={() => onOpen(s.id)}
                      onLongPress={() => confirmDelete(s)}
                    >
                      <MaterialCommunityIcons
                        name="message-outline"
                        size={17}
                        color={active ? colors.white : 'rgba(255,255,255,0.55)'}
                      />
                      <Text
                        numberOfLines={1}
                        style={[styles.rowText, active && styles.rowTextActive]}
                      >
                        {s.title}
                      </Text>
                      <Pressable onPress={() => confirmDelete(s)} hitSlop={10}>
                        <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.4)" />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: {
    width: '82%',
    maxWidth: 340,
    backgroundColor: colors.ink,
    paddingTop: 58,
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  brand: { fontFamily: fonts.bold, fontSize: 24, color: colors.white },

  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  newChatText: { fontFamily: fonts.medium, fontSize: 15, color: colors.white },

  list: { paddingTop: 14, paddingBottom: 30 },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.45)',
    paddingTop: 24,
  },
  groupLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  rowActive: { backgroundColor: 'rgba(255,255,255,0.12)' },
  rowText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  rowTextActive: { fontFamily: fonts.medium, color: colors.white },
});
