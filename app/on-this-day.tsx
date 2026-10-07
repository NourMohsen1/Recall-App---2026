import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../src/components/AnalyzingBanner';
import MixSheet from '../src/components/MixSheet';
import PersonAvatar from '../src/components/PersonAvatar';
import PhotoImage from '../src/components/PhotoImage';
import ScreenHeader from '../src/components/ScreenHeader';
import TopicArrangeRow from '../src/components/TopicArrangeRow';
import { learnFollows, likeSubject, muteSubject, unmuteSubject } from '../src/follows';
import { getAllAssumedMemories } from '../src/assumedMemory';
import { getAllGuesses, type GuessesByDay } from '../src/guessedPeople';
import { useMemoryPolish } from '../src/memoryIntake';
import { LoggedMemory, dateKey, getMemoriesByDay, memoryDisplayText } from '../src/memoryLog';
import { MonthBucket, buildMonthBuckets, buildPastYears, buildYearMonths } from '../src/monthBuckets';
import {
  Topic,
  TopicItem,
  getDayFeed,
  getInterestTopics,
  getTopicEvents,
  setInterestTopics,
  topicIcon,
} from '../src/onThisDay';
import { getAllDayPeople, getAllPersonMeta } from '../src/peopleTags';
import { getAllPhotoSources } from '../src/photoMeta';
import { getAllDayPlaces, type DayPlace } from '../src/places';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';
import { withAppNav } from '../src/components/AppNav';

// On This Day: each day of the user's life beside what happened in the
// world that same day — "the day you went to the doctor was the day
// Liverpool beat City 3–1". A row per day: the user's own day first, then
// one card per topic they care about, wide enough to read, with just an
// edge of the next one showing so the row reads as swipeable. Tailoring
// happens on the cards (More like this / Not for me) and in "Your mix".

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SIDE = 16;
const GAP = 12;
/** How much of the next card shows — enough to say "swipe". */
const PEEK = 22;
const CARD_H = 392;
const MEDIA_H = 168;

