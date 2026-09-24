import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  LayoutChangeEvent,
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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import AnalyzingBanner from '../../src/components/AnalyzingBanner';
import PeopleEditor from '../../src/components/PeopleEditor';
import { approveGuess, getGuessesForDay, rejectGuess } from '../../src/guessedPeople';
import PhotoTile from '../../src/components/PhotoTile';
import {
  AssumedMemory,
  assumedMemoryAvailable,
  dayLoggedText,
  dismissAssumedMemory,
  getAssumedMemory,
  getCachedAssumedMemory,
  onAssumedMemoryUpdated,
  translateAssumedMemory,
  isAssumedMemoryDismissed,
} from '../../src/assumedMemory';
import { MONTHS_SHORT, WEEKDAYS, dateWithOffset, shortDate } from '../../src/data';
import { useMemoryPolish } from '../../src/memoryIntake';
import { MonthBucket, buildMonthBuckets, buildPastYears, buildYearMonths } from '../../src/monthBuckets';
import { getAllPhotoSources, getPhotoTimestamps } from '../../src/photoMeta';

// Smooth, native-driven expand/collapse for the rail — one line before each
// toggle's setState instead of hand-rolled height animations.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateRail = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
import {
  LoggedMemory,
  dateKey,
  formatClockTime,
  getMemoriesByDay,
  memoryDisplayText,
} from '../../src/memoryLog';
import { Topic, TopicItem, TopicKey, getDayFeed, getInterestTopics, swapTopic } from '../../src/onThisDay';
import {
  addPersonForDay,
  getAllTaggedPeople,
  getPeopleForDay,
  removePersonForDay,
} from '../../src/peopleTags';
import { DetectedPlace, getPlacesForDay } from '../../src/placesFromPhotos';
import { rtlIfArabic } from '../../src/transcription';
import TopicSwapSheet from '../../src/components/TopicSwapSheet';
import { colors, fonts } from '../../src/theme';

const TOPIC_ICONS: Record<string, string> = {
  sports: 'soccer',
  music: 'music-note',
  news: 'newspaper-variant-outline',
  movies: 'movie-open-outline',
  design: 'palette-outline',
  travel: 'airplane',
  books: 'book-open-variant',
};

// Compact version of the On This Day topic card, sized to fit the canvas.
function MiniTopicCard({
  topic,
  item,
  future,
  loading,
  onFeedback,
}: {
  topic: Topic;
  item?: TopicItem;
  future: boolean;
  loading: boolean;
  onFeedback: () => void;
}) {
  return (
    <View style={styles.miniTopicCard}>
      <View style={styles.miniTopicHeader}>
        <Text style={styles.miniTopicLabel}>{topic.label}</Text>
        {!future && (
          <Pressable hitSlop={10} onPress={onFeedback}>
            <Ionicons name="ellipsis-horizontal-circle-outline" size={16} color="#B9BEBF" />
          </Pressable>
        )}
      </View>
      {future ? (
        <Text style={styles.miniTopicMuted}>We can’t predict the Future…</Text>
      ) : loading ? (
        <Text style={styles.miniTopicMuted}>Looking this day up…</Text>
      ) : item ? (
        <>
          <Text style={styles.miniTopicHeadline} numberOfLines={2}>
            {item.headline}
          </Text>
          <Text style={styles.miniTopicSummary} numberOfLines={3}>
            {item.summary}
          </Text>
        </>
      ) : (
        <Text style={styles.miniTopicMuted}>Nothing found for this day.</Text>
      )}
    </View>
  );
}

// Rail shows a few future days, then the current month expanded day-by-day,
// then a year of prior months collapsed into tappable squares.
const FUTURE_OFFSETS = [3, 2, 1];

