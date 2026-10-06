import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Press, hold and drag to reorder — the way Notes, Reminders and most apps
// do it: after a short hold the item lifts (a little larger, with a
// shadow) and follows the finger; the others slide aside to open the gap
// where it would land; letting go settles it into that gap. A quick swipe
// is still a scroll — only a hold starts a drag.
//
// The list keeps the order on screen itself, so the drop never jumps back
// while the caller is saving it.

const LIFT_DELAY_MS = 320;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** The new order, after a drop that changed it. */
  onReorder: (items: T[], moved: { from: number; to: number }) => void;
  /** Called when a drag starts and ends — the screen stops scrolling. */
  onDragging?: (dragging: boolean) => void;
  enabled?: boolean;
};

export default function ReorderableList<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  onDragging,
  enabled = true,
}: Props<T>) {
  const [order, setOrder] = useState(items);
  useEffect(() => setOrder(items), [items]);

  const heights = useSharedValue<number[]>([]);
  const active = useSharedValue(-1);
  const hover = useSharedValue(-1);
  const dragY = useSharedValue(0);

  // Heights by item, so they follow an item when it changes place.
  const heightOf = useRef<Record<string, number>>({});
  const syncHeights = (list: T[]) => {
    heights.value = list.map((it) => heightOf.current[keyOf(it)] ?? 0);
  };

  // The drop: once the new order is laid out, everything stands still in
  // its new place — no row slides back from where it was shifted to.
  const dropped = useRef(false);
  useLayoutEffect(() => {
    syncHeights(order);
    if (!dropped.current) return;
    dropped.current = false;
    active.value = -1;
    hover.value = -1;
    dragY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  const commit = (from: number, to: number) => {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    dropped.current = true;
    setOrder(next);
    onDragging?.(false);
    onReorder(next, { from, to });
  };

  const cancel = () => {
    onDragging?.(false);
  };

  return (
    <View>
      {order.map((item, index) => (
        <Row
          key={keyOf(item)}
          index={index}
          onHeight={(h) => {
            heightOf.current[keyOf(item)] = h;
            syncHeights(order);
          }}
          count={order.length}
          heights={heights}
          active={active}
          hover={hover}
          dragY={dragY}
          enabled={enabled && order.length > 1}
          onStart={() => onDragging?.(true)}
          onDrop={commit}
          onCancel={cancel}
        >
          {renderItem(item, index)}
        </Row>
      ))}
    </View>
  );
}

function Row({
  index,
  onHeight,
  count,
  heights,
  active,
  hover,
  dragY,
  enabled,
  onStart,
  onDrop,
  onCancel,
  children,
}: {
  index: number;
  onHeight: (h: number) => void;
  count: number;
  heights: SharedValue<number[]>;
  active: SharedValue<number>;
  hover: SharedValue<number>;
  dragY: SharedValue<number>;
  enabled: boolean;
  onStart: () => void;
  onDrop: (from: number, to: number) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const lift = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(LIFT_DELAY_MS)
    .onStart(() => {
      active.value = index;
      hover.value = index;
      dragY.value = 0;
      lift.value = withTiming(1, { duration: 140 });
      runOnJS(onStart)();
    })
    .onUpdate((e) => {
      dragY.value = e.translationY;
      // Where the lifted item's middle is now, against the others' middles.
      const hs = heights.value;
      let top = 0;
      for (let i = 0; i < index; i++) top += hs[i] ?? 0;
      const mid = top + (hs[index] ?? 0) / 2 + e.translationY;
      let target = 0;
      let y = 0;
      for (let i = 0; i < count; i++) {
        if (i === index) continue;
        const h = hs[i] ?? 0;
        if (mid > y + h / 2) target++;
        y += h;
      }
      hover.value = target;
    })
    .onEnd(() => {
      const from = index;
      const to = hover.value;
      const hs = heights.value;
      // Settle exactly into the gap, then hand the new order over.
      let shift = 0;
      if (to > from) for (let i = from + 1; i <= to; i++) shift += hs[i] ?? 0;
      else for (let i = to; i < from; i++) shift -= hs[i] ?? 0;
      lift.value = withTiming(0, { duration: 160 });
      dragY.value = withSpring(shift, SPRING, (done) => {
        if (!done) return;
        if (to !== from) runOnJS(onDrop)(from, to);
        else {
          active.value = -1;
          hover.value = -1;
          dragY.value = 0;
          runOnJS(onCancel)();
        }
      });
    })
    .onFinalize((_, success) => {
      if (success) return;
      lift.value = withTiming(0, { duration: 160 });
    });

  const style = useAnimatedStyle(() => {
    const a = active.value;
    if (a === index) {
      return {
        zIndex: 10,
        transform: [{ translateY: dragY.value }, { scale: 1 + lift.value * 0.03 }],
        shadowColor: '#081112',
        shadowOpacity: lift.value * 0.18,
        shadowRadius: lift.value * 14,
        shadowOffset: { width: 0, height: lift.value * 6 },
      };
    }
    // Others open the gap: everything between where it was and where it
    // would land moves one place toward its old spot.
    // No drag going on: stand exactly in place, no animation — this is
    // also the frame right after a drop, when the order has just changed.
    if (a < 0) return { zIndex: 0, transform: [{ translateY: 0 }, { scale: 1 }], shadowOpacity: 0 };
    const h = heights.value[a] ?? 0;
    const t = hover.value;
    let y = 0;
    if (a < index && index <= t) y = -h;
    else if (t <= index && index < a) y = h;
    return {
      zIndex: 0,
      transform: [{ translateY: withSpring(y, SPRING) }, { scale: 1 }],
      shadowOpacity: 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={onLayout} style={style}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
