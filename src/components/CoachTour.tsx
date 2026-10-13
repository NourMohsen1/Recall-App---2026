import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect as SvgRect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import type { Rect } from '../coachTargets';
import { colors, fonts } from '../theme';

// A tour of the real screen, one part at a time: everything dims except
// the part being explained, which gets a ring, and a speech bubble points
// at it with a line or two and Next. The way MyFitnessPal and Gymshark do
// it (Nour's references), in Recall's teal.
//
// Each step measures its part when it comes up, so the ring lands on
// whatever is really there, at whatever size the phone draws it.

export type TourStep = {
  key: string;
  title: string;
  body: string;
  /** Where the part is now, after scrolling it into view if needed. */
  measure: () => Promise<Rect | null>;
  /** A circle for round things (the +), a rounded box otherwise. */
  round?: boolean;
};

const PAD = 8;
const GAP = 14;
const SIDE = 16;

export default function CoachTour({
  steps,
  visible,
  onDone,
}: {
  steps: TourStep[];
  visible: boolean;
  /** `finished`: went through to the end, rather than closed early. */
  onDone: (finished: boolean) => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  // Measure the step's part, then fade the ring and bubble in on it. A part
  // that can't be found is skipped rather than pointed at nothing.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    fade.setValue(0);
    setRect(null);
    steps[index]
      ?.measure()
      .then((r) => {
        if (!live) return;
        if (!r) {
          console.warn(`[tour] could not find "${steps[index].key}", skipping it`);
          if (index < steps.length - 1) setIndex(index + 1);
          else onDone(true);
          return;
        }
        setRect(r);
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  const step = steps[index];
  const last = index === steps.length - 1;
  const next = () => {
    if (last) onDone(true);
    else setIndex(index + 1);
  };

  // The hole in the dim layer: the part plus a little room around it.
  const hole = rect && {
    x: rect.x - PAD,
    y: rect.y - PAD,
    w: rect.width + PAD * 2,
    h: rect.height + PAD * 2,
  };
  const r = hole ? (step?.round ? Math.min(hole.w, hole.h) / 2 : 18) : 0;
  const dim = hole
    ? `M0 0H${W}V${H}H0Z ` +
      `M${hole.x + r} ${hole.y}H${hole.x + hole.w - r}A${r} ${r} 0 0 1 ${hole.x + hole.w} ${hole.y + r}` +
      `V${hole.y + hole.h - r}A${r} ${r} 0 0 1 ${hole.x + hole.w - r} ${hole.y + hole.h}` +
      `H${hole.x + r}A${r} ${r} 0 0 1 ${hole.x} ${hole.y + hole.h - r}V${hole.y + r}A${r} ${r} 0 0 1 ${hole.x + r} ${hole.y}Z`
    : `M0 0H${W}V${H}H0Z`;

  // The bubble goes on whichever side of the part has more room, with its
  // point aimed at the part's centre.
  const below = hole ? hole.y + hole.h / 2 < H / 2 : true;
  const centreX = rect ? rect.x + rect.width / 2 : W / 2;
  const arrowLeft = Math.min(Math.max(centreX - SIDE - 9, 22), W - SIDE * 2 - 40);
  const bubblePos = hole
    ? below
      ? { top: hole.y + hole.h + GAP }
      : { bottom: H - hole.y + GAP }
    : { top: H / 3 };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => onDone(false)}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
          <Path d={dim} fill="rgba(8,17,18,0.72)" fillRule="evenodd" />
          {hole && (
            <SvgRect
              x={hole.x}
              y={hole.y}
              width={hole.w}
              height={hole.h}
              rx={r}
              ry={r}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2.5}
            />
          )}
        </Svg>

        {step && hole && (
          <Animated.View
            style={[
              styles.bubble,
              bubblePos,
              {
                opacity: fade,
                transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [below ? -8 : 8, 0] }) }],
              },
            ]}
          >
            <View style={[styles.arrow, below ? styles.arrowUp : styles.arrowDown, { left: arrowLeft }]} />
            <View style={styles.headRow}>
              <Text style={styles.title}>{step.title}</Text>
              <Pressable onPress={() => onDone(false)} hitSlop={12} accessibilityLabel="Close the tour">
                <Ionicons name="close" size={24} color={colors.white} />
              </Pressable>
            </View>
            <Text style={styles.body}>{step.body}</Text>
            <View style={styles.footRow}>
              <Text style={styles.count}>
                {index + 1}/{steps.length}
              </Text>
              <Pressable onPress={next} style={styles.nextBtn}>
                <Text style={styles.nextText}>{last ? 'Got it' : 'Next'}</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    left: SIDE,
    right: SIDE,
    backgroundColor: colors.primary,
    borderRadius: 22,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  // A square turned 45°, half hidden behind the bubble: its point.
  arrow: {
    position: 'absolute',
    width: 18,
    height: 18,
    backgroundColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  arrowUp: { top: -8 },
  arrowDown: { bottom: -8 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.white },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: '#D6E1E2', marginTop: 6 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  count: { fontFamily: fonts.medium, fontSize: 13, color: colors.soft },
  nextBtn: { backgroundColor: colors.white, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 26 },
  nextText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
});
