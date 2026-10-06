import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import PhotoImage from '../src/components/PhotoImage';
import ScreenHeader from '../src/components/ScreenHeader';
import TopicActionSheet from '../src/components/TopicActionSheet';
import FollowSheet from '../src/components/FollowSheet';
import PersonAvatar from '../src/components/PersonAvatar';
import TopicSwapSheet from '../src/components/TopicSwapSheet';
import { placePhoto } from '../src/images';
import { useMemoryPolish } from '../src/memoryIntake';
import { MonthBucket, buildMonthBuckets, buildPastYears, buildYearMonths } from '../src/monthBuckets';

// Same smooth expand/collapse as the Timeline rail.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateList = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
import { learnFollows } from '../src/follows';
import { getAllGuesses, type GuessesByDay } from '../src/guessedPeople';
import { LoggedMemory, dateKey, getMemoriesByDay, memoryDisplayText } from '../src/memoryLog';
import { getAllDayPeople, getAllPersonMeta } from '../src/peopleTags';
import { getAllPhotoSources } from '../src/photoMeta';
import { SOURCE_LABEL_STYLES, type AnySourceKey } from '../src/photoSource';
import { getAllDayPlaces, type DayPlace } from '../src/places';
import {
  Topic,
  TopicItem,
  TopicKey,
  getDayFeed,
  getInterestTopics,
  getTopicEvents,
  topicIcon,
  getTopicInterests,
  swapTopic,
} from '../src/onThisDay';
import { rtlIfArabic } from '../src/transcription';
import { colors, fonts } from '../src/theme';
import { withAppNav } from '../src/components/AppNav';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Future days first (top), then today, then back into the past — same
// year-back structure as the Timeline rail: current month expanded
// day-by-day, then 11 prior months collapsed into tappable banners.
const FUTURE_OFFSETS = [4, 3, 2, 1];

const CARD_W = 250;
const CARD_GAP = 12;

function dateFor(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

// What the user actually logged that day — no placeholders. A camera
// photo is preferred for the picture; a day with only screenshots or saved
// images shows one of those, labelled for what it is, because it is not a
// photo *from* that day.
function memoryContent(real: LoggedMemory[], sources: Record<string, string>) {
  const texts = real.map(memoryDisplayText).filter(Boolean) as string[];
  const uris = real.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []);
  const camera = uris.find((u) => !sources[u]);
  const saved = camera ? undefined : uris.find((u) => sources[u]);
  if (texts.length === 0 && !camera && !saved) return null;
  return {
    lines: texts.slice(0, 3),
    photoUri: camera ?? saved,
    /** Set when the picture is a screenshot or saved from an app. */
    savedFrom: saved ? (sources[saved] as AnySourceKey) : undefined,
  };
}

/** Everything about a day the Memory card shows besides what was logged. */
export type DayCompany = {
  people: string[];
  /** Recognised by face, not confirmed — drawn as the guesses they are. */
  guessed: string[];
  photos: Record<string, string | undefined>;
  place?: string;
};

const SLOTS = 6;

// The six circles under the photo: who was there, then ⊕ for the slots
// nobody fills — the same grid the design gives an empty day.
function PeopleGrid({ company }: { company: DayCompany }) {
  const all = [
    ...company.people.map((name) => ({ name, guess: false })),
    ...company.guessed.map((name) => ({ name, guess: true })),
  ];
  const overflow = all.length > SLOTS;
  const shown = all.slice(0, overflow ? SLOTS - 1 : SLOTS);
  const empty = SLOTS - shown.length - (overflow ? 1 : 0);
  return (
    <View style={styles.plusGrid}>
      {shown.map((p) => (
        <PersonAvatar key={p.name} name={p.name} photoUri={company.photos[p.name]} size={24} unconfirmed={p.guess} />
      ))}
      {overflow && (
        <View style={styles.moreSlot}>
          <Text style={styles.moreText}>+{all.length - shown.length}</Text>
        </View>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <Ionicons key={`e${i}`} name="add-circle-outline" size={24} color={colors.teal} />
      ))}
    </View>
  );
}

