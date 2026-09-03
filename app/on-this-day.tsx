import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../src/components/AnalyzingBanner';
import ScreenHeader from '../src/components/ScreenHeader';
import TopicActionSheet from '../src/components/TopicActionSheet';
import TopicInterestSheet from '../src/components/TopicInterestSheet';
import TopicSwapSheet from '../src/components/TopicSwapSheet';
import { placePhoto } from '../src/images';
import { useMemoryPolish } from '../src/memoryIntake';
import { MonthBucket, buildMonthBuckets, buildPastYears, buildYearMonths } from '../src/monthBuckets';

// Same smooth expand/collapse as the Timeline rail.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateList = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
import {
  LoggedMemory,
  dateKey,
  getMemoriesByDay,
} from '../src/memoryLog';
import {
  Topic,
  TopicItem,
  TopicKey,
  getDayFeed,
  getInterestTopics,
  getTopicEvents,
  getTopicInterests,
  setTopicInterest,
  swapTopic,
} from '../src/onThisDay';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Future days first (top), then today, then back into the past — same
// year-back structure as the Timeline rail: current month expanded
// day-by-day, then 11 prior months collapsed into tappable banners.
const FUTURE_OFFSETS = [4, 3, 2, 1];

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

// What the user actually logged that day — no placeholders.
function memoryContent(real: LoggedMemory[]) {
  const texts = real.map((m) => m.text).filter(Boolean) as string[];
  const photoUri = real.find((m) => m.kind === 'photo')?.photoUris?.[0];
  if (texts.length === 0 && !photoUri) return null;
  return { lines: texts.slice(0, 4), photoUri };
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
  const content = future ? null : memoryContent(real);

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
            ) : (
              <View style={styles.emptyPhoto} />
            )}
          </>
        )}
      </View>
    </Pressable>
  );
}

// Width of one page inside an expanded topic card's event pager.
const EXPANDED_W = 320;
const PAGE_W = EXPANDED_W - 28; // card padding

// A news photo that falls back to the topic icon when its URL won't load —
// search-found image links are best-effort by nature.
function EventImage({
  uri,
  topicKey,
  style,
}: {
  uri?: string;
  topicKey: string;
  style: object;
}) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={style as any}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[style as any, styles.topicIconBlock]}>
      <MaterialCommunityIcons
        name={(TOPIC_ICONS[topicKey] ?? 'earth') as any}
        size={32}
        color={colors.teal}
      />
    </View>
  );
}

