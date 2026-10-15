import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AnalyzingBanner from '../../src/components/AnalyzingBanner';
import { BRAND, ICONS, MISC } from '../../src/images';
import FeatureTile from '../../src/components/FeatureTile';
import { polishPendingMemories, useMemoryPolish } from '../../src/memoryIntake';
import { syncPhotosWithLibrary } from '../../src/photoGuard';
import { syncNewPhotosIfOn } from '../../src/photoImport';
import { getPhotoReading } from '../../src/photoReading';
import { LoggedMemory, dateKey, getMemoriesByDay, isManualLog, localFile, memoryDisplayText } from '../../src/memoryLog';
import { getAllDayPlaces } from '../../src/places';
import { getTasks, taskClock, type StoredTask } from '../../src/tasks';
import { getUserProfile } from '../../src/userProfile';
import MyPhotoCard from '../../src/components/MyPhotoCard';
import ExplorePastCard from '../../src/components/ExplorePastCard';
import { getAiConsent } from '../../src/aiConsent';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';
import { markWalkthroughSeen, walkthroughSeen } from '../../src/walkthrough';
import CoachTour, { type TourStep } from '../../src/components/CoachTour';
import { measureCoachTarget, measureView } from '../../src/coachTargets';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A day gets its green dot only when the user logged something themselves
// for that day — typed, spoken, attached, or photos they picked, at the
// time or later. Photos Recall imported on its own don't count.
function getWeek(loggedKeys: Set<string>) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return {
      letter: DAY_LETTERS[i],
      date: d.getDate(),
      /** Days from today, as the Timeline counts them. */
      offset: Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - t.getTime()) / 86400000),
      isToday: d.toDateString() === today.toDateString(),
      hasLog: loggedKeys.has(dateKey(d)),
    };
  });
}

