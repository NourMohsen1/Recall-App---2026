import { polishPendingMemories, transcribePendingMemories } from '../../src/memoryIntake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { goBack } from '../../src/navigation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AttachmentViewer from '../../src/components/AttachmentViewer';
import SwipeToDelete from '../../src/components/SwipeToDelete';
import { MONTHS_SHORT } from '../../src/data';
import {
  StoredTask,
  confirmNoDueDate,
  deleteTask,
  restoreTask,
  taskClock,
  taskTimeLabel,
  getTasks,
  markTasksSeen,
  toggleTask,
} from '../../src/tasks';
import { rtlIfArabic } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';
import { makeStyles, useColors } from '../../src/appearance';

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

// Monday-first weeks, as a planner reads them.
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// "OCT 1 - 7", or "SEP 28 - OCT 4" across a month.
function rangeLabel(from: Date, to: Date): string {
  const a = `${MONTHS_SHORT[from.getMonth()]} ${from.getDate()}`;
  if (keyOf(from) === keyOf(to)) return a;
  return from.getMonth() === to.getMonth()
    ? `${a} - ${to.getDate()}`
    : `${a} - ${MONTHS_SHORT[to.getMonth()]} ${to.getDate()}`;
}

type Section = { key: string; title: string; range?: string; past: boolean; tasks: StoredTask[] };

// The design groups tasks by week: what is coming, this week, and what has
// passed. Soonest first inside a week still to come, newest first in a
// week that has passed. Undated tasks
// sit together under "Anytime", after this week — until they're done: a
// finished undated task moves to the week it was finished in (tasks done
// before that was recorded use the day they were made), and "Anytime"
// disappears once nothing open is left in it.
function placeDay(t: StoredTask): string | undefined {
  if (t.dueDate) return t.dueDate;
  if (!t.done) return undefined;
  return keyOf(new Date(t.doneAt ?? t.createdAt));
}

function groupByWeek(tasks: StoredTask[], now = new Date()): Section[] {
  const thisWeek = startOfWeek(now);
  const nextWeek = addDays(thisWeek, 7);
  const weekAfter = addDays(thisWeek, 14);
  const lastWeek = addDays(thisWeek, -7);
  const bounds = {
    thisWeek: keyOf(thisWeek),
    nextWeek: keyOf(nextWeek),
    weekAfter: keyOf(weekAfter),
    lastWeek: keyOf(lastWeek),
  };
  const sections: Section[] = [
    { key: 'later', title: 'Later', past: false, tasks: [] },
    { key: 'next', title: 'Next Week', range: rangeLabel(nextWeek, addDays(nextWeek, 6)), past: false, tasks: [] },
    { key: 'this', title: 'This Week', range: rangeLabel(thisWeek, addDays(thisWeek, 6)), past: false, tasks: [] },
    { key: 'anytime', title: 'Anytime', past: false, tasks: [] },
    { key: 'last', title: 'Last Week', range: rangeLabel(lastWeek, addDays(lastWeek, 6)), past: true, tasks: [] },
    { key: 'earlier', title: 'Earlier', past: true, tasks: [] },
  ];
  const at = (k: string) => sections.find((s) => s.key === k)!;
  for (const t of tasks) {
    const d = placeDay(t);
    if (!d) at('anytime').tasks.push(t);
    else if (d >= bounds.weekAfter) at('later').tasks.push(t);
    else if (d >= bounds.nextWeek) at('next').tasks.push(t);
    else if (d >= bounds.thisWeek) at('this').tasks.push(t);
    else if (d >= bounds.lastWeek) at('last').tasks.push(t);
    else at('earlier').tasks.push(t);
  }
  const when = (t: StoredTask) => `${placeDay(t) ?? ''} ${taskClock(t) ?? '00:00'}`;
  for (const s of sections) {
    // Open tasks first, finished ones after them: what is still to do
    // leads every week. Then soonest first in this week and the weeks
    // ahead, as a to-do list reads; most recent first in weeks that have
    // passed, as a history does.
    const order = s.past ? -1 : 1;
    s.tasks.sort((a, b) => Number(a.done) - Number(b.done) || order * when(a).localeCompare(when(b)));
    // Earlier covers everything before last week: its range is what is in it.
    if (s.key === 'earlier' && s.tasks.length > 0) {
      const days = s.tasks.map((t) => placeDay(t)!).sort();
      const [y1, m1, d1] = days[0].split('-').map(Number);
      const [y2, m2, d2] = days[days.length - 1].split('-').map(Number);
      s.range = rangeLabel(new Date(y1, m1 - 1, d1), new Date(y2, m2 - 1, d2));
    }
  }
  return sections.filter((s) => s.tasks.length > 0);
}

