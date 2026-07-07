import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import ScreenHeader from '../../src/components/ScreenHeader';
import TopicSwapSheet from '../../src/components/TopicSwapSheet';
import { getDayDetail } from '../../src/data';
import { personPhoto, placePhoto } from '../../src/images';
import {
  LoggedMemory,
  dateKey,
  getMemoriesByDay,
} from '../../src/memoryLog';
import { Topic, TopicItem, TopicKey, getDayFeed, getInterestTopics, swapTopic } from '../../src/onThisDay';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Future days first (top), then today, then back into the past — like the mock.
const OFFSETS = Array.from({ length: 14 }, (_, i) => 4 - i);

const CARD_W = 250;
const CARD_GAP = 12;

const TOPIC_ICONS: Record<string, string> = {
  sports: 'soccer',
  music: 'music-note',
  news: 'newspaper-variant-outline',
  movies: 'movie-open-outline',
  design: 'palette-outline',
  travel: 'airplane',
  books: 'book-open-variant',
};

function dateFor(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

// What the user logged that day (real first, seeded demo as fallback).
function memoryContent(offset: number, real: LoggedMemory[]) {
  const texts = real
    .map((m) => (m.kind === 'photo' ? m.text : m.text))
    .filter(Boolean) as string[];
  const photoUri = real.find((m) => m.kind === 'photo')?.photoUris?.[0];
  if (texts.length > 0 || photoUri) {
    return { lines: texts.slice(0, 4), photoUri, demoPeople: [] as string[] };
  }
  const detail = getDayDetail(offset);
  if (detail) {
    return {
      lines: detail.bullets.slice(0, 4),
      photoUri: undefined,
      demoPhoto: placePhoto(offset === -3 ? 'Soccer Roof' : 'College'),
      demoPeople: detail.people.filter((p) => p.hasPhoto).map((p) => p.name),
    };
  }
  return null;
}

function PlusGrid() {
  return (
    <View style={styles.plusGrid}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Ionicons key={i} name="add-circle-outline" size={24} color={colors.teal} />
      ))}
    </View>
  );
}

