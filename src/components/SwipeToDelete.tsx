import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../theme';

// Swipe left to delete, as in Mail and Reminders: a short swipe reveals a
// red Delete to tap; a long swipe (past half the row) deletes on release,
// with a tick as it crosses the line so it never happens by surprise.

const ACTION_W = 92;
const RED = '#D64545';

function DeleteAction({
  translation,
  full,
  onPress,
}: {
  translation: SharedValue<number>;
  full: number;
  onPress: () => void;
}) {
  // The red area follows the finger past its width, like iOS.
  const style = useAnimatedStyle(() => ({ width: Math.max(ACTION_W, -translation.value) }));
  const label = useAnimatedStyle(() => ({ opacity: -translation.value > full ? 0.85 : 1 }));
  return (
    <Animated.View style={[styles.action, style]}>
      <Pressable style={styles.actionPress} onPress={onPress} accessibilityRole="button" accessibilityLabel="Delete">
        <Animated.View style={[styles.actionInner, label]}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.actionText}>Delete</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export default function SwipeToDelete({
  children,
  onDelete,
  rowWidth,
  style,
}: {
  children: ReactNode;
  onDelete: () => void;
  /** The row's width, so a "long swipe" is measured against it. */
  rowWidth: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<SwipeableMethods>(null);
  const armed = useRef(false);
  const full = rowWidth * 0.5;

  const arm = (on: boolean) => {
    if (armed.current === on) return;
    armed.current = on;
    if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const remove = () => {
    armed.current = false;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onDelete();
  };

  return (
    <Swipeable
      ref={ref}
      containerStyle={style}
      friction={1.4}
      rightThreshold={ACTION_W / 2}
      overshootRight
      renderRightActions={(_progress, translation) => (
        <Watcher translation={translation} full={full} onArm={arm}>
          <DeleteAction translation={translation} full={full} onPress={remove} />
        </Watcher>
      )}
      onSwipeableWillOpen={() => {
        if (armed.current) remove();
      }}
    >
      {children}
    </Swipeable>
  );
}

/** Reports when the swipe crosses the "delete on release" line. */
function Watcher({
  translation,
  full,
  onArm,
  children,
}: {
  translation: SharedValue<number>;
  full: number;
  onArm: (on: boolean) => void;
  children: ReactNode;
}) {
  useAnimatedReaction(
    () => -translation.value > full,
    (past, before) => {
      if (past !== before) runOnJS(onArm)(past);
    },
  );
  return <View style={styles.watcher}>{children}</View>;
}

const styles = StyleSheet.create({
  watcher: { flexDirection: 'row', justifyContent: 'flex-end' },
  action: { backgroundColor: RED, borderRadius: 20, marginLeft: 10, overflow: 'hidden' },
  actionPress: { flex: 1, justifyContent: 'center' },
  actionInner: { alignItems: 'center', justifyContent: 'center', width: ACTION_W, gap: 2, alignSelf: 'flex-end' },
  actionText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#fff' },
});