function dateFor(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

type DayCompany = { people: string[]; guessed: string[]; place?: string };

// ── The user's own day ─────────────────────────────────────────────────────

function DayCard({
  width,
  offset,
  memories,
  company,
  photos,
  sources,
  guess,
}: {
  width: number;
  offset: number;
  memories: LoggedMemory[];
  company: DayCompany;
  photos: Record<string, string | undefined>;
  sources: Record<string, string>;
  /** What Recall guessed from the day's photos — shown only when the user
   *  wrote nothing, and drawn as the guess it is. */
  guess?: string;
}) {
  const router = useRouter();
  const lines = memories.map(memoryDisplayText).filter(Boolean) as string[];
  // The card is a fixed height, and notes vary — three two-line notes don't
  // fit. Each note is measured, and one that wouldn't fit whole is left for
  // the day page rather than drawn over the footer.
  const [bodyH, setBodyH] = useState(0);
  const [rowBottoms, setRowBottoms] = useState<Record<number, number>>({});
  const fits = (i: number) => i === 0 || !bodyH || rowBottoms[i] == null || rowBottoms[i] <= bodyH;
  const uris = memories.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []);
  const camera = uris.find((u) => !sources[u]);
  const photo = camera ?? uris[0];
  const isScreenshot = !camera && !!photo;
  const everyone = [
    ...company.people.map((n) => ({ n, guess: false })),
    ...company.guessed.map((n) => ({ n, guess: true })),
  ];
  const empty = lines.length === 0 && !photo && everyone.length === 0;

  return (
    <Pressable
      style={[styles.card, { width }]}
      onPress={() =>
        empty && offset === 0
          ? router.push('/log/text')
          : router.push(`/day/${offset}` as Parameters<typeof router.push>[0])
      }
    >
      <View style={styles.media}>
        {photo ? (
          <>
            <PhotoImage uri={photo} style={StyleSheet.absoluteFill} />
            {isScreenshot && (
              <View style={styles.mediaTag}>
                <MaterialCommunityIcons name="cellphone-screenshot" size={12} color={colors.ink} />
                <Text style={styles.mediaTagText}>Screenshot</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.mediaEmpty}>
            <MaterialCommunityIcons name="notebook-heart-outline" size={34} color={colors.soft} />
          </View>
        )}
      </View>

      <View style={[styles.body, styles.clipBody]} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
        {!(lines.length === 0 && guess) && <Text style={styles.kicker}>YOUR DAY</Text>}
        {lines.length === 0 && guess ? (
          // Dashed and tinted, like every guess in Recall — never mistaken
          // for something the user logged.
          <View style={styles.guessBox}>
            <View style={styles.guessHead}>
              <Ionicons name="sparkles-outline" size={14} color={colors.teal} />
              <Text style={styles.guessTitle}>Recall’s guess from your photos</Text>
            </View>
            <Text numberOfLines={4} style={[styles.guessText, rtlIfArabic(guess)]}>
              {guess}
            </Text>
          </View>
        ) : lines.length > 0 ? (
          lines.slice(0, 3).map((l, i) => (
            <View
              key={i}
              style={[styles.lineRow, !fits(i) && styles.lineHidden]}
              onLayout={(e) => {
                const bottom = Math.ceil(e.nativeEvent.layout.y + e.nativeEvent.layout.height);
                setRowBottoms((b) => (b[i] === bottom ? b : { ...b, [i]: bottom }));
              }}
            >
              <View style={styles.lineDot} />
              <Text numberOfLines={2} style={[styles.lineText, rtlIfArabic(l)]}>
                {l}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>
            {empty
              ? offset === 0
                ? 'Nothing logged yet today.'
                : 'Nothing logged this day.'
              : isScreenshot
                ? 'A screenshot you took this day.'
                : 'No notes this day.'}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        {everyone.length > 0 ? (
          <View style={styles.faces}>
            {everyone.slice(0, 5).map((p, i) => (
              <View key={p.n} style={[styles.face, i > 0 && { marginLeft: -8 }]}>
                <PersonAvatar name={p.n} photoUri={photos[p.n]} size={28} unconfirmed={p.guess} />
              </View>
            ))}
            {everyone.length > 5 && <Text style={styles.moreFaces}>+{everyone.length - 5}</Text>}
          </View>
        ) : empty ? (
          <View style={styles.action}>
            <Ionicons name="add" size={15} color={colors.primary} />
            <Text style={styles.actionText}>{offset === 0 ? 'Log today' : 'Add to this day'}</Text>
          </View>
        ) : (
          <View />
        )}
        {company.place && (
          <View style={styles.placeRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.teal} />
            <Text numberOfLines={1} style={styles.placeText}>
              {company.place}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ── The world that day ─────────────────────────────────────────────────────

function NewsImage({ uri, topicKey }: { uri?: string; topicKey: string }) {
  if (uri) return <PhotoImage uri={uri} style={StyleSheet.absoluteFill} />;
  return (
    <View style={styles.mediaEmpty}>
      <MaterialCommunityIcons name={topicIcon(topicKey) as any} size={38} color={colors.teal} />
    </View>
  );
}

/** Holding a topic's card starts arranging the topics. */
function HoldToArrange({ onHold, children }: { onHold: () => void; children: React.ReactNode }) {
  const hold = useMemo(() => Gesture.LongPress().minDuration(380).runOnJS(true).onStart(onHold), [onHold]);
  return <GestureDetector gesture={hold}>{children}</GestureDetector>;
}

function NewsCard({
  width,
  topic,
  item,
  loading,
  onMore,
  onMix,
}: {
  width: number;
  topic: Topic;
  item?: TopicItem;
  loading: boolean;
  onMore: () => void;
  onMix: () => void;
}) {
  const [liked, setLiked] = useState(false);
  const [hidden, setHidden] = useState(false);
  // A long headline leaves less room: the summary gets the lines that are
  // left above the footer, never more.
  const [bodyH, setBodyH] = useState(0);
  const [headBottom, setHeadBottom] = useState(0);
  const SUMMARY_LINE = 20;
  const summaryLines =
    bodyH && headBottom ? Math.min(3, Math.floor((bodyH - headBottom - 6) / SUMMARY_LINE)) : 3;

  const topicChip = (
    <View style={styles.topicChip}>
      <MaterialCommunityIcons name={topicIcon(topic.key) as any} size={13} color={colors.teal} />
      <Text style={styles.topicChipText}>{topic.label}</Text>
    </View>
  );

  if (loading || !item) {
    return (
      <View style={[styles.card, { width }]}>
        <View style={[styles.media, styles.skeleton]} />
        <View style={styles.body}>
          {topicChip}
          <View style={[styles.skelLine, { width: '85%', marginTop: 14 }]} />
          <View style={[styles.skelLine, { width: '70%' }]} />
          <View style={[styles.skelLine, { width: '55%' }]} />
        </View>
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={colors.soft} />
        </View>
      </View>
    );
  }

  // Nothing happened that day in this topic — said plainly, not filled.
  if (item.quiet || !item.live) {
    return (
      <View style={[styles.card, styles.quietCard, { width }]}>
        <View style={styles.quietIcon}>
          <MaterialCommunityIcons name={topicIcon(topic.key) as any} size={30} color={colors.teal} />
        </View>
        <Text style={styles.quietTitle}>{item.headline}</Text>
        <Text style={styles.quietText}>{item.summary}</Text>
        <Pressable style={[styles.action, { marginTop: 18 }]} onPress={onMix}>
          <Ionicons name="options-outline" size={15} color={colors.primary} />
          <Text style={styles.actionText}>Your mix</Text>
        </Pressable>
      </View>
    );
  }

  if (hidden) {
    return (
      <View style={[styles.card, styles.quietCard, { width }]}>
        <MaterialCommunityIcons name="eye-off-outline" size={28} color={colors.soft} />
        <Text style={styles.quietTitle}>Got it — no more {item.about}</Text>
        <Text style={styles.quietText}>Recall won’t show stories about it again.</Text>
        <Pressable
          style={[styles.action, { marginTop: 18 }]}
          onPress={async () => {
            await unmuteSubject(item.about!);
            animate();
            setHidden(false);
          }}
        >
          <Ionicons name="arrow-undo-outline" size={15} color={colors.primary} />
          <Text style={styles.actionText}>Undo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, { width }]}>
      <Pressable style={styles.media} onPress={onMore}>
        <NewsImage uri={item.image} topicKey={topic.key} />
      </Pressable>
      <Pressable
        style={[styles.body, styles.clipBody]}
        onPress={onMore}
        onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}
      >
        {topicChip}
        <Text
          numberOfLines={3}
          style={styles.headline}
          onLayout={(e) => setHeadBottom(Math.ceil(e.nativeEvent.layout.y + e.nativeEvent.layout.height))}
        >
          {item.headline}
        </Text>
        {summaryLines > 0 && (
          <Text numberOfLines={summaryLines} style={styles.summary}>
            {item.summary}
          </Text>
        )}
      </Pressable>
      <View style={styles.footer}>
        <View style={styles.feedback}>
          {item.about && (
            <>
              <Pressable
                style={[styles.iconBtn, liked && styles.iconBtnOn]}
                hitSlop={6}
                accessibilityLabel={`More like this — follow ${item.about}`}
                onPress={async () => {
                  if (liked) return;
                  await likeSubject(topic.key, item.about!);
                  setLiked(true);
                }}
              >
                <Ionicons
                  name={liked ? 'thumbs-up' : 'thumbs-up-outline'}
                  size={16}
                  color={liked ? colors.white : colors.primary}
                />
              </Pressable>
              <Pressable
                style={styles.iconBtn}
                hitSlop={6}
                accessibilityLabel={`Not for me — hide ${item.about}`}
                onPress={async () => {
                  await muteSubject(item.about!);
                  animate();
                  setHidden(true);
                }}
              >
                <Ionicons name="thumbs-down-outline" size={16} color={colors.primary} />
              </Pressable>
              {liked && (
                <Text numberOfLines={1} style={styles.likedText}>
                  Following {item.about}
                </Text>
              )}
            </>
          )}
        </View>
        <Pressable style={styles.action} onPress={onMore} hitSlop={6}>
          <Text style={styles.actionText}>More</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

// ── More from that day, in a sheet ────────────────────────────────────────

function MoreSheet({ target, onClose }: { target: { topic: Topic; date: Date } | null; onClose: () => void }) {
  const [events, setEvents] = useState<TopicItem[] | null>(null);
  useEffect(() => {
    if (!target) return;
    setEvents(null);
    getTopicEvents(target.date, target.topic).then(setEvents);
  }, [target]);
  if (!target) return null;
  const d = target.date;
  const real = (events ?? []).filter((e) => !e.quiet && e.live);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>
            {target.topic.label} · {MONTHS[d.getMonth()]} {d.getDate()}, {d.getFullYear()}
          </Text>
          <Text style={styles.sheetSub}>What happened that day</Text>
          <ScrollView style={{ maxHeight: 460, marginTop: 14 }} showsVerticalScrollIndicator={false}>
            {!events ? (
              <ActivityIndicator color={colors.teal} style={{ marginVertical: 40 }} />
            ) : real.length === 0 ? (
              <Text style={[styles.muted, { marginVertical: 30, textAlign: 'center' }]}>
                Nothing else happened that day.
              </Text>
            ) : (
              real.map((e, i) => (
                <View key={i} style={styles.event}>
                  <View style={styles.eventThumb}>
                    <NewsImage uri={e.image} topicKey={target.topic.key} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventHeadline}>{e.headline}</Text>
                    <Text style={styles.eventSummary}>{e.summary}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────

function OnThisDay() {
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const cardW = screenW - SIDE - GAP - PEEK;

  const [topics, setTopics] = useState<Topic[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [feeds, setFeeds] = useState<Record<string, TopicItem[]>>({});
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [dayPeople, setDayPeople] = useState<Record<string, string[]>>({});
  const [guesses, setGuesses] = useState<GuessesByDay>({});
  const [personPhotos, setPersonPhotos] = useState<Record<string, string | undefined>>({});
  const [dayPlaces, setDayPlaces] = useState<Record<string, DayPlace[]>>({});
  const [photoSources, setPhotoSources] = useState<Record<string, string>>({});
  const [photoGuesses, setPhotoGuesses] = useState<Record<string, string>>({});
  // `?mix=1` opens straight onto Your mix (from Profile, or a link).
  const params = useLocalSearchParams<{ mix?: string }>();
  const [mixOpen, setMixOpen] = useState(params.mix === '1');
  // Arranging: every day shrinks to tiles and the topics can be slid into
  // a new order — the same order on every day.
  const [arranging, setArranging] = useState(false);
  const startArrange = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setArranging(true);
  }, []);
  const reorderTopics = (keys: string[]) => {
    setTopics((now) => keys.map((k) => now.find((t) => t.key === k)!).filter(Boolean));
    setInterestTopics(keys as Topic['key'][]);
    console.log(`[otd] topics now ${keys.join(', ')}`);
  };
  useEffect(() => {
    if (params.mix === '1') setMixOpen(true);
  }, [params.mix]);
  const [more, setMore] = useState<{ topic: Topic; date: Date } | null>(null);
  const [yearAgo, setYearAgo] = useState<{ offset: number; years: number; item?: TopicItem } | null>(null);

  const monthBuckets = useMemo(() => buildMonthBuckets(), []);
  const pastYears = useMemo(() => buildPastYears(), []);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set(monthBuckets[0] ? [monthBuckets[0].key] : []),
  );
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => new Set());
  const toggleMonth = (key: string) => {
    animate();
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleYear = (year: number) => {
    animate();
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };
  const openYearMonths = useMemo(
    () => Array.from(expandedYears).flatMap((y) => buildYearMonths(y)),
    [expandedYears],
  );

  // Only days on screen are ever looked up.
  const visibleOffsets = useMemo(
    () => [
      ...monthBuckets.filter((b) => expandedMonths.has(b.key)).flatMap((b) => b.offsets),
      ...openYearMonths.filter((b) => expandedMonths.has(b.key)).flatMap((b) => b.offsets),
    ],
    [monthBuckets, expandedMonths, openYearMonths],
  );

  const loadTopics = useCallback(() => {
    getInterestTopics().then(setTopics);
  }, []);

  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then(setByDay);
      loadTopics();
      Promise.all([getAllDayPeople(), getAllGuesses()]).then(([p, g]) => {
        setDayPeople(p);
        setGuesses(g);
      });
      getAllDayPlaces().then(setDayPlaces);
      getAllPhotoSources().then(setPhotoSources);
      Promise.all([getAllAssumedMemories(), getMemoriesByDay()]).then(([all, days]) => {
        setPhotoGuesses(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.summary])));
        const shown = Object.keys(all).filter(
          (k) => !(days.get(k) ?? []).some((m) => m.kind !== 'photo' || m.text),
        );
        console.log(`[otd] photo guesses: ${Object.keys(all).length} days, shown on ${shown.length} with no notes (e.g. ${shown.slice(0, 3).join(', ') || 'none'})`);
      });
      getAllPersonMeta().then((meta) =>
        setPersonPhotos(Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, m.photoUri]))),
      );
      // Quietly read new memories for what the user follows.
      learnFollows().then((added) => {
        if (added > 0) {
          setFeeds({});
          loadTopics();
        }
      });
    }, [loadTopics]),
  );

  const analyzing = useMemoryPolish(useCallback(() => getMemoriesByDay().then(setByDay), []));

  // Today's date in an earlier year: the most recent one the user logged
  // anything on, and what happened in the world that day.
  useEffect(() => {
    if (topics.length === 0 || byDay.size === 0) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let years = 1; years <= 10; years++) {
      const d = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
      if (!(byDay.get(dateKey(d)) ?? []).length) continue;
      const offset = Math.round((d.getTime() - today.getTime()) / 86400000);
      setYearAgo({ offset, years });
      getDayFeed(d, topics).then((items) =>
        setYearAgo({ offset, years, item: items.find((i) => i.live && !i.quiet) }),
      );
      return;
    }
    setYearAgo(null);
  }, [topics, byDay]);

  // Each visible day's world, one after another (cached once found).
  useEffect(() => {
    if (topics.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoadingFeeds(true);
      for (const offset of visibleOffsets) {
        const date = dateFor(offset);
        const key = dateKey(date);
        if (feeds[key]) continue;
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

  const companyOf = (key: string): DayCompany => {
    const people = dayPeople[key] ?? [];
    return {
      people,
      guessed: (guesses[key] ?? [])
        .map((g) => g.name)
        .filter((n) => !people.some((p) => p.toLowerCase() === n.toLowerCase())),
      place: (dayPlaces[key] ?? []).find((p) => p.named)?.label ?? dayPlaces[key]?.[0]?.label,
    };
  };

  const renderDay = (offset: number) => {
    const date = dateFor(offset);
    const key = dateKey(date);
    const isToday = offset === 0;
    const feed = feeds[key];
    return (
      <View key={offset} style={styles.day}>
        <View style={styles.dayHeader}>
          <Text style={styles.dayWeekday}>{WEEKDAYS[date.getDay()]}</Text>
          {isToday && (
            <View style={styles.todayPill}>
              <Text style={styles.todayPillText}>Today</Text>
            </View>
          )}
          <View style={styles.dayDate}>
            <Text style={styles.dayMonth}>{MONTHS[date.getMonth()]}</Text>
            <Text style={styles.dayNum}>{String(date.getDate()).padStart(2, '0')}</Text>
          </View>
        </View>
        {arranging ? (
          <View style={{ paddingHorizontal: SIDE }}>
            <TopicArrangeRow topics={topics} width={screenW - SIDE * 2} gap={8} onReorder={reorderTopics} />
          </View>
        ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardW + GAP}
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
        >
          <DayCard
            width={cardW}
            offset={offset}
            memories={byDay.get(key) ?? []}
            company={companyOf(key)}
            photos={personPhotos}
            sources={photoSources}
            guess={photoGuesses[key]}
          />
          {topics.map((t) => (
            <HoldToArrange key={t.key} onHold={startArrange}>
              <View>
                <NewsCard
                  width={cardW}
                  topic={t}
                  item={feed?.find((i) => i.topic === t.key)}
                  loading={!feed && loadingFeeds}
                  onMore={() => setMore({ topic: t, date })}
                  onMix={() => setMixOpen(true)}
                />
              </View>
            </HoldToArrange>
          ))}
        </ScrollView>
        )}
      </View>
    );
  };

  const renderMonth = (bucket: MonthBucket, isCurrent = false) => {
    if (isCurrent) return <View key={bucket.key}>{bucket.offsets.map(renderDay)}</View>;
    const open = expandedMonths.has(bucket.key);
    return (
      <View key={bucket.key}>
        <Pressable onPress={() => toggleMonth(bucket.key)} style={styles.banner}>
          <View style={styles.bannerIcon}>
            <MaterialCommunityIcons name="calendar-month-outline" size={22} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerLabel}>{bucket.label}</Text>
            <Text style={styles.bannerSub}>{bucket.offsets.length} days</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#9AA4A5" />
        </Pressable>
        {open && bucket.offsets.map(renderDay)}
      </View>
    );
  };

  const yearAgoDate = yearAgo ? dateFor(yearAgo.offset) : null;
  const yearAgoMemories = yearAgoDate ? (byDay.get(dateKey(yearAgoDate)) ?? []) : [];
  const yearAgoPhotoCount = yearAgoMemories.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []).length;
  // Something said about that day, always — the user's own words, or what
  // they kept from it.
  const yearAgoLine =
    yearAgoMemories.map(memoryDisplayText).find(Boolean) ??
    (yearAgoPhotoCount ? `You kept ${yearAgoPhotoCount === 1 ? 'a photo' : `${yearAgoPhotoCount} photos`} from this day.` : undefined);
  const yearAgoPhoto = yearAgoMemories
    .filter((m) => m.kind === 'photo')
    .flatMap((m) => m.photoUris ?? [])
    .find((u) => !photoSources[u]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="On This Day"
        action={{ icon: 'options-outline', label: 'Your mix', onPress: () => setMixOpen(true) }}
      />
      <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        {analyzing && (
          <View style={{ paddingHorizontal: SIDE, paddingTop: 8 }}>
            <AnalyzingBanner />
          </View>
        )}

        {/* Today, in an earlier year — the moment this page exists for. */}
        {yearAgo && yearAgoDate && (
          <Pressable
            style={styles.flashback}
            onPress={() => router.push(`/day/${yearAgo.offset}` as Parameters<typeof router.push>[0])}
          >
            {yearAgoPhoto ? <PhotoImage uri={yearAgoPhoto} style={StyleSheet.absoluteFill} /> : null}
            <View style={[styles.flashbackShade, !yearAgoPhoto && { backgroundColor: colors.primary }]} />
            <View style={styles.flashbackBody}>
              <Text style={styles.flashbackKicker}>
                {yearAgo.years === 1 ? 'A YEAR AGO TODAY' : `${yearAgo.years} YEARS AGO TODAY`} ·{' '}
                {yearAgoDate.getFullYear()}
              </Text>
              {yearAgoLine && (
                <Text numberOfLines={2} style={[styles.flashbackLine, rtlIfArabic(yearAgoLine)]}>
                  {yearAgoLine}
                </Text>
              )}
              {yearAgo.item && (
                <View style={styles.flashbackWorld}>
                  <MaterialCommunityIcons name={topicIcon(yearAgo.item.topic) as any} size={14} color={colors.accent} />
                  <Text numberOfLines={2} style={styles.flashbackWorldText}>
                    That day: {yearAgo.item.headline}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        )}

        {/* A quiet break between the flashback and the days. */}
        {yearAgo && (
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>YOUR DAYS</Text>
            <View style={styles.sectionLine} />
          </View>
        )}

        {monthBuckets.map((b, i) => renderMonth(b, i === 0))}

        {pastYears.map((year) => {
          const open = expandedYears.has(year);
          return (
            <View key={year}>
              <Pressable onPress={() => toggleYear(year)} style={styles.banner}>
                <View style={styles.bannerIcon}>
                  <MaterialCommunityIcons name="calendar-outline" size={22} color={colors.teal} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerLabel}>{year}</Text>
                  <Text style={styles.bannerSub}>A full year</Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#9AA4A5" />
              </Pressable>
              {open && buildYearMonths(year).map((b) => renderMonth(b))}
            </View>
          );
        })}
      </ScrollView>

      {arranging && (
        <View style={styles.arrangeBar} pointerEvents="box-none">
          <Text style={styles.arrangeHint}>Slide a topic — it moves on every day</Text>
          <Pressable style={styles.arrangeDone} onPress={() => setArranging(false)}>
            <Text style={styles.arrangeDoneText}>Done</Text>
          </Pressable>
        </View>
      )}

      <MixSheet
        visible={mixOpen}
        onClose={(changed) => {
          setMixOpen(false);
          if (changed) {
            setFeeds({});
            loadTopics();
          }
        }}
      />
      <MoreSheet target={more} onClose={() => setMore(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Above the + button and the bar.
  arrangeBar: { position: 'absolute', left: 0, right: 0, bottom: 176, alignItems: 'center', gap: 10 },
  arrangeHint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.white,
    backgroundColor: 'rgba(8,17,18,0.75)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  arrangeDone: { backgroundColor: colors.accent, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 42 },
  arrangeDoneText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
  safe: { flex: 1, backgroundColor: colors.white },
  page: { flex: 1, backgroundColor: colors.pale },

  day: { paddingTop: 20, paddingBottom: 6 },
  // The reference: weekday on the left, "Today" between, the date stacked
  // on the right — aligned with the card edges below.
  dayHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE + 6, marginBottom: 12 },
  dayWeekday: { flex: 1, fontFamily: fonts.bold, fontSize: 22, color: colors.primary },
  todayPill: {
    backgroundColor: colors.muted,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  todayPillText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink },
  // Weekday and date take equal sides, so "Today" sits in the middle.
  dayDate: { flex: 1, alignItems: 'flex-end' },
  dayMonth: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 17, color: colors.primary, letterSpacing: 0.5 },
  dayNum: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 28, color: colors.primary },

  guessBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slate,
    backgroundColor: colors.pale,
    borderRadius: 16,
    padding: 12,
  },
  guessHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  guessTitle: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
  guessText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#324547', marginTop: 8 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: SIDE + 6, marginTop: 28 },
  sectionLabel: { fontFamily: fonts.semiBold, fontSize: 11, letterSpacing: 1, color: colors.teal },
  sectionLine: { flex: 1, height: 1, backgroundColor: '#B7C8CA' },

  card: {
    height: CARD_H,
    backgroundColor: colors.white,
    borderRadius: 24,
    overflow: 'hidden',
  },
  media: { height: MEDIA_H, backgroundColor: '#EEF3F3' },
  mediaEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF3F3' },
  mediaTag: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  mediaTagText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.ink },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  // Cards are a fixed height; nothing may spill into the footer.
  clipBody: { overflow: 'hidden' },
  kicker: { fontFamily: fonts.semiBold, fontSize: 11, letterSpacing: 1, color: colors.teal, marginBottom: 10 },
  lineRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  // Still laid out (so it stays measured), just not seen.
  lineHidden: { opacity: 0 },
  lineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal, marginTop: 8 },
  lineText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#3E4647' },
  muted: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#8B9394' },

  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: colors.pale,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  topicChipText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.teal },
  headline: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 24, color: '#1B1B1B', marginTop: 10 },
  summary: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#5B6364', marginTop: 6 },

  footer: {
    height: 58,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F0F2F2',
  },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnOn: { backgroundColor: colors.primary },
  likedText: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal, flexShrink: 1 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.pale,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  actionText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },

  faces: { flexDirection: 'row', alignItems: 'center' },
  face: { borderRadius: 16, borderWidth: 2, borderColor: colors.white },
  moreFaces: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.teal, marginLeft: 6 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, maxWidth: '55%' },
  placeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal, flexShrink: 1 },

  quietCard: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  quietIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  quietTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B', textAlign: 'center', marginTop: 6 },
  quietText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: '#8B9394',
    textAlign: 'center',
    marginTop: 6,
  },

  skeleton: { backgroundColor: '#EEF3F3' },
  skelLine: { height: 12, borderRadius: 6, backgroundColor: '#EEF3F3', marginTop: 10 },

  flashback: {
    marginHorizontal: SIDE,
    marginTop: 18,
    height: 190,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  flashbackShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,17,18,0.45)' },
  flashbackBody: { padding: 18 },
  flashbackKicker: { fontFamily: fonts.semiBold, fontSize: 11, letterSpacing: 1, color: colors.accent },
  flashbackLine: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 24, color: colors.white, marginTop: 6 },
  flashbackWorld: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 },
  flashbackWorldText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.9)',
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: SIDE,
    marginTop: 14,
    padding: 14,
    backgroundColor: colors.white,
    borderRadius: 18,
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.primary },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,18,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 34,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDE2E2', alignSelf: 'center', marginBottom: 18 },
  sheetTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B' },
  sheetSub: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', marginTop: 3 },
  event: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F2F2' },
  eventThumb: { width: 72, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: '#EEF3F3' },
  eventHeadline: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: '#1B1B1B' },
  eventSummary: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#5B6364', marginTop: 4 },
});

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(OnThisDay);
