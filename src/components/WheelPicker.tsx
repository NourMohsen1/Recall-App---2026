import { useEffect, useRef } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts } from '../theme';

// iOS-alarm-style spinning column: snap-scrolling list with the selected
// value framed between two hairlines and neighbors fading out above/below.
// Pure ScrollView — no native picker dependency, works everywhere.

const ITEM_H = 38;
const VISIBLE = 5; // odd, so one row sits exactly in the middle

export default function WheelPicker({
  items,
  index,
  onChange,
  width = 72,
}: {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  width?: number;
}) {
  const ref = useRef<ScrollView>(null);

  // Center the initial selection once mounted.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: index * ITEM_H, animated: false });
    }, 0);
    return () => clearTimeout(t);
    // Only on mount — user scrolls drive everything afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(
      items.length - 1,
      Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)),
    );
    if (i !== index) onChange(i);
  };

  return (
    <View style={[styles.wrap, { width }]}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: (ITEM_H * (VISIBLE - 1)) / 2 }}
      >
        {items.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.item}>
            <Text style={[styles.itemText, i === index && styles.itemTextSelected]}>{label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Hairlines framing the selected row */}
      <View pointerEvents="none" style={[styles.line, { top: ITEM_H * 2 }]} />
      <View pointerEvents="none" style={[styles.line, { top: ITEM_H * 3 }]} />
      {/* Fade the rows above and below the selection */}
      <View pointerEvents="none" style={[styles.fade, styles.fadeTop]} />
      <View pointerEvents="none" style={[styles.fade, styles.fadeBottom]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: ITEM_H * VISIBLE },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontFamily: fonts.regular, fontSize: 20, color: '#9AA4A5' },
  itemTextSelected: { fontFamily: fonts.semiBold, fontSize: 22, color: '#1B1B1B' },
  line: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 1,
    backgroundColor: '#D5DBDB',
  },
  fade: { position: 'absolute', left: 0, right: 0, height: ITEM_H * 1.35 },
  fadeTop: { top: 0, backgroundColor: 'rgba(255,255,255,0.72)' },
  fadeBottom: { bottom: 0, backgroundColor: 'rgba(255,255,255,0.72)' },
});