// The task that deserves attention now: the nearest one still ahead —
// today's next, or the soonest after today when today is clear. A task
// with a date but no time counts until the end of its day. Overdue ones are
// not it: they are already marked in red, and "next" means what is coming.
function nextUpId(tasks: StoredTask[], now: Date): string | null {
  const nowKey = `${keyOf(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let best: { id: string; at: string } | null = null;
  for (const t of tasks) {
    if (t.done || !t.dueDate) continue;
    const at = `${t.dueDate} ${taskClock(t) ?? '23:59'}`;
    if (at < nowKey) continue;
    if (!best || at < best.at) best = { id: t.id, at };
  }
  if (best) return best.id;
  // Nothing dated still ahead: the cue moves on to the first open task
  // with no date, so ticking off the last appointment never leaves the
  // page without anything marked as next.
  return tasks.find((t) => !t.done && !t.dueDate)?.id ?? null;
}

// The tick on the left of every task, as in Reminders and every other
// to-do list: an empty ring is still to do, a filled teal circle with a
// tick is done. It replaced a switch that was ON for "to do", which a
// tester read the wrong way round.
function CheckCircle({ done, onPress }: { done: boolean; onPress: () => void }) {
  const c = useColors();
  const styles = useStyles();
  const pop = useRef(new Animated.Value(1)).current;
  const press = () => {
    if (!done) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      pop.setValue(0.6);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    } else {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress();
  };
  return (
    <Pressable
      onPress={press}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={done ? 'Done. Tap to mark as not done' : 'Mark as done'}
    >
      <Animated.View style={[styles.check, done && styles.checkDone, { transform: [{ scale: pop }] }]}>
        {done && <Ionicons name="checkmark" size={17} color={c.onTile} />}
      </Animated.View>
    </Pressable>
  );
}

function TaskCard({
  task,
  isNew,
  isNext,
  onLayoutY,
  onToggle,
  onEdit,
  onOpenSource,
}: {
  task: StoredTask;
  isNew: boolean;
  isNext: boolean;
  onLayoutY?: (y: number) => void;
  onToggle: () => void;
  onEdit: () => void;
  onOpenSource: (() => void) | null;
}) {
  const c = useColors();
  const styles = useStyles();
  const [viewing, setViewing] = useState(false);
  const muted = task.done;
  const overdue = isOverdue(task);
  // One short line of what it is: the details a document gave, or the words
  // it came from. Two lines at most — the full text is one tap away.
  const description = task.notes?.trim() || task.sourceText?.trim();
  // A small icon after the title only when there is something behind it:
  // the original screenshot or file, or the memory it came from. Editing is
  // the whole card.
  const icon = task.attachment
    ? { name: 'paperclip' as const, onPress: () => setViewing(true) }
    : onOpenSource
      ? { name: 'link-variant' as const, onPress: onOpenSource }
      : null;
  const time = taskTimeLabel(task);

  return (
    <Pressable
      onPress={onEdit}
      onLayout={onLayoutY ? (e) => onLayoutY(e.nativeEvent.layout.y) : undefined}
      style={[styles.card, isNext && styles.cardNext, muted && styles.cardDone]}
    >
      <CheckCircle done={task.done} onPress={onToggle} />

      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          {/* Just added from a memory: a small dot until the page is seen.
              The outline is kept for one meaning only: what is next. */}
          {isNew && !muted && <View style={styles.newDot} />}
          <Text
            numberOfLines={2}
            style={[styles.taskTitle, muted && styles.mutedText, muted && styles.doneTitle, rtlIfArabic(task.title)]}
          >
            {task.title}
          </Text>
          {icon && (
            <Pressable onPress={icon.onPress} hitSlop={10}>
              <MaterialCommunityIcons name={icon.name} size={15} color={muted ? c.textGhost : c.textGhost} />
            </Pressable>
          )}
        </View>

        {description ? (
          <Text
            numberOfLines={2}
            style={[styles.description, muted && styles.mutedText, rtlIfArabic(description)]}
          >
            {description}
          </Text>
        ) : null}

        {/* One line of status under the words: done, overdue, or when. */}
        {task.done ? (
          <View style={styles.doneBadge}>
            <MaterialCommunityIcons name="check" size={13} color={c.brandSoft} />
            <Text style={styles.doneBadgeText}>Done</Text>
          </View>
        ) : overdue || time ? (
          <View style={styles.metaRow}>
            {time ? (
              <Text style={[styles.taskTime, overdue && styles.overdueTime]}>{time}</Text>
            ) : null}
            {overdue && (
              <View style={styles.overduePill}>
                <Text style={styles.overdueText}>Overdue</Text>
              </View>
            )}
          </View>
        ) : null}
      </View>

      {task.dueDate ? (
        <View style={[styles.dateChip, muted && styles.dateChipMuted, overdue && styles.dateChipOverdue]}>
          <Text style={[styles.dateMonth, muted && styles.mutedText, overdue && styles.overdueTime]}>
            {dueDateParts(task.dueDate).month}
          </Text>
          <Text style={[styles.dateDay, muted && styles.mutedText, overdue && styles.overdueTime]}>
            {dueDateParts(task.dueDate).day}
          </Text>
        </View>
      ) : task.needsDueDate && !task.done ? (
        // The user never said when: a soft nudge to give it a date.
        <View style={[styles.dateChip, styles.dateChipAsk]}>
          <MaterialCommunityIcons name="calendar-question" size={20} color={c.warn} />
          <Text style={styles.dateAskText}>Set date</Text>
        </View>
      ) : null}

      {task.attachment && (
        <AttachmentViewer attachment={viewing ? task.attachment : null} onClose={() => setViewing(false)} />
      )}
    </Pressable>
  );
}

export default function Tasks() {
  const c = useColors();
  const styles = useStyles();
  const router = useRouter();
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Ids that were unseen when this visit started — they keep their
  // highlight for the whole visit, while storage is already marked seen so
  // it is gone next time.
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

  // Pull down: tasks come out of what the user logs, so first anything not
  // written up yet is (transcribed, then read by the intake), then the list.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await transcribePendingMemories();
      await polishPendingMemories();
    } catch (e) {
      console.warn('[tasks] refresh failed:', e);
    } finally {
      reload();
      setRefreshing(false);
    }
  }, [reload]);

  // Swipe to delete, with a few seconds to take it back.
  const { width: screenW } = useWindowDimensions();
  const [undo, setUndo] = useState<StoredTask | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDelete = async (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTasks((all) => all.filter((t) => t.id !== id));
    const removed = await deleteTask(id);
    console.log(`[tasks] deleted by swipe: ${removed?.title ?? id}`);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(removed);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    reload();
  };
  const onUndo = async () => {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await restoreTask(undo);
    setUndo(null);
    reload();
  };

  const onToggle = async (id: string) => {
    const wasNext = id === nextId;
    await toggleTask(id);
    // The outline slides to the next task rather than blinking over…
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // …and when the one just ticked off was the highlighted one, the page
    // follows it to wherever the next one is — even above, out of view.
    followNext.current = wasNext;
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

  const sections = groupByWeek(tasks);

  // "Next" moves on by itself as the day goes: checked every minute, so the
  // outline leaves a 3 pm task once it is 3 pm without the page reopening.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const timer = setInterval(() => setNow(new Date()), 60_000);
      return () => clearInterval(timer);
    }, []),
  );
  const nextId = nextUpId(tasks, now);
  const nextSection = sections.find((s) => s.tasks.some((t) => t.id === nextId))?.key;

  // Open on what is next — or on this week when nothing is — with its week
  // header in view. Once per visit, so it never jumps while reading.
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const sectionY = useRef<Record<string, number>>({});
  const nextCardY = useRef<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      scrolled.current = false;
    }, []),
  );
  // Where each card sits inside its week, so the page can go to whichever
  // task becomes next.
  const cardY = useRef<Record<string, number>>({});
  const followNext = useRef(false);

  const tryScroll = () => {
    if (scrolled.current) return;
    let y: number | undefined;
    if (nextSection) {
      const top = sectionY.current[nextSection];
      if (top == null || nextCardY.current == null) return;
      // Keep the week's header in view when the card is its first.
      y = nextCardY.current < 120 ? top : top + nextCardY.current - 24;
    } else {
      y = sectionY.current.this;
      if (y == null) return;
    }
    scrolled.current = true;
    if (y > 40) scrollRef.current?.scrollTo({ y: y - 8, animated: false });
  };
  const onSectionLayout = (key: string, y: number) => {
    sectionY.current[key] = y;
    tryScroll();
  };

  useEffect(() => {
    if (!followNext.current || !nextId || !nextSection) return;
    followNext.current = false;
    const t = setTimeout(() => {
      const top = sectionY.current[nextSection];
      const inSection = cardY.current[nextId];
      if (top == null || inSection == null) return;
      const y = inSection < 120 ? top : top + inSection - 24;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }, 280);
    return () => clearTimeout(t);
  }, [nextId, nextSection]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header with the + button for deliberate task creation */}
      <View style={styles.header}>
        <Pressable
          onPress={() => goBack(router, '/home')}
          hitSlop={12}
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={28} color={c.brand} />
        </Pressable>
        <Text style={styles.headerTitle}>Tasks</Text>
        <Pressable onPress={() => router.push('/log/task-edit')} hitSlop={12} style={styles.addBtn}>
          <Ionicons name="add" size={26} color={c.onTile} />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.brandSoft} colors={[c.brandSoft]} />}
      >
        {loaded && tasks.length === 0 && (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="checkbox-marked-circle-plus-outline" size={40} color={c.textGhost} />
            <Text style={styles.emptyTitle}>No tasks yet</Text>
            <Text style={styles.emptyText}>
              Tap + to add one, or just log a memory like “I have to get some fruits tomorrow
              morning” and Recall will turn it into a task for you.
            </Text>
          </View>
        )}

        {sections.map((section) => (
          <View key={section.key} onLayout={(e) => onSectionLayout(section.key, e.nativeEvent.layout.y)}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, section.past && styles.sectionPast]}>{section.title}</Text>
              {section.range ? (
                <Text style={[styles.sectionRange, section.past && styles.sectionPast]}>{section.range}</Text>
              ) : null}
            </View>
            {section.tasks.map((task) => (
              <SwipeToDelete
                key={task.id}
                rowWidth={screenW - 40}
                style={styles.swipeRow}
                onDelete={() => onDelete(task.id)}
              >
              <TaskCard
                task={task}
                isNew={newIds.has(task.id)}
                isNext={task.id === nextId}
                onLayoutY={(y) => {
                  cardY.current[task.id] = y;
                  if (task.id === nextId) {
                    nextCardY.current = y;
                    tryScroll();
                  }
                }}
                onToggle={() => onToggle(task.id)}
                onEdit={() => router.push({ pathname: '/log/task-edit', params: { id: task.id } })}
                onOpenSource={
                  task.sourceDate
                    ? () =>
                        router.push(
                          `/day/${offsetFromDate(task.sourceDate!)}` as Parameters<typeof router.push>[0],
                        )
                    : null
                }
              />
              </SwipeToDelete>
            ))}
          </View>
        ))}
      </ScrollView>

      {undo && (
        <View style={styles.undoBar} pointerEvents="box-none">
          <View style={styles.undoPill}>
            <Text style={styles.undoText} numberOfLines={1}>
              Task deleted
            </Text>
            <Pressable onPress={onUndo} hitSlop={10}>
              <Text style={styles.undoAction}>Undo</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* "When is this due?" — confirmation for AI-created dateless tasks */}
      <Modal visible={!!askTask} transparent animationType="fade" onRequestClose={dismissAsk}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}>
              <MaterialCommunityIcons name="calendar-question" size={26} color={c.brandSoft} />
            </View>
            <Text style={styles.modalTitle}>New task from your memory</Text>
            <Text style={[styles.modalTask, askTask ? rtlIfArabic(askTask.title) : undefined]}>
              “{askTask?.title}”
            </Text>
            <Text style={styles.modalBody}>
              You didn’t mention when. Want to give it a due date so Recall can remind you?
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

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    backgroundColor: c.surface,
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: c.textBody },
  addBtn: {
    position: 'absolute',
    right: 20,
    top: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { flex: 1, backgroundColor: c.bgSoft },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 },

  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 30, gap: 12 },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: c.textMuted },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: c.textFaint,
    textAlign: 'center',
  },

  // Week headers: a thin rule above and below, the week's name left and its
  // dates right. Weeks that have passed are drawn quieter.
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: c.border,
    paddingVertical: 12,
    marginTop: 22,
  },
  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: c.textBody },
  sectionRange: { fontFamily: fonts.semiBold, fontSize: 15, color: c.textBody },
  sectionPast: { color: c.textFaint },
  mutedText: { color: c.textGhost },

  // The gap above each task belongs to its swipe row, so the red Delete
  // behind a card is exactly the card's height.
  swipeRow: { marginTop: 14 },
  undoBar: { position: 'absolute', left: 0, right: 0, bottom: 176, alignItems: 'center' },
  undoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    // A dark toast in light; in dark, a raised one with a faint edge.
    backgroundColor: c.scheme === 'dark' ? c.raised : colors.ink,
    borderWidth: c.scheme === 'dark' ? 1 : 0,
    borderColor: c.edge,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  undoText: { fontFamily: fonts.medium, fontSize: 14, color: c.onTile },
  undoAction: { fontFamily: fonts.semiBold, fontSize: 14, color: c.accent },
  // Tick | words | date: the tick where the thumb is, the date where the
  // eye lands to scan a week.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingVertical: 16,
    paddingLeft: 16,
    paddingRight: 14,
    borderWidth: 2,
    borderColor: c.surface,
  },
  // Finished: still readable, clearly stepped back.
  cardDone: { backgroundColor: c.fillSoft, borderColor: c.fillSoft },
  cardBody: { flex: 1, gap: 4 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: c.brandMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: c.tileAlt, borderColor: c.brandSoft },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  overduePill: { backgroundColor: c.dangerWash, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  dateChipOverdue: { backgroundColor: c.dangerWash },
  // What is next: the design's teal outline, on one task at a time.
  cardNext: { borderColor: c.accent },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  taskTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: c.textBody, flexShrink: 1 },
  description: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: c.textMuted,
  },
  taskTime: { fontFamily: fonts.semiBold, fontSize: 14, color: c.brandSoft },
  overdueTime: { color: c.danger },
  overdueText: { fontFamily: fonts.semiBold, fontSize: 11, color: c.danger },
  doneTitle: { textDecorationLine: 'line-through' },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 2,
    backgroundColor: c.fill,
    borderRadius: 999,
    paddingVertical: 3,
    paddingLeft: 7,
    paddingRight: 9,
  },
  doneBadgeText: { fontFamily: fonts.semiBold, fontSize: 12, color: c.brandSoft },

  dateChip: {
    backgroundColor: c.fill,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
  },
  dateChipMuted: { backgroundColor: c.fill },
  dateChipAsk: { backgroundColor: c.warnWash, gap: 2 },
  dateAskText: { fontFamily: fonts.medium, fontSize: 11, color: c.warn },
  dateMonth: { fontFamily: fonts.semiBold, fontSize: 12, color: c.brand },
  dateDay: { fontFamily: fonts.bold, fontSize: 20, color: c.brand, lineHeight: 24 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: c.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: c.raised,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  modalIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.chip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: c.text },
  modalTask: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: c.brandSoft,
    textAlign: 'center',
    marginTop: 10,
  },
  modalBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  modalPrimary: {
    alignSelf: 'stretch',
    backgroundColor: c.tile,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  modalPrimaryText: { fontFamily: fonts.semiBold, fontSize: 15, color: c.onTile },
  modalSecondary: { paddingVertical: 12, alignItems: 'center' },
  modalSecondaryText: { fontFamily: fonts.medium, fontSize: 14, color: c.textFaint },
}));
