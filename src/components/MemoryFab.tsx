import { useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { ICONS } from '../images';
import { colors, fonts } from '../theme';

// The + in the middle of the bar: the three ways to log a memory.
//
// The bubbles spring out the moment the + is touched (with a knock):
// - slide onto one — it lights up (colours reversed, a tick, its name
//   above it) — and let go to pick it; let go anywhere else and nothing
//   happens;
// - or just tap the +, and tap a bubble.

const FAB = 76;
const BUBBLE = 58;
// Where the bubbles sit, from the + button's centre (points). Type is on
// the right — the easiest slide for a right thumb — as the most used.
const ACTIONS = [
  { key: 'upload', label: 'Upload', icon: ICONS.upload, lit: ICONS.uploadArrow, iconSize: 40, dx: -74, dy: -46, href: '/log/photo' },
  { key: 'talk', label: 'Talk', icon: ICONS.voice, lit: ICONS.voice, iconSize: 32, dx: 0, dy: -86, href: '/log/voice' },
  { key: 'type', label: 'Type', icon: ICONS.keyboard, lit: ICONS.keyboard, iconSize: 30, dx: 74, dy: -46, href: '/log/text' },
] as const;
/** How near a bubble's centre a finger counts as on it — a bit bigger than
 *  the bubble, so a thumb doesn't have to be exact. */
const HIT = BUBBLE / 2 + 16;

const tick = (style: Haptics.ImpactFeedbackStyle) => Haptics.impactAsync(style).catch(() => {});

export default function MemoryFab() {
  const router = useRouter();
  // The logging screen needs to know which tab to return to (see useReturnTo).
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const openAnim = useRef(new Animated.Value(0)).current;
  const litAnims = useRef(ACTIONS.map(() => new Animated.Value(0))).current;
  const fabRef = useRef<View>(null);
  const centre = useRef({ x: 0, y: 0 });
  const litRef = useRef<number | null>(null);

  const show = (to: 0 | 1, cb?: () => void) => {
    if (to) {
      Animated.spring(openAnim, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start(cb);
    } else {
      Animated.timing(openAnim, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(cb);
    }
  };

  const light = (i: number | null) => {
    if (litRef.current === i) return;
    if (litRef.current !== null) {
      Animated.timing(litAnims[litRef.current], { toValue: 0, duration: 140, useNativeDriver: false }).start();
    }
    if (i !== null) {
      Animated.spring(litAnims[i], { toValue: 1, friction: 5, tension: 160, useNativeDriver: false }).start();
      Haptics.selectionAsync().catch(() => {});
    }
    litRef.current = i;
    setLit(i);
  };

  const openUp = () => {
    setOpen(true);
    show(1);
    tick(Haptics.ImpactFeedbackStyle.Medium);
  };

  const close = () => {
    light(null);
    setOpen(false);
    show(0);
  };

  const pick = (i: number, how: 'tap' | 'hold') => {
    const a = ACTIONS[i];
    console.log(`[fab] ${a.key} picked by ${how}`);
    light(i);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // A beat of the lit bubble, then away.
    setTimeout(() => {
      setOpen(false);
      show(0, () => {
        light(null);
        router.push({ pathname: a.href, params: { from: pathname } });
      });
    }, 120);
  };

  /** Which bubble is under the finger (window coordinates), if any. */
  const bubbleAt = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestD = HIT;
    ACTIONS.forEach((a, i) => {
      const d = Math.hypot(x - (centre.current.x + a.dx), y - (centre.current.y + a.dy));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const measure = () =>
    fabRef.current?.measureInWindow((x, y, w, h) => {
      centre.current = { x: x + w / 2, y: y + h / 2 };
    });

  // One gesture for both: the bubbles come out the instant the + is
  // touched. Slide onto one and let go to pick it. A quick tap that didn't
  // land on a bubble leaves them open to tap (or, if they were already
  // open, closes them); a longer press let go elsewhere cancels.
  const touch = useRef({ at: 0, wasOpen: false, moved: false });
  const gesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin(() => {
      measure();
      touch.current = { at: Date.now(), wasOpen: open, moved: false };
      if (!open) openUp();
    })
    .onUpdate((e) => {
      if (Math.hypot(e.translationX, e.translationY) > 10) touch.current.moved = true;
      const i = bubbleAt(e.absoluteX, e.absoluteY);
      if (i !== litRef.current && i !== null) console.log(`[fab] over ${ACTIONS[i].key}`);
      light(i);
    })
    .onFinalize(() => {
      const i = litRef.current;
      const quickTap = !touch.current.moved && Date.now() - touch.current.at < 300;
      if (i !== null) pick(i, 'hold');
      else if (quickTap && !touch.current.wasOpen) {
        // A tap: stay open for the bubbles to be tapped.
      } else {
        console.log('[fab] let go away from the bubbles');
        tick(Haptics.ImpactFeedbackStyle.Light);
        close();
      }
    });
  const turn = openAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <>
      {/* Dim the screen while choosing; a tap on it closes. */}
      {open && (
        <Animated.View style={[styles.backdrop, { opacity: openAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
      )}

      {ACTIONS.map((a, i) => {
        const translateX = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, a.dx] });
        const translateY = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0, a.dy] });
        const scale = openAnim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
        const hv = litAnims[i];
        return (
          <Animated.View
            key={a.key}
            pointerEvents={open ? 'box-none' : 'none'}
            style={[styles.slot, { opacity: openAnim, transform: [{ translateX }, { translateY }, { scale }] }]}
          >
            {/* Its name, only while lit */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.label,
                {
                  opacity: hv,
                  transform: [{ translateY: hv.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
                },
              ]}
            >
              <View style={styles.labelPill}>
                <Text style={styles.labelText} numberOfLines={1}>
                  {a.label}
                </Text>
              </View>
            </Animated.View>

            <Pressable onPress={() => pick(i, 'tap')} accessibilityRole="button" accessibilityLabel={a.label}>
              {/* Lit: colours reversed and a little bigger */}
              <Animated.View
                style={[
                  styles.bubble,
                  {
                    backgroundColor: hv.interpolate({ inputRange: [0, 1], outputRange: [colors.soft, colors.primary] }),
                    transform: [{ scale: hv.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }],
                  },
                ]}
              >
                <Animated.Image
                  source={a.icon}
                  style={[styles.glyph, { width: a.iconSize, height: a.iconSize, opacity: Animated.subtract(1, hv) }]}
                  tintColor={colors.primary}
                  resizeMode="contain"
                />
                <Animated.Image
                  source={a.lit}
                  style={[styles.glyph, { width: a.iconSize, height: a.iconSize, opacity: hv }]}
                  tintColor={colors.soft}
                  resizeMode="contain"
                />
              </Animated.View>
            </Pressable>
          </Animated.View>
        );
      })}

      <GestureDetector gesture={gesture}>
        <View
          ref={fabRef}
          style={styles.fab}
          accessible
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close' : 'Log a memory'}
          accessibilityHint="Hold and slide to choose"
          onLayout={measure}
        >
          {/* A thin + that turns into × while open */}
          <Animated.View style={[styles.plus, { transform: [{ rotate: turn }] }]}>
            <View style={styles.plusH} />
            <View style={styles.plusV} />
          </Animated.View>
        </View>
      </GestureDetector>
    </>
  );
}

const FAB_BOTTOM = 60;

const styles = StyleSheet.create({
  // See the note in app/log/voice.tsx — neither absoluteFill nor
  // absoluteFillObject is safe to spread across both native and web after
  // RN 0.85, so the four properties are written out.
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,17,18,0.35)',
  },
  fab: {
    position: 'absolute',
    bottom: FAB_BOTTOM,
    alignSelf: 'center',
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.ink,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  plus: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  plusH: { position: 'absolute', width: 30, height: 2.5, borderRadius: 1.25, backgroundColor: colors.white },
  plusV: { position: 'absolute', width: 2.5, height: 30, borderRadius: 1.25, backgroundColor: colors.white },
  // Each bubble starts at the + button's centre and springs out from there.
  slot: {
    position: 'absolute',
    bottom: FAB_BOTTOM + (FAB - BUBBLE) / 2,
    alignSelf: 'center',
    width: BUBBLE,
    alignItems: 'center',
  },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(8,17,18,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  glyph: { position: 'absolute' },
  // Wider than the bubble, centred over it, so a name never wraps.
  label: {
    position: 'absolute',
    bottom: BUBBLE + 10,
    left: (BUBBLE - 100) / 2,
    width: 100,
    alignItems: 'center',
  },
  labelPill: { backgroundColor: colors.ink, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  labelText: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.white },
});
