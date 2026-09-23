import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NO_EMBEDDER_REASON, faceEmbedderAvailable } from '../faceEmbedder';
import { IndexStatus, getIndexStatus } from '../faceIndex';
import { IndexingState, getIndexingState, onIndexingStateChange } from '../faceIndexing';
import { colors, fonts } from '../theme';

// Whether the app has finished reading your photos for faces.
//
// This exists because the work is invisible otherwise. Recognising faces
// means reading every photo once, which takes a while the first time and then
// never happens again — and a user who cannot see that happening has no way
// to tell "still working" apart from "broken", which is exactly how the
// previous attempt felt.
//
// So it says which of the three it is, always: not available, working, or
// done — and when it's working, how far along.

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export default function FaceIndexCard() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState<IndexingState>(getIndexingState());
  const available = faceEmbedderAvailable();

  const refresh = useCallback(() => {
    if (!available) return;
    getIndexStatus().then(setStatus).catch(() => {});
  }, [available]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Follows the pass live, and refreshes the totals the moment it stops.
  useEffect(() => {
    let wasRunning = getIndexingState().running;
    return onIndexingStateChange((next) => {
      setIndexing(next);
      if (wasRunning && !next.running) refresh();
      wasRunning = next.running;
    });
  }, [refresh]);

  const running = indexing.running && indexing.total > 0;
  const pct = running ? Math.round((indexing.done / indexing.total) * 100) : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Faces</Text>

      {!available ? (
        <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={18} color="#8B9394" />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Not in this version</Text>
            <Text style={styles.hint}>{NO_EMBEDDER_REASON}</Text>
          </View>
        </View>
      ) : running ? (
        <>
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.teal} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Reading your photos…</Text>
              <Text style={styles.hint}>
                {indexing.done.toLocaleString()} of {indexing.total.toLocaleString()} — this
                happens once, then never again.
              </Text>
            </View>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} />
          </View>
        </>
      ) : status?.upToDate ? (
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Up to date</Text>
            <Text style={styles.hint}>
              {plural(status.faces, 'face', 'faces')} found across{' '}
              {plural(status.read, 'photo', 'photos')}.
            </Text>
          </View>
        </View>
      ) : status && status.remaining > 0 ? (
        <View style={styles.row}>
          <Ionicons name="time-outline" size={18} color="#8B9394" />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>
              {plural(status.remaining, 'photo', 'photos')} still to read
            </Text>
            <Text style={styles.hint}>
              It carries on quietly while you use the app, and picks up where it left off.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Ionicons name="images-outline" size={18} color="#8B9394" />
          <Text style={styles.label}>No photos to read yet</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 16,
  },
  cardTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: colors.primary,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#8B9394',
    marginTop: 2,
    lineHeight: 16,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4EAEA',
    overflow: 'hidden',
    marginTop: 12,
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.teal },
});
