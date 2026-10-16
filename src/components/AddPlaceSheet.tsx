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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PLACE_KINDS, addPlace, knownPlaceNames, recordNamedPlaceForDay, type PlaceKind } from '../places';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// Adding a place by hand. On a day (dayKey): for when Recall didn't notice
// it — type a name, or tap one of the user's places — saved like a place
// named in a log. From the Places page (no dayKey): a new place, with what
// kind of place it is.

export default function AddPlaceSheet({
  dayKey,
  visible,
  onClose,
}: {
  /** The day it goes on; none when adding from the Places page. */
  dayKey?: string;
  visible: boolean;
  /** `added`: a place was added — the screen reloads. */
  onClose: (added: boolean) => void;
}) {
  const c = useColors();
  const styles = useStyles();
  const [text, setText] = useState('');
  const [known, setKnown] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<PlaceKind | undefined>();

  useEffect(() => {
    if (!visible) return;
    setText('');
    setKind(undefined);
    knownPlaceNames().then(setKnown);
  }, [visible]);

  const add = async (name: string) => {
    const clean = name.trim();
    if (!clean || saving) return;
    setSaving(true);
    if (dayKey) {
      await recordNamedPlaceForDay(dayKey, { name: clean }, true);
      console.log(`[places] added ${clean} to ${dayKey} by hand`);
    } else {
      await addPlace(clean, kind);
    }
    setSaving(false);
    onClose(true);
  };

  const q = text.trim().toLowerCase();
  // On a day, the user's places help; on the Places page they already
  // are there, so only ones matching what's typed show (as "already yours").
  const matches = (q ? known.filter((k) => k.toLowerCase().includes(q)) : dayKey ? known : []).slice(0, 12);
  const kinds = (Object.keys(PLACE_KINDS) as PlaceKind[]).filter((k) => k !== 'other');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={() => onClose(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <View style={styles.titleRow}>
              <View style={styles.titleIcon}>
                <MaterialCommunityIcons name="map-marker-plus-outline" size={18} color={c.brandSoft} />
              </View>
              <Text style={styles.title}>Add a place</Text>
            </View>

            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder={dayKey ? 'Where were you?' : 'Name of the place'}
                placeholderTextColor={c.textGhost}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => add(text)}
              />
              <Pressable
                style={[styles.addBtn, !text.trim() && { opacity: 0.4 }]}
                onPress={() => add(text)}
                disabled={!text.trim() || saving}
              >
                <Text style={styles.addText}>Add</Text>
              </Pressable>
            </View>

            {!dayKey && (
              <>
                <Text style={styles.section}>What kind of place</Text>
                <View style={styles.chips}>
                  {kinds.map((k) => (
                    <Pressable
                      key={k}
                      style={[styles.chip, kind === k && styles.chipOn]}
                      onPress={() => setKind(kind === k ? undefined : k)}
                    >
                      <MaterialCommunityIcons
                        name={PLACE_KINDS[k].icon as any}
                        size={14}
                        color={kind === k ? c.onTile : c.brandSoft}
                      />
                      <Text style={[styles.chipText, kind === k && { color: c.onTile }]}>{PLACE_KINDS[k].label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {matches.length > 0 && (
              <>
                <Text style={styles.section}>{dayKey ? 'Your places' : 'Already yours'}</Text>
                <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={styles.chips}>
                  {matches.map((k) => (
                    <Pressable key={k} style={styles.chip} onPress={() => add(k)}>
                      <MaterialCommunityIcons name="map-marker-outline" size={14} color={c.brandSoft} />
                      <Text style={styles.chipText}>{k}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
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
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.grabber, alignSelf: 'center', marginBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.semiBold, fontSize: 18, color: c.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: c.accent,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: c.textBody,
  },
  addBtn: { backgroundColor: c.tile, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 },
  addText: { fontFamily: fonts.semiBold, fontSize: 14, color: c.onTile },
  section: { fontFamily: fonts.semiBold, fontSize: 13, color: c.textMuted, marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: c.chip,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipOn: { backgroundColor: c.tile },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: c.brand },
}));
