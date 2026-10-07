import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { topicIcon, type Topic } from '../onThisDay';
import { colors, fonts } from '../theme';

// One day of On This Day, shrunk to tiles while the user arranges the
// topics: the day's own tile first and fixed, then a tile per topic. Slide
// a topic sideways and the others open a gap; let go and the new order is
// the order on every day — each topic is a column down the whole page.

const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

type Props = {
  topics: Topic[];
  /** Width of the whole row (the screen minus its side margins). */
  width: number;
  gap: number;
  onReorder: (keys: string[]) => void;
};

export default function TopicArrangeRow({ topics, width, gap, onReorder }: Props) {
  const [order, setOrder] = useState(topics);
  useEffect(() => setOrder(topics), [topics]);

  const n = order.length + 1;
  const tileW = (width - gap * (n - 1)) / n;
  const slot = tileW + gap;

  const active = useSharedValue(-1);
  const hover = useSharedValue(-1);
  const dragX = useSharedValue(0);

  // After a drop the new order is laid out first, then the shifts are
  // cleared — nothing slides back from where it was moved to.
  const dropped = useRef(false);
  useLayoutEffect(() => {
    if (!dropped.current) return;
    dropped.current = false;
    active.value = -1;
    hover.value = -1;
    dragX.value = 0;
  }, [order, active, hover, dragX]);

  const tick = () => Haptics.selectionAsync().catch(() => {});

  const finish = (from: number, to: number) => {
    if (from === to) {
      active.value = -1;
      hover.value = -1;
      dragX.value = 0;
      return;
    }
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    dropped.current = true;
    setOrder(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onReorder(next.map((t) => t.key));
  };

  return (
    <View style={[styles.row, { gap }]}>
      <View style={[styles.tile, styles.dayTile, { width: tileW }]}>
        <MaterialCommunityIcons name="notebook-heart-outline" size={20} color="#9AA4A5" />
        <Text numberOfLines={1} style={[styles.label, styles.dayLabel]}>
          Your day
        </Text>
      </View>
      {order.map((t, i) => (
        <Tile
          key={t.key}
          topic={t}
          index={i}
          count={order.length}
          width={tileW}
          slot={slot}
          active={active}
          hover={hover}
          dragX={dragX}
          onHover={tick}
          onDrop={finish}
        />
      ))}
    </View>
  );
}

function Tile({
  topic,
  index,
  count,
  width,
  slot,
  active,
  hover,
  dragX,
  onHover,
  onDrop,
}: {
  topic: Topic;
  index: number;
  count: number;
  width: number;
  slot: number;
  active: SharedValue<number>;
  hover: SharedValue<number>;
  dragX: SharedValue<number>;
  onHover: () => void;
  onDrop: (from: number, to: number) => void;
}) {
  // Sideways drags move the tile; an up-or-down swipe is left to the page.
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onStart(() => {
      active.value = index;
      hover.value = index;
      dragX.value = 0;
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
      const to = Math.max(0, Math.min(count - 1, Math.round(index + e.translationX / slot)));
      if (to !== hover.value) {
        hover.value = to;
        runOnJS(onHover)();
      }
    })
    .onEnd(() => {
      runOnJS(onDrop)(index, hover.value);
    });

  const style = useAnimatedStyle(() => {
    if (active.value === index) {
      return { transform: [{ translateX: dragX.value }, { scale: 1.08 }], zIndex: 2, shadowOpacity: 0.25 };
    }
    let shift = 0;
    if (active.value >= 0) {
      if (active.value < index && index <= hover.value) shift = -slot;
      else if (hover.value <= index && index < active.value) shift = slot;
    }
    return {
      transform: [{ translateX: active.value < 0 ? 0 : withSpring(shift, SPRING) }, { scale: 1 }],
      zIndex: 0,
      shadowOpacity: 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.tile, styles.topicTile, { width }, style]}>
        <MaterialCommunityIcons name={topicIcon(topic.key) as any} size={20} color={colors.white} />
        <Text numberOfLines={1} style={styles.label}>
          {topic.label}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  tile: {
    height: 84,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
    shadowColor: colors.ink,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  dayTile: { backgroundColor: '#E4EBEB' },
  topicTile: { backgroundColor: colors.primary },
  label: { fontFamily: fonts.medium, fontSize: 11, color: colors.white },
  dayLabel: { color: '#8B9394' },
});
