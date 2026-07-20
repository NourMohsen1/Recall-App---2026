import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { MONTHS_SHORT } from '../../src/data';
import {
  StoredTask,
  confirmNoDueDate,
  deleteTask,
  formatDueTime,
  getTasks,
  markTasksSeen,
  toggleTask,
} from '../../src/tasks';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

function dueDateParts(dueDate: string): { month: string; day: string } {
  const [, m, d] = dueDate.split('-').map(Number);
  return { month: MONTHS_SHORT[m - 1], day: String(d).padStart(2, '0') };
}

// Day offset (0 = today, negative = past) for linking back to the day the
// task was extracted from.
function offsetFromDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function isOverdue(task: StoredTask): boolean {
  if (!task.dueDate || task.done) return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  return task.dueDate < todayKey;
}

function Toggle({ on, muted, onPress }: { on: boolean; muted: boolean; onPress: () => void }) {
  // The track itself must light up when on, not just the knob — otherwise a
  // completed task never reads as "done" at a glance.
  const trackColor = on
    ? muted
      ? '#C7CBCB'
      : colors.accent
    : muted
      ? '#E4E6E6'
      : '#DCE6E7';
  return (
    <Pressable onPress={onPress} style={[styles.track, { backgroundColor: trackColor }]}>
      <View
        style={[
          styles.knob,
          on
            ? { alignSelf: 'flex-end', backgroundColor: colors.white }
            : { alignSelf: 'flex-start', backgroundColor: muted ? '#B4B8B8' : '#AEB6B7' },
        ]}
      />
    </Pressable>
  );
}

function TaskCard({
  task,
  muted,
  isNew,
  onToggle,
  onDelete,
  onEdit,
  onOpenSource,
}: {
  task: StoredTask;
  muted: boolean;
  isNew: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onOpenSource: (() => void) | null;
}) {
  const overdue = isOverdue(task);
  return (
    <View style={[styles.card, isNew && styles.cardNew]}>
      <View style={styles.cardTop}>
        <Pressable style={styles.titleRow} onPress={onEdit}>
          {isNew && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          )}
          <Text style={[styles.taskTitle, muted && styles.mutedText, rtlIfArabic(task.title)]}>
            {task.title}
          </Text>
          <Ionicons name="pencil-outline" size={14} color={muted ? '#B4B8B8' : '#9AA4A5'} />
        </Pressable>
        <Toggle on={task.done} muted={muted} onPress={onToggle} />
      </View>

      <View style={styles.cardBottom}>
        <View style={{ flex: 1 }}>
          {/* Where this task came from — a spoken/typed memory keeps its
              original sentence as the citation; tap it to open that day. */}
          {task.source === 'memory' && task.sourceText ? (
            <Pressable
              style={styles.sourceRow}
              onPress={onOpenSource ?? undefined}
              disabled={!onOpenSource}
            >
              <MaterialCommunityIcons
                name="text-long"
                size={14}
                color={muted ? '#B4B8B8' : colors.teal}
              />
              <Text
                numberOfLines={2}
                style={[styles.sourceText, muted && styles.mutedText, rtlIfArabic(task.sourceText)]}
              >
                From your memory: “{task.sourceText}”
                {onOpenSource ? '  — tap to view that day' : ''}
              </Text>
            </Pressable>
          ) : null}
          {task.dueTime && (
            <Text style={[styles.taskTime, muted && styles.mutedText]}>
              {formatDueTime(task.dueTime)}
            </Text>
          )}
          {overdue && <Text style={styles.overdueText}>Overdue</Text>}
          <Pressable style={styles.deleteBtn} onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={15} color="#B24545" />
            <Text style={styles.deleteText}>Remove</Text>
          </Pressable>
        </View>
        {task.dueDate ? (
          <View style={[styles.dateChip, overdue && styles.dateChipOverdue]}>
            <Text style={[styles.dateMonth, muted && styles.mutedText]}>
              {dueDateParts(task.dueDate).month}
            </Text>
            <Text style={[styles.dateDay, muted && styles.mutedText]}>
              {dueDateParts(task.dueDate).day}
            </Text>
          </View>
        ) : task.needsDueDate && !task.done ? (
          // The user never said when — a soft nudge to confirm a due date.
          <Pressable style={[styles.dateChip, styles.dateChipAsk]} onPress={onEdit}>
            <MaterialCommunityIcons name="calendar-question" size={20} color="#8A6D3B" />
            <Text style={styles.dateAskText}>Set date</Text>
          </Pressable>
        ) : (
          <View style={styles.dateChip}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={20} color="#9AA4A5" />
          </View>
        )}
      </View>
    </View>
  );
}

