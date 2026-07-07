import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../src/components/ScreenHeader';
import { TASKS } from '../../src/data';
import { colors, fonts } from '../../src/theme';

function weekRange(offsetWeeks: number) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  if (start.getMonth() === end.getMonth()) {
    return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${end.getDate()}`;
  }
  return `${MONTHS[start.getMonth()]} ${start.getDate()} - ${MONTHS[end.getMonth()]} ${end.getDate()}`;
}

function Toggle({ on, muted, onPress }: { on: boolean; muted: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.track, { backgroundColor: muted ? '#E4E6E6' : '#DCE6E7' }]}
    >
      <View
        style={[
          styles.knob,
          on
            ? { alignSelf: 'flex-end', backgroundColor: muted ? '#B4B8B8' : colors.accent }
            : { alignSelf: 'flex-start', backgroundColor: muted ? '#B4B8B8' : '#AEB6B7' },
        ]}
      />
    </Pressable>
  );
}

export default function Tasks() {
  const [done, setDone] = useState(TASKS.map((t) => t.done));

  const renderSection = (week: 'this' | 'last', label: string, range: string, muted: boolean) => (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, muted && styles.mutedText]}>{label}</Text>
        <Text style={[styles.sectionRange, muted && styles.mutedText]}>{range}</Text>
      </View>
      {TASKS.map((task, i) => {
        if (task.week !== week) return null;
        return (
          <View key={task.title} style={[styles.card, task.highlighted && styles.cardHighlighted]}>
            <View style={styles.cardTop}>
              <View style={styles.titleRow}>
                <Text style={[styles.taskTitle, muted && styles.mutedText]}>{task.title}</Text>
                <View style={styles.linkBadge}>
                  <Ionicons name="link" size={14} color={muted ? '#B4B8B8' : colors.teal} />
                </View>
              </View>
              <Toggle
                on={done[i]}
                muted={muted}
                onPress={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))}
              />
            </View>
            <View style={styles.cardBottom}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.taskDesc, muted && styles.mutedText]}>{task.description}</Text>
                <Text style={[styles.taskTime, muted && styles.mutedText]}>{task.time}</Text>
              </View>
              <View style={styles.dateChip}>
                <Text style={[styles.dateMonth, muted && styles.mutedText]}>{task.month}</Text>
                <Text style={[styles.dateDay, muted && styles.mutedText]}>{task.day}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tasks" />
      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        {renderSection('this', 'This Week', weekRange(0), false)}
        {renderSection('last', 'Last Week', weekRange(-1), true)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  body: { flex: 1, backgroundColor: '#EFF3F3' },
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#9AA4A5',
    paddingVertical: 14,
    marginTop: 24,
  },
  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: '#2B2B2B' },
  sectionRange: { fontFamily: fonts.semiBold, fontSize: 15, color: '#2B2B2B' },
  mutedText: { color: '#A6ACAD' },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 18,
    marginTop: 20,
  },
  cardHighlighted: { borderWidth: 2, borderColor: colors.accent },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  taskTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#2B2B2B' },
  linkBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E8EEEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    width: 58,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  knob: { width: 24, height: 24, borderRadius: 12 },
  cardBottom: { flexDirection: 'row', marginTop: 10 },
  taskDesc: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: '#3E4647' },
  taskTime: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.teal, marginTop: 12 },
  dateChip: {
    backgroundColor: '#DCE3E3',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  dateMonth: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  dateDay: { fontFamily: fonts.bold, fontSize: 20, color: colors.primary, lineHeight: 24 },
});
