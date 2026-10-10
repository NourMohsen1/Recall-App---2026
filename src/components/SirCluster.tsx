import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import {
  SIR_KINDS,
  SIR_KIND_LIST,
  type ShownMarker,
  type SirKind,
} from '../dayMarkers';
import { rtlIfArabic } from '../transcription';
import { colors, fonts } from '../theme';

// Smart Icon Reminders, drawn on the Timeline canvas. See src/dayMarkers.ts
// for what they are and where they come from.
//
// As in Nour's original Timeline design: solid teal circles with a white
// icon, spread around the cards rather than packed into one corner — the
// Timeline screen works out free spots between and beside the cards
// (sirSlots in app/(tabs)/timeline.tsx). Like the cards, an icon can be
// held and dragged anywhere, and stays where it was put on that day. The
// "+" to add one lives on the screen itself, not on the canvas.

export const SIR_SIZE = 54;
const KEY = 'sirLayout';

type Spot = { x: number; y: number };
type Saved = Record<string, Record<string, Spot>>;

async function readSaved(): Promise<Saved> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

async function saveSpot(day: string, id: string, spot: Spot): Promise<void> {
  const all = await readSaved();
  all[day] = { ...(all[day] ?? {}), [id]: { x: Math.round(spot.x), y: Math.round(spot.y) } };
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  console.log(`[timeline] moved a moment icon on ${day}`);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

// The line under a marker's name in its bubble: how often it comes back, or
// where it came from. Said plainly, because an icon the user didn't add
// should always be able to explain itself.
function describe(m: ShownMarker): string {
  if (m.recurring) {
    const r = m.recurring;
    return r.every === 'year' && r.month
      ? `Every year · ${r.day} ${MONTHS[r.month - 1]}`
      : `Every month · the ${ordinal(r.day)}`;
  }
  return m.source === 'manual' ? 'Added by you' : 'Noticed in what you logged';
}

export default function SirCluster({
  day,
  markers,
  slots,
  scale,
  onRemove,
  onNote,
}: {
  day: string;
  markers: ShownMarker[];
  /** The user wrote (or cleared) the note on an icon. */
  onNote: (marker: ShownMarker, note: string) => void;
  /** Free spots on the canvas, best first — one per icon. */
  slots: Spot[];
  /** The canvas zoom, so a drag follows the finger at any zoom. */
  scale: SharedValue<number>;
  onRemove: (marker: ShownMarker) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, Spot>>({});
  useEffect(() => {
    let live = true;
    setOpen(null);
    readSaved().then((all) => live && setSaved(all[day] ?? {}));
    return () => {
      live = false;
    };
  }, [day]);

  useEffect(() => {
    if (markers.length) console.log(`[timeline] ${markers.length} moment icon(s) on ${day}, ${slots.length} free spot(s)`);
  }, [markers.length, slots.length, day]);

  const spotOf = (m: ShownMarker, i: number): Spot => saved[m.id] ?? slots[i] ?? slots[slots.length - 1] ?? { x: 40, y: 40 };
  // A tap shows what an icon is; editing is a step the user asks for.
  const active = markers.find((m) => m.id === open) ?? null;
  const activeSpot = active ? spotOf(active, markers.indexOf(active)) : null;
  const [editing, setEditing] = useState<ShownMarker | null>(null);

  return (
    <>
      {markers.map((m, i) => (
        <SirIcon
          key={m.id}
          marker={m}
          spot={spotOf(m, i)}
          open={open === m.id}
          scale={scale}
          onPress={() => setOpen(open === m.id ? null : m.id)}
          onMoved={(spot) => {
            setOpen(null);
            setSaved((prev) => ({ ...prev, [m.id]: spot }));
            saveSpot(day, m.id, spot).catch((e) => console.warn('[timeline] could not remember an icon:', e));
          }}
        />
      ))}

      {/* Drawn last so it sits over the cards around it, right beside the
          icon that was tapped. */}
      {active && activeSpot && (
        <View style={[styles.bubble, { left: activeSpot.x + SIR_SIZE + 10, top: activeSpot.y - 4 }]}>
          <SirDetails
            marker={active}
            onEdit={() => {
              setOpen(null);
              setEditing(active);
            }}
          />
        </View>
      )}

      <SirWindow
        marker={editing}
        onClose={() => setEditing(null)}
        onSave={(note) => editing && onNote(editing, note)}
        onRemove={() => editing && onRemove(editing)}
      />
    </>
  );
}

/** What an icon is — its name, the user's note, where it came from — with
 *  the way into editing it. */
function SirDetails({ marker, onEdit }: { marker: ShownMarker; onEdit: () => void }) {
  return (
    <>
      <View style={styles.bubbleHeader}>
        <MaterialCommunityIcons name={SIR_KINDS[marker.kind].icon} size={18} color={colors.primary} />
        <Text style={[styles.bubbleTitle, rtlIfArabic(marker.label)]} numberOfLines={2}>
          {marker.label}
        </Text>
      </View>
      {marker.note ? <Text style={[styles.bubbleNote, rtlIfArabic(marker.note)]}>{marker.note}</Text> : null}
      <Text style={styles.bubbleSub}>{describe(marker)}</Text>
      <Pressable onPress={onEdit} hitSlop={8} style={styles.editBtn}>
        <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.primary} />
        <Text style={styles.editText}>{marker.note ? 'Edit' : 'Add a note'}</Text>
      </Pressable>
    </>
  );
}

/** One icon: tap to say what it is, hold to move it. */
function SirIcon({
  marker,
  spot,
  open,
  scale,
  onPress,
  onMoved,
}: {
  marker: ShownMarker;
  spot: Spot;
  open: boolean;
  scale: SharedValue<number>;
  onPress: () => void;
  onMoved: (spot: Spot) => void;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);
  // The new spot is drawn by its left/top once saved; the drag offset goes
  // back to zero in the same frame so it doesn't jump.
  useEffect(() => {
    dx.value = 0;
    dy.value = 0;
  }, [spot.x, spot.y, dx, dy]);

  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const drop = (x: number, y: number) => onMoved({ x: spot.x + x, y: spot.y + y });

  const tap = Gesture.Tap().onEnd((_e, ok) => {
    if (ok) runOnJS(onPress)();
  });
  const drag = Gesture.Pan()
    .activateAfterLongPress(320)
    .onStart(() => {
      lift.value = withSpring(1, { damping: 16, stiffness: 260 });
      runOnJS(tick)();
    })
    .onUpdate((e) => {
      const s = scale.value || 1;
      dx.value = e.translationX / s;
      dy.value = e.translationY / s;
    })
    .onFinalize((_e, success) => {
      lift.value = withTiming(0, { duration: 180 });
      if (success) runOnJS(drop)(dx.value, dy.value);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: 1 + 0.12 * lift.value }],
    zIndex: lift.value > 0.01 ? 1000 : 5,
    shadowOpacity: 0.18 + 0.15 * lift.value,
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <Animated.View style={[styles.icon, { left: spot.x, top: spot.y }, open && styles.iconOpen, style]}>
        <MaterialCommunityIcons
          name={SIR_KINDS[marker.kind].icon}
          size={26}
          color={open ? colors.primary : colors.white}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** The same markers on the day screen: a plain row of labelled icons rather
 *  than a floating grid, because this screen is a list, not a canvas. Both
 *  read one store, so a note or a removal here shows on the Timeline too. */
export function SirRow({
  markers,
  onAdd,
  onRemove,
  onNote,
}: {
  markers: ShownMarker[];
  onAdd: () => void;
  onRemove: (marker: ShownMarker) => void;
  onNote: (marker: ShownMarker, note: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShownMarker | null>(null);
  return (
    <View style={styles.row}>
      {markers.map((m) => (
        <View key={m.id} style={styles.rowItem}>
          <Pressable onPress={() => setOpen(open === m.id ? null : m.id)} style={styles.chip}>
            <MaterialCommunityIcons name={SIR_KINDS[m.kind].icon} size={18} color={colors.primary} />
            <Text style={[styles.chipLabel, rtlIfArabic(m.note ?? m.label)]} numberOfLines={1}>
              {m.note ? `${m.label} · ${m.note}` : m.label}
            </Text>
          </Pressable>
          {open === m.id && (
            <View style={[styles.bubble, styles.bubbleInline]}>
              <SirDetails
                marker={m}
                onEdit={() => {
                  setOpen(null);
                  setEditing(m);
                }}
              />
            </View>
          )}
        </View>
      ))}
      <Pressable onPress={onAdd} style={[styles.chip, styles.chipAdd]}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.slate} />
        <Text style={[styles.chipLabel, { color: colors.slate }]}>Mark this day</Text>
      </Pressable>
      <SirWindow
        marker={editing}
        onClose={() => setEditing(null)}
        onSave={(note) => editing && onNote(editing, note)}
        onRemove={() => editing && onRemove(editing)}
      />
    </View>
  );
}

// What the note field asks, by kind — a nudge toward the one detail that
// makes the icon worth having ("Payday" alone could be any money).
const NOTE_HINT: Partial<Record<SirKind, string>> = {
  payday: 'What was it? Salary, freelance, a refund…',
  purchase: 'What did you buy?',
  medicine: 'Which medicine?',
  doctor: 'Which doctor, and what for?',
  sick: 'What was it?',
  travel: 'Where to?',
  birthday: 'Whose? Any plans?',
  anniversary: 'Of what?',
  dinner: 'Where, and with whom?',
  call: 'Who with, about what?',
  study: 'Which exam or subject?',
  work: 'What happened?',
  workout: 'What did you do?',
  celebration: 'What were you celebrating?',
  car: 'What happened with the car?',
  pet: 'What happened?',
  family: 'What was it?',
  holiday: 'Which holiday?',
  home: 'What changed?',
  achievement: 'What did you do?',
};

/** A small window over the screen — not a new page — for one icon: what
 *  it is, a line of the user's own words about it, Done. */
function SirWindow({
  marker,
  onClose,
  onSave,
  onRemove,
}: {
  marker: ShownMarker | null;
  onClose: () => void;
  onSave: (note: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => setText(marker?.note ?? ''), [marker?.id, marker?.note]);

  // Closing keeps what was typed — tapping outside is not "discard".
  const close = () => {
    if (marker && text.trim() !== (marker.note ?? '')) onSave(text);
    onClose();
  };

  return (
    <Modal visible={!!marker} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.windowWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        {marker && (
          <View style={styles.window}>
            <View style={styles.windowHead}>
              <View style={styles.windowIcon}>
                <MaterialCommunityIcons name={SIR_KINDS[marker.kind].icon} size={22} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bubbleTitle, rtlIfArabic(marker.label)]} numberOfLines={2}>
                  {marker.label}
                </Text>
                <Text style={styles.bubbleSub}>{describe(marker)}</Text>
              </View>
            </View>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={NOTE_HINT[marker.kind] ?? 'Add a note'}
              placeholderTextColor="#9AA4A5"
              style={[styles.noteInput, rtlIfArabic(text)]}
              multiline
              maxLength={140}
            />
            <View style={styles.windowActions}>
              <Pressable
                onPress={() => {
                  onClose();
                  onRemove();
                }}
                hitSlop={8}
              >
                <Text style={styles.bubbleRemove}>{marker.recurring ? 'Remove from every year' : 'Remove'}</Text>
              </Pressable>
              <Pressable onPress={close} style={styles.doneBtn}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The list of icons to choose from, for the "+". */
export function SirPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (kind: SirKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Mark this day</Text>
        <Text style={styles.sheetHint}>
          Birthdays and anniversaries come back on this date every year.
        </Text>
        <ScrollView contentContainerStyle={styles.grid}>
          {SIR_KIND_LIST.map((kind) => (
            <Pressable key={kind} onPress={() => onPick(kind)} style={styles.choice}>
              <View style={styles.choiceIcon}>
                <MaterialCommunityIcons name={SIR_KINDS[kind].icon} size={24} color={colors.primary} />
              </View>
              <Text style={styles.choiceLabel} numberOfLines={2}>
                {SIR_KINDS[kind].label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Solid teal with a white icon and a white edge, so a small thing reads
  // clearly on the dotted canvas (Nour's original design, larger and
  // inverted from the first build's white circles).
  icon: {
    position: 'absolute',
    width: SIR_SIZE,
    height: SIR_SIZE,
    borderRadius: SIR_SIZE / 2,
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B2A2E',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  // Tapped: the colours swap back, so it reads as selected.
  iconOpen: { backgroundColor: colors.white, borderColor: colors.primary },
  bubble: {
    position: 'absolute',
    // Above every card, including one that was just moved to the top.
    zIndex: 2000,
    width: 210,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E1E7E8',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    gap: 4,
  },
  // On the day screen the details open under the chip, in the flow.
  bubbleInline: { position: 'relative', zIndex: 0, width: 230 },
  bubbleNote: { color: colors.ink, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: '#EEF3F3',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  editText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  windowWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, backgroundColor: 'rgba(8,17,18,0.25)' },
  window: {
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: 18,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  windowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  windowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteInput: {
    minHeight: 64,
    maxHeight: 120,
    borderRadius: 14,
    backgroundColor: '#EEF3F3',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  windowActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneBtn: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 22 },
  doneText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },
  bubbleTitle: { flex: 1, color: colors.ink, fontFamily: fonts.semiBold, fontSize: 14 },
  bubbleSub: { color: colors.slate, fontFamily: fonts.regular, fontSize: 12 },
  bubbleRemove: {
    color: '#B4574F',
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 6,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowItem: { gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF3F3',
  },
  chipAdd: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.soft,
  },
  chipLabel: { color: colors.primary, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(8,17,18,0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.pale,
    marginBottom: 14,
  },
  sheetTitle: { color: colors.ink, fontFamily: fonts.semiBold, fontSize: 18 },
  sheetHint: {
    color: colors.slate,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 12 },
  choice: { width: 76, alignItems: 'center', gap: 6 },
  choiceIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EEF3F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLabel: {
    color: colors.primary,
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: 'center',
  },
});