export default function Tasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Ids that were unseen when this visit started — they keep their "New"
  // badge for the whole visit, while storage is already marked seen so the
  // badge is gone next time.
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const reload = useCallback(() => {
    getTasks().then((t) => {
      setTasks(t);
      setLoaded(true);
      const unseen = t.filter((task) => task.source === 'memory' && task.seen === false);
      if (unseen.length > 0) {
        setNewIds((prev) => new Set([...prev, ...unseen.map((task) => task.id)]));
        markTasksSeen(unseen.map((task) => task.id)).catch(() => {});
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onToggle = async (id: string) => {
    await toggleTask(id);
    reload();
  };
  const onDelete = async (id: string) => {
    await deleteTask(id);
    reload();
  };

  // Tasks the AI created without a due date get one confirmation popup each
  // per visit — set a date, or keep it dateless and stop being asked.
  const [askedIds, setAskedIds] = useState<Set<string>>(new Set());
  const askTask = tasks.find((t) => t.needsDueDate && !t.done && !askedIds.has(t.id));

  const dismissAsk = () => {
    if (askTask) setAskedIds((prev) => new Set([...prev, askTask.id]));
  };
  const keepWithoutDate = async () => {
    if (!askTask) return;
    dismissAsk();
    await confirmNoDueDate(askTask.id);
    reload();
  };
  const setDateFor = () => {
    if (!askTask) return;
    dismissAsk();
    router.push({ pathname: '/log/task-edit', params: { id: askTask.id } });
  };

  // Open tasks first (soonest due date up top, undated last), done ones below.
  const open = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const done = tasks.filter((t) => t.done);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header with the + button for deliberate task creation */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.push('/home'))}
          hitSlop={12}
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Tasks</Text>
        <Pressable onPress={() => router.push('/log/task')} hitSlop={12} style={styles.addBtn}>
          <Ionicons name="add" size={26} color={colors.white} />
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.scroll}>
        {loaded && tasks.length === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="checkbox-marked-circle-plus-outline" size={40} color="#AEB6B7" />
            <Text style={styles.emptyTitle}>No tasks yet</Text>
            <Text style={styles.emptyText}>
              Tap + to add one — or just log a memory like “I have to get some fruits tomorrow
              morning” and Recall will turn it into a task for you.
            </Text>
          </View>
        )}

        {open.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>To Do</Text>
              <Text style={styles.sectionRange}>{open.length}</Text>
            </View>
            {open.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                muted={false}
                isNew={newIds.has(task.id)}
                onToggle={() => onToggle(task.id)}
                onDelete={() => onDelete(task.id)}
                onEdit={() =>
                  router.push({ pathname: '/log/task-edit', params: { id: task.id } })
                }
                onOpenSource={
                  task.sourceDate
                    ? () =>
                        router.push(
                          `/day/${offsetFromDate(task.sourceDate!)}` as Parameters<
                            typeof router.push
                          >[0],
                        )
                    : null
                }
              />
            ))}
          </>
        )}

        {done.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, styles.mutedText]}>Done</Text>
              <Text style={[styles.sectionRange, styles.mutedText]}>{done.length}</Text>
            </View>
            {done.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                muted
                isNew={false}
                onToggle={() => onToggle(task.id)}
                onDelete={() => onDelete(task.id)}
                onEdit={() =>
                  router.push({ pathname: '/log/task-edit', params: { id: task.id } })
                }
                onOpenSource={
                  task.sourceDate
                    ? () =>
                        router.push(
                          `/day/${offsetFromDate(task.sourceDate!)}` as Parameters<
                            typeof router.push
                          >[0],
                        )
                    : null
                }
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* "When is this due?" — confirmation for AI-created dateless tasks */}
      <Modal visible={!!askTask} transparent animationType="fade" onRequestClose={dismissAsk}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <MaterialCommunityIcons name="calendar-question" size={26} color={colors.teal} />
            </View>
            <Text style={styles.modalTitle}>New task from your memory</Text>
            <Text style={[styles.modalTask, askTask ? rtlIfArabic(askTask.title) : undefined]}>
              “{askTask?.title}”
            </Text>
            <Text style={styles.modalBody}>
              You didn’t mention when — want to give it a due date so Recall can remind you?
            </Text>
            <Pressable style={styles.modalPrimary} onPress={setDateFor}>
              <Text style={styles.modalPrimaryText}>Set due date</Text>
            </Pressable>
            <Pressable style={styles.modalSecondary} onPress={keepWithoutDate}>
              <Text style={styles.modalSecondaryText}>Keep without date</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    backgroundColor: colors.white,
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  addBtn: {
    position: 'absolute',
    right: 20,
    top: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { flex: 1, backgroundColor: '#EFF3F3' },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 },

  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 30, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#5B6364' },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#8B9394',
    textAlign: 'center',
  },

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
  cardNew: { borderWidth: 2, borderColor: colors.accent },
  newBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  newBadgeText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.ink },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  taskTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: '#2B2B2B', flexShrink: 1 },
  track: {
    width: 58,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  knob: { width: 24, height: 24, borderRadius: 12 },
  cardBottom: { flexDirection: 'row', marginTop: 10, gap: 12 },

  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  sourceText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#7C8586',
    fontStyle: 'italic',
  },
  taskTime: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.teal, marginTop: 10 },
  overdueText: { fontFamily: fonts.medium, fontSize: 12, color: '#B24545', marginTop: 4 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
  deleteText: { fontFamily: fonts.regular, fontSize: 12, color: '#B24545' },

  dateChip: {
    backgroundColor: '#DCE3E3',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    minWidth: 58,
  },
  dateChipOverdue: { backgroundColor: '#F3E3E3' },
  dateChipAsk: { backgroundColor: '#F5EEDC', gap: 2 },
  dateAskText: { fontFamily: fonts.medium, fontSize: 11, color: '#8A6D3B' },
  dateMonth: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  dateDay: { fontFamily: fonts.bold, fontSize: 20, color: colors.primary, lineHeight: 24 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,17,18,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: '#1B1B1B' },
  modalTask: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.teal,
    textAlign: 'center',
    marginTop: 10,
  },
  modalBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: '#5B6364',
    textAlign: 'center',
    marginTop: 10,
  },
  modalPrimary: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  modalPrimaryText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.white },
  modalSecondary: { paddingVertical: 12, alignItems: 'center' },
  modalSecondaryText: { fontFamily: fonts.medium, fontSize: 14, color: '#8B9394' },
});