/** "Today", "In 1 Day", "In 5 Days" — when the next task is due. */
function dueIn(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  const now = new Date();
  const days = Math.round(
    (new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
  );
  return days <= 0 ? 'Today' : days === 1 ? 'In 1 Day' : `In ${days} Days`;
}

// The week strip spans the same width as the cards below (the page's 20 pt
// sides). Proportions from Nour's reference: a circle is about two-thirds
// of its day's share of the width, so the gap between circles is a bit over
// half a circle — 38 pt circles with 21 pt gaps on a 430 pt phone.
const PAGE_SIDE = 20;
const DAY_SHARE = 0.68;

export default function Home() {
  const { width: screenW } = useWindowDimensions();
  const daySize = Math.min(44, Math.round(((screenW - PAGE_SIDE * 2) / 7) * DAY_SHARE));
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [yPlaces, setYPlaces] = useState<string[]>([]);
  const [nextTask, setNextTask] = useState<StoredTask | null>(null);
  const router = useRouter();

  // The Home tour: tips on the real screen (src/components/CoachTour.tsx).
  // Once on its own; again whenever Profile → How Recall works sends ?tour.
  const { tour: tourParam } = useLocalSearchParams<{ tour?: string }>();
  const [touring, setTouring] = useState(false);
  const { height: screenH } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const askRef = useRef<View>(null);
  const weekRef = useRef<View>(null);
  const tasksRef = useRef<View>(null);
  const tilesRef = useRef<View>(null);
  // Only ever over Home itself: leaving Home closes it, and a tour waiting
  // to start is called off if Home is no longer the screen showing (it once
  // carried on over Ask, pointing at nothing).
  const homeFocused = useRef(false);
  const tourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTourSoon = useCallback((ms: number) => {
    if (tourTimer.current) clearTimeout(tourTimer.current);
    tourTimer.current = setTimeout(() => {
      if (homeFocused.current) setTouring(true);
    }, ms);
  }, []);
  useFocusEffect(
    useCallback(() => {
      homeFocused.current = true;
      return () => {
        homeFocused.current = false;
        if (tourTimer.current) clearTimeout(tourTimer.current);
        setTouring(false);
      };
    }, []),
  );
  useEffect(() => {
    if (!tourParam) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    startTourSoon(500);
  }, [tourParam, startTourSoon]);

  // A part below the fold (a smaller phone) is scrolled up into view first,
  // leaving room for the bubble and the tab bar.
  const inView = (ref: { current: View | null }) => async () => {
    let r = await measureView(ref.current);
    if (!r) return null;
    const bottomLimit = screenH - 110;
    const topLimit = 110;
    let dy = 0;
    if (r.y + r.height > bottomLimit) dy = r.y + r.height - bottomLimit + 24;
    else if (r.y < topLimit) dy = r.y - topLimit - 24;
    if (dy !== 0) {
      scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + dy), animated: true });
      await new Promise((done) => setTimeout(done, 380));
      r = await measureView(ref.current);
    }
    return r;
  };

  const tourSteps: TourStep[] = [
    {
      key: 'fab',
      title: 'Log your day',
      body: 'Tap + to talk, type or add photos. This is the only way something gets saved.',
      measure: () => measureCoachTarget('fab'),
      round: true,
    },
    {
      key: 'ask',
      title: 'Ask your memory',
      body: 'Type or talk to ask about any day. Ask answers, and never saves what you tell it.',
      measure: inView(askRef),
    },
    {
      key: 'week',
      title: 'Your week',
      body: 'Tap a day to open it on the Timeline. A green dot means you logged it.',
      measure: inView(weekRef),
    },
    {
      key: 'tasks',
      title: 'Tasks fill in',
      body: 'Say “dentist Thursday at 2” in a log and it lands here, with a reminder.',
      measure: inView(tasksRef),
    },
    {
      key: 'tiles',
      title: 'People, places, recaps',
      body: 'They fill in by themselves from what you log and the photos you take.',
      measure: inView(tilesRef),
    },
  ];

  const endTour = (finished: boolean) => {
    setTouring(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    markWalkthroughSeen().catch((e) => console.warn('[tour] could not remember it was seen:', e));
    console.log(`[tour] ${finished ? 'finished' : 'closed early'}`);
  };

  // The user's own photo for the Profile button, when they've set one.
  const [myPhoto, setMyPhoto] = useState<string | undefined>();

  useFocusEffect(
    useCallback(() => {
      getUserProfile().then((p) => setMyPhoto(p.photoUri ? localFile(p.photoUri) : undefined));
      getMemoriesByDay().then(setByDay);
      // Where yesterday happened, named places first — the summary's chips.
      getAllDayPlaces().then((all) => {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const spots = all[dateKey(y)] ?? [];
        setYPlaces([...spots.filter((p) => p.named), ...spots.filter((p) => !p.named)].slice(0, 3).map((p) => p.label));
      });
      // The next task that's due, for the Tasks card.
      getTasks().then((tasks) => {
        const today = dateKey(new Date());
        const next = tasks
          .filter((t) => !t.done && t.dueDate && t.dueDate >= today)
          .sort((a, b) => (a.dueDate! + (taskClock(a) ?? '')).localeCompare(b.dueDate! + (taskClock(b) ?? '')))[0];
        setNextTask(next ?? null);
      });
      // Someone who had Recall before these questions existed is asked
      // once, here: AI first (until answered, nothing is sent), then photos.
      // Then, once those are answered, how Recall works (app/walkthrough.tsx),
      // once, for new users and for everyone who had Recall before it.
      const walkthroughNext = () =>
        walkthroughSeen().then((seen) => {
          // A moment after Home is drawn, so every part has its place.
          if (!seen) startTourSoon(800);
        });
      if (getAiConsent() === null) router.push({ pathname: '/ai-consent', params: { from: 'home' } });
      else if (getAiConsent() === 'on') {
        getPhotoReading().then((mode) => {
          if (mode === null) router.push({ pathname: '/photo-reading', params: { from: 'home' } });
          else walkthroughNext();
        });
      } else walkthroughNext();
    }, [router]),
  );

  // Sweep up anything the AI hasn't polished yet, then refresh what's shown.
  const analyzing = useMemoryPolish(useCallback(() => getMemoriesByDay().then(setByDay), []));

  // Pull down to refresh: everything the app otherwise does on its own when
  // it opens — deleted and private photos checked, new photos brought in
  // (when Sync photos is on), unfinished logs written up — then the screen.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncPhotosWithLibrary();
      await syncNewPhotosIfOn();
      await polishPendingMemories();
    } catch (e) {
      console.warn('[home] refresh failed:', e);
    } finally {
      setByDay(await getMemoriesByDay());
      setRefreshing(false);
    }
  }, []);

  // A day is marked when it has something the user logged themselves —
  // including what they added to it later (logging Monday on Tuesday marks
  // Monday), since the day is what they kept up with.
  const manualDays = new Set<string>();
  for (const [day, list] of byDay) if (list.some(isManualLog)) manualDays.add(day);
  const week = getWeek(manualDays);

  // Yesterday's Summary prefers what the user actually logged yesterday.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yReal = byDay.get(dateKey(yesterday)) ?? [];
  const yLines = yReal.map(memoryDisplayText).filter(Boolean) as string[];
  const usingRealSummary = yLines.length > 0;


  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Image
            source={BRAND.symbol}
            style={styles.headerSymbol}
            tintColor={colors.primary}
            resizeMode="contain"
          />
          <Text style={styles.logoText}>Recall</Text>
          {/* Profile lives here now that Ask has its place in the bar */}
          <Pressable
            style={styles.profileBtn}
            hitSlop={10}
            accessibilityLabel="Profile"
            onPress={() => router.navigate('/profile')}
          >
            {myPhoto ? (
              <Image source={{ uri: myPhoto }} style={styles.profilePhoto} />
            ) : (
              <Image source={ICONS.profile} style={styles.profileIcon} tintColor={colors.primary} resizeMode="contain" />
            )}
          </Pressable>
        </View>

        {/* Week strip */}
        <View ref={weekRef} collapsable={false} style={styles.weekRow}>
          {week.map((day, i) => (
            // Opens the Timeline on that day.
            <Pressable
              key={i}
              style={[styles.dayCol, { width: daySize }]}
              onPress={() =>
                router.navigate({ pathname: '/timeline', params: { offset: String(day.offset), at: String(Date.now()) } })
              }
            >
                <Text style={styles.dayLetter}>{day.letter}</Text>
                <View
                  style={[
                    styles.dayCircle,
                    { width: daySize, height: daySize, borderRadius: daySize / 2 },
                    day.isToday && styles.dayCircleToday,
                  ]}
                >
                  <Text style={[styles.dayNum, { fontSize: Math.round(daySize * 0.42) }, day.isToday && styles.dayNumToday]}>
                    {day.date}
                  </Text>
                </View>
                {/* Today always has its dot, in the accent; other days only
                    when the user logged that day, in green. */}
                {day.isToday ? (
                  <View style={[styles.logDot, styles.todayDot]} />
                ) : (
                  day.hasLog && <View style={styles.logDot} />
                )}
            </Pressable>
          ))}
        </View>

        {/* AI chat pill */}
        <View style={styles.tourGap}>
        <View ref={askRef} collapsable={false}>
        <Link href="/chat" asChild>
          <Pressable style={StyleSheet.flatten([styles.chatRow, styles.noTopGap])}>
            <View style={styles.chatAvatar}>
              <Image source={MISC.brainAvatar} style={styles.chatAvatarImg} resizeMode="cover" />
            </View>
            <View style={styles.chatPill}>
              <Text style={styles.chatPillText}>Hey, its your memory, How can i help ?</Text>
            </View>
          </Pressable>
        </Link>
        </View>
        </View>

        {/* Once, for anyone who never saw "Explore your past" in setup. */}
        <ExplorePastCard onDone={() => getMemoriesByDay().then(setByDay)} />

        {/* Once, until the app knows the user's face (src/myFace.ts). */}
        <MyPhotoCard />

        {analyzing && <AnalyzingBanner />}

        {/* Yesterday's Summary — opens yesterday */}
        <Pressable style={styles.card} onPress={() => router.push('/day/-1' as Parameters<typeof router.push>[0])}>
          <Text style={styles.cardTitle}>Yesterday’s Summary</Text>
          {yPlaces.length > 0 && (
            <View style={styles.chipRow}>
              {yPlaces.map((p) => (
                <View key={p} style={styles.placeChip}>
                  <Text numberOfLines={1} style={styles.placeChipText}>
                    {p}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ marginTop: 14 }}>
            {usingRealSummary ? (
              yLines.slice(0, 4).map((line, i, shown) => (
                <View key={i} style={styles.summaryLine}>
                  {/* A dot per moment, joined by a dotted line. */}
                  <View style={styles.rail}>
                    <View style={styles.summaryDot} />
                    {i < shown.length - 1 && <View style={styles.railDash} />}
                  </View>
                  <Text numberOfLines={2} style={[styles.summaryText, rtlIfArabic(line)]}>
                    {line}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.summaryEmpty}>Nothing logged yesterday yet.</Text>
            )}
          </View>
        </Pressable>

        {/* Tasks — the next one due */}
        <View style={styles.tourGap}>
        <View ref={tasksRef} collapsable={false}>
        <Link href="/tasks" asChild>
          <Pressable style={StyleSheet.flatten([styles.card, styles.noTopGap])}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Tasks</Text>
              {nextTask?.dueDate && (
                <View style={styles.duePill}>
                  <Text style={styles.duePillText}>{dueIn(nextTask.dueDate)}</Text>
                </View>
              )}
            </View>
            <Text numberOfLines={2} style={styles.cardSubtitle}>
              {nextTask ? nextTask.title : 'All your tasks are organized and saved here.'}
            </Text>
          </Pressable>
        </Link>
        </View>
        </View>

        {/* Places / People / Recap — each with a photo from inside it */}
        <View ref={tilesRef} collapsable={false} style={styles.shortcutRow}>
          <FeatureTile feature="places" size={110} />
          <FeatureTile feature="people" size={110} />
          <FeatureTile feature="recap" size={110} />
        </View>

        {/* On This Day */}
        <Link href="/on-this-day" asChild>
          <Pressable style={styles.lastCard}>
            <Text style={styles.cardTitle}>On This Day</Text>
            {/* What the feature is, not a headline from inside it. */}
            <Text style={styles.cardSubtitle}>See what was happening in the world on any day of your life.</Text>
          </Pressable>
        </Link>
      </ScrollView>
      <CoachTour steps={tourSteps} visible={touring} onDone={endTour} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  scroll: { paddingHorizontal: PAGE_SIDE },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 },
  headerSymbol: { width: 34, height: 34 },
  logoText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 24 },
  profileBtn: { marginLeft: 'auto' },
  // A button and an avatar at once: big enough to read as the user's face.
  profileIcon: { width: 36, height: 36 },
  profilePhoto: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: colors.pale },

  // 34-pt circles, 15 apart (the design), as one centred group.
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  dayCol: { alignItems: 'center' },
  dayLetter: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 8 },
  dayCircle: {
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: { backgroundColor: colors.primary },
  // Dark on the pale circles so the dates read easily; today stays white on teal.
  dayNum: { fontFamily: fonts.medium, fontSize: 15, color: colors.primary },
  dayNumToday: { color: colors.white },
  // Green: logged that day. The same green for today as any other day.
  logDot: { width: 7, height: 7, borderRadius: 4, marginTop: 8, backgroundColor: '#A9D3B6' },
  // Today's own marker, slightly larger, in the accent.
  todayDot: { width: 9, height: 9, borderRadius: 5, marginTop: 7, backgroundColor: colors.accent },

  chatRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 10 },
  chatAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: '#7FB8BF',
    alignItems: 'center',
    justifyContent: 'center',
    // White, like the design — the brain sits on the page, not on black.
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  // The artwork has wide empty margins; scaled up so the brain fills the
  // circle as in the design.
  chatAvatarImg: { width: 66, height: 66 },
  chatPill: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  chatPillText: { color: colors.white, fontFamily: fonts.regular, fontSize: 14 },

  card: {
    borderWidth: 1,
    borderColor: '#C9CDCE',
    borderRadius: 24,
    padding: 18,
    marginTop: 24,
    backgroundColor: colors.white,
  },
  lastCard: {
    borderWidth: 1,
    borderColor: '#C9CDCE',
    borderRadius: 24,
    padding: 18,
    marginTop: 24,
    backgroundColor: colors.white,
    marginBottom: 110,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.ink },
  // Body lines stop short of the card's edge, so they wrap into two
  // comfortable lines instead of one run edge to edge.
  cardSubtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#8B9394', marginTop: 6, maxWidth: '82%' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  placeChip: { backgroundColor: colors.pale, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, maxWidth: 140 },
  placeChipText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink },
  duePill: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 },
  duePillText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  rail: { width: 6, alignItems: 'center', alignSelf: 'stretch' },
  railDash: {
    flex: 1,
    width: 0,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.teal,
    marginTop: 2,
    marginBottom: -9,
  },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 6 },
  summaryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
    marginTop: 5,
  },
  summaryText: { flex: 1, maxWidth: '86%', fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#7C8586' },
  summaryEmpty: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },

  shortcutRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  // The gap above a part the tour rings sits outside the ringed box.
  tourGap: { marginTop: 24 },
  noTopGap: { marginTop: 0 },
});
