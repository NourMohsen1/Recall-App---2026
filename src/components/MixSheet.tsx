import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import FollowSheet from './FollowSheet';
import { getFollows, getMuted, unmuteSubject, type Follow } from '../follows';
import { allTopics, getInterestTopics, setInterestTopics, topicIcon, type Topic } from '../onThisDay';
import { colors, fonts } from '../theme';

// "Your mix": everything that shapes On This Day, in one sheet — the topics
// shown, what is followed inside each (learned from memories, marked with
// the sparkle, or added by the user), and what was waved away. Most
// tailoring happens on the cards themselves (👍 / 👎); this is where all of
// it can be seen and undone.

const MAX_TOPICS = 4;

export default function MixSheet({ visible, onClose }: { visible: boolean; onClose: (changed: boolean) => void }) {
  const [options, setOptions] = useState<Topic[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [follows, setFollows] = useState<Follow[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [followTopic, setFollowTopic] = useState<Topic | null>(null);

  const load = async () => {
    const [all, current, f, m] = await Promise.all([allTopics(), getInterestTopics(), getFollows(), getMuted()]);
    setOptions(all);
    setChosen(current.map((t) => t.key));
    setFollows(f);
    setMuted(m);
  };

  useEffect(() => {
    if (!visible) return;
    setChanged(false);
    load();
  }, [visible]);

  const toggle = async (key: string) => {
    const next = chosen.includes(key)
      ? chosen.length > 1
        ? chosen.filter((k) => k !== key)
        : chosen
      : chosen.length < MAX_TOPICS
        ? [...chosen, key]
        : chosen;
    if (next === chosen) return;
    setChosen(next);
    setChanged(true);
    await setInterestTopics(next);
  };

  const unmute = async (name: string) => {
    await unmuteSubject(name);
    setMuted((m) => m.filter((x) => x !== name));
    setChanged(true);
  };

  const close = () => onClose(changed);
  const shown = options.filter((t) => chosen.includes(t.key)).sort((a, b) => chosen.indexOf(a.key) - chosen.indexOf(b.key));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Your mix</Text>
          <Text style={styles.subtitle}>What the world beside your days is about.</Text>

          <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.section}>
              Topics <Text style={styles.sectionNote}>· up to {MAX_TOPICS}</Text>
            </Text>
            <View style={styles.chips}>
              {options.map((t) => {
                const on = chosen.includes(t.key);
                return (
                  <Pressable key={t.key} onPress={() => toggle(t.key)} style={[styles.chip, on && styles.chipOn]}>
                    <MaterialCommunityIcons name={topicIcon(t.key) as any} size={15} color={on ? colors.white : colors.teal} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.section}>You follow</Text>
            {shown.map((t) => {
              const mine = follows.filter((f) => f.topic === t.key);
              return (
                <Pressable key={t.key} style={styles.followRow} onPress={() => setFollowTopic(t)}>
                  <View style={styles.followIcon}>
                    <MaterialCommunityIcons name={topicIcon(t.key) as any} size={18} color={colors.teal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.followLabel}>{t.label}</Text>
                    <Text numberOfLines={1} style={styles.followNames}>
                      {mine.length ? mine.map((f) => f.name).join(', ') : `Anything notable in ${t.label.toLowerCase()}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#B4B8B8" />
                </Pressable>
              );
            })}

            {muted.length > 0 && (
              <>
                <Text style={styles.section}>Not for you</Text>
                <View style={styles.chips}>
                  {muted.map((m) => (
                    <View key={m} style={styles.mutedChip}>
                      <Text style={styles.mutedText}>{m}</Text>
                      <Pressable onPress={() => unmute(m)} hitSlop={10}>
                        <Ionicons name="close" size={14} color="#8B9394" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          <Pressable style={styles.doneBtn} onPress={close}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>

      <FollowSheet
        topic={followTopic}
        onClose={(c) => {
          setFollowTopic(null);
          if (c) {
            setChanged(true);
            getFollows().then(setFollows);
          }
        }}
      />
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
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDE2E2', alignSelf: 'center', marginBottom: 18 },
  title: { fontFamily: fonts.semiBold, fontSize: 20, color: '#1B1B1B' },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', marginTop: 4 },
  section: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B', marginTop: 22, marginBottom: 12 },
  sectionNote: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D3DCDD',
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
  chipTextOn: { color: colors.white },
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F2',
  },
  followIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: '#1B1B1B' },
  followNames: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },
  mutedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F2F4F4',
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 9,
  },
  mutedText: { fontFamily: fonts.medium, fontSize: 13, color: '#8B9394', textDecorationLine: 'line-through' },
  doneBtn: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  doneText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
});