function MemoryCard({
  offset,
  real,
  future,
  company,
  sources,
}: {
  offset: number;
  real: LoggedMemory[];
  future: boolean;
  company: DayCompany;
  sources: Record<string, string>;
}) {
  const router = useRouter();
  const content = future ? null : memoryContent(real, sources);
  const label = content?.savedFrom ? SOURCE_LABEL_STYLES[content.savedFrom] : undefined;
  const noPeople = company.people.length + company.guessed.length === 0;

  return (
    <Pressable
      style={[styles.card, styles.memoryCard]}
      onPress={() => (future ? undefined : router.push(`/day/${offset}` as any))}
    >
      <View style={styles.memoryTop}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.cardTitle}>Memories</Text>
          {future ? (
            <Text style={styles.futureText}>We can’t predict the Future…</Text>
          ) : content ? (
            content.lines.length > 0 ? (
              content.lines.map((line, i) => (
                <View key={i} style={styles.memoryLineRow}>
                  <View style={styles.memoryDot} />
                  <Text numberOfLines={2} style={[styles.memoryLine, rtlIfArabic(line)]}>
                    {line}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.futureText}>
                {!content.savedFrom
                  ? 'Photos from this day.'
                  : content.savedFrom === 'screenshot'
                    ? 'A screenshot you took this day.'
                    : `${label?.text ?? 'Saved'} this day.`}
              </Text>
            )
          ) : (
            <Text style={styles.futureText}>{noPeople ? 'Nothing logged this day…' : 'No notes this day.'}</Text>
          )}
        </View>

        {/* The picture, then who was there in the six slots under it. */}
        <View style={styles.cardMedia}>
          {content?.photoUri ? (
            <View>
              <PhotoImage uri={content.photoUri} style={styles.photo} />
              {label && (
                <View style={[styles.sourcePill, { backgroundColor: label.bg }]}>
                  <MaterialCommunityIcons
                    name={content.savedFrom === 'screenshot' ? 'cellphone-screenshot' : 'download-outline'}
                    size={10}
                    color={label.fg}
                  />
                  <Text numberOfLines={1} style={[styles.sourcePillText, { color: label.fg }]}>
                    {content.savedFrom === 'screenshot' ? 'Screenshot' : label.text.replace(/^Saved from /, '')}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.emptyPhoto} />
          )}
          {future ? (
            <View style={styles.plusGrid}>
              {Array.from({ length: SLOTS }).map((_, i) => (
                <Ionicons key={i} name="add-circle-outline" size={24} color={colors.teal} />
              ))}
            </View>
          ) : (
            <PeopleGrid company={company} />
          )}
        </View>
      </View>

      {/* Where — along the bottom. */}
      {!future && company.place && (
        <View style={styles.memoryFoot}>
          <MaterialCommunityIcons name="map-marker-outline" size={13} color={colors.teal} />
          <Text numberOfLines={1} style={styles.placeText}>
            {company.place}
          </Text>
        </View>
      )}
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
      <PhotoImage uri={uri} style={style as any} />
    );
  }
  return (
    <View style={[style as any, styles.topicIconBlock]}>
      <MaterialCommunityIcons
        name={topicIcon(topicKey) as any}
        size={32}
        color={colors.teal}
      />
    </View>
  );
}

