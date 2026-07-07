import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../src/components/ScreenHeader';
import { MONTHS_SHORT, getDayDetail } from '../../src/data';
import { PLACE_PHOTOS } from '../../src/images';
import { colors, fonts } from '../../src/theme';

const PHOTO_CYCLE = Object.values(PLACE_PHOTOS);

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

function PhotoTile({ style, seed = 0 }: { style?: object; seed?: number }) {
  return (
    <Image
      source={PHOTO_CYCLE[seed % PHOTO_CYCLE.length]}
      style={style as any}
      resizeMode="cover"
    />
  );
}

function TodayRecap() {
  const router = useRouter();
  // Today's recap shows what's been logged so far; demo uses yesterday's morning.
  const detail = getDayDetail(-1);
  return (
    <View style={styles.todayCard}>
      <View style={styles.spine} />
      {(detail?.segments ?? []).map((segment, i) => (
        <View key={segment.period} style={styles.segment}>
          <View style={styles.spineDot} />
          <View style={{ flex: 1 }}>
            <View style={styles.segmentHeader}>
              <Text style={styles.segmentTitle}>{segment.period}</Text>
              <View style={styles.timePill}>
                <Text style={styles.timePillText}>{i === 0 ? segment.time : '≈ 00:00 PM – 0:00 PM'}</Text>
              </View>
            </View>
            <Text style={styles.segmentText}>{i === 0 ? segment.text : 'N/A'}</Text>
          </View>
        </View>
      ))}
      <Pressable
        style={styles.sourceBtn}
        onPress={() => router.push({ pathname: '/day/[offset]/source', params: { offset: -1 } })}
      >
        <Text style={styles.sourceBtnText}>Source</Text>
      </Pressable>
    </View>
  );
}

function WeeklyRecap() {
  const sections: { title: string; offset: number }[] = [
    { title: 'This\nWeek', offset: 0 },
    { title: 'Last\nWeek', offset: -1 },
    { title: 'Earlier', offset: -2 },
  ];
  return (
    <>
      {sections.map((section) => (
        <View key={section.title} style={styles.weekCard}>
          <View style={styles.weekHeader}>
            <Text style={styles.weekTitle}>{section.title}</Text>
            <Text style={styles.weekRange}>{weekLabel(section.offset)}</Text>
          </View>
          <View style={styles.weekDays}>
            {Array.from({ length: 7 }, (_, i) => (
              <View key={i} style={styles.dayPill}>
                <Text style={styles.dayPillNum}>{String(i + 1).padStart(2, '0')}</Text>
                <PhotoTile style={styles.dayPillPhoto} seed={i + section.offset + 7} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

function MonthlyRecap() {
  const now = new Date();
  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { name: MONTH_NAMES[d.getMonth()], year: d.getFullYear() };
  });
  return (
    <>
      {months.map((m, i) => (
        <View key={m.name + m.year} style={styles.monthCard}>
          <View style={styles.weekHeader}>
            <Text style={styles.monthTitle}>{m.name}</Text>
            <Text style={styles.monthTitle}>{m.year}</Text>
          </View>
          <PhotoTile style={styles.monthPhoto} seed={i * 3 + 1} />
        </View>
      ))}
    </>
  );
}

function YearlyRecap() {
  const thisYear = new Date().getFullYear();
  return (
    <>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.monthCard}>
          <View>
            <PhotoTile style={styles.yearPhoto} seed={i * 4 + 4} />
            <View style={styles.yearOverlay}>
              <Text style={styles.yearText}>{thisYear - i}</Text>
            </View>
          </View>
        </View>
      ))}
    </>
  );
}

export default function Recap() {
  const [period, setPeriod] = useState<Period>('Today');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Recap" />
      <View style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Period switcher */}
          <View style={styles.switcher}>
            {PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.switchBtn, period === p && styles.switchBtnActive]}
              >
                <Text style={[styles.switchText, period === p && styles.switchTextActive]}>
                  {p}
                </Text>
              </Pressable>
            ))}
          </View>

          {period === 'Today' && <TodayRecap />}
          {period === 'Weekly' && <WeeklyRecap />}
          {period === 'Monthly' && <MonthlyRecap />}
          {period === 'Yearly' && <YearlyRecap />}
        </ScrollView>
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
  spine: {
    position: 'absolute',
    left: 30,
    top: 34,
    bottom: 110,
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
});
