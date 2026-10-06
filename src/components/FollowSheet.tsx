import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { addFollow, followsFor, removeFollow, type Follow } from '../follows';
import { topicIcon, type Topic } from '../onThisDay';
import { colors, fonts } from '../theme';

// "What you follow in Sports": what Recall noticed in the user's memories
// (marked with the app's sparkle, the sign for something it worked out) and
// what they added themselves. Remove with ×, add by typing. On This Day
// searches only for these.

const EXAMPLES: Record<string, string> = {
  sports: 'Al Ahly, Premier League, F1…',
  music: 'Amr Diab, Coldplay…',
  news: 'Egypt, the US election…',
  movies: 'Marvel, A24…',
  tv: 'The Bear, Ramadan series…',
  books: 'Naguib Mahfouz, sci-fi…',
  design: 'Apple design, Bauhaus…',
  art: 'Banksy, Art Basel…',
  tech: 'Apple, AI, SpaceX…',
  science: 'NASA, space missions…',
  food: 'Egyptian food, Michelin…',
  travel: 'Japan, Dubai…',
  fashion: 'Nike, Paris Fashion Week…',
  gaming: 'FIFA, Nintendo…',
  business: 'Tesla, the Egyptian pound…',
  health: 'Marathons, CrossFit…',
  nature: 'Climate, wildlife…',
  cars: 'Porsche, Formula E…',
};

export default function FollowSheet({
  topic,
  onClose,
}: {
  topic: Topic | null;
  /** `changed`: something was added or removed — the feed refetches. */
  onClose: (changed: boolean) => void;
}) {
  const [follows, setFollows] = useState<Follow[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!topic) return;
    setText('');
    setProblem(null);
    setChanged(false);
    followsFor(topic.key).then(setFollows);
  }, [topic]);

  if (!topic) return null;

  const add = async () => {
    const name = text.trim();
    if (!name || busy) return;
    setBusy(true);
    setProblem(null);
    const check = await addFollow(topic.key, name);
    setBusy(false);
    if (!check.ok) {
      setProblem(
        check.reason === 'blocked'
          ? 'Recall doesn’t show sexual or explicit content.'
          : 'Couldn’t check that just now. Try again in a moment.',
      );
      return;
    }
    setText('');
    setChanged(true);
    setFollows(await followsFor(topic.key));
  };

  const remove = async (f: Follow) => {
    await removeFollow(topic.key, f.name);
    setChanged(true);
    setFollows(await followsFor(topic.key));
  };

  const close = () => onClose(changed);
  const noticed = follows.some((f) => f.from === 'memories');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grabber} />
            <View style={styles.titleRow}>
              <View style={styles.titleIcon}>
                <MaterialCommunityIcons name={topicIcon(topic.key) as any} size={18} color={colors.teal} />
              </View>
              <Text style={styles.title}>What you follow in {topic.label}</Text>
            </View>
            <Text style={styles.subtitle}>On This Day shows news about these, next to your memories.</Text>

            <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={styles.chips}>
              {follows.length === 0 ? (
                <Text style={styles.empty}>Nothing yet. Add a team, league, artist or country.</Text>
              ) : (
                follows.map((f) => (
                  <View key={`${f.from}:${f.name}`} style={styles.chip}>
                    {f.from === 'memories' && (
                      <MaterialCommunityIcons name="creation-outline" size={13} color={colors.teal} />
                    )}
                    <Text style={styles.chipText}>{f.name}</Text>
                    <Pressable onPress={() => remove(f)} hitSlop={10}>
                      <Ionicons name="close" size={15} color="#8B9394" />
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
            {noticed && (
              <View style={styles.legend}>
                <MaterialCommunityIcons name="creation-outline" size={12} color="#8B9394" />
                <Text style={styles.legendText}>Noticed in your memories</Text>
              </View>
            )}

            <View style={styles.addRow}>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={(t) => {
                  setText(t);
                  setProblem(null);
                }}
                placeholder={EXAMPLES[topic.key] ?? 'Add something you follow'}
                placeholderTextColor="#A9B0B1"
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={add}
              />
              <Pressable style={[styles.addBtn, !text.trim() && { opacity: 0.4 }]} onPress={add} disabled={!text.trim()}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.addText}>Add</Text>}
              </Pressable>
            </View>
            {problem && <Text style={styles.problem}>{problem}</Text>}

            <Pressable style={styles.doneBtn} onPress={close}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B' },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#8B9394', marginTop: 8 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.pale,
    borderRadius: 999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
  empty: { fontFamily: fonts.regular, fontSize: 13, color: '#A3ABAC' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  legendText: { fontFamily: fonts.regular, fontSize: 11, color: '#8B9394' },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: '#2B2B2B',
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 72,
    alignItems: 'center',
  },
  addText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  problem: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal, marginTop: 8 },

  doneBtn: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  doneText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
});
