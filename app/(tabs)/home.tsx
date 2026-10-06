import { useCallback, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../../src/components/AnalyzingBanner';
import { BRAND, MISC, placePhoto } from '../../src/images';
import { PlaceThumb } from '../../src/components/PlaceTile';
import { polishPendingMemories, useMemoryPolish } from '../../src/memoryIntake';
import { syncPhotosWithLibrary } from '../../src/photoGuard';
import { syncNewPhotosIfOn } from '../../src/photoImport';
import { getPhotoReading } from '../../src/photoReading';
import { LoggedMemory, dateKey, getMemoriesByDay, isManualLog, memoryDisplayText } from '../../src/memoryLog';
import { getAllDayPlaces } from '../../src/places';
import { getTasks, type StoredTask } from '../../src/tasks';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

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

export default function Home() {
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());
  const [yPlaces, setYPlaces] = useState<string[]>([]);
  const [nextTask, setNextTask] = useState<StoredTask | null>(null);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
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
          .sort((a, b) => (a.dueDate! + (a.dueTime ?? '')).localeCompare(b.dueDate! + (b.dueTime ?? '')))[0];
        setNextTask(next ?? null);
      });
      // Someone who had Recall before this question existed is asked once,
      // here. Until they answer, no photos are sent.
      getPhotoReading().then((mode) => {
        if (mode === null) router.push({ pathname: '/photo-reading', params: { from: 'home' } });
      });
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
        </View>

        {/* Week strip */}
        <View style={styles.weekRow}>
          {week.map((day, i) => (
            // Opens the Timeline on that day.
            <Pressable
              key={i}
              style={styles.dayCol}
              onPress={() =>
                router.navigate({ pathname: '/timeline', params: { offset: String(day.offset), at: String(Date.now()) } })
              }
            >
                <Text style={styles.dayLetter}>{day.letter}</Text>
                <View style={[styles.dayCircle, day.isToday && styles.dayCircleToday]}>
                  <Text style={[styles.dayNum, day.isToday && styles.dayNumToday]}>{day.date}</Text>
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
        <Link href="/chat" asChild>
          <Pressable style={styles.chatRow}>
            <View style={styles.chatAvatar}>
              <Image source={MISC.brain3d} style={styles.chatAvatarImg} resizeMode="cover" />
            </View>
            <View style={styles.chatPill}>
              <Text style={styles.chatPillText}>Hey, its your memory, How can i help ?</Text>
            </View>
          </Pressable>
        </Link>

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
        <Link href="/tasks" asChild>
          <Pressable style={styles.card}>
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

        {/* Places / People / Recap shortcuts */}
        <View style={styles.shortcutRow}>
          <Link href="/places" asChild>
            <Pressable style={styles.shortcut}>
              <PlaceThumb style={styles.shortcutImage} />
              <Text style={styles.shortcutLabel}>Places</Text>
            </Pressable>
          </Link>
          <Link href="/people" asChild>
            <Pressable style={styles.shortcut}>
              <View style={[styles.shortcutImage, styles.peopleTile]}>
                <MaterialCommunityIcons name="account-group" size={44} color={colors.white} />
              </View>
              <Text style={styles.shortcutLabel}>People</Text>
            </Pressable>
          </Link>
          <Link href="/recap" asChild>
            <Pressable style={styles.shortcut}>
              <Image
                source={placePhoto('Soccer Roof')}
                style={styles.shortcutImage}
                resizeMode="cover"
              />
              <Text style={styles.shortcutLabel}>Recap</Text>
            </Pressable>
          </Link>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4 },
  headerSymbol: { width: 34, height: 34 },
  logoText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 24 },

  // 34-pt circles, 15 apart (the design), as one centred group.
  weekRow: { flexDirection: 'row', justifyContent: 'center', gap: 15, marginTop: 20 },
  dayCol: { alignItems: 'center', width: 34 },
  dayLetter: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 8 },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: { backgroundColor: colors.primary },
  dayNum: { fontFamily: fonts.medium, fontSize: 15, color: colors.white },
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
  shortcut: { alignItems: 'center', width: 110 },
  shortcutImage: {
    width: 110,
    height: 110,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.white,
    overflow: 'hidden',
  },
  peopleTile: {
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, marginTop: 8 },
});
