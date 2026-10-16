import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { rtlIfArabic } from '../transcription';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// Writing or rewriting one memory on a day.
//
// Used for both editing something already logged and adding something new to
// a past day, because they're the same act from the user's side: putting
// words on a day. The only difference is whether there were words there
// already, which decides the title and whether Delete is offered.

export default function MemoryEditSheet({
  visible,
  initialText,
  dayLabel,
  mode,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  initialText: string;
  dayLabel: string;
  mode: 'edit' | 'add';
  onSave: (text: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useStyles();
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setText(initialText);
  }, [visible, initialText]);

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave(trimmed);
    setSaving(false);
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete this memory?', 'It will be removed from this day for good.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void onDelete() },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Same shape as the app's other bottom sheets (PhotoSourceSheet):
          the backdrop bottom-aligns the sheet and closes on tap, and the
          sheet swallows its own taps so typing in it doesn't dismiss it. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>
              {mode === 'add' ? 'Add to this day' : 'Edit memory'}
            </Text>
            <Pressable onPress={save} hitSlop={10} disabled={!canSave}>
              <Text style={[styles.done, !canSave && styles.doneOff]}>
                {saving ? 'Saving…' : 'Done'}
              </Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.day}>{dayLabel}</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="What happened?"
              placeholderTextColor={c.textGhost}
              style={[styles.input, rtlIfArabic(text)]}
              multiline
              autoFocus
            />

            {mode === 'add' ? (
              <Text style={styles.hint}>
                Recall will read this and file anything in it: a task, someone you saw, a place
                you went.
              </Text>
            ) : (
              <Text style={styles.hint}>
                These are your words now — Recall won't rewrite them again. The original recording
                or entry is still on the Source page.
              </Text>
            )}

            {mode === 'edit' && onDelete && (
              <Pressable style={styles.delete} onPress={confirmDelete}>
                <MaterialCommunityIcons name="trash-can-outline" size={18} color={c.danger} />
                <Text style={styles.deleteText}>Delete this memory</Text>
              </Pressable>
            )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: c.backdrop,
  },
  sheet: {
    backgroundColor: c.raised,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 30,
    maxHeight: '90%',
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.grabber,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: c.text },
  cancel: { fontFamily: fonts.medium, fontSize: 15, color: c.textFaint },
  done: { fontFamily: fonts.semiBold, fontSize: 15, color: c.brandSoft },
  doneOff: { color: c.textGhost },

  body: { paddingTop: 16, paddingBottom: 10 },
  day: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: c.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  input: {
    backgroundColor: c.chip,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: c.text,
    minHeight: 150,
    textAlignVertical: 'top',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: c.textGhost,
    marginTop: 10,
  },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  deleteText: { fontFamily: fonts.medium, fontSize: 14, color: c.danger },
}));
