import { type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';

// The Timeline's cards, movable: hold one, it lifts and follows the finger
// anywhere on the canvas, and the dashed lines stay joined to it the whole
// way. A plain swipe still pans the canvas and a tap still opens what it
// always did — moving a card needs the hold, so it never happens by
// accident. Where each card was put is remembered for that day.
//
// The lines are drawn as one smooth path each (SVG) with rounded corners,
// rather than three dashed boxes meeting at a corner — which is why the
// old ones looked broken where they turned.

export const CARD_IDS = ['people', 'photo', 'day', 'places', 'otd', 'assumed'] as const;
export type CardId = (typeof CARD_IDS)[number];

export type Offset = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  lift: SharedValue<number>;
  /** Stacking: the card moved last sits on top of the others. */
  z: SharedValue<number>;
  /** Shared by every card — the highest z handed out so far. */
  top: SharedValue<number>;
};
export type Offsets = Record<CardId, Offset>;
export type Rect = { x: number; y: number; w: number; h?: number };

const HOLD_MS = 320;
const KEY = 'timelineLayout';

/** One pair of shared values per card — a fixed set, so hooks stay in order. */
export function useCardOffsets(): Offsets {
  /* eslint-disable react-hooks/rules-of-hooks */
  const top = useSharedValue(1);
  const make = (): Offset => ({ x: useSharedValue(0), y: useSharedValue(0), lift: useSharedValue(0), z: useSharedValue(1), top });
  return {
    people: make(),
    photo: make(),
    day: make(),
    places: make(),
    otd: make(),
    assumed: make(),
  };
  /* eslint-enable react-hooks/rules-of-hooks */
}

type Saved = Record<string, Partial<Record<CardId, { x: number; y: number }>>>;

async function readAll(): Promise<Saved> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

/** Puts every card where the user left it on that day (or where it
 *  belongs, if never moved). */
export async function restoreOffsets(day: string, offsets: Offsets): Promise<void> {
  const saved = (await readAll())[day] ?? {};
  for (const id of CARD_IDS) {
    offsets[id].x.value = saved[id]?.x ?? 0;
    offsets[id].y.value = saved[id]?.y ?? 0;
  }
}

async function saveOffset(day: string, id: CardId, x: number, y: number): Promise<void> {
  const all = await readAll();
  all[day] = { ...(all[day] ?? {}), [id]: { x: Math.round(x), y: Math.round(y) } };
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  console.log(`[timeline] moved ${id} on ${day} by ${Math.round(x)}, ${Math.round(y)}`);
}

