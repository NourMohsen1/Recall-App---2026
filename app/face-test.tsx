import { Fragment, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import type { SkImage } from '@shopify/react-native-skia';

import { colors, fonts, type } from '../src/theme';
import { MATCH_THRESHOLD, normalize, similarity } from '../src/faceIndex';
import { setTrace, type Detection } from '../src/faceDetector';
import {
  alignedPreview,
  embedFace,
  faceThumbnail,
  findFaces,
  modelInfo,
  type EmbedderKind,
  type EmbedOptions,
} from '../src/faceEmbedderTflite';
import { clusterFaces, getClusters, type Cluster } from '../src/faceClusters';

// THROWAWAY. Delete once the numbers below have been acted on.
//
// This started as "two photos, one score" and that was not enough. Two
// separate runs, each on a single pair, disagreed completely about which
// preparation was best — one made alignment the clear winner, the next made
// it the clear loser. A single pair is a single data point, and a
// preparation chosen from one is chosen by luck.
//
// So this measures properly. Give it several photos of one person and
// several of other people, and for every preparation it scores EVERY pair:
//
//   same  — each photo of the person against each other photo of them
//   diff  — each photo of them against each photo of somebody else
//
// The number that decides everything is the MARGIN: the worst same-person
// score minus the best different-person score. A threshold has to sit
// between those two, so when the margin is positive there is a threshold
// that is right about every pair tested, and when it is negative no
// threshold exists that can be.
//
// Averages are deliberately not the headline. A preparation that is
// brilliant on average and wrong about one pair in ten produces an app that
// confidently mislabels somebody, which is worse than one that hedges.

const SHORT: Record<EmbedderKind, string> = {
  mobilefacenet: 'mfn',
  facenet512: 'fn512',
};

function variants(): { label: string; options: EmbedOptions }[] {
  const out: { label: string; options: EmbedOptions }[] = [];
  for (const embedder of ['mobilefacenet', 'facenet512'] as EmbedderKind[]) {
    for (const order of ['rgb', 'bgr'] as const) {
      for (const range of ['signed', 'unit', 'standard'] as const) {
        const tail = `${order} · ${range}`;
        out.push({
          label: `${SHORT[embedder]} · aligned · ${tail}`,
          options: { embedder, align: true, order, range },
        });
        for (const padding of [0, 0.25, 0.4]) {
          out.push({
            label: `${SHORT[embedder]} · pad ${padding} · ${tail}`,
            options: { embedder, align: false, padding, order, range },
          });
        }
      }
    }
  }
  return out;
}

type Face = {
  group: 'me' | 'other';
  image: SkImage;
  detection: Detection;
  preview: string | null;
};

type Row = {
  label: string;
  /** Worst same-person and best different-person score. The threshold has
   *  to fit between them, so these two decide everything. */
  worstSame: number;
  bestDiff: number;
  margin: number;
  meanSame: number;
  meanDiff: number;
};

export default function FaceTest() {
  const [status, setStatus] = useState('Loading models…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  // Grouping is a separate question from scoring: not "how alike are these
  // two" but "did it put the right faces together".
  const [groups, setGroups] = useState<(Cluster & { thumb: string | null })[] | null>(null);

  useEffect(() => {
    setTrace(true);
    return () => setTrace(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [mfn, fn] = await Promise.all([
          modelInfo('mobilefacenet'),
          modelInfo('facenet512'),
        ]);
        setStatus(
          `mfn ${mfn.size}×${mfn.size}/${mfn.dims} · ` +
            `fn512 ${fn.size}×${fn.size}/${fn.dims} · ${fn.delegates.join(', ') || 'cpu'}`,
        );
        setReady(true);
      } catch (e) {
        setStatus(`Failed to load: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, []);

  async function add(group: 'me' | 'other') {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;

    setRows(null);
    const added: Face[] = [];
    for (let i = 0; i < picked.assets.length; i++) {
      setBusy(`Reading ${i + 1} of ${picked.assets.length}…`);
      const found = await findFaces(picked.assets[i].uri);
      if (!found?.faces.length) continue;
      // The biggest face is the subject; a bystander in the background is
      // not who this photo is of.
      const main = [...found.faces].sort((p, q) => q.box.w * q.box.h - p.box.w * p.box.h)[0];
      added.push({
        group,
        image: found.image,
        detection: main,
        preview: await alignedPreview(found.image, main),
      });
    }
    setFaces((prev) => [...prev, ...added]);
    setBusy(null);
  }

  async function group() {
    setBusy('Grouping faces…');
    const { grouped, groups: total } = await clusterFaces();
    const found = await getClusters();
    const withFaces = await Promise.all(
      found.slice(0, 20).map(async (c) => ({
        ...c,
        thumb: c.sample ? await faceThumbnail(c.sample.photoUri, c.sample.box) : null,
      })),
    );
    setGroups(withFaces);
    setStatus(`${grouped} new faces sorted · ${total} groups in total`);
    setBusy(null);
  }

  async function sweep() {
    const mine = faces.filter((f) => f.group === 'me');
    const others = faces.filter((f) => f.group === 'other');
    if (mine.length < 2 || others.length < 1) return;

    const all = variants();
    const out: Row[] = [];

    for (let v = 0; v < all.length; v++) {
      const { label, options } = all[v];
      setBusy(`${label} — ${v + 1} of ${all.length}`);

      // Every face measured once per preparation, in order. Overlapping
      // calls share the model's buffers and return each other's answers.
      const vectors: (Float32Array | null)[] = [];
      for (const f of faces) {
        const e = await embedFace(f.image, f.detection, options);
        vectors.push(e ? normalize(e) : null);
      }

      const same: number[] = [];
      const diff: number[] = [];
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const a = vectors[i];
          const b = vectors[j];
          if (!a || !b) continue;
          const score = similarity(a, b);
          if (faces[i].group === 'me' && faces[j].group === 'me') same.push(score);
          else if (faces[i].group !== faces[j].group) diff.push(score);
          // other-vs-other is ignored: two strangers may well be related
          // for all this test knows, so it proves nothing either way.
        }
      }
      if (!same.length || !diff.length) continue;

      const worstSame = Math.min(...same);
      const bestDiff = Math.max(...diff);
      out.push({
        label,
        worstSame,
        bestDiff,
        margin: worstSame - bestDiff,
        meanSame: same.reduce((x, y) => x + y, 0) / same.length,
        meanDiff: diff.reduce((x, y) => x + y, 0) / diff.length,
      });
    }

    out.sort((p, q) => q.margin - p.margin);
    setRows(out);
    setBusy(null);
  }

  const mine = faces.filter((f) => f.group === 'me').length;
  const others = faces.filter((f) => f.group === 'other').length;
  const canSweep = mine >= 2 && others >= 1;
  const pairs = (mine * (mine - 1)) / 2 + mine * others;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Face test</Text>
        <Text style={styles.status}>{status}</Text>

        <View style={styles.row}>
          <Pressable
            onPress={() => add('me')}
            disabled={!ready || busy !== null}
            style={[styles.button, styles.half]}
          >
            <Text style={styles.buttonText}>Photos of me ({mine})</Text>
          </Pressable>
          <Pressable
            onPress={() => add('other')}
            disabled={!ready || busy !== null}
            style={[styles.button, styles.half]}
          >
            <Text style={styles.buttonText}>Other people ({others})</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          Pick several at once. Use hard ones — far away, sunglasses, bad light, a
          few years apart. Easy photos prove nothing.
        </Text>

        {/* Every face that will be measured. Worth a glance: a wrong face
            here (a bystander, a statue) poisons every number below. */}
        <View style={styles.strip}>
          {faces.map((f, i) => (
            <View key={i} style={styles.thumbWrap}>
              {f.preview ? (
                <Image source={{ uri: f.preview }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]} />
              )}
              <Text style={[styles.thumbTag, f.group === 'me' && styles.thumbMine]}>
                {f.group === 'me' ? 'me' : 'other'}
              </Text>
            </View>
          ))}
        </View>

        {faces.length > 0 && (
          <Pressable onPress={() => setFaces([])} disabled={busy !== null}>
            <Text style={styles.clear}>Clear all</Text>
          </Pressable>
        )}

        <Pressable
          onPress={group}
          disabled={busy !== null}
          style={[styles.button, styles.sweep, busy !== null && styles.disabled]}
        >
          <Text style={styles.buttonText}>Group every face in my library</Text>
        </Pressable>

        {groups && (
          <View style={styles.table}>
            <Text style={styles.tableNote}>
              Each row is one person the app thinks it has found, biggest group first.
              Look at whether each face really is one person — and whether the same
              person turns up as two rows.
            </Text>
            {groups.map((g) => (
              <View key={g.id} style={styles.groupRow}>
                {g.thumb ? (
                  <Image source={{ uri: g.thumb }} style={styles.groupFace} />
                ) : (
                  <View style={[styles.groupFace, styles.thumbEmpty]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupTitle}>
                    {g.name ?? `Group ${g.id}`} · {g.size} photos
                  </Text>
                  <Text style={styles.meta}>
                    {g.days.length} day{g.days.length === 1 ? '' : 's'}
                    {g.days.length ? ` · ${g.days[g.days.length - 1]} → ${g.days[0]}` : ''}
                  </Text>
                </View>
              </View>
            ))}
            {groups.length === 0 && (
              <Text style={styles.meta}>
                No group has reached three photos yet — either the library is still
                being read, or nobody recurs in it.
              </Text>
            )}
          </View>
        )}

        <Pressable
          onPress={sweep}
          disabled={!canSweep || busy !== null}
          style={[styles.button, styles.sweep, (!canSweep || busy) && styles.disabled]}
        >
          <Text style={styles.buttonText}>
            {canSweep ? `Measure ${pairs} pairs` : 'Need 2+ of me and 1+ other'}
          </Text>
        </Pressable>

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.meta}>{busy}</Text>
          </View>
        )}

        {rows && (
          <View style={styles.table}>
            <Text style={styles.tableNote}>
              Sorted by margin — the worst same-person score minus the best
              different-person score. Positive means some threshold gets every pair
              right; negative means none can. Current threshold {MATCH_THRESHOLD}.
            </Text>
            <View style={styles.headRow}>
              <Text style={[styles.cell, styles.head, styles.wide]}>preparation</Text>
              <Text style={[styles.cell, styles.head]}>worst{'\n'}same</Text>
              <Text style={[styles.cell, styles.head]}>best{'\n'}diff</Text>
              <Text style={[styles.cell, styles.head]}>margin</Text>
            </View>
            {rows.map((r, i) => (
              <Fragment key={r.label}>
                <View style={[styles.tableRow, i === 0 && styles.best]}>
                  <Text style={[styles.cell, styles.wide]}>{r.label}</Text>
                  <Text style={styles.cell}>{r.worstSame.toFixed(3)}</Text>
                  <Text style={styles.cell}>{r.bestDiff.toFixed(3)}</Text>
                  <Text style={[styles.cell, r.margin > 0 ? styles.good : styles.bad]}>
                    {r.margin.toFixed(3)}
                  </Text>
                </View>
                {i === 0 && (
                  <Text style={styles.suggest}>
                    averages: same {r.meanSame.toFixed(3)} · diff {r.meanDiff.toFixed(3)}
                    {r.margin > 0
                      ? ` — a threshold of ${((r.worstSame + r.bestDiff) / 2).toFixed(2)} sits between them`
                      : ' — no threshold separates these photos'}
                  </Text>
                )}
              </Fragment>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { padding: 20, paddingBottom: 60 },
  title: { color: colors.white, fontFamily: fonts.semiBold, fontSize: type.titleLg },
  status: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: type.label,
    marginTop: 8,
    marginBottom: 20,
  },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sweep: { backgroundColor: colors.accent, marginTop: 16 },
  disabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontFamily: fonts.medium, fontSize: type.body },
  hint: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: type.label,
    marginTop: 12,
  },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  thumbWrap: { alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 8 },
  thumbEmpty: { backgroundColor: colors.deep },
  thumbTag: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: type.caption,
    marginTop: 4,
  },
  thumbMine: { color: colors.accent },
  clear: {
    color: colors.slate,
    fontFamily: fonts.regular,
    fontSize: type.label,
    marginTop: 12,
  },
  busy: { alignItems: 'center', marginTop: 16, gap: 8 },
  meta: { color: colors.soft, fontFamily: fonts.regular, fontSize: type.label },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  groupFace: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.deep },
  groupTitle: { color: colors.white, fontFamily: fonts.medium, fontSize: type.body },
  table: { marginTop: 24 },
  tableNote: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: type.label,
    marginBottom: 12,
  },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.dark },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  best: { backgroundColor: colors.dark, borderRadius: 6 },
  cell: {
    color: colors.pale,
    fontFamily: fonts.regular,
    fontSize: 11,
    width: 46,
    textAlign: 'right',
  },
  wide: { flex: 1, textAlign: 'left' },
  head: { color: colors.muted, fontFamily: fonts.medium, paddingBottom: 6 },
  good: { color: colors.accent, fontFamily: fonts.medium },
  bad: { color: '#FF3B30', fontFamily: fonts.medium },
  suggest: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: type.caption,
    paddingVertical: 8,
  },
});
