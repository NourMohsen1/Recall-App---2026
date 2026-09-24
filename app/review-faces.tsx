import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, type } from '../src/theme';
import {
  clusterFaces,
  clusterStats,
  dismissCluster,
  getClusters,
  nameCluster,
  unnameCluster,
  MIN_CLUSTER_SIZE,
  type Cluster,
} from '../src/faceClusters';
import { faceThumbnail } from '../src/faceEmbedderTflite';
import { getAllTaggedPeople } from '../src/peopleTags';

// "Who is this?" — asked once per person, not once per photo.
//
// The app has already worked out that the same face appears on many days.
// What it cannot know is the name, and that is the only thing it asks for.
// One answer here fills in every day that person appears.
//
// Everything on this screen is a question the app cannot answer itself.
// Anything it CAN answer it has already done, quietly, and marked as its
// own guess for the user to agree with later — see src/guessedPeople.ts.

type Card = Cluster & { thumb: string | null };

export default function ReviewFaces() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof clusterStats>> | null>(null);
  const [busy, setBusy] = useState<string | null>('Looking for people…');
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, string>>({});
  // Groups already named. Shown so a wrong name can be spotted and taken
  // back — without this, naming the wrong face is a permanent mistake the
  // user cannot find again.
  const [named, setNamed] = useState<Card[]>([]);

  const load = useCallback(async () => {
    try {
      // Group whatever has been read since last time. Cheap when there is
      // nothing new, which is the usual case for a screen being reopened.
      await clusterFaces();
      const [found, alreadyNamed, counts, people] = await Promise.all([
        getClusters({ named: false }),
        getClusters({ named: true }),
        clusterStats(),
        getAllTaggedPeople(),
      ]);
      setStats(counts);
      setKnown(people);
      setNamed(
        await Promise.all(
          alreadyNamed.map(async (c) => ({
            ...c,
            thumb: c.sample ? await faceThumbnail(c.sample.photoUri, c.sample.box) : null,
          })),
        ),
      );
      setCards(
        await Promise.all(
          found.map(async (c) => ({
            ...c,
            thumb: c.sample ? await faceThumbnail(c.sample.photoUri, c.sample.box) : null,
          })),
        ),
      );
    } catch (e) {
      setStats(null);
      setBusy(null);
      console.warn('[faces] review failed:', e);
    } finally {
      setBusy(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setBusy('Looking for people…');
      load();
    }, [load]),
  );

  async function name(cluster: Card, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(`Adding ${trimmed} to their days…`);
    const days = await nameCluster(cluster.id, trimmed);
    setDone((d) => ({ ...d, [cluster.id]: `${trimmed} · added to ${days} day${days === 1 ? '' : 's'}` }));
    setCards((list) => list.filter((c) => c.id !== cluster.id));
    setBusy(null);
  }

  async function undo(cluster: Card) {
    await unnameCluster(cluster.id);
    setBusy('Undoing…');
    await load();
  }

  async function dismiss(cluster: Card) {
    await dismissCluster(cluster.id);
    setCards((list) => list.filter((c) => c.id !== cluster.id));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.title}>Who is this?</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          These faces keep appearing in your photos. Name one and Recall will add them
          to every day they show up — marked as a guess until you agree.
        </Text>

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.meta}>{busy}</Text>
          </View>
        )}

        {/* Said plainly, because "no people found" and "no people found YET"
            are different messages and only one means come back later. */}
        {!busy && cards.length === 0 && stats && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {stats.faces === 0 ? 'No faces read yet' : 'Nobody left to name'}
            </Text>
            <Text style={styles.meta}>
              {stats.faces === 0
                ? 'Recall is still reading your photo library. This fills up as it goes — come back in a while.'
                : `${stats.faces} faces found across your photos, in ${stats.groups} group${stats.groups === 1 ? '' : 's'}. A face has to appear in at least ${MIN_CLUSTER_SIZE} photos before it is worth asking about.`}
            </Text>
          </View>
        )}

        {Object.entries(done).map(([id, label]) => (
          <View key={`done-${id}`} style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
            <Text style={styles.meta}>{label}</Text>
          </View>
        ))}

        {/* Already answered. Kept visible rather than tidied away: this is
            the only screen where a wrong name is visible as a wrong FACE,
            which is the only way anyone would notice. */}
        {named.length > 0 && (
          <View style={styles.namedBlock}>
            <Text style={styles.namedTitle}>Already named</Text>
            {named.map((c) => (
              <View key={c.id} style={styles.namedRow}>
                {c.thumb ? (
                  <Image source={{ uri: c.thumb }} style={styles.namedFace} />
                ) : (
                  <View style={[styles.namedFace, styles.faceEmpty]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.namedName}>{c.name}</Text>
                  <Text style={styles.meta}>
                    {c.size} photo{c.size === 1 ? '' : 's'} · {c.days.length} day
                    {c.days.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Pressable onPress={() => undo(c)} hitSlop={10}>
                  <Text style={styles.undo}>Not them</Text>
                </Pressable>
              </View>
            ))}
            <Text style={styles.meta}>
              Undoing removes the guesses this face made. Days you already agreed to stay —
              those are yours now, not the app's.
            </Text>
          </View>
        )}

        {cards.map((c) => (
          <View key={c.id} style={styles.card}>
            <View style={styles.cardTop}>
              {c.thumb ? (
                <Image source={{ uri: c.thumb }} style={styles.face} />
              ) : (
                <View style={[styles.face, styles.faceEmpty]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.count}>
                  In {c.size} photo{c.size === 1 ? '' : 's'}
                </Text>
                <Text style={styles.meta}>
                  {c.days.length} day{c.days.length === 1 ? '' : 's'}
                  {c.days.length > 1 ? ` · ${c.days[c.days.length - 1]} → ${c.days[0]}` : ''}
                </Text>
              </View>
            </View>

            {/* Names already in the app come first: tapping one is faster
                than typing, and it keeps a person from being created twice
                under two spellings. */}
            {known.length > 0 && (
              <View style={styles.chips}>
                {known.slice(0, 8).map((n) => (
                  <Pressable key={n} onPress={() => name(c, n)} style={styles.chip}>
                    <Text style={styles.chipText}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.entry}>
              <TextInput
                value={typed[c.id] ?? ''}
                onChangeText={(t) => setTyped((s) => ({ ...s, [c.id]: t }))}
                placeholder="Or type a name"
                placeholderTextColor={colors.slate}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => name(c, typed[c.id] ?? '')}
              />
              <Pressable
                onPress={() => name(c, typed[c.id] ?? '')}
                disabled={!(typed[c.id] ?? '').trim()}
                style={[styles.save, !(typed[c.id] ?? '').trim() && styles.disabled]}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => dismiss(c)} hitSlop={8}>
              <Text style={styles.skip}>Not someone I know — don't ask again</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 8 },
  title: { color: colors.white, fontFamily: fonts.semiBold, fontSize: type.title },
  content: { padding: 20, paddingTop: 4, paddingBottom: 60 },
  intro: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: type.body,
    marginBottom: 20,
    lineHeight: 20,
  },
  busy: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: type.label, lineHeight: 18 },
  empty: { paddingVertical: 32, gap: 8 },
  emptyTitle: { color: colors.white, fontFamily: fonts.medium, fontSize: type.subtitle },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  card: {
    backgroundColor: colors.deep,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  face: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.dark },
  faceEmpty: { backgroundColor: colors.dark },
  count: { color: colors.white, fontFamily: fonts.medium, fontSize: type.subtitle },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.dark,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { color: colors.pale, fontFamily: fonts.regular, fontSize: type.label },
  entry: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.dark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.white,
    fontFamily: fonts.regular,
    fontSize: type.body,
  },
  save: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveText: { color: colors.white, fontFamily: fonts.medium, fontSize: type.body },
  disabled: { opacity: 0.35 },
  skip: { color: colors.slate, fontFamily: fonts.regular, fontSize: type.label },
  namedBlock: { marginBottom: 24, gap: 10 },
  namedTitle: { color: colors.white, fontFamily: fonts.medium, fontSize: type.subtitle },
  namedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  namedFace: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.dark },
  namedName: { color: colors.pale, fontFamily: fonts.regular, fontSize: type.body },
  undo: { color: colors.slate, fontFamily: fonts.regular, fontSize: type.label },
});
