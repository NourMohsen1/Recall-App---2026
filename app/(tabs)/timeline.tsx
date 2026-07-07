import { useCallback, useEffect, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import PhotoTile, { TILE_SIZE } from '../../src/components/PhotoTile';
import { PERSON_PLACEHOLDER, PLACE_PLACEHOLDER, personPhoto, placePhoto } from '../../src/images';
import {
  MONTHS_SHORT,
  WEEKDAYS,
  dateWithOffset,
  getDayDetail,
  shortDate,
} from '../../src/data';
import {
  LoggedMemory,
  dateKey,
  formatClockTime,
  getMemoriesByDay,
} from '../../src/memoryLog';
import { Topic, TopicItem, TopicKey, getDayFeed, getInterestTopics, swapTopic } from '../../src/onThisDay';
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

// Rail shows a few future days then back into the past.
const RAIL_OFFSETS = Array.from({ length: 34 }, (_, i) => 3 - i);

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

// Smart Icon Reminder — small floating visual cue on the canvas.
function Sir({ x, y, icon }: { x: number; y: number; icon: string }) {
  return (
    <View style={[styles.sir, { left: x, top: y }]}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
    </View>
  );
}

function MiniPlay() {
  return (
    <View style={styles.miniPlay}>
      <Ionicons name="play" size={14} color={colors.white} style={{ marginLeft: 1 }} />
    </View>
  );
}


const MAX_SCALE = 2.5;
const MIN_SCALE = 0.2;

export default function Timeline() {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());

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
  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then(setByDay);
      getInterestTopics().then(setOtdTopics);
    }, []),
  );

  const detail = getDayDetail(selected);
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
  const photoCaptions = photoMemories.map((m) => m.text).filter(Boolean) as string[];

  // Voice transcripts read like any other note on the day card.
  const voiceTexts = voices.map((v) => v.text).filter(Boolean) as string[];
  const realBullets = [
    ...texts.map((t) => t.text ?? ''),
    ...voiceTexts,
    ...photoCaptions,
  ].filter(Boolean);
  if (realBullets.length === 0 && voices.length > 0) {
    realBullets.push('Voice memory — no transcript yet.');
  }
  const bullets = realBullets.length > 0 ? realBullets : detail?.bullets ?? [];

  const latestVoice = voices[voices.length - 1];
  const recordedLine = latestVoice
    ? `Recorded by voice on ${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} at ${formatClockTime(new Date(latestVoice.takenAt))}`
    : detail
      ? `Recorded by voice on ${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} at ${detail.recordedAt}`
      : null;

  const latestPhotoMemory = photoMemories[photoMemories.length - 1];
  const showDayCard = bullets.length > 0 || !!latestVoice;
  const showPhotoLib = realPhotoUris.length > 0 || !!detail;
  const hasContent =
    showDayCard || realPhotoUris.length > 0 || !!detail || (!otdFuture && otdTopics.length > 0);

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

      <View style={styles.bodyRow}>
        {/* Date rail */}
        <ScrollView style={styles.rail} showsVerticalScrollIndicator={false}>
          {RAIL_OFFSETS.map((offset) => {
            const d = dateWithOffset(offset);
            const isSelected = offset === selected;
            return (
              <Pressable
                key={offset}
                onPress={() => setSelected(offset)}
                style={[styles.railCell, isSelected && styles.railCellSelected]}
              >
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
          })}
        </ScrollView>

        {/* Free-move day canvas: pan any direction + pinch zoom, like a map */}
        <View style={styles.viewport} onLayout={onViewportLayout}>
          <GestureDetector gesture={canvasGesture}>
            <Animated.View style={[{ width: CANVAS_W, height: CANVAS_H }, canvasStyle]}>
              <DottedBackground />

              {hasContent ? (
                <>
                  {/* Smart Icon Reminders belong to the rich demo layout */}
                  {detail && (
                    <>
                      <Sir x={150} y={26} icon="camera" />
                      <Sir x={352} y={96} icon="sync" />
                      <Sir x={56} y={716} icon="receipt" />
                      <Sir x={566} y={668} icon="pill" />
                    </>
                  )}

                  {/* Connectors — anchored to card-edge midpoints once measured */}
                  {detail && showDayCard && cardH.people && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.people.x + CARD_POS.people.w / 2, y: CARD_POS.people.y + cardH.people }}
                      to={{ x: CARD_POS.day.x + CARD_POS.day.w / 2, y: CARD_POS.day.y }}
                    />
                  )}
                  {detail && showPhotoLib && cardH.photo && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.photo.x + CARD_POS.photo.w / 2, y: CARD_POS.photo.y + cardH.photo }}
                      to={{ x: CARD_POS.places.x + CARD_POS.places.w / 2, y: CARD_POS.places.y }}
                    />
                  )}
                  {detail && showDayCard && cardH.day && cardH.places && (
                    <Elbow
                      axis="h"
                      from={{ x: CARD_POS.day.x + CARD_POS.day.w, y: CARD_POS.day.y + cardH.day / 2 }}
                      to={{ x: CARD_POS.places.x, y: CARD_POS.places.y + cardH.places / 2 }}
                    />
                  )}
                  {detail && showDayCard && cardH.day && (
                    <Elbow
                      axis="v"
                      from={{ x: CARD_POS.day.x + CARD_POS.day.w / 2, y: CARD_POS.day.y + cardH.day }}
                      to={{ x: CARD_POS.otd.x + CARD_POS.otd.w / 2, y: CARD_POS.otd.y }}
                    />
                  )}

                  {/* People card (demo data only for now) */}
                  {detail && (
                    <Pressable
                      onLayout={measure('people')}
                      style={[
                        styles.card,
                        { left: CARD_POS.people.x, top: CARD_POS.people.y, width: CARD_POS.people.w },
                      ]}
                      onPress={() =>
                        router.push({
                          pathname: '/day/[offset]/people',
                          params: { offset: selected },
                        })
                      }
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardTitle}>People</Text>
                        <View style={styles.actionsRow}>
                          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                          <MiniPlay />
                        </View>
                      </View>
                      <View style={styles.avatarRow}>
                        {detail.people.map((p) => (
                          <Image
                            key={p.name}
                            source={p.hasPhoto ? personPhoto(p.name) : PERSON_PLACEHOLDER}
                            style={styles.avatar}
                            resizeMode="cover"
                          />
                        ))}
                      </View>
                    </Pressable>
                  )}

                  {/* Photo Library card — real logged photos take priority */}
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
                      <View style={styles.thumbRow}>
                        {realPhotoUris.length > 0 ? (
                          realPhotoUris
                            .slice(0, 3)
                            .map((uri) => <PhotoTile key={uri} source={{ uri }} />)
                        ) : (
                          <>
                            <PhotoTile source={placePhoto('Soccer Roof')} />
                            <PhotoTile source={placePhoto('787 Coffee')} />
                            <PhotoTile source={placePhoto('College')} />
                          </>
                        )}
                      </View>
                      <View style={styles.syncedRow}>
                        <Ionicons name="link" size={14} color="#8B9394" />
                        <Text style={styles.syncedText}>
                          {latestPhotoMemory
                            ? `Added on ${shortDate(new Date(latestPhotoMemory.createdAt))} at ${formatClockTime(new Date(latestPhotoMemory.createdAt))}`
                            : `Synced on ${shortDate(date)} at 4:39 pm`}
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
                      {recordedLine && (
                        <View style={styles.recordedRow}>
                          <Text style={styles.recordedText}>{recordedLine}</Text>
                          <Pressable
                            onPress={() =>
                              router.push({
                                pathname: '/day/[offset]/source',
                                params: { offset: selected },
                              })
                            }
                          >
                            <MaterialCommunityIcons name="waveform" size={24} color={colors.teal} />
                          </Pressable>
                        </View>
                      )}
                    </Pressable>
                  )}

                  {/* Places card */}
                  {detail && (
                  <Pressable
                    onLayout={measure('places')}
                    style={[
                      styles.card,
                      { left: CARD_POS.places.x, top: CARD_POS.places.y, width: CARD_POS.places.w },
                    ]}
                    onPress={() =>
                      router.push({
                        pathname: '/day/[offset]/places',
                        params: { offset: selected },
                      })
                    }
                  >
                    <View style={styles.cardHeaderRow}>
                      <Text style={styles.cardTitle}>Places</Text>
                      <View style={styles.actionsRow}>
                        <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                        <MiniPlay />
                      </View>
                    </View>
                    <View style={styles.placeGrid}>
                      {detail?.places.slice(0, 6).map((place) => (
                        <View key={place.name} style={styles.placeCell}>
                          <PhotoTile
                            source={place.hasPhoto ? placePhoto(place.name) : PLACE_PLACEHOLDER}
                          />
                          <Text numberOfLines={1} style={styles.placeCellLabel}>
                            {place.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
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

  bodyRow: { flex: 1, flexDirection: 'row', backgroundColor: colors.white },
  viewport: { flex: 1, overflow: 'hidden' },
  rail: { width: 88, backgroundColor: colors.white, flexGrow: 0 },
  railCell: {
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

  dash: { position: 'absolute', borderColor: colors.accent, borderStyle: 'dashed' },
  dashDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  sir: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCE6E7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#B9C9CB',
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
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniPlay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  recordedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  recordedText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: '#9AA4A5' },

  placeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
  },
  placeCell: { width: TILE_SIZE, alignItems: 'center' },
  placeCellLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#4A5253', marginTop: 4 },

  otdCardHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
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