function MemoryCard({
  offset,
  real,
  future,
}: {
  offset: number;
  real: LoggedMemory[];
  future: boolean;
}) {
  const router = useRouter();
  const content = future ? null : memoryContent(offset, real);

  return (
    <Pressable
      style={styles.card}
      onPress={() =>
        future ? undefined : router.push(`/day/${offset}` as any)
      }
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.cardTitle}>Memory</Text>
        {future ? (
          <Text style={styles.futureText}>We can’t predict the Future…</Text>
        ) : content ? (
          content.lines.length > 0 ? (
            content.lines.map((line, i) => (
              <Text key={i} numberOfLines={2} style={[styles.memoryLine, rtlIfArabic(line)]}>
                {line}
              </Text>
            ))
          ) : (
            <Text style={styles.futureText}>Photos from this day.</Text>
          )
        ) : (
          <Text style={styles.futureText}>Nothing logged this day…</Text>
        )}
      </View>

      <View style={styles.cardMedia}>
        {future || !content ? (
          <>
            <View style={styles.emptyPhoto} />
            <PlusGrid />
          </>
        ) : (
          <>
            {content.photoUri ? (
              <Image source={{ uri: content.photoUri }} style={styles.photo} resizeMode="cover" />
            ) : 'demoPhoto' in content && content.demoPhoto ? (
              <Image source={content.demoPhoto} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={styles.emptyPhoto} />
            )}
            {content.demoPeople.length > 0 && (
              <View style={styles.avatarRow}>
                {content.demoPeople.slice(0, 4).map((name, i) => (
                  <Image
                    key={name}
                    source={personPhoto(name)}
                    style={[styles.miniAvatar, { marginLeft: i === 0 ? 0 : -6 }]}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </Pressable>
  );
}

function TopicCard({
  label,
  topicKey,
  item,
  future,
  loading,
  onFeedback,
}: {
  label: string;
  topicKey: string;
  item?: TopicItem;
  future: boolean;
  loading: boolean;
  onFeedback: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <View style={styles.topicHeaderRow}>
          <Text style={styles.cardTitle}>{label}</Text>
          {!future && (
            <Pressable hitSlop={10} onPress={onFeedback}>
              <Ionicons name="ellipsis-horizontal-circle-outline" size={18} color="#B9BEBF" />
            </Pressable>
          )}
        </View>
        {future ? (
          <Text style={styles.futureText}>We can’t predict the Future…</Text>
        ) : loading ? (
          <Text style={styles.futureText}>Looking this day up…</Text>
        ) : item ? (
          <>
            <Text style={styles.topicHeadline} numberOfLines={3}>
              {item.headline}
            </Text>
            <Text style={styles.topicSummary} numberOfLines={4}>
              {item.summary}
            </Text>
          </>
        ) : (
          <Text style={styles.futureText}>Nothing found for this day.</Text>
        )}
      </View>

      <View style={styles.cardMedia}>
        {future || loading || !item ? (
          <View style={styles.emptyPhoto} />
        ) : topicKey === 'sports' && !item.live ? (
          <Image source={placePhoto('Soccer Roof')} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.topicIconBlock}>
            <MaterialCommunityIcons
              name={(TOPIC_ICONS[topicKey] ?? 'earth') as any}
              size={40}
              color={colors.teal}
            />
          </View>
        )}
      </View>
    </View>
  );
}

export default function OnThisDay() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [feeds, setFeeds] = useState<Record<string, TopicItem[]>>({});
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [swapTarget, setSwapTarget] = useState<Topic | null>(null);

  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then(setByDay);
      getInterestTopics().then(setTopics);
    }, []),
  );

  const handleSwap = async (newKey: TopicKey) => {
    if (!swapTarget) return;
    const next = await swapTopic(swapTarget.key, newKey);
    setSwapTarget(null);
    setFeeds({}); // old cache is keyed to the previous topic mix — refetch clean
    setTopics(next);
  };

  // Fetch each past day's feed sequentially (cache makes revisits instant).
  useEffect(() => {
    if (topics.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoadingFeeds(true);
      for (const offset of OFFSETS) {
        if (offset > 0) continue;
        const date = dateFor(offset);
        const items = await getDayFeed(date, topics);
        if (cancelled) return;
        setFeeds((prev) => ({ ...prev, [dateKey(date)]: items }));
      }
      if (!cancelled) setLoadingFeeds(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [topics]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="On This Day" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {OFFSETS.map((offset) => {
          const date = dateFor(offset);
          const key = dateKey(date);
          const isToday = offset === 0;
          const future = offset > 0;
          const real = byDay.get(key) ?? [];
          const feed = feeds[key];

          return (
            <View key={offset} style={[styles.row, isToday && styles.rowToday]}>
              <View style={styles.dateCol}>
                <Text style={[styles.month, isToday && styles.dateToday]}>
                  {MONTHS[date.getMonth()]}
                </Text>
                <Text style={[styles.day, isToday && styles.dateToday]}>
                  {String(date.getDate()).padStart(2, '0')}
                </Text>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={CARD_W + CARD_GAP}
                decelerationRate="fast"
                contentContainerStyle={{ gap: CARD_GAP, paddingRight: 16 }}
              >
                <MemoryCard offset={offset} real={real} future={future} />
                {topics.map((t) => (
                  <TopicCard
                    key={t.key}
                    label={t.label}
                    topicKey={t.key}
                    item={feed?.find((i) => i.topic === t.key)}
                    future={future}
                    loading={!future && !feed && loadingFeeds}
                    onFeedback={() => setSwapTarget(t)}
                  />
                ))}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      <TopicSwapSheet
        visible={!!swapTarget}
        topic={swapTarget}
        selectedKeys={topics.map((t) => t.key)}
        onSelect={handleSwap}
        onClose={() => setSwapTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF3F3',
  },
  rowToday: { backgroundColor: colors.accent },
  dateCol: { width: 78, alignItems: 'center' },
  month: { fontFamily: fonts.bold, fontSize: 18, color: colors.primary, lineHeight: 22 },
  day: { fontFamily: fonts.bold, fontSize: 32, color: colors.primary, lineHeight: 38 },
  dateToday: { color: colors.white },

  card: {
    width: CARD_W,
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DDE2E2',
    padding: 14,
    minHeight: 170,
  },
  cardTitle: { fontFamily: fonts.medium, fontSize: 16, color: '#2B2B2B', marginBottom: 6 },
  topicHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memoryLine: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#4A5253',
  },
  futureText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#8B9394' },
  topicHeadline: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    lineHeight: 18,
    color: '#1B1B1B',
  },
  topicSummary: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#4A5253',
    marginTop: 4,
  },

  cardMedia: { width: 84 },
  photo: { width: '100%', height: 78, borderRadius: 10, overflow: 'hidden' },
  emptyPhoto: {
    width: '100%',
    height: 78,
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
    borderWidth: 1,
    borderColor: '#E4E4E4',
  },
  topicIconBlock: {
    width: '100%',
    height: 78,
    borderRadius: 10,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    justifyContent: 'center',
  },
  avatarRow: { flexDirection: 'row', marginTop: 8 },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.white,
    overflow: 'hidden',
  },
});
