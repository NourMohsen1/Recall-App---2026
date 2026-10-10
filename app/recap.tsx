import { logDayKey } from '../src/logicalDay';
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import ReorderableList from '../src/components/ReorderableList';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../src/components/AnalyzingBanner';
import RecapCompany from '../src/components/RecapCompany';
import RecapOverview from '../src/components/RecapOverview';
import RecapView from '../src/components/RecapView';
import ScreenHeader from '../src/components/ScreenHeader';
import type { RecapKind, RecapUnit } from '../src/recap';
import { MONTHS_SHORT } from '../src/data';
import PhotoImage from '../src/components/PhotoImage';
import { polishPendingMemories, useMemoryPolish } from '../src/memoryIntake';
import {
  LoggedMemory,
  dateKey,
  formatClockTime,
  getLoggedMemories,
  memoryDisplayText,
  reorderDay,
  shownMemories,
} from '../src/memoryLog';
import { colors, fonts } from '../src/theme';
import { withAppNav } from '../src/components/AppNav';

const PERIODS = ['Today', 'Weekly', 'Monthly', 'Yearly'] as const;
type Period = (typeof PERIODS)[number];

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

function weekLabel(offsetWeeks: number) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  if (start.getMonth() === end.getMonth()) {
    return `${MONTHS_SHORT[start.getMonth()]}\n${start.getDate()}–${end.getDate()}`;
  }
  return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} –\n${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`;
}

function firstPhotoUri(memories: LoggedMemory[]): string | undefined {
  return memories.find((m) => m.kind === 'photo' && m.photoUris?.length)?.photoUris?.[0];
}

// A small placeholder icon shown when there's no logged photo for a slot —
// never a stock/demo photo, just an honest "nothing here" mark.
function EmptyTile({ style }: { style?: object }) {
  return (
    <View style={[style as any, styles.emptyTile]}>
      <MaterialCommunityIcons name="image-off-outline" size={18} color="#A9B0B1" />
    </View>
  );
}

function TodayRecap({
  memories,
  onDragging,
  onReordered,
}: {
  memories: LoggedMemory[];
  onDragging: (d: boolean) => void;
  onReordered: () => void;
}) {
  const router = useRouter();
  // The day still going: after midnight, the evening before (logicalDay.ts).
  const today = logDayKey();
  const entries = memories
    .filter((m) => dateKey(new Date(m.takenAt)) === today && (m.kind !== 'photo' || m.text))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const hasVoice = entries.some((m) => m.kind === 'voice');

  if (entries.length === 0) {
    return (
      <View style={styles.todayCard}>
        <Text style={styles.emptyText}>Nothing logged today yet.</Text>
        <RecapCompany from={today} to={today} />
      </View>
    );
  }

  return (
    <View style={styles.todayCard}>
      {/* The spine sits with the entries, so it stops above the people
          and places at the end. */}
      <View>
        <View style={styles.spine} />
        {/* Hold an entry and drag it to put the day in order. */}
        <ReorderableList
          items={entries}
          keyOf={(m) => m.id}
          onDragging={onDragging}
          onReorder={async (next, { to }) => {
            await reorderDay(next.map((m) => m.id), next[to].id);
            onReordered();
          }}
          renderItem={(m) => (
          <View style={styles.segment}>
            <View style={styles.spineDot} />
            <View style={{ flex: 1 }}>
              <View style={styles.segmentHeader}>
                <Text style={styles.segmentTitle}>{m.kind === 'photo' ? 'Photos' : 'Note'}</Text>
                <View style={styles.timePill}>
                  <Text style={styles.timePillText}>≈ {formatClockTime(new Date(m.takenAt))}</Text>
                </View>
              </View>
              {memoryDisplayText(m) && (
                <Text style={styles.segmentText}>{memoryDisplayText(m)}</Text>
              )}
            </View>
          </View>
          )}
        />
        {hasVoice && (
          <Pressable
            style={styles.sourceBtn}
            onPress={() => router.push({ pathname: '/day/[offset]/source', params: { offset: 0 } })}
          >
            <Text style={styles.sourceBtnText}>Source</Text>
          </Pressable>
        )}
      </View>
      <RecapCompany from={today} to={today} />
    </View>
  );
}

const KIND: Record<Exclude<Period, 'Today'>, RecapKind> = { Weekly: 'week', Monthly: 'month', Yearly: 'year' };

function Recap() {
  const router = useRouter();
  // A recap notification opens straight onto its own tab.
  const params = useLocalSearchParams<{ period?: string; offset?: string }>();
  const [period, setPeriod] = useState<Period>(
    PERIODS.includes(params.period as Period) ? (params.period as Period) : 'Today',
  );
  // null: the tab's overview (a card per week, month or year). A number:
  // that period's full recap, 0 = the current one.
  const [offset, setOffset] = useState<number | null>(null);
  useEffect(() => {
    if (PERIODS.includes(params.period as Period)) {
      setPeriod(params.period as Period);
      const o = Number(params.offset);
      setOffset(params.offset != null && Number.isFinite(o) ? o : null);
    }
  }, [params.period, params.offset]);

  // Tapping a row goes one level in: a day opens that day, a week its
  // weekly recap, a month its monthly recap.
  const openUnit = (unit: RecapUnit) => {
    const [y, m, d] = unit.from.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const today = new Date();
    if (period === 'Weekly') {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      router.push(`/day/${Math.round((start.getTime() - t.getTime()) / 86400000)}` as Parameters<typeof router.push>[0]);
    } else if (period === 'Monthly') {
      const monday = (x: Date) => {
        const c = new Date(x.getFullYear(), x.getMonth(), x.getDate());
        c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
        return c;
      };
      setPeriod('Weekly');
      setOffset(Math.round((monday(start).getTime() - monday(today).getTime()) / (7 * 86400000)));
    } else if (period === 'Yearly') {
      setPeriod('Monthly');
      setOffset((y - today.getFullYear()) * 12 + (m - 1 - today.getMonth()));
    }
  };
  const [memories, setMemories] = useState<LoggedMemory[]>([]);
  // An entry is being dragged: the page holds still under the finger.
  const [dragging, setDragging] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getLoggedMemories().then((all) => setMemories(shownMemories(all)));
    }, []),
  );

  const analyzing = useMemoryPolish(useCallback(() => getLoggedMemories().then((all) => setMemories(shownMemories(all))), []));

  // Pull down: anything not written up yet is, then the recap is drawn
  // again from what's there now (people, places and stories included).
  const [refreshing, setRefreshing] = useState(false);
  const [round, setRound] = useState(0);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await polishPendingMemories();
    } catch (e) {
      console.warn('[recap] refresh failed:', e);
    } finally {
      setMemories(shownMemories(await getLoggedMemories()));
      setRound((r) => r + 1);
      setRefreshing(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Inside one week, month or year, back returns to the list of them. */}
      <ScreenHeader title="Recap" onBack={period !== 'Today' && offset !== null ? () => setOffset(null) : undefined} />
      <View style={styles.body}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!dragging}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.teal} colors={[colors.teal]} />}
        >
          {analyzing && <AnalyzingBanner />}

          {/* Period switcher */}
          <View style={styles.switcher}>
            {PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => {
                  setPeriod(p);
                  setOffset(null);
                }}
                style={[styles.switchBtn, period === p && styles.switchBtnActive]}
              >
                <Text style={[styles.switchText, period === p && styles.switchTextActive]}>
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>

          {period === 'Today' && (
            <TodayRecap
              memories={memories}
              onDragging={setDragging}
              onReordered={() => getLoggedMemories().then((all) => setMemories(shownMemories(all)))}
            />
          )}
          {period !== 'Today' && offset === null && (
            <RecapOverview key={`o${round}`} kind={KIND[period]} onOpen={setOffset} />
          )}
          {period !== 'Today' && offset !== null && (
            <RecapView key={`v${round}`} kind={KIND[period]} offset={offset} onOffset={setOffset} onOpenUnit={openUnit} />
          )}
        </ScrollView>
        </GestureHandlerRootView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: colors.pale },
  scroll: { padding: 16, paddingBottom: 140 },

  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 999,
    padding: 6,
    justifyContent: 'space-between',
  },
  switchBtn: {
    borderRadius: 999,
    paddingVertical: 10,
    flex: 1,
    alignItems: 'center',
  },
  switchBtnActive: { backgroundColor: colors.primary },
  switchText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#1B1B1B' },
  switchTextActive: { color: colors.white },

  // Today
  todayCard: {
    backgroundColor: colors.white,
    borderRadius: 26,
    padding: 22,
    marginTop: 18,
    position: 'relative',
  },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },
  spine: {
    position: 'absolute',
    left: 8,
    top: 12,
    bottom: 88,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#8FA6A9',
  },
  segment: { flexDirection: 'row', gap: 14, marginBottom: 30 },
  spineDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, marginTop: 2 },
  segmentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  segmentTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#111' },
  timePill: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  timePillText: { fontFamily: fonts.regular, fontSize: 12, color: colors.white },
  segmentText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#5B6364', marginTop: 5 },
  sourceBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginTop: 6,
  },
  sourceBtnText: { fontFamily: fonts.regular, fontSize: 14, color: '#0E1B1C' },

  // Weekly
  weekCard: { backgroundColor: colors.white, borderRadius: 26, padding: 18, marginTop: 18 },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  weekTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24, color: '#1B1B1B' },
  weekRange: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 21, color: '#1B1B1B', textAlign: 'right' },
  weekDays: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  dayPill: {
    width: '13%',
    borderWidth: 1,
    borderColor: '#C9D2D3',
    borderRadius: 999,
    alignItems: 'center',
    paddingTop: 6,
    overflow: 'hidden',
  },
  dayPillNum: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.teal, marginBottom: 5 },
  dayPillPhoto: {
    width: '100%',
    aspectRatio: 0.45,
    borderRadius: 999,
    overflow: 'hidden',
  },

  // Monthly / Yearly
  monthCard: { backgroundColor: colors.white, borderRadius: 26, padding: 18, marginTop: 18 },
  monthTitle: { fontFamily: fonts.bold, fontSize: 22, color: '#1B1B1B' },
  monthPhoto: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    marginTop: 14,
    overflow: 'hidden',
  },
  yearPhoto: {
    width: '100%',
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
  },
  yearOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearText: { fontFamily: fonts.bold, fontSize: 64, color: colors.accent },
  emptyTile: {
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// The app's bottom menu over this screen, like the main tabs.
export default withAppNav(Recap);
