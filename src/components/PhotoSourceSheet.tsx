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
import { Ionicons } from '@expo/vector-icons';
import { PhotoMeta } from '../photoMeta';
import { AnySourceKey, MANUAL_SOURCE_OPTIONS, SOURCE_LABEL_STYLES } from '../photoSource';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  current: PhotoMeta | null; // the photo's current label, if any
  onSet: (meta: PhotoMeta) => void;
  onClear: () => void;
  onClose: () => void;
};

// Apple keeps "which app saved this photo" as private, OS-only data — no
// third-party app can read it back out. So instead of guessing, this is the
// honest substitute: a one-tap picker so the user can label (or fix) a
// photo's source themselves. Whatever's set here is 100% correct, unlike
// any detector.
export default function PhotoSourceSheet({ visible, current, onSet, onClear, onClose }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    if (visible) {
      setCustomOpen(false);
      setCustomText(current?.source === 'other' ? (current.customLabel ?? '') : '');
    }
  }, [visible, current]);

  const choose = (key: AnySourceKey) => {
    onSet({ source: key });
    onClose();
  };

  const saveCustom = () => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    onSet({ source: 'other', customLabel: trimmed });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Where's this photo from?</Text>
            <Text style={styles.subtitle}>
              Apple doesn't let any app read this automatically — tag it once and Recall
              remembers it.
            </Text>

            <View style={styles.grid}>
              {MANUAL_SOURCE_OPTIONS.map((key) => {
                const label = SOURCE_LABEL_STYLES[key];
                const active = current?.source === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => choose(key)}
                    style={[styles.chip, { backgroundColor: label.bg }, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, { color: label.fg }]} numberOfLines={1}>
                      {label.text.replace('Saved from ', '')}
                    </Text>
                    {active && <Ionicons name="checkmark-circle" size={14} color={label.fg} style={{ marginLeft: 4 }} />}
                  </Pressable>
                );
              })}
            </View>

            {customOpen ? (
              <View style={styles.customRow}>
                <TextInput
                  style={styles.customInput}
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="App name…"
                  placeholderTextColor="#9AA4A5"
                  autoFocus
                  onSubmitEditing={saveCustom}
                  returnKeyType="done"
                />
                <Pressable style={styles.customSaveBtn} onPress={saveCustom} disabled={!customText.trim()}>
                  <Text style={styles.customSaveText}>Set</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.otherRow} onPress={() => setCustomOpen(true)}>
                <Ionicons name="add-circle-outline" size={18} color={colors.teal} />
                <Text style={styles.otherText}>Other app…</Text>
              </Pressable>
            )}

            {current && (
              <Pressable
                style={styles.clearBtn}
                onPress={() => {
                  onClear();
                  onClose();
                }}
              >
                <Text style={styles.clearText}>Clear label — just a normal photo</Text>
              </Pressable>
            )}

            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,18,0.55)', justifyContent: 'flex-end' },
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
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#8B9394', marginTop: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    // A hairline border so a pale/white chip (ChatGPT) still reads as its
    // own pill against this sheet's white background, not just on the
    // photo viewer's black one.
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  chipActive: { borderWidth: 2, borderColor: colors.teal },
  chipText: { fontFamily: fonts.semiBold, fontSize: 13 },

  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  otherText: { fontFamily: fonts.medium, fontSize: 14, color: colors.teal },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  customInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#2B2B2B',
  },
  customSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  customSaveText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },

  clearBtn: { alignItems: 'center', marginTop: 22 },
  clearText: { fontFamily: fonts.medium, fontSize: 13, color: '#B24545' },
  cancelBtn: { alignItems: 'center', marginTop: 14 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },
});
