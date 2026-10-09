import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
}: {
  day: string;
  markers: ShownMarker[];
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
  const active = markers.find((m) => m.id === open) ?? null;
  const activeSpot = active ? spotOf(active, markers.indexOf(active)) : null;

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
          <View style={styles.bubbleHeader}>
            <MaterialCommunityIcons name={SIR_KINDS[active.kind].icon} size={18} color={colors.primary} />
            <Text style={[styles.bubbleTitle, rtlIfArabic(active.label)]} numberOfLines={2}>
              {active.label}
            </Text>
          </View>
          <Text style={styles.bubbleSub}>{describe(active)}</Text>
          <Pressable
            onPress={() => {
              setOpen(null);
              onRemove(active);
            }}
            hitSlop={8}
          >
            <Text style={styles.bubbleRemove}>{active.recurring ? 'Remove from every year' : 'Remove'}</Text>
          </Pressable>
        </View>
      )}
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
 *  read one store, so removing an icon here removes it from the Timeline. */
export function SirRow({
  markers,
  onAdd,
  onRemove,
}: {
  markers: ShownMarker[];
  onAdd: () => void;
  onRemove: (marker: ShownMarker) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={styles.row}>
      {markers.map((m) => {
        const isOpen = open === m.id;
        return (
          <View key={m.id} style={styles.rowItem}>
            <Pressable
              onPress={() => setOpen(isOpen ? null : m.id)}
              style={[styles.chip, isOpen && styles.chipOpen]}
            >
              <MaterialCommunityIcons
                name={SIR_KINDS[m.kind].icon}
                size={18}
                color={isOpen ? colors.white : colors.primary}
              />
              <Text
                style={[styles.chipLabel, isOpen && styles.chipLabelOpen, rtlIfArabic(m.label)]}
                numberOfLines={1}
              >
                {m.label}
              </Text>
            </Pressable>
            {isOpen && (
              <View style={styles.chipDetail}>
                <Text style={styles.bubbleSub}>{describe(m)}</Text>
                <Pressable
                  onPress={() => {
                    setOpen(null);
                    onRemove(m);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.bubbleRemove}>
                    {m.recurring ? 'Remove from every year' : 'Remove'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      <Pressable onPress={onAdd} style={[styles.chip, styles.chipAdd]}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.slate} />
        <Text style={[styles.chipLabel, { color: colors.slate }]}>Mark this day</Text>
      </Pressable>
    </View>
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
    width: 200,
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
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  chipOpen: { backgroundColor: colors.primary },
  chipAdd: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.soft,
  },
  chipLabel: { color: colors.primary, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  chipLabelOpen: { color: colors.white },
  chipDetail: { paddingHorizontal: 12, gap: 2 },
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
