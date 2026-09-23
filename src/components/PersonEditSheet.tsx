import { useEffect, useState } from 'react';
import {
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
import { rtlIfArabic } from '../transcription';
import { colors, fonts } from '../theme';

// Editing who someone is: their name, and how the user knows them.
//
// The descriptor is the more useful of the two and the one people struggle
// to think of cold, so the field asks the question rather than naming the
// field — "How do you know them?" gets an answer, "Bio" gets a blank.

export default function PersonEditSheet({
  visible,
  name,
  descriptor,
  mode = 'edit',
  onSave,
  onClose,
}: {
  visible: boolean;
  name: string;
  descriptor?: string;
  /** 'add' creates somebody new, 'edit' changes who they already are, and
   *  'self' is the user editing their own identity — same two fields, but
   *  'how do you know them' makes no sense about yourself. */
  mode?: 'edit' | 'add' | 'self';
  onSave: (name: string, descriptor: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftDescriptor, setDraftDescriptor] = useState(descriptor ?? '');
  const [saving, setSaving] = useState(false);

  // Reopening always shows what's actually stored, never a stale draft from
  // a previous edit the user backed out of.
  useEffect(() => {
    if (visible) {
      setDraftName(name);
      setDraftDescriptor(descriptor ?? '');
    }
  }, [visible, name, descriptor]);

  const trimmed = draftName.trim();
  const canSave = trimmed.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave(trimmed, draftDescriptor.trim());
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Same shape as the app's other bottom sheets — see PhotoSourceSheet. */}
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
              {mode === 'add' ? 'Add person' : mode === 'self' ? 'About you' : 'Edit person'}
            </Text>
            <Pressable onPress={save} hitSlop={10} disabled={!canSave}>
              <Text style={[styles.done, !canSave && styles.doneOff]}>
                {saving ? 'Saving…' : 'Done'}
              </Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder={mode === 'add' ? 'Who are they?' : mode === 'self' ? 'Your name' : 'Their name'}
              placeholderTextColor="#A8B0B1"
              style={[styles.input, rtlIfArabic(draftName)]}
              autoCorrect={false}
            />
            <Text style={styles.hint}>
              {mode === 'add'
                ? 'You can add someone before they appear in any memory — give them a face now and Recall will start looking for them in your photos.'
                : mode === 'self'
                  ? 'Recall uses your name to understand who "I" and "me" mean in the things you log.'
                  : "Renaming moves everything you've logged with them. If you type the name of someone you already have, the two are joined into one person."}
            </Text>

            <Text style={styles.label}>{mode === 'self' ? 'About you' : 'How do you know them?'}</Text>
            <TextInput
              value={draftDescriptor}
              onChangeText={setDraftDescriptor}
              placeholder={
                mode === 'self'
                  ? 'A product designer. I built Recall.'
                  : 'Brother · College friend · From work'
              }
              placeholderTextColor="#A8B0B1"
              style={[styles.input, styles.inputMultiline, rtlIfArabic(draftDescriptor)]}
              multiline
            />
            <Text style={styles.hint}>
              {mode === 'self'
                ? 'Standing context for every answer Recall gives you — your work, your family, anything it should always know.'
                : 'Shown under their name, and used when Recall answers questions about them.'}
            </Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: colors.white,
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
    backgroundColor: '#DDE3E3',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },
  cancel: { fontFamily: fonts.medium, fontSize: 15, color: '#8B9394' },
  done: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.teal },
  doneOff: { color: '#C2C9C9' },

  body: { paddingTop: 12, paddingBottom: 10 },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#8B9394',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.pale,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: '#1B1B1B',
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#9AA4A5',
    marginTop: 8,
  },
});
