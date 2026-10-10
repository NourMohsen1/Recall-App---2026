import { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '../../src/navigation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import CalendarSheet from '../../src/components/CalendarSheet';
import { MONTHS_SHORT, WEEKDAYS } from '../../src/data';
import { defaultReminder, reminderLabel, reminderOptions } from '../../src/taskNotifications';
import ChoiceWheel from '../../src/components/ChoiceWheel';
import {
  PERIOD_START,
  addTask,
  deleteTask,
  extractTasks,
  getTask,
  taskExtractionAvailable,
  taskTimeLabel,
  updateTask,
  type DayPeriod,
  type ReminderChoice,
} from '../../src/tasks';
import { colors, fonts } from '../../src/theme';

// One screen for a task, new (the + on Tasks) or existing: its name, when
// it is, when to be reminded, and notes.
//
// The time is Apple's own wheel — the one in Clock's alarms — opened under
// the Time row, as Calendar and Reminders do. A task has no time until one
// is set: most tasks are "tomorrow", not "tomorrow at 2:00".

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(dueDate: string): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (dueDate === localDate(today)) return 'Today';
  if (dueDate === localDate(tomorrow)) return 'Tomorrow';
  const [y, m, d] = dueDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const year = y !== today.getFullYear() ? `, ${y}` : '';
  const month = MONTHS_SHORT[date.getMonth()];
  return `${WEEKDAYS[date.getDay()].slice(0, 3)}, ${month.charAt(0)}${month.slice(1).toLowerCase()} ${d}${year}`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeAsDate(t: string): Date {
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/** The next whole hour — where the wheel starts for a task with no time. */
function nextHour(): string {
  const d = new Date();
  return `${String((d.getHours() + 1) % 24).padStart(2, '0')}:00`;
}

// Worth asking the AI about: the name mentions a day or a time
// ("dentist tomorrow at 2", "بكرة", "bokra"). Otherwise saving stays instant.
const SOUNDS_DATED =
  /\d|today|tonight|tomorrow|morning|afternoon|evening|night|noon|next|mon|tue|wed|thu|fri|sat|sun|week|month|بكر|النهارد|الليل|الصبح|العصر|الضهر|المغرب|الساعة|الاسبوع|الأسبوع|يوم|bokra|bukra|el sa3a|elsa3a|ba3d/i;

export default function TaskEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isNew = !id;

  const [loaded, setLoaded] = useState(isNew);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [dueTime, setDueTime] = useState<string | undefined>();
  const [duePeriod, setDuePeriod] = useState<DayPeriod | undefined>();
  const [reminder, setReminder] = useState<ReminderChoice | undefined>();
  const [remindEarly, setRemindEarly] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reminderMenu, setReminderMenu] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTask(id).then((task) => {
      if (!task) {
        goBack(router, '/tasks');
        return;
      }
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setDueDate(task.dueDate);
      setDueTime(task.dueTime);
      setDuePeriod(task.dueTime ? undefined : task.duePeriod);
      setReminder(task.reminder);
      setRemindEarly(!!task.remindEarly);
      // A task at a time opens with its wheel showing, like an alarm.
      setTimeOpen(!!task.dueTime);
      setLoaded(true);
    });
  }, [id]);

  const when = { title, dueDate, dueTime, duePeriod, reminder, remindEarly };

  // A reminder choice that no longer fits ("15 minutes before" once the
  // time is gone) falls back to the default.
  const keepReminderIfFits = (next: { dueTime?: string; duePeriod?: DayPeriod }) => {
    if (reminder && !reminderOptions({ ...when, ...next }).some((o) => o.key === reminder)) setReminder(undefined);
  };

  const setTime = (t: string) => {
    setDueTime(t);
    setDuePeriod(undefined);
    if (!dueDate) setDueDate(localDate(new Date()));
    keepReminderIfFits({ dueTime: t, duePeriod: undefined });
  };

  const toggleTime = () => {
    Keyboard.dismiss();
    setReminderMenu(false);
    if (timeOpen) {
      setTimeOpen(false);
      return;
    }
    // Opening the wheel is choosing to give the task a time: it starts at
    // the part of the day already said, or the next hour.
    if (!dueTime) setTime(duePeriod ? PERIOD_START[duePeriod] : nextHour());
    setTimeOpen(true);
  };

  const removeTime = () => {
    setDueTime(undefined);
    setDuePeriod(undefined);
    setTimeOpen(false);
    keepReminderIfFits({ dueTime: undefined, duePeriod: undefined });
  };

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const fields = {
      title: trimmed,
      notes: notes.trim() || undefined,
      dueDate,
      dueTime: dueDate ? dueTime : undefined,
      duePeriod: dueDate && !dueTime ? duePeriod : undefined,
      reminder,
    };
    if (id) {
      await updateTask(id, fields);
    } else {
      // "Dentist tomorrow at 2" typed as the name, with no date picked:
      // Recall reads the day and time from the words, as it does for logs.
      // A date the user picked is never overridden.
      if (!dueDate && SOUNDS_DATED.test(trimmed) && taskExtractionAvailable()) {
        const parsed = await Promise.race([
          extractTasks(trimmed),
          new Promise<null>((r) => setTimeout(() => r(null), 8000)),
        ]);
        const found = parsed?.length === 1 ? parsed[0] : undefined;
        if (found?.dueDate) {
          console.log(`[tasks] read "${trimmed}" as ${found.dueDate} ${found.dueTime ?? found.duePeriod ?? ''}`);
          Object.assign(fields, {
            title: found.title || trimmed,
            dueDate: found.dueDate,
            dueTime: found.dueTime,
            duePeriod: found.duePeriod,
          });
        }
      }
      await addTask({ ...fields, source: 'manual' });
    }
    goBack(router, '/tasks');
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
          goBack(router, '/tasks');
        },
      },
    ]);
  };

  if (!loaded) {
    return <SafeAreaView style={styles.safe} edges={['top']} />;
  }

  // The wheel's choices, and which is on now — the user's, or the
  // default the task would get.
  const wheelOptions = reminderOptions(when);
  const wheelValue = reminder ?? defaultReminder(when);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack(router, '/tasks')} hitSlop={10}>
          <Text style={styles.headerAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{isNew ? 'New Task' : 'Edit Task'}</Text>
        <Pressable onPress={save} hitSlop={10} disabled={!title.trim() || saving}>
          <Text style={[styles.headerAction, styles.headerSave, (!title.trim() || saving) && { opacity: 0.4 }]}>
            {saving ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Task name"
            placeholderTextColor="#9AA4A5"
            autoFocus={isNew}
            multiline
          />

          {/* When — the day, the time, and the reminder that follows from them */}
          <View style={styles.group}>
            <Pressable
              style={styles.row}
              onPress={() => {
                Keyboard.dismiss();
                setCalendarOpen(true);
              }}
            >
              <View style={styles.rowLead}>
                <MaterialCommunityIcons name="calendar-blank-outline" size={20} color={colors.teal} />
                <Text style={styles.rowLabel}>Date</Text>
              </View>
              <View style={styles.rowValueWrap}>
                <Text style={[styles.rowValue, dueDate && styles.rowValueSet]}>
                  {dueDate ? dateLabel(dueDate) : 'None'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#B4B8B8" />
              </View>
            </Pressable>

            <Pressable style={[styles.row, styles.rowBorder]} onPress={toggleTime}>
              <View style={styles.rowLead}>
                <MaterialCommunityIcons name="clock-outline" size={20} color={colors.teal} />
                <Text style={styles.rowLabel}>Time</Text>
              </View>
              <View style={styles.rowValueWrap}>
                <Text style={[styles.rowValue, (dueTime || duePeriod) && styles.rowValueSet]}>
                  {taskTimeLabel({ dueTime, duePeriod }) ?? 'None'}
                </Text>
                <Ionicons name={timeOpen ? 'chevron-down' : 'chevron-forward'} size={16} color="#B4B8B8" />
              </View>
            </Pressable>

            {timeOpen && dueTime && (
              <View style={styles.wheelWrap}>
                <DateTimePicker
                  value={timeAsDate(dueTime)}
                  mode="time"
                  display="spinner"
                  themeVariant="light"
                  textColor="#1B1B1B"
                  onValueChange={(_, d) => setTime(hhmm(d))}
                  style={styles.wheel}
                />
                <Pressable onPress={removeTime} hitSlop={8} style={styles.removeTime}>
                  <Text style={styles.removeTimeText}>Remove time</Text>
                </Pressable>
              </View>
            )}

            {dueDate && (
              <Pressable
                style={[styles.row, styles.rowBorder]}
                onPress={() => {
                  Keyboard.dismiss();
                  // One wheel open at a time keeps the page short.
                  setTimeOpen(false);
                  setReminderMenu((open) => !open);
                }}
              >
                <View style={styles.rowLead}>
                  <MaterialCommunityIcons
                    name={reminder === 'none' ? 'bell-off-outline' : 'bell-outline'}
                    size={20}
                    color={colors.teal}
                  />
                  <Text style={styles.rowLabel}>Reminder</Text>
                </View>
                <View style={styles.rowValueWrap}>
                  <Text style={[styles.rowValue, styles.rowValueSet]}>{reminderLabel(when)}</Text>
                  <Ionicons name={reminderMenu ? 'chevron-down' : 'chevron-forward'} size={16} color="#B4B8B8" />
                </View>
              </Pressable>
            )}
            {/* A wheel under the row, like the time's — swipe to "2 hours
                before". "Night before + 2 hours before" is the default for
                saved tickets; choosing it is choosing the default. */}
            {dueDate && reminderMenu && (
              <ChoiceWheel
                options={wheelOptions}
                value={wheelValue}
                onChange={(key) => setReminder(key === 'early' ? undefined : key)}
              />
            )}
          </View>

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

          {!isNew && (
            <Pressable style={styles.deleteBtn} onPress={remove}>
              <Text style={styles.deleteText}>Delete Task</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <CalendarSheet
        visible={calendarOpen}
        value={dueDate}
        onPick={(day) => {
          setDueDate(day);
          if (!day) {
            // No day, no time: a time only means something on a day.
            setDueTime(undefined);
            setDuePeriod(undefined);
            setTimeOpen(false);
            setReminder(undefined);
          }
        }}
        onClose={() => setCalendarOpen(false)}
      />
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

  group: { backgroundColor: colors.white, borderRadius: 16, marginTop: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#EFF1F1' },
  rowLead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: '#1B1B1B' },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, marginLeft: 12 },
  rowValue: { fontFamily: fonts.regular, fontSize: 15, color: '#8B9394', flexShrink: 1, textAlign: 'right' },
  rowValueSet: { color: colors.teal },

  wheelWrap: { alignItems: 'center', paddingBottom: 12 },
  wheel: { width: 320, height: 216 },
  removeTime: { paddingVertical: 4, paddingHorizontal: 10 },
  removeTimeText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },

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