// One rail day cell — used for the near-future days and every day inside an
// expanded month.
function DayCell({
  offset,
  isSelected,
  onPress,
}: {
  offset: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const d = dateWithOffset(offset);
  return (
    <Pressable onPress={onPress} style={[styles.railCell, isSelected && styles.railCellSelected]}>
      {isSelected && (
        <View style={styles.railWeekdayWrap}>
          <Text numberOfLines={1} style={styles.railWeekday}>
            {WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.railMonth}>{MONTHS_SHORT[d.getMonth()]}</Text>
        <Text style={styles.railDay}>{String(d.getDate()).padStart(2, '0')}</Text>
      </View>
    </Pressable>
  );
}

// Fixed-size 2D canvas the user can pan around, like a map.
const CANVAS_W = 920;
const CANVAS_H = 1240;

function DottedBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} width={CANVAS_W} height={CANVAS_H}>
      <Defs>
        <Pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <Circle cx="2" cy="2" r="1.2" fill="#C9CDCE" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

// Fixed card positions on the canvas. Heights are measured at runtime so
// connectors can anchor to the exact center of each card edge.
const CARD_POS = {
  people: { x: 40, y: 72, w: 240 },
  photo: { x: 440, y: 44, w: 410 },
  day: { x: 30, y: 330, w: 340 },
  places: { x: 470, y: 330, w: 410 },
  otd: { x: 180, y: 780, w: 400 },
  // Deliberately unconnected — this is a floating AI guess, not part of the
  // people/day/places/otd chain of real logged content.
  assumed: { x: 610, y: 780, w: 290 },
} as const;

type Point = { x: number; y: number };

// Dashed elbow connector between two card-edge midpoints, with a dot at each
// end. `axis` is the direction the line leaves the first card: 'v' exits
// through a top/bottom edge, 'h' through a left/right edge.
function Elbow({ from, to, axis }: { from: Point; to: Point; axis: 'v' | 'h' }) {
  const segs: { x: number; y: number; len: number; vertical: boolean }[] = [];
  if (axis === 'v') {
    const ym = (from.y + to.y) / 2;
    segs.push({ x: from.x, y: Math.min(from.y, ym), len: Math.abs(ym - from.y), vertical: true });
    segs.push({ x: Math.min(from.x, to.x), y: ym, len: Math.abs(to.x - from.x), vertical: false });
    segs.push({ x: to.x, y: Math.min(ym, to.y), len: Math.abs(to.y - ym), vertical: true });
  } else {
    const xm = (from.x + to.x) / 2;
    segs.push({ x: Math.min(from.x, xm), y: from.y, len: Math.abs(xm - from.x), vertical: false });
    segs.push({ x: xm, y: Math.min(from.y, to.y), len: Math.abs(to.y - from.y), vertical: true });
    segs.push({ x: Math.min(xm, to.x), y: to.y, len: Math.abs(to.x - xm), vertical: false });
  }
  return (
    <>
      {segs
        .filter((s) => s.len > 0.5)
        .map((s, i) => (
          <View
            key={i}
            style={[
              styles.dash,
              s.vertical
                ? { left: s.x - 1, top: s.y, height: s.len, borderLeftWidth: 2 }
                : { left: s.x, top: s.y - 1, width: s.len, borderTopWidth: 2 },
            ]}
          />
        ))}
      <View style={[styles.dashDot, { left: from.x - 5, top: from.y - 5 }]} />
      <View style={[styles.dashDot, { left: to.x - 5, top: to.y - 5 }]} />
    </>
  );
}



const MAX_SCALE = 2.5;
const MIN_SCALE = 0.2;

export default function Timeline() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());

  // The current calendar year's months, current month expanded by default,
  // the rest collapsed into tappable tiles — then whole prior years
  // collapse into single tiles until opened.
  const monthBuckets = useMemo(() => buildMonthBuckets(), []);
  const pastYears = useMemo(() => buildPastYears(), []);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set(monthBuckets[0] ? [monthBuckets[0].key] : []),
  );
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => new Set());
  const toggleMonth = (key: string) => {
    animateRail();
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleYear = (year: number) => {
    animateRail();
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  // Measured card heights, used to anchor connectors to edge midpoints.
  const [cardH, setCardH] = useState<Record<string, number>>({});
  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setCardH((prev) => (prev[key] === h ? prev : { ...prev, [key]: h }));
  };

  // Free pan + pinch-zoom over the canvas, clamped so the canvas always
  // covers the viewport. Transform order is [translate, scale], so with the
  // scale pivoting on the canvas center the on-screen top-left sits at
  // translate + (1 - scale) * size / 2 — the clamp accounts for that.
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const clampAll = () => {
    'worklet';
    if (sc.value < MIN_SCALE) sc.value = MIN_SCALE;
    if (sc.value > MAX_SCALE) sc.value = MAX_SCALE;
    const s = sc.value;

    // When zoomed out far enough that the canvas is smaller than the
    // viewport on an axis, center it on that axis instead of letting it
    // slide around inside empty space.
    const offX = ((1 - s) * CANVAS_W) / 2;
    const scaledW = CANVAS_W * s;
    if (scaledW <= vw.value) {
      tx.value = (vw.value - scaledW) / 2 - offX;
    } else {
      const minTx = vw.value - scaledW - offX;
      const maxTx = -offX;
      tx.value = Math.min(maxTx, Math.max(minTx, tx.value));
    }

    const offY = ((1 - s) * CANVAS_H) / 2;
    const scaledH = CANVAS_H * s;
    if (scaledH <= vh.value) {
      ty.value = (vh.value - scaledH) / 2 - offY;
    } else {
      const minTy = vh.value - scaledH - offY;
      const maxTy = -offY;
      ty.value = Math.min(maxTy, Math.max(minTy, ty.value));
    }
  };

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
      clampAll();
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = sc.value;
    })
    .onUpdate((e) => {
      sc.value = startScale.value * e.scale;
      clampAll();
    });

  const canvasGesture = Gesture.Simultaneous(pan, pinch);

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }],
  }));

  const onViewportLayout = (e: LayoutChangeEvent) => {
    vw.value = e.nativeEvent.layout.width;
    vh.value = e.nativeEvent.layout.height;
  };

  // Re-read logged memories whenever the screen regains focus so a memory
  // saved from the "+" button shows up immediately.
  const [places, setPlaces] = useState<DetectedPlace[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<string[]>([]);
  // Who the app thinks was there, from the faces in that day's photos.
  // Drawn beside the confirmed names with a dashed ring and a question
  // mark, so a guess never passes for something the user recorded.
  const [guessed, setGuessed] = useState<{ name: string }[]>([]);
  const reloadDay = useCallback(() => {
    const key = dateKey(dateWithOffset(selected));
    getMemoriesByDay().then(setByDay);
    getPlacesForDay(key).then(setPlaces);
    getPeopleForDay(key).then(setPeople);
    getGuessesForDay(key).then((g) => setGuessed(g.map((x) => ({ name: x.name }))));
  }, [selected]);

  useFocusEffect(
    useCallback(() => {
      const key = dateKey(dateWithOffset(selected));
      getMemoriesByDay().then(setByDay);
      getInterestTopics().then(setOtdTopics);
      getPlacesForDay(key).then(setPlaces);
      getPeopleForDay(key).then(setPeople);
      getAllTaggedPeople().then(setPeopleSuggestions);
      getGuessesForDay(key).then((g) => setGuessed(g.map((x) => ({ name: x.name }))));
    }, [selected]),
  );

  // Sweep up any memory the AI hasn't polished/routed yet (older logs, or
  // ones whose analysis failed) and refresh what's on screen when it does.
  const analyzing = useMemoryPolish(reloadDay);

  const dayKey = dateKey(dateWithOffset(selected));
  const addPerson = async (name: string) => {
    await addPersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
    setPeopleSuggestions(await getAllTaggedPeople());
  };
  const removePerson = async (name: string) => {
    await removePersonForDay(dayKey, name);
    setPeople(await getPeopleForDay(dayKey));
  };

  // Settling a guess. Yes makes it the user's own data, no is remembered so
  // the same face is not offered for the same day again. Either way it
  // disappears from every screen at once, because they all read one store.
  const confirmGuess = async (name: string) => {
    await approveGuess(dayKey, name);
    reloadDay();
    setPeople(await getPeopleForDay(dayKey));
  };
  const dismissGuess = async (name: string) => {
    await rejectGuess(dayKey, name);
    reloadDay();
  };

  const date = dateWithOffset(selected);
  const weekday = WEEKDAYS[date.getDay()];

  // On This Day feed for the selected day — same live data as the full page,
  // shown here as a smaller swipeable card. Cached per day so switching
  // between recently-viewed days doesn't refetch.
  const [otdTopics, setOtdTopics] = useState<Topic[]>([]);
  const [otdFeeds, setOtdFeeds] = useState<Record<string, TopicItem[]>>({});
  const [otdLoading, setOtdLoading] = useState(false);
  const [otdSwapTarget, setOtdSwapTarget] = useState<Topic | null>(null);
  const otdFuture = selected > 0;
  const otdKey = dateKey(date);
  const otdFeed = otdFeeds[otdKey];

  useEffect(() => {
    if (otdTopics.length === 0 || otdFuture || otdFeed) return;
    let cancelled = false;
    setOtdLoading(true);
    getDayFeed(date, otdTopics).then((items) => {
      if (!cancelled) {
        setOtdFeeds((prev) => ({ ...prev, [otdKey]: items }));
        setOtdLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [otdTopics, otdKey, otdFuture]);

  const handleOtdSwap = async (newKey: TopicKey) => {
    if (!otdSwapTarget) return;
    const next = await swapTopic(otdSwapTarget.key, newKey);
    setOtdSwapTarget(null);
    setOtdFeeds({});
    setOtdTopics(next);
  };

  // Real memories the user logged for the selected day.
  const real = byDay.get(dateKey(date)) ?? [];
  const texts = real.filter((m) => m.kind === 'text');
  const voices = real.filter((m) => m.kind === 'voice');
  const photoMemories = real.filter((m) => m.kind === 'photo');
  const realPhotoUris = photoMemories.flatMap((m) => m.photoUris ?? []);
  // What the user already wrote/said themselves, if anything — handed to
  // the assumed-memory analysis so it complements rather than duplicates.
  // Derived through the shared helper so this screen, the Day screen and
  // the background pass all produce the same cache signature.
  const loggedTextForAssumed = dayLoggedText(real);

  // Assumed Memory — a floating, read-only AI guess at the day built from
  // its photos alone, for whichever day is currently selected. Lazy: only
  // the day actually open gets analyzed (never the whole photo library),
  // and results are cached per day inside assumedMemory.ts so reopening a
  // day already seen costs nothing.
  const [assumedMemory, setAssumedMemory] = useState<AssumedMemory | null>(null);
  const [assumedDismissed, setAssumedDismissed] = useState(false);
  // 'idle' — nothing to show (no photos, or feature unavailable).
  // 'loading' — a fetch for this exact day is in flight.
  // 'ready' — assumedMemory holds the result.
  // 'failed' — a real attempt was made and came back with nothing (rate
  // limited, offline, etc.) — distinct from "hasn't been tried yet" so the
  // card can offer a retry instead of just silently showing nothing.
  const [assumedStatus, setAssumedStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  // 'en' shows the original; any other code shows that cached translation
  // once fetched. Arabic only for now — see ASSUMED_MEMORY_LANGUAGES.
  const [assumedLang, setAssumedLang] = useState<'en' | 'ar'>('en');
  const [translating, setTranslating] = useState(false);
  const photoUrisKey = realPhotoUris.join('|');

  // One fetch attempt for the currently-selected day — pulled out of the
  // effect below so the retry button can call the exact same logic on
  // demand instead of only ever running automatically.
  const fetchAssumed = useCallback(
    async (targetDay: string, uris: string[], loggedText: string) => {
      if (uris.length === 0 || !assumedMemoryAvailable()) {
        setAssumedStatus('idle');
        return;
      }
      setAssumedStatus('loading');
      const timestamps = await getPhotoTimestamps(uris);
      const sources = await getAllPhotoSources();
      const photos = uris
        .filter((uri) => timestamps[uri])
        .map((uri) => ({ uri, takenAt: timestamps[uri], source: sources[uri] }));
      if (photos.length === 0) {
        setAssumedStatus('idle');
        return;
      }
      const record = await getAssumedMemory(targetDay, photos, loggedText || undefined);
      // The user may have moved to a different day while this was in
      // flight — never let a stale response paint over what's now shown.
      if (targetDay !== dayKeyRef.current) return;
      if (!record) {
        setAssumedStatus('failed');
        return;
      }
      const dismissed = await isAssumedMemoryDismissed(targetDay, record.signature);
      if (targetDay !== dayKeyRef.current) return;
      setAssumedMemory(record);
      setAssumedDismissed(dismissed);
      setAssumedStatus('ready');
    },
    [],
  );

  const dayKeyRef = useRef(dayKey);
  dayKeyRef.current = dayKey;

  useEffect(() => {
    setAssumedMemory(null);
    setAssumedDismissed(false);
    setAssumedStatus('idle');
    setAssumedLang('en');
    fetchAssumed(dayKey, realPhotoUris, loggedTextForAssumed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, photoUrisKey, loggedTextForAssumed]);

  const retryAssumed = () => fetchAssumed(dayKey, realPhotoUris, loggedTextForAssumed);


  // A day analyzed by the background pass appears here on its own — no
  // need to tap the day to make it show up.
  useEffect(() => {
    return onAssumedMemoryUpdated(async (updatedDay) => {
      if (updatedDay !== dayKey) return;
      const record = await getCachedAssumedMemory(updatedDay);
      if (!record) return;
      setAssumedMemory(record);
      setAssumedDismissed(await isAssumedMemoryDismissed(updatedDay, record.signature));
    });
  }, [dayKey]);

  const dismissAssumed = () => {
    if (!assumedMemory) return;
    setAssumedDismissed(true);
    dismissAssumedMemory(dayKey, assumedMemory.signature);
  };

  // Toggles between the original and the Arabic translation, fetching (and
  // caching, inside assumedMemory.ts) the translation only the first time.
  const toggleAssumedLang = async () => {
    if (!assumedMemory) return;
    if (assumedLang === 'ar') {
      setAssumedLang('en');
      return;
    }
    if (assumedMemory.translations?.ar) {
      setAssumedLang('ar');
      return;
    }
    setTranslating(true);
    const translated = await translateAssumedMemory(dayKey, assumedMemory, 'ar');
    setTranslating(false);
    if (!translated) return;
    setAssumedMemory((prev) =>
      prev ? { ...prev, translations: { ...prev.translations, ar: translated } } : prev,
    );
    setAssumedLang('ar');
  };
  const photoCaptions = photoMemories.map((m) => m.text).filter(Boolean) as string[];

  // Voice transcripts read like any other note on the day card — a
  // recording still being written up contributes its own pending line
  // rather than blanking the whole card.
  const bullets = [
    ...texts.map((t) => memoryDisplayText(t)),
    ...voices.map((v) => memoryDisplayText(v)),
    ...photoCaptions,
  ].filter(Boolean) as string[];

  const latestVoice = voices[voices.length - 1];
  // How this day was logged, as icons only. It used to be a sentence
  // ("Recorded by voice on 9/3/2026 at 11:29 pm"), which was too much for a
  // card this small and wrong for a day logged more than one way — a voice
  // note in the morning and a typed one at night would need two sentences.
  // The icons just mark which methods were used and open the Source page.
  const captureMethods: { key: string; icon: 'microphone-outline' | 'keyboard-outline' }[] = [
    ...(voices.length > 0 ? [{ key: 'voice', icon: 'microphone-outline' as const }] : []),
    ...(texts.length > 0 ? [{ key: 'typed', icon: 'keyboard-outline' as const }] : []),
  ];

  const latestPhotoMemory = photoMemories[photoMemories.length - 1];
  const showDayCard = bullets.length > 0 || !!latestVoice;
  const showPhotoLib = realPhotoUris.length > 0;
  const showPlaces = places.length > 0;
  // A day with only guesses on it still has people on it — that is the
  // whole point of the app noticing. Requiring a confirmed name here would
  // have hidden every face it found until the user had already done the
  // work themselves.
  const showPeople = people.length > 0 || guessed.length > 0;
  const hasContent =
    showDayCard || showPhotoLib || showPlaces || showPeople || (!otdFuture && otdTopics.length > 0);

  // One flat rail tile — a month (or, nested inside an opened year, still a
  // month) collapsed to its label, or expanded into a small header plus its
  // day cells. Reused for the current year's list and for any year opened
  // below it, so both read as the same rail. The live current month skips
  // the header entirely — it's always open and isn't a "past month" you'd
  // ever collapse, so the dropdown affordance would be meaningless there.
  const renderMonthBucket = (bucket: MonthBucket, isCurrent = false) => {
    if (isCurrent) {
      return (
        <View key={bucket.key}>
          {bucket.offsets.map((offset) => (
            <DayCell
              key={offset}
              offset={offset}
              isSelected={offset === selected}
              onPress={() => setSelected(offset)}
            />
          ))}
        </View>
      );
    }

    const isExpanded = expandedMonths.has(bucket.key);

    if (!isExpanded) {
      return (
        <Pressable key={bucket.key} onPress={() => toggleMonth(bucket.key)} style={styles.railCell}>
          <Text style={styles.railTileLabel}>{bucket.label}</Text>
        </Pressable>
      );
    }

    return (
      <View key={bucket.key}>
        <Pressable onPress={() => toggleMonth(bucket.key)} style={styles.railHeaderRow}>
          <Text style={styles.railHeaderText}>{bucket.label}</Text>
          <Ionicons name="chevron-down" size={13} color="#8B9394" />
        </Pressable>
        {bucket.offsets.map((offset) => (
          <DayCell
            key={offset}
            offset={offset}
            isSelected={offset === selected}
            onPress={() => setSelected(offset)}
          />
        ))}
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.push('/home')} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Timeline</Text>
      </View>

      {/* Floats above the pannable canvas so it's visible regardless of
          scroll/zoom position */}
      {analyzing && (
        <View style={styles.analyzingFloat}>
          <AnalyzingBanner />
        </View>
      )}

      <View style={styles.bodyRow}>
        {/* Date rail — near-future days, current month expanded, then a
            year of prior months collapsed into squares until tapped open */}
        <ScrollView style={styles.rail} showsVerticalScrollIndicator={false}>
          {FUTURE_OFFSETS.map((offset) => (
            <DayCell
              key={offset}
              offset={offset}
              isSelected={offset === selected}
              onPress={() => setSelected(offset)}
            />
          ))}

          {monthBuckets.map((bucket, i) => renderMonthBucket(bucket, i === 0))}

          {pastYears.map((year) => {
            const isExpanded = expandedYears.has(year);

            if (!isExpanded) {
              return (
                <Pressable key={year} onPress={() => toggleYear(year)} style={styles.railCell}>
                  <Text style={styles.railTileLabel}>{year}</Text>
                </Pressable>
              );
            }

            return (
              <View key={year}>
                <Pressable onPress={() => toggleYear(year)} style={styles.railHeaderRow}>
                  <Text style={styles.railHeaderText}>{year}</Text>
                  <Ionicons name="chevron-down" size={13} color="#8B9394" />
                </Pressable>
                {buildYearMonths(year).map((bucket) => renderMonthBucket(bucket))}
              </View>
            );
          })}
        </ScrollView>

        {/* Free-move day canvas: pan any direction + pinch zoom, like a map */}
        <View style={styles.viewport} onLayout={onViewportLayout}>
          <GestureDetector gesture={canvasGesture}>
            <Animated.View style={[{ width: CANVAS_W, height: CANVAS_H }, canvasStyle]}>
              <DottedBackground />

              {hasContent ? (
                <>
                  {/* Connectors — anchored to card-edge midpoints once measured */}
                  {showPhotoLib && showPlaces && cardH.photo && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.photo.x + CARD_POS.photo.w / 2, y: CARD_POS.photo.y + cardH.photo }}
                      to={{ x: CARD_POS.places.x + CARD_POS.places.w / 2, y: CARD_POS.places.y }}
                    />
                  )}
                  {showDayCard && showPlaces && cardH.day && cardH.places && (
                    <Elbow
                      axis="h"
                      from={{ x: CARD_POS.day.x + CARD_POS.day.w, y: CARD_POS.day.y + cardH.day / 2 }}
                      to={{ x: CARD_POS.places.x, y: CARD_POS.places.y + cardH.places / 2 }}
                    />
                  )}
                  {showDayCard && cardH.day && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.day.x + CARD_POS.day.w / 2, y: CARD_POS.day.y + cardH.day }}
                      to={{ x: CARD_POS.otd.x + CARD_POS.otd.w / 2, y: CARD_POS.otd.y }}
                    />
                  )}
                  {showPeople && showDayCard && cardH.people && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.people.x + CARD_POS.people.w / 2, y: CARD_POS.people.y + cardH.people }}
                      to={{ x: CARD_POS.day.x + CARD_POS.day.w / 2, y: CARD_POS.day.y }}
                    />
                  )}

                  {/* People card — names the user has manually tagged for
                      this day (no face recognition; a fast, correctable habit
                      instead). Only appears once someone has been tagged. */}
                  {showPeople && (
                    <View
                      onLayout={measure('people')}
                      style={[
                        styles.card,
                        { left: CARD_POS.people.x, top: CARD_POS.people.y, width: CARD_POS.people.w },
                      ]}
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardTitle}>People</Text>
                        <MaterialCommunityIcons name="account-multiple-outline" size={22} color={colors.primary} />
                      </View>
                      <View style={{ marginTop: 12 }}>
                        <PeopleEditor
                          people={people}
                          suggestions={peopleSuggestions}
                          onAdd={addPerson}
                          onRemove={removePerson}
                          pinSize={48}
                          suggested={guessed}
                          onConfirm={confirmGuess}
                          onDismiss={dismissGuess}
                        />
                      </View>
                    </View>
                  )}

                  {/* Photo Library card — only appears when real photos are logged */}
                  {showPhotoLib && (
                    <View
                      onLayout={measure('photo')}
                      style={[
                        styles.card,
                        { left: CARD_POS.photo.x, top: CARD_POS.photo.y, width: CARD_POS.photo.w },
                      ]}
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardTitle}>Photo Library</Text>
                        <MaterialCommunityIcons
                          name="image-multiple"
                          size={24}
                          color={colors.primary}
                        />
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.thumbRow}
                      >
                        {realPhotoUris.map((uri, i) => (
                          <Pressable
                            key={uri}
                            onPress={() =>
                              router.push({
                                pathname: '/day/[offset]/photos',
                                params: { offset: selected, start: i },
                              })
                            }
                          >
                            <PhotoTile source={{ uri }} />
                          </Pressable>
                        ))}
                      </ScrollView>
                      <View style={styles.syncedRow}>
                        <Ionicons name="link" size={14} color="#8B9394" />
                        <Text style={styles.syncedText}>
                          Added on {shortDate(new Date(latestPhotoMemory!.createdAt))} at{' '}
                          {formatClockTime(new Date(latestPhotoMemory!.createdAt))}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Day summary card — real logged text/voice takes priority */}
                  {showDayCard && (
                    <Pressable
                      onLayout={measure('day')}
                      style={[
                        styles.dayCard,
                        { left: CARD_POS.day.x, top: CARD_POS.day.y, width: CARD_POS.day.w },
                      ]}
                      onPress={() =>
                        router.push(`/day/${selected}` as Parameters<typeof router.push>[0])
                      }
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.dayCardTitle}>
                          {weekday}, {shortDate(date)}
                        </Text>
                        <View style={styles.playBtn}>
                          <Ionicons
                            name="play"
                            size={18}
                            color={colors.white}
                            style={{ marginLeft: 2 }}
                          />
                        </View>
                      </View>
                      <View style={{ marginTop: 10 }}>
                        {bullets.map((line, i) => (
                          <View key={i} style={styles.bulletRow}>
                            <View style={styles.bulletDot} />
                            <Text style={[styles.bulletText, rtlIfArabic(line)]}>{line}</Text>
                          </View>
                        ))}
                      </View>
                      {captureMethods.length > 0 && (
                        <View style={styles.methodRow}>
                          {captureMethods.map((m) => (
                            <Pressable
                              key={m.key}
                              hitSlop={8}
                              onPress={() =>
                                router.push({
                                  pathname: '/day/[offset]/source',
                                  params: { offset: selected },
                                })
                              }
                            >
                              <MaterialCommunityIcons name={m.icon} size={18} color={colors.teal} />
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </Pressable>
                  )}

                  {/* Places card — derived from where the day's photos were
                      actually taken (or live location when logging manually).
                      Only appears once a real place has been detected. */}
                  {showPlaces && (
                    <View
                      onLayout={measure('places')}
                      style={[
                        styles.card,
                        { left: CARD_POS.places.x, top: CARD_POS.places.y, width: CARD_POS.places.w },
                      ]}
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardTitle}>Places</Text>
                        <MaterialCommunityIcons name="map-marker-outline" size={22} color={colors.primary} />
                      </View>
                      <View style={styles.placeGrid}>
                        {places.slice(0, 6).map((place) => (
                          <View key={`${place.label}-${place.latitude ?? 'named'}`} style={styles.placeCell}>
                            <View style={styles.placePin}>
                              <MaterialCommunityIcons name="map-marker" size={30} color={colors.teal} />
                            </View>
                            <Text numberOfLines={1} style={styles.placeCellLabel}>
                              {place.label}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* On This Day card — live topics, horizontally swipeable,
                      same feed as the full On This Day page */}
                  {!otdFuture && otdTopics.length > 0 && (
                    <View
                      onLayout={measure('otd')}
                      style={[
                        styles.card,
                        { left: CARD_POS.otd.x, top: CARD_POS.otd.y, width: CARD_POS.otd.w, padding: 0 },
                      ]}
                    >
                      <View style={[styles.cardHeaderRow, styles.otdCardHeader]}>
                        <Text style={styles.cardTitle}>On This Day</Text>
                        <Pressable onPress={() => router.push('/on-this-day')}>
                          <Ionicons name="expand-outline" size={20} color={colors.primary} />
                        </Pressable>
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={216}
                        decelerationRate="fast"
                        contentContainerStyle={styles.otdScrollContent}
                      >
                        {otdTopics.map((t) => (
                          <MiniTopicCard
                            key={t.key}
                            topic={t}
                            item={otdFeed?.find((i) => i.topic === t.key)}
                            future={false}
                            loading={!otdFeed && otdLoading}
                            onFeedback={() => setOtdSwapTarget(t)}
                          />
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Assumed Memory — floating on purpose (no connector): an
                      AI guess built only from the day's photos, never the
                      user's real logged account. Dismissible; never
                      promoted into the real Day memory. */}
                  {assumedMemory && !assumedDismissed && (
                    <Pressable
                      style={[
                        styles.assumedCard,
                        { left: CARD_POS.assumed.x, top: CARD_POS.assumed.y, width: CARD_POS.assumed.w },
                      ]}
                      onPress={() =>
                        router.push(`/day/${selected}` as Parameters<typeof router.push>[0])
                      }
                    >
                      <View style={styles.cardHeaderRow}>
                        <View style={styles.assumedTitleRow}>
                          <Ionicons name="sparkles-outline" size={16} color={colors.teal} />
                          <Text style={styles.assumedTitle}>Assumed Memory</Text>
                        </View>
                        <Pressable hitSlop={10} onPress={dismissAssumed}>
                          <Ionicons name="close" size={16} color="#9AA4A5" />
                        </Pressable>
                      </View>
                      <Text style={styles.assumedSub}>The AI's best guess from this day's photos</Text>
                      <Text
                        style={[
                          styles.assumedText,
                          assumedLang === 'ar' && rtlIfArabic(assumedMemory.translations?.ar),
                        ]}
                      >
                        {assumedLang === 'ar' && assumedMemory.translations?.ar
                          ? assumedMemory.translations.ar
                          : assumedMemory.summary}
                      </Text>
                      <Pressable
                        style={styles.assumedTranslateBtn}
                        onPress={toggleAssumedLang}
                        disabled={translating}
                      >
                        <Ionicons name="language-outline" size={13} color={colors.teal} />
                        <Text style={styles.assumedTranslateText}>
                          {translating ? 'Translating…' : assumedLang === 'ar' ? 'Show original' : 'Translate to Arabic'}
                        </Text>
                      </Pressable>
                    </Pressable>
                  )}

                  {/* A real attempt was made and came back with nothing —
                      rate limited, offline, whatever. Distinct from "hasn't
                      been tried yet" (which shows no card at all): this one
                      offers a manual retry instead of leaving the day
                      looking like analysis will never arrive. */}
                  {assumedStatus === 'failed' && (
                    <Pressable
                      style={[
                        styles.assumedCard,
                        styles.assumedCardFailed,
                        { left: CARD_POS.assumed.x, top: CARD_POS.assumed.y, width: CARD_POS.assumed.w },
                      ]}
                      onPress={retryAssumed}
                    >
                      <View style={styles.assumedTitleRow}>
                        <Ionicons name="refresh" size={16} color="#8B9394" />
                        <Text style={styles.assumedTitle}>Assumed Memory</Text>
                      </View>
                      <Text style={styles.assumedSub}>
                        Couldn't analyze this day's photos yet — tap to try again
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <Pressable
                  style={[styles.dayCard, { left: 40, top: 420, width: 330, minHeight: 180 }]}
                  onPress={() => router.push('/log/text')}
                >
                  <Text style={styles.dayCardTitle}>
                    {selected === 0
                      ? `Today, ${shortDate(date)}`
                      : `${weekday}, ${shortDate(date)}`}
                  </Text>
                  <Text style={styles.emptyHint}>
                    {selected > 0 ? 'We can’t predict the Future…' : 'What happened today?…………'}
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          </GestureDetector>
        </View>
      </View>

      <TopicSwapSheet
        visible={!!otdSwapTarget}
        topic={otdSwapTarget}
        selectedKeys={otdTopics.map((t) => t.key)}
        onSelect={handleOtdSwap}
        onClose={() => setOtdSwapTarget(null)}
      />
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.muted },
  header: {
    backgroundColor: colors.muted,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { position: 'absolute', left: 20, top: 20 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#22292A' },
  analyzingFloat: { position: 'absolute', top: 76, left: 16, zIndex: 10 },

  bodyRow: { flex: 1, flexDirection: 'row', backgroundColor: colors.white },
  viewport: { flex: 1, overflow: 'hidden' },
  rail: { width: 88, backgroundColor: colors.white, flexGrow: 0 },
  railCell: {
    minHeight: 70,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: colors.white,
    backgroundColor: '#F0F0F0',
    flexDirection: 'row',
    gap: 2,
  },
  railCellSelected: { backgroundColor: colors.accent },
  railWeekdayWrap: {
    position: 'absolute',
    left: -10,
    width: 40,
    alignItems: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  railWeekday: { fontFamily: fonts.semiBold, fontSize: 11, color: '#22292A' },
  railMonth: { fontFamily: fonts.semiBold, fontSize: 13, color: '#22292A', lineHeight: 17 },
  railDay: { fontFamily: fonts.bold, fontSize: 22, color: '#22292A', lineHeight: 26 },

  // Collapsed month/year — same flat tile as a day cell, just a centered
  // label, so the whole rail reads as one continuous list.
  railTileLabel: { fontFamily: fonts.bold, fontSize: 15, color: '#000000' },

  // Expanded month/year — a small, quiet divider (no tint, no border) that
  // sits between the rail cells above and below it.
  railHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  railHeaderText: { fontFamily: fonts.semiBold, fontSize: 11, color: '#8B9394', letterSpacing: 0.3 },

  dash: { position: 'absolute', borderColor: colors.accent, borderStyle: 'dashed' },
  dashDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  card: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: 16,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontFamily: fonts.medium, fontSize: 16, color: '#2B2B2B' },
  thumbRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  syncedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  syncedText: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394' },

  dayCard: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: colors.accent,
    padding: 18,
  },
  dayCardTitle: { fontFamily: fonts.medium, fontSize: 16, color: '#2B2B2B', flex: 1 },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8 },
  bulletDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginTop: 7 },
  bulletText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#7C8586' },
  // How the day was logged, bottom-right of the day card: icons only, no
  // sentence — see captureMethods above for why.
  methodRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },

  placeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
  },
  placeCell: { width: 88, alignItems: 'center' },
  placePin: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeCellLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#4A5253', marginTop: 6 },

  otdCardHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },

  // Assumed Memory — a dashed border and tinted fill mark it as distinct
  // from the solid-white "real" cards around it: a guess, not a record.
  assumedCard: {
    position: 'absolute',
    backgroundColor: colors.pale,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.slate,
    padding: 14,
  },
  assumedCardFailed: { backgroundColor: '#F0F0F0', borderColor: '#C9CDCE' },
  assumedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assumedTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
  assumedSub: { fontFamily: fonts.regular, fontSize: 11, color: '#5B7377', marginTop: 2 },
  assumedText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#324547',
    marginTop: 10,
  },
  assumedTranslateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#C7D6D8',
  },
  assumedTranslateText: { fontFamily: fonts.medium, fontSize: 11, color: colors.teal },
  otdScrollContent: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 6, gap: 12 },
  miniTopicCard: {
    width: 204,
    borderWidth: 1,
    borderColor: '#E4E8E8',
    borderRadius: 16,
    padding: 12,
  },
  miniTopicHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  miniTopicLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#2B2B2B' },
  miniTopicMuted: { fontFamily: fonts.regular, fontSize: 11, color: '#8B9394', marginTop: 6 },
  miniTopicHeadline: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 17, color: '#1B1B1B', marginTop: 6 },
  miniTopicSummary: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: '#4A5253', marginTop: 3 },

  emptyHint: { fontFamily: fonts.regular, fontSize: 14, color: '#9AA4A5', marginTop: 14 },
});
