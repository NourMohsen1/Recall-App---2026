import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WheelPicker from '../../src/components/WheelPicker';
import { MONTHS_SHORT, WEEKDAYS } from '../../src/data';
import { deleteTask, getTask, updateTask } from '../../src/tasks';
import { colors, fonts } from '../../src/theme';

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// The next two weeks as pickable chips — covers almost every real task
// without needing a full calendar widget.
function upcomingDays(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      key: localDate(d),
      label:
        i === 0
          ? 'Today'
          : i === 1
            ? 'Tomorrow'
            : `${WEEKDAYS[d.getDay()].slice(0, 3)} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`,
    };
  });
}

function dateLabel(dueDate: string): string {
  const found = upcomingDays(15).find((d) => d.key === dueDate);
  if (found) return found.label;
  const [y, m, d] = dueDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()].slice(0, 3)} ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const AMPM = ['AM', 'PM'];

export default function TaskEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // The alarm-style wheel: hour / minute / AM-PM, plus a "Remind me" switch
  // (like Snooze) deciding whether the time counts at all.
  const [hourIdx, setHourIdx] = useState(8); // 9 o'clock
  const [minIdx, setMinIdx] = useState(0);
  const [pmIdx, setPmIdx] = useState(0); // AM
  const [remind, setRemind] = useState(true);

  useEffect(() => {
    if (!id) return;
    getTask(id).then((task) => {
      if (!task) {
        router.back();
        return;
      }
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setDueDate(task.dueDate);
      if (task.dueTime) {
        const [h, m] = task.dueTime.split(':').map(Number);
        setPmIdx(h >= 12 ? 1 : 0);
        setHourIdx((h % 12 || 12) - 1);
        setMinIdx(m);
        setRemind(true);
      } else {
        setRemind(false);
      }
      setLoaded(true);
    });
  }, [id]);

  const wheelTime = (): string => {
    const h24 = ((hourIdx + 1) % 12) + (pmIdx === 1 ? 12 : 0);
    return `${String(h24).padStart(2, '0')}:${MINUTES[minIdx]}`;
  };

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving || !id) return;
    setSaving(true);
    await updateTask(id, {
      title: trimmed,
      notes: notes.trim() || undefined,
      dueDate,
      // A time only means something when there's a date and the reminder is on.
      dueTime: dueDate && remind ? wheelTime() : undefined,
    });
    if (router.canGoBack()) router.back();
    else router.replace('/tasks');
  };

  const remove = () => {
    if (!id) return;
    Alert.alert('Delete this task?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTask(id);
          if (router.canGoBack()) router.back();
          else router.replace('/tasks');
        },
      },
    ]);
  };

  if (!loaded) {
    return <SafeAreaView style={styles.safe} edges={['top']} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Cancel · title · Save — like the alarm editor */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Edit Task</Text>
        <Pressable onPress={save} hitSlop={10} disabled={!title.trim() || saving}>
          <Text
            style={[
              styles.headerAction,
              styles.headerSave,
              (!title.trim() || saving) && { opacity: 0.4 },
            ]}
          >
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Task name front and center */}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Task name"
            placeholderTextColor="#9AA4A5"
            multiline
          />

          {/* The time wheel — always live, exactly like the alarm screen.
              Picking a time here sets the due date to today automatically
              if none is chosen yet, so spinning it just works right away. */}
          <View style={styles.wheelCard}>
            <View style={styles.wheelRow}>
              <WheelPicker
                items={HOURS}
                index={hourIdx}
                onChange={(i) => {
                  setHourIdx(i);
                  if (!dueDate) setDueDate(localDate(new Date()));
                }}
                width={76}
              />
              <WheelPicker
                items={MINUTES}
                index={minIdx}
                onChange={(i) => {
                  setMinIdx(i);
                  if (!dueDate) setDueDate(localDate(new Date()));
                }}
                width={76}
              />
              <WheelPicker
                items={AMPM}
                index={pmIdx}
                onChange={(i) => {
                  setPmIdx(i);
                  if (!dueDate) setDueDate(localDate(new Date()));
                }}
                width={70}
              />
            </View>
          </View>

          {/* Grouped settings, alarm-style */}
          <View style={styles.group}>
            <Pressable style={styles.row} onPress={() => setDatePickerOpen((v) => !v)}>
              <Text style={styles.rowLabel}>Due date</Text>
              <View style={styles.rowValueWrap}>
                <Text style={styles.rowValue}>{dueDate ? dateLabel(dueDate) : 'None'}</Text>
                <Ionicons
                  name={datePickerOpen ? 'chevron-down' : 'chevron-forward'}
                  size={16}
                  color="#B4B8B8"
                />
              </View>
            </Pressable>

            {datePickerOpen && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dateChips}
              >
                <Pressable
                  onPress={() => setDueDate(undefined)}
                  style={[styles.chip, !dueDate && styles.chipActive]}
                >
                  <Text style={[styles.chipText, !dueDate && styles.chipTextActive]}>No date</Text>
                </Pressable>
                {upcomingDays(14).map((d) => (
                  <Pressable
                    key={d.key}
                    onPress={() => setDueDate(d.key)}
                    style={[styles.chip, dueDate === d.key && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, dueDate === d.key && styles.chipTextActive]}>
                      {d.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>Remind me</Text>
              <Switch
                value={remind}
                onValueChange={setRemind}
                trackColor={{ false: '#DCE0E0', true: colors.accent }}
                thumbColor={colors.white}
                disabled={!dueDate}
              />
            </View>
          </View>

          {/* Notes / description */}
          <View style={styles.group}>
            <Text style={[styles.rowLabel, styles.notesLabel]}>Notes</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add details about this task…"
              placeholderTextColor="#9AA4A5"
              multiline
              textAlignVertical="top"
            />
          </View>

          <Pressable style={styles.deleteBtn} onPress={remove}>
            <Text style={styles.deleteText}>Delete Task</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFF3F3' },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: '#EFF3F3',
  },
  headerAction: { fontFamily: fonts.regular, fontSize: 16, color: colors.teal },
  headerSave: { fontFamily: fonts.semiBold },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },

  body: { paddingHorizontal: 16, paddingBottom: 60 },

  titleInput: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: '#1B1B1B',
    marginTop: 8,
  },

  wheelCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    marginTop: 14,
    paddingVertical: 6,
    alignItems: 'center',
  },
  wheelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },

  group: { backgroundColor: colors.white, borderRadius: 16, marginTop: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#EFF1F1' },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: '#1B1B1B' },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowValue: { fontFamily: fonts.regular, fontSize: 15, color: '#8B9394' },

  dateChips: { gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  chip: {
    borderWidth: 1,
    borderColor: '#D5DBDB',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.regular, fontSize: 13, color: '#3E4647' },
  chipTextActive: { color: colors.white, fontFamily: fonts.medium },

  notesLabel: { paddingHorizontal: 16, paddingTop: 14 },
  notesInput: {
    minHeight: 90,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#2B2B2B',
  },

  deleteBtn: {
    backgroundColor: colors.white,
    borderRadius: 16,
    marginTop: 22,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteText: { fontFamily: fonts.medium, fontSize: 15, color: '#C4453E' },
});
