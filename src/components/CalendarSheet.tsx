import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

// Picking a task's day: the three answers people give most (today,
// tomorrow, next week) one tap away, and the month underneath for anything
// else. Choosing a day closes the sheet — there is nothing else to confirm.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEK_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Six weeks starting on the Sunday on or before the 1st. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function CalendarSheet({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** YYYY-MM-DD, or none. */
  value?: string;
  /** A day was chosen, or `undefined` for Clear. */
  onPick: (day: string | undefined) => void;
  onClose: () => void;
}) {
  const today = new Date();
  const todayKey = keyOf(today);
  const [cursor, setCursor] = useState(() => (value ? fromKey(value) : today));

  // Open on the chosen day's month each time.
  useEffect(() => {
    if (visible) setCursor(value ? fromKey(value) : new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // "Next week" is the Monday after this one, as calendars mean it.
  const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  const quick = [
    { key: keyOf(today), label: 'Today', icon: 'calendar-today' as const },
    { key: keyOf(addDays(today, 1)), label: 'Tomorrow', icon: 'calendar-arrow-right' as const },
    { key: keyOf(nextMonday), label: 'Next week', icon: 'calendar-week' as const },
  ];

  const pick = (key: string) => {
    onPick(key);
    onClose();
  };

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = monthGrid(year, month);
  // Drop a sixth row that is entirely next month.
  const rows = days[35].getMonth() !== month ? 5 : 6;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title}>Due date</Text>
            {value && (
              <Pressable
                style={styles.clearBtn}
                hitSlop={8}
                onPress={() => {
                  onPick(undefined);
                  onClose();
                }}
              >
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            )}
          </View>

          {quick.map((q) => {
            const on = value === q.key;
            const d = fromKey(q.key);
            return (
              <Pressable key={q.label} style={[styles.quickRow, on && styles.quickRowOn]} onPress={() => pick(q.key)}>
                <MaterialCommunityIcons name={q.icon} size={22} color={on ? colors.accent : colors.teal} />
                <Text style={styles.quickLabel}>{q.label}</Text>
                <Text style={styles.quickHint}>
                  {WEEKDAYS_SHORT[d.getDay()]} {d.getDate()}
                </Text>
              </Pressable>
            );
          })}

          <View style={styles.divider} />

          <View style={styles.monthHead}>
            <Text style={styles.monthTitle}>
              {MONTHS[month]} {year}
            </Text>
            <View style={styles.monthNav}>
              <Pressable hitSlop={10} onPress={() => setCursor(new Date(year, month - 1, 1))}>
                <Ionicons name="chevron-back" size={20} color={colors.teal} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => setCursor(new Date(year, month + 1, 1))}>
                <Ionicons name="chevron-forward" size={20} color={colors.teal} />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            {WEEK_LETTERS.map((l, i) => (
              <Text key={i} style={styles.weekLetter}>
                {l}
              </Text>
            ))}
          </View>

          {Array.from({ length: rows }, (_, r) => (
            <View key={r} style={styles.weekRow}>
              {days.slice(r * 7, r * 7 + 7).map((d) => {
                const key = keyOf(d);
                const inMonth = d.getMonth() === month;
                const selected = key === value;
                const isToday = key === todayKey;
                const past = key < todayKey;
                return (
                  <Pressable key={key} style={styles.dayCell} onPress={() => pick(key)}>
                    <View style={[styles.dayDot, selected && styles.dayDotOn, !selected && isToday && styles.dayDotToday]}>
                      <Text
                        style={[
                          styles.dayText,
                          (!inMonth || past) && styles.dayTextFaint,
                          isToday && styles.dayTextToday,
                          selected && styles.dayTextOn,
                        ]}
                      >
                        {d.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8,17,18,0.45)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 34,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDE2E2', alignSelf: 'center', marginBottom: 14 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
    minHeight: 34,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B' },
  clearBtn: { borderWidth: 1, borderColor: '#D5DBDB', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 16 },
  clearText: { fontFamily: fonts.medium, fontSize: 14, color: colors.teal },

  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
  },
  quickRowOn: { backgroundColor: '#EEF4F5' },
  quickLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: '#1B1B1B' },
  quickHint: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },

  divider: { height: 1, backgroundColor: '#EFF1F1', marginVertical: 10 },

  monthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  monthTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#1B1B1B' },
  monthNav: { flexDirection: 'row', gap: 26 },

  weekRow: { flexDirection: 'row' },
  weekLetter: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#8B9394',
    paddingVertical: 6,
  },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayDotOn: { backgroundColor: colors.primary },
  dayDotToday: { borderWidth: 1.5, borderColor: colors.accent },
  dayText: { fontFamily: fonts.regular, fontSize: 16, color: '#1B1B1B' },
  dayTextFaint: { color: '#B9C0C1' },
  dayTextToday: { fontFamily: fonts.semiBold, color: colors.teal },
  dayTextOn: { fontFamily: fonts.semiBold, color: colors.white },
});
