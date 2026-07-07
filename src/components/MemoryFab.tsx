import { useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ICONS, MISC } from '../images';
import { colors, fonts } from '../theme';

// The three pop-out actions, positioned relative to the FAB center.
// Keyboard fans lower-left (type a memory), Brain straight up (speak a
// memory to Recall), Upload lower-right (attach photos/videos).
const ACTIONS = [
  { key: 'keyboard', icon: ICONS.keyboard, image: false, dx: -96, dy: -70, href: '/log/text' as const },
  { key: 'brain', icon: MISC.brain3d, image: true, dx: 0, dy: -128, href: '/log/voice' as const },
  { key: 'upload', icon: ICONS.upload, image: false, dx: 96, dy: -70, href: '/log/photo' as const },
];

export default function MemoryFab() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const animateTo = (to: number, cb?: () => void) => {
    Animated.timing(anim, {
      toValue: to,
      duration: 220,
      easing: to ? Easing.out(Easing.back(1.4)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(cb);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    animateTo(next ? 1 : 0);
  };

  const pick = (href: any) => {
    setOpen(false);
    animateTo(0, () => router.push(href));
  };

  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <>
      {/* Tap-away backdrop */}
      {open && (
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={toggle} />
        </Animated.View>
      )}

      {/* Fan-out action buttons */}
      {ACTIONS.map((a) => {
        const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, a.dx] });
        const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, a.dy] });
        const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
        return (
          <Animated.View
            key={a.key}
            pointerEvents={open ? 'auto' : 'none'}
            style={[
              styles.action,
              { opacity: anim, transform: [{ translateX }, { translateY }, { scale }] },
            ]}
          >
            <Pressable style={styles.actionBtn} onPress={() => pick(a.href)}>
              <Image
                source={a.icon}
                style={a.image ? styles.actionBrain : styles.actionIcon}
                tintColor={a.image ? undefined : colors.white}
                resizeMode="contain"
              />
            </Pressable>
          </Animated.View>
        );
      })}

      {/* Main + button */}
      <Pressable style={styles.fab} onPress={toggle}>
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </>
  );
}

const FAB_BOTTOM = 64;

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,17,18,0.35)',
  },
  fab: {
    position: 'absolute',
    bottom: FAB_BOTTOM,
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.ink,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPlus: {
    color: colors.white,
    fontSize: 40,
    lineHeight: 44,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    fontFamily: fonts.regular,
  },
  action: {
    position: 'absolute',
    bottom: FAB_BOTTOM + 6,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.ink,
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  actionIcon: { width: 30, height: 30 },
  actionBrain: { width: 46, height: 46 },
});