function TopicCard({
  label,
  topicKey,
  item,
  future,
  loading,
  expanded,
  events,
  interest,
  onMenu,
  onToggleExpand,
  onTune,
}: {
  label: string;
  topicKey: string;
  item?: TopicItem;
  future: boolean;
  loading: boolean;
  expanded: boolean;
  events?: TopicItem[]; // undefined while the expanded view is loading
  interest?: string;
  onMenu: () => void;
  onToggleExpand: () => void;
  onTune: () => void;
}) {
  const [page, setPage] = useState(0);

  return (
    <Pressable
      style={[styles.card, expanded && styles.cardExpanded]}
      onPress={future ? undefined : onToggleExpand}
    >
      <View style={{ flex: 1, paddingRight: expanded ? 0 : 10 }}>
        <View style={styles.topicHeaderRow}>
          <Text style={styles.cardTitle}>{label}</Text>
          {/* One button for everything: expand, tune, swap */}
          {!future && (
            <Pressable hitSlop={10} onPress={onMenu}>
              <Ionicons
                name="ellipsis-horizontal-circle-outline"
                size={18}
                color={interest ? colors.teal : '#B9BEBF'}
              />
            </Pressable>
          )}
        </View>

        {future ? (
          <Text style={styles.futureText}>We can’t predict the Future…</Text>
        ) : expanded ? (
          // Expanded: swipe through several events from this topic that day.
          !events ? (
            <Text style={styles.futureText}>Finding more {label} from this day…</Text>
          ) : (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={PAGE_W}
                decelerationRate="fast"
                onMomentumScrollEnd={(e) =>
                  setPage(Math.round(e.nativeEvent.contentOffset.x / PAGE_W))
                }
                style={{ marginTop: 4 }}
              >
                {events.map((ev, i) => (
                  <View key={i} style={styles.eventPage}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.topicHeadline} numberOfLines={3}>
                        {ev.headline}
                      </Text>
                      <Text style={styles.topicSummary} numberOfLines={5}>
                        {ev.summary}
                      </Text>
                    </View>
                    <EventImage uri={ev.image} topicKey={topicKey} style={styles.eventPhoto} />
                  </View>
                ))}
              </ScrollView>
              <View style={styles.dotsRow}>
                {events.map((_, i) => (
                  <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
                ))}
              </View>
            </>
          )
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

        {/* What this topic is tuned to — tap to change */}
        {!future && expanded && (
          <Pressable style={styles.tuneRow} onPress={onTune}>
            <MaterialCommunityIcons name="tune-variant" size={13} color={colors.teal} />
            <Text numberOfLines={1} style={styles.tuneText}>
              {interest ? `Tuned to: ${interest}` : `Tune ${label} to your taste`}
            </Text>
          </Pressable>
        )}
      </View>

      {!expanded && (
        <View style={styles.cardMedia}>
          {future || loading || !item ? (
            <View style={styles.emptyPhoto} />
          ) : topicKey === 'sports' && !item.live ? (
            <Image source={placePhoto('Soccer Roof')} style={styles.photo} resizeMode="cover" />
          ) : (
            <EventImage uri={item.image} topicKey={topicKey} style={styles.photo} />
          )}
        </View>
      )}

      {/* Subtle hint that the card opens */}
      {!future && !expanded && (
        <Ionicons name="chevron-down" size={13} color="#C4CACB" style={styles.expandHint} />
      )}
    </Pressable>
  );
}

export default function OnThisDay() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [feeds, setFeeds] = useState<Record<string, TopicItem[]>>({});
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [swapTarget, setSwapTarget] = useState<Topic | null>(null);

  // Per-topic taste text ("Premier League, F1…") and the sheet to edit it.
  const [interests, setInterests] = useState<Partial<Record<TopicKey, string>>>({});
  const [tuneTarget, setTuneTarget] = useState<Topic | null>(null);

  // The "…" action sheet — one entry point for expand / tune / swap.
  const [actionTarget, setActionTarget] = useState<{ topic: Topic; date: Date } | null>(null);

  // Expanded topic cards ("<dayKey>:<topicKey>") and their fetched events.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [eventsByKey, setEventsByKey] = useState<Record<string, TopicItem[]>>({});

  // The current calendar year's months, current month expanded by default,
  // the rest collapsed into tappable banners — then whole prior years
  // collapse into a single banner apiece, same model as the Timeline rail.
  const monthBuckets = useMemo(() => buildMonthBuckets(), []);
  const pastYears = useMemo(() => buildPastYears(), []);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set(monthBuckets[0] ? [monthBuckets[0].key] : []),
  );
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => new Set());
  const toggleMonth = (key: string) => {
    animateList();
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleYear = (year: number) => {
    animateList();
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  // Months belonging to any opened past year, appended to the current
  // year's list so one fetch effect covers both.
  const openYearMonths = useMemo(
    () => Array.from(expandedYears).flatMap((y) => buildYearMonths(y)),
    [expandedYears],
  );

  // Only days actually rendered (future + whichever months are expanded)
  // ever get their web feed fetched — a collapsed month costs nothing until
  // the user opens it.
  const visibleOffsets = useMemo(
    () => [
      ...FUTURE_OFFSETS,
      ...monthBuckets.filter((b) => expandedMonths.has(b.key)).flatMap((b) => b.offsets),
      ...openYearMonths.filter((b) => expandedMonths.has(b.key)).flatMap((b) => b.offsets),
    ],
    [monthBuckets, expandedMonths, openYearMonths],
  );

  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then(setByDay);
      getInterestTopics().then(setTopics);
      getTopicInterests().then(setInterests);
    }, []),
  );

  const analyzing = useMemoryPolish(useCallback(() => getMemoriesByDay().then(setByDay), []));

  const handleSwap = async (newKey: TopicKey) => {
    if (!swapTarget) return;
    const next = await swapTopic(swapTarget.key, newKey);
    setSwapTarget(null);
    setFeeds({}); // old cache is keyed to the previous topic mix — refetch clean
    setTopics(next);
  };

  const handleTuneSave = async (text: string) => {
    if (!tuneTarget) return;
    await setTopicInterest(tuneTarget.key, text);
    setTuneTarget(null);
    setInterests(await getTopicInterests());
    // Taste changed → both the day feeds and any expanded events are stale.
    setFeeds({});
    setEventsByKey({});
    setExpandedKeys(new Set());
    setTopics((prev) => [...prev]); // nudge the feed effect to refetch
  };

  const toggleExpand = (date: Date, topic: Topic) => {
    const k = `${dateKey(date)}:${topic.key}`;
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
        // Lazy-fetch the extra events the first time this card opens.
        if (!eventsByKey[k]) {
          getTopicEvents(date, topic).then((items) =>
            setEventsByKey((cur) => ({ ...cur, [k]: items })),
          );
        }
      }
      return next;
    });
  };

  // Fetch each visible past day's feed sequentially (cache makes revisits
  // instant). Re-runs when a collapsed month is opened, so expanding a year
  // never means fetching a year — only what's actually on screen.
  useEffect(() => {
    if (topics.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoadingFeeds(true);
      for (const offset of visibleOffsets) {
        if (offset > 0) continue;
        const date = dateFor(offset);
        const key = dateKey(date);
        if (feeds[key]) continue; // already fetched/cached
        const items = await getDayFeed(date, topics);
        if (cancelled) return;
        setFeeds((prev) => ({ ...prev, [key]: items }));
      }
      if (!cancelled) setLoadingFeeds(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, visibleOffsets]);

  // One full day row — used for the near-future days and every day inside
  // an expanded month.
  const renderDayRow = (offset: number) => {
    const date = dateFor(offset);
    const key = dateKey(date);
    const isToday = offset === 0;
    const future = offset > 0;
    const real = byDay.get(key) ?? [];
    const feed = feeds[key];

    return (
      <View key={offset} style={[styles.row, isToday && styles.rowToday]}>
        <View style={styles.dateCol}>
          <Text style={[styles.month, isToday && styles.dateToday]}>{MONTHS[date.getMonth()]}</Text>
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
          {topics.map((t) => {
            const expandKey = `${key}:${t.key}`;
            return (
              <TopicCard
                key={t.key}
                label={t.label}
                topicKey={t.key}
                item={feed?.find((i) => i.topic === t.key)}
                future={future}
                loading={!future && !feed && loadingFeeds}
                expanded={expandedKeys.has(expandKey)}
                events={eventsByKey[expandKey]}
                interest={interests[t.key]}
                onMenu={() => setActionTarget({ topic: t, date })}
                onToggleExpand={() => toggleExpand(date, t)}
                onTune={() => setTuneTarget(t)}
              />
            );
          })}
        </ScrollView>
      </View>
    );
  };

  // One collapsible month banner — reused for the current year's list and
  // for whichever prior years are opened below it. The live current month
  // skips the banner/header entirely — it's always open and isn't a "past
  // month" you'd ever collapse, so the dropdown affordance is meaningless
  // there.
  const renderMonthBanner = (bucket: MonthBucket, isCurrent = false) => {
    if (isCurrent) {
      return <View key={bucket.key}>{bucket.offsets.map(renderDayRow)}</View>;
    }

    const isExpanded = expandedMonths.has(bucket.key);

    if (!isExpanded) {
      return (
        <Pressable key={bucket.key} onPress={() => toggleMonth(bucket.key)} style={styles.monthBanner}>
          <View style={styles.monthBannerIcon}>
            <MaterialCommunityIcons name="calendar-month-outline" size={22} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.monthBannerLabel}>{bucket.label}</Text>
            <Text style={styles.monthBannerSub}>
              {bucket.offsets.length} day{bucket.offsets.length === 1 ? '' : 's'} — tap to explore
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#B9BEBF" />
        </Pressable>
      );
    }

    return (
      <View key={bucket.key}>
        <Pressable onPress={() => toggleMonth(bucket.key)} style={styles.monthHeaderRow}>
          <Text style={styles.monthHeaderText}>{bucket.label}</Text>
          <Ionicons name="chevron-up" size={16} color="#5B6364" />
        </Pressable>
        {bucket.offsets.map(renderDayRow)}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="On This Day" />
      {analyzing && (
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <AnalyzingBanner />
        </View>
      )}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {FUTURE_OFFSETS.map(renderDayRow)}

        {monthBuckets.map((bucket, i) => renderMonthBanner(bucket, i === 0))}

        {pastYears.map((year) => {
          const isExpanded = expandedYears.has(year);

          if (!isExpanded) {
            return (
              <Pressable key={year} onPress={() => toggleYear(year)} style={styles.monthBanner}>
                <View style={styles.monthBannerIcon}>
                  <MaterialCommunityIcons name="calendar-outline" size={22} color={colors.teal} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.monthBannerLabel}>{year}</Text>
                  <Text style={styles.monthBannerSub}>a full year — tap to explore</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#B9BEBF" />
              </Pressable>
            );
          }

          return (
            <View key={year}>
              <Pressable onPress={() => toggleYear(year)} style={styles.monthHeaderRow}>
                <Text style={styles.monthHeaderText}>{year}</Text>
                <Ionicons name="chevron-up" size={16} color="#5B6364" />
              </Pressable>
              {buildYearMonths(year).map((bucket) => renderMonthBanner(bucket))}
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

      <TopicInterestSheet
        visible={!!tuneTarget}
        topic={tuneTarget}
        initialText={tuneTarget ? (interests[tuneTarget.key] ?? '') : ''}
        onSave={handleTuneSave}
        onClose={() => setTuneTarget(null)}
      />

      <TopicActionSheet
        visible={!!actionTarget}
        topic={actionTarget?.topic ?? null}
        expanded={
          !!actionTarget &&
          expandedKeys.has(`${dateKey(actionTarget.date)}:${actionTarget.topic.key}`)
        }
        tuned={!!actionTarget && !!interests[actionTarget.topic.key]}
        onTune={() => {
          const t = actionTarget?.topic ?? null;
          setActionTarget(null);
          setTuneTarget(t);
        }}
        onSwap={() => {
          const t = actionTarget?.topic ?? null;
          setActionTarget(null);
          setSwapTarget(t);
        }}
        onToggleExpand={() => {
          if (actionTarget) toggleExpand(actionTarget.date, actionTarget.topic);
          setActionTarget(null);
        }}
        onClose={() => setActionTarget(null)}
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

  // Collapsed month — a full-width banner instead of the rail's small
  // square, since this page is one column rather than a side strip.
  monthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF3F3',
  },
  monthBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBannerLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.primary },
  monthBannerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },

  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#F7F8F8',
    borderBottomWidth: 1,
    borderBottomColor: '#EDEFEF',
  },
  monthHeaderText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#5B6364', letterSpacing: 0.3 },

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
  cardExpanded: { width: EXPANDED_W },
  cardTitle: { fontFamily: fonts.medium, fontSize: 16, color: '#2B2B2B', marginBottom: 6 },
  topicHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  eventPage: { width: PAGE_W, paddingRight: 14, flexDirection: 'row', gap: 10 },
  eventPhoto: { width: 74, height: 74, borderRadius: 10, overflow: 'hidden' },
  expandHint: { position: 'absolute', bottom: 4, alignSelf: 'center' },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D5DBDB' },
  dotActive: { backgroundColor: colors.teal },

  tuneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F2',
    paddingTop: 8,
  },
  tuneText: { flex: 1, fontFamily: fonts.medium, fontSize: 11, color: colors.teal },
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
});