// News from a nearby day, said plainly — "2 days before" — so it is never
// mistaken for something that happened on the day itself.
function WhenLabel({ when }: { when: string }) {
  return (
    <View style={styles.whenPill}>
      <MaterialCommunityIcons name="calendar-arrow-left" size={11} color={colors.teal} />
      <Text style={styles.whenText}>{when}</Text>
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
                      {ev.when && <WhenLabel when={ev.when} />}
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
            {item.when && <WhenLabel when={item.when} />}
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
              {interest ? `Following ${interest}` : `What you follow in ${label}`}
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

function OnThisDay() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [feeds, setFeeds] = useState<Record<string, TopicItem[]>>({});
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [swapTarget, setSwapTarget] = useState<Topic | null>(null);

  // What the user follows per topic ("Al Ahly, Premier League…") and the
  // sheet that shows and edits it.
  const [interests, setInterests] = useState<Partial<Record<TopicKey, string>>>({});
  const [tuneTarget, setTuneTarget] = useState<Topic | null>(null);

  // Who and where each day, for the Memory cards.
  const [dayPeople, setDayPeople] = useState<Record<string, string[]>>({});
  const [guesses, setGuesses] = useState<GuessesByDay>({});
  const [personPhotos, setPersonPhotos] = useState<Record<string, string | undefined>>({});
  const [dayPlaces, setDayPlaces] = useState<Record<string, DayPlace[]>>({});
  // Which pictures are screenshots or saved from apps, not camera photos.
  const [photoSources, setPhotoSources] = useState<Record<string, string>>({});

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
      Promise.all([getAllDayPeople(), getAllGuesses()]).then(([people, guessed]) => {
        setDayPeople(people);
        setGuesses(guessed);
        const today = dateKey(new Date());
        console.log(
          `[otd] people on ${today}: ${(people[today] ?? []).length} tagged, ${(guessed[today] ?? []).length} recognised; ${Object.keys(people).length} days have someone tagged`,
        );
      });
      getAllDayPlaces().then(setDayPlaces);
      Promise.all([getAllPhotoSources(), getMemoriesByDay()]).then(([sources, days]) => {
        setPhotoSources(sources);
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const uris = (days.get(dateKey(y)) ?? []).flatMap((m) => m.photoUris ?? []);
        const marked = uris.filter((u) => sources[u]).map((u) => sources[u]);
        console.log(`[otd] yesterday's pictures: ${uris.length}, of them ${marked.length} not from the camera (${marked.join(', ') || 'none'})`);
      });
      getAllPersonMeta().then((meta) =>
        setPersonPhotos(Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, m.photoUri]))),
      );
      // Quietly read new memories for what the user follows; when something
      // new turns up, the feeds are refetched with it.
      learnFollows().then((added) => {
        if (added > 0) followsChanged();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Follows changed (added, removed or learned): the day feeds and any
  // expanded events were searched for the old ones.
  const followsChanged = async () => {
    setInterests(await getTopicInterests());
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
          <MemoryCard
            offset={offset}
            real={real}
            future={future}
            sources={photoSources}
            company={{
              people: dayPeople[key] ?? [],
              guessed: (guesses[key] ?? [])
                .map((g) => g.name)
                .filter((n) => !(dayPeople[key] ?? []).some((p) => p.toLowerCase() === n.toLowerCase())),
              photos: personPhotos,
              place: (dayPlaces[key] ?? []).find((p) => p.named)?.label ?? dayPlaces[key]?.[0]?.label,
            }}
          />
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

      <FollowSheet
        topic={tuneTarget}
        onClose={(changed) => {
          setTuneTarget(null);
          if (changed) followsChanged();
        }}
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
    flex: 1,
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

  // The Memory card stacks: what was logged and the photo, then who/where.
  memoryCard: { flexDirection: 'column' },
  memoryTop: { flexDirection: 'row', flex: 1 },
  memoryLineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  memoryDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal, marginTop: 7 },
  memoryFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F2',
  },
  moreSlot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { fontFamily: fonts.semiBold, fontSize: 9, color: colors.primary },
  // The app's own source label (src/photoSource.ts), small, on the photo.
  sourcePill: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  sourcePillText: { fontFamily: fonts.semiBold, fontSize: 9 },
  placeText: { flex: 1, fontFamily: fonts.medium, fontSize: 11, color: colors.teal },

  whenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.pale,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  whenText: { fontFamily: fonts.medium, fontSize: 10, color: colors.teal },
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

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(OnThisDay);
