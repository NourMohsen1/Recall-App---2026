import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import PersonAvatar from './PersonAvatar';
import { PersonMeta, PersonSummary } from '../peopleTags';
import { colors, fonts } from '../theme';

// Joining two profiles by hand.
//
// The app already offers a merge when two names LOOK alike, but plenty of
// duplicates don't: "Baba" and "Nour's dad" are the same person and share
// not one letter. Only the user knows that, so this is the way to say it.
//
// Two steps on purpose. Picking the pair and choosing which name survives
// are different decisions, and merging is not undoable — showing exactly
// what is about to happen, in one sentence, before anything moves, is worth
// the extra tap.

export default function MergePeopleSheet({
  visible,
  people,
  meta,
  onMerge,
  onClose,
}: {
  visible: boolean;
  people: PersonSummary[];
  meta: Record<string, PersonMeta>;
  onMerge: (mergeName: string, keepName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [keep, setKeep] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (visible) {
      setPicked([]);
      setKeep(null);
    }
  }, [visible]);

  const toggle = (name: string) => {
    setPicked((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      // Two is the whole job; picking a third replaces the older choice
      // rather than refusing the tap.
      return prev.length < 2 ? [...prev, name] : [prev[1], name];
    });
    setKeep(null);
  };

  const daysOf = (name: string) => people.find((p) => p.name === name)?.days.length ?? 0;

  const confirm = async () => {
    if (picked.length !== 2 || !keep || merging) return;
    const merge = picked.find((n) => n !== keep)!;
    setMerging(true);
    await onMerge(merge, keep);
    setMerging(false);
  };

  const step = picked.length < 2 ? 'pick' : 'keep';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>Merge people</Text>
            <View style={{ width: 52 }} />
          </View>

          <Text style={styles.step}>
            {step === 'pick'
              ? 'Choose the two profiles that are the same person.'
              : 'Which name should they keep?'}
          </Text>

          {step === 'pick' ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {people.map((p) => {
                const on = picked.includes(p.name);
                return (
                  <Pressable
                    key={p.name}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => toggle(p.name)}
                  >
                    <PersonAvatar name={p.name} photoUri={meta[p.name]?.photoUri} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{p.name}</Text>
                      <Text style={styles.rowSub}>
                        {meta[p.name]?.descriptor
                          ? `${meta[p.name]!.descriptor} · `
                          : ''}
                        {p.days.length === 1 ? '1 day' : `${p.days.length} days`}
                      </Text>
                    </View>
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={on ? colors.teal : '#C6CDCD'}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.keepStep}>
              {picked.map((name) => {
                const on = keep === name;
                const other = picked.find((n) => n !== name)!;
                return (
                  <Pressable
                    key={name}
                    style={[styles.keepCard, on && styles.keepCardOn]}
                    onPress={() => setKeep(name)}
                  >
                    <PersonAvatar name={name} photoUri={meta[name]?.photoUri} size={52} />
                    <Text style={styles.keepName}>{name}</Text>
                    {meta[name]?.descriptor && (
                      <Text style={styles.keepDesc}>{meta[name]!.descriptor}</Text>
                    )}
                    <Text style={styles.keepDays}>
                      {daysOf(name) === 1 ? '1 day' : `${daysOf(name)} days`}
                    </Text>
                    {on && (
                      <Text style={styles.keepNote}>
                        Everything from {other} moves here.
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {step === 'keep' && (
            <>
              <View style={styles.warnRow}>
                <MaterialCommunityIcons name="information-outline" size={16} color={colors.slate} />
                <Text style={styles.warnText}>
                  Every day, note and photo moves onto the name you keep, and the other spelling
                  is remembered so future entries land here too. This can't be undone.
                </Text>
              </View>
              <View style={styles.footer}>
                <Pressable style={styles.backBtn} onPress={() => setPicked([])}>
                  <Text style={styles.backBtnText}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.mergeBtn, !keep && styles.mergeBtnOff]}
                  onPress={confirm}
                  disabled={!keep || merging}
                >
                  <Text style={styles.mergeBtnText}>
                    {merging ? 'Merging…' : 'Merge'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#DDE3E3',
    marginBottom: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },
  cancel: { fontFamily: fonts.medium, fontSize: 15, color: '#8B9394' },
  step: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#5B6364',
    marginTop: 12,
    marginBottom: 6,
  },

  list: { paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  rowOn: { backgroundColor: colors.pale },
  rowName: { fontFamily: fonts.medium, fontSize: 15, color: '#1B1B1B' },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },

  keepStep: { flexDirection: 'row', gap: 12, marginTop: 10 },
  keepCard: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#E5E8E8',
  },
  keepCardOn: { borderColor: colors.teal, backgroundColor: colors.pale },
  keepName: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B', marginTop: 6, textAlign: 'center' },
  keepDesc: { fontFamily: fonts.regular, fontSize: 12, color: colors.teal, textAlign: 'center' },
  keepDays: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },
  keepNote: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: '#5B7377',
    textAlign: 'center',
    marginTop: 6,
  },

  warnRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  warnText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#8B9394' },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  backBtn: { paddingVertical: 12, paddingHorizontal: 18 },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },
  mergeBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  mergeBtnOff: { backgroundColor: '#C6CDCD' },
  mergeBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },
});