export function DraggableCard({
  id,
  day,
  rect,
  offsets,
  scale,
  bounds,
  onLayout,
  children,
}: {
  onLayout?: (e: LayoutChangeEvent) => void;
  id: CardId;
  day: string;
  rect: Rect;
  offsets: Offsets;
  /** The canvas zoom: a finger moving 10 pt at half zoom moves a card 20. */
  scale: SharedValue<number>;
  /** How far a card may go, in canvas points, so it can't be lost. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  children: ReactNode;
}) {
  const o = offsets[id];
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const save = (x: number, y: number) => {
    saveOffset(day, id, x, y).catch((e) => console.warn('[timeline] could not remember where a card went:', e));
  };

  const drag = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      startX.value = o.x.value;
      startY.value = o.y.value;
      o.top.value += 1;
      o.z.value = o.top.value;
      o.lift.value = withSpring(1, { damping: 16, stiffness: 260 });
      runOnJS(tick)();
    })
    .onUpdate((e) => {
      const s = scale.value || 1;
      const nx = startX.value + e.translationX / s;
      const ny = startY.value + e.translationY / s;
      // Kept on the canvas: a card dragged off the edge would be gone.
      o.x.value = Math.min(bounds.maxX - rect.x - rect.w, Math.max(bounds.minX - rect.x, nx));
      o.y.value = Math.min(bounds.maxY - rect.y - (rect.h ?? 120), Math.max(bounds.minY - rect.y, ny));
    })
    .onFinalize((_e, success) => {
      o.lift.value = withTiming(0, { duration: 180 });
      if (success) runOnJS(save)(o.x.value, o.y.value);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: o.x.value },
      { translateY: o.y.value },
      { scale: 1 + 0.04 * o.lift.value },
    ],
    // Floats above everything while held, and stays above once put down.
    zIndex: o.lift.value > 0.01 ? 1000 : o.z.value,
    shadowOpacity: 0.2 * o.lift.value,
    shadowRadius: 10 + 14 * o.lift.value,
    shadowOffset: { width: 0, height: 4 + 10 * o.lift.value },
  }));

  return (
    <GestureDetector gesture={drag}>
      <Animated.View onLayout={onLayout} style={[styles.slot, { left: rect.x, top: rect.y, width: rect.w }, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/** Where a card's content sits inside its DraggableCard. */
export const IN_SLOT = { position: 'relative' as const, left: 0, top: 0, width: '100%' as const };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type Link = { from: CardId; to: CardId };

/** Every dashed line on the canvas, in one layer under the cards. Each joins
 *  the two cards' facing edges — bottom to top when one is below the other,
 *  side to side when they're next to each other — and re-routes as a card
 *  is dragged past the other. */
export function Connectors({
  links,
  rects,
  offsets,
  origin,
  size,
}: {
  links: Link[];
  rects: Partial<Record<CardId, Rect>>;
  offsets: Offsets;
  /** The layer's top-left in canvas points (it reaches past the cards). */
  origin: { x: number; y: number };
  size: { w: number; h: number };
}) {
  return (
    <View pointerEvents="none" style={[styles.layer, { left: origin.x, top: origin.y, width: size.w, height: size.h }]}>
      <Svg width={size.w} height={size.h}>
        {links.map((l) => {
          const a = rects[l.from];
          const b = rects[l.to];
          if (!a?.h || !b?.h) return null;
          return (
            <Line
              key={`${l.from}-${l.to}`}
              a={a as Required<Rect>}
              b={b as Required<Rect>}
              oa={offsets[l.from]}
              ob={offsets[l.to]}
              origin={origin}
            />
          );
        })}
      </Svg>
    </View>
  );
}

type Ends = { x1: number; y1: number; x2: number; y2: number; vertical: boolean; apart: boolean };

/** The two ends of a line, from where both cards are right now. */
function endsOf(a: Required<Rect>, b: Required<Rect>, ax: number, ay: number, bx: number, by: number): Ends {
  'worklet';
  const acx = ax + a.w / 2;
  const acy = ay + a.h / 2;
  const bcx = bx + b.w / 2;
  const bcy = by + b.h / 2;
  // Clear space between them on each axis: whichever is larger says
  // whether they sit above each other or side by side.
  const gapY = Math.max(by - (ay + a.h), ay - (by + b.h));
  const gapX = Math.max(bx - (ax + a.w), ax - (bx + b.w));
  // Overlapping cards have no space for a line between them.
  const apart = gapX > 6 || gapY > 6;
  if (gapY >= gapX) {
    const down = bcy > acy;
    return { x1: acx, y1: down ? ay + a.h : ay, x2: bcx, y2: down ? by : by + b.h, vertical: true, apart };
  }
  const right = bcx > acx;
  return { x1: right ? ax + a.w : ax, y1: acy, x2: right ? bx : bx + b.w, y2: bcy, vertical: false, apart };
}

/** An elbow with rounded corners; straight when the ends line up. */
function pathOf(e: Ends): string {
  'worklet';
  if (!e.apart) return 'M 0 0';
  const { x1, y1, x2, y2 } = e;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const r = Math.min(16, Math.abs(dx) / 2, Math.abs(dy) / 2);
  if (e.vertical) {
    if (Math.abs(dx) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const ym = y1 + dy / 2;
    return (
      `M ${x1} ${y1} L ${x1} ${ym - r * sy} Q ${x1} ${ym} ${x1 + r * sx} ${ym} ` +
      `L ${x2 - r * sx} ${ym} Q ${x2} ${ym} ${x2} ${ym + r * sy} L ${x2} ${y2}`
    );
  }
  if (Math.abs(dy) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const xm = x1 + dx / 2;
  return (
    `M ${x1} ${y1} L ${xm - r * sx} ${y1} Q ${xm} ${y1} ${xm} ${y1 + r * sy} ` +
    `L ${xm} ${y2 - r * sy} Q ${xm} ${y2} ${xm + r * sx} ${y2} L ${x2} ${y2}`
  );
}

function Line({
  a,
  b,
  oa,
  ob,
  origin,
}: {
  a: Required<Rect>;
  b: Required<Rect>;
  oa: Offset;
  ob: Offset;
  origin: { x: number; y: number };
}) {
  // The cards' positions are read right here, not inside a helper: the
  // animation only follows the values it can see itself, and a line that
  // read them one step removed stayed where the card used to be.
  const ends = useDerivedValue(() =>
    endsOf(
      a,
      b,
      a.x + oa.x.value - origin.x,
      a.y + oa.y.value - origin.y,
      b.x + ob.x.value - origin.x,
      b.y + ob.y.value - origin.y,
    ),
  );
  const pathProps = useAnimatedProps(() => ({ d: pathOf(ends.value) }));
  const startDot = useAnimatedProps(() => ({ cx: ends.value.x1, cy: ends.value.y1, r: ends.value.apart ? 5 : 0 }));
  const endDot = useAnimatedProps(() => ({ cx: ends.value.x2, cy: ends.value.y2, r: ends.value.apart ? 5 : 0 }));

  return (
    <>
      <AnimatedPath
        animatedProps={pathProps}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2.5}
        strokeDasharray="7 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <AnimatedCircle animatedProps={startDot} fill={colors.accent} />
      <AnimatedCircle animatedProps={endDot} fill={colors.accent} />
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', shadowColor: '#0B2A2E', borderRadius: 24 },
  layer: { position: 'absolute' },
});
