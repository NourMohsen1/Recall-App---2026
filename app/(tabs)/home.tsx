import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AnalyzingBanner from '../../src/components/AnalyzingBanner';
import { BRAND, MISC, placePhoto } from '../../src/images';
import { useMemoryPolish } from '../../src/memoryIntake';
import { LoggedMemory, dateKey, getMemoriesByDay } from '../../src/memoryLog';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A day gets a log dot only when the user actually logged something that day.
function getWeek(loggedKeys: Set<string>) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      letter: DAY_LETTERS[i],
      date: d.getDate(),
      isToday: d.toDateString() === today.toDateString(),
      hasLog: loggedKeys.has(dateKey(d)),
    };
  });
}

function PlayButton() {
  return (
    <View style={styles.playBtn}>
      <Ionicons name="play" size={18} color={colors.white} style={{ marginLeft: 2 }} />
    </View>
  );
}

export default function Home() {
  const [byDay, setByDay] = useState<Map<string, LoggedMemory[]>>(new Map());

  useFocusEffect(
    useCallback(() => {
      getMemoriesByDay().then(setByDay);
    }, []),
  );

  // Sweep up anything the AI hasn't polished yet, then refresh what's shown.
  const analyzing = useMemoryPolish(useCallback(() => getMemoriesByDay().then(setByDay), []));

  const week = getWeek(new Set(byDay.keys()));

  // Yesterday's Summary prefers what the user actually logged yesterday.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yReal = byDay.get(dateKey(yesterday)) ?? [];
  const yLines = yReal
    .map((m) =>
      m.kind === 'voice'
        ? m.text ?? 'Voice memory — no transcript yet.'
        : m.text,
    )
    .filter(Boolean) as string[];
  const usingRealSummary = yLines.length > 0;

  // The Timeline widget always reflects yesterday, from the user's own logs.
  const timelinePreview = usingRealSummary
    ? `Yesterday: ${yLines[0]}${yLines.length > 1 ? ` (+${yLines.length - 1} more)` : ''}`
    : 'Nothing logged yesterday — tap + to remember something.';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
            <Link key={i} href="/on-this-day" asChild>
              <Pressable style={styles.dayCol}>
                <Text style={styles.dayLetter}>{day.letter}</Text>
                <View style={[styles.dayCircle, day.isToday && styles.dayCircleToday]}>
                  <Text style={[styles.dayNum, day.isToday && styles.dayNumToday]}>{day.date}</Text>
                </View>
                {day.hasLog && (
                  <View
                    style={[
                      styles.logDot,
                      { backgroundColor: day.isToday ? colors.accent : '#A9D3B6' },
                    ]}
                  />
                )}
              </Pressable>
            </Link>
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

        {/* Yesterday's Summary */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Yesterday’s Summary</Text>
            <PlayButton />
          </View>
          <View style={{ marginTop: 10 }}>
            {usingRealSummary ? (
              yLines.map((line, i) => (
                <View key={i} style={styles.summaryLine}>
                  <View style={styles.summaryDot} />
                  <Text style={[styles.summaryText, rtlIfArabic(line)]}>{line}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.summaryEmpty}>Nothing logged yesterday yet.</Text>
            )}
          </View>
        </View>

        {/* Timeline */}
        <Link href="/timeline" asChild>
          <Pressable style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Timeline</Text>
              <PlayButton />
            </View>
            <Text style={styles.cardSubtitle}>{timelinePreview}</Text>
          </Pressable>
        </Link>

        {/* Places / People / Recap shortcuts */}
        <View style={styles.shortcutRow}>
          <Link href="/places" asChild>
            <Pressable style={styles.shortcut}>
              <Image source={placePhoto('College')} style={styles.shortcutImage} resizeMode="cover" />
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

        {/* Tasks */}
        <Link href="/tasks" asChild>
          <Pressable style={styles.lastCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Tasks</Text>
              <PlayButton />
            </View>
            <Text style={styles.cardSubtitle}>All your tasks are organized and saved here..</Text>
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

  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  dayCol: { alignItems: 'center', width: 40 },
  dayLetter: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 8 },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: { backgroundColor: colors.primary },
  dayNum: { fontFamily: fonts.medium, fontSize: 15, color: colors.white },
  dayNumToday: { color: colors.white },
  logDot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },

  chatRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 10 },
  chatAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    overflow: 'hidden',
  },
  chatAvatarImg: { width: 48, height: 48 },
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
  cardSubtitle: { fontFamily: fonts.regular, fontSize: 13, color: '#8B9394', marginTop: 6 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 7 },
  summaryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
    marginTop: 5,
  },
  summaryText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#7C8586' },
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
