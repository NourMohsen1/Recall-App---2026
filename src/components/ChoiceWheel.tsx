import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
// gesture-handler's ScrollView takes the swipe for itself inside the page's
// own scroll — React Native's lets the page move instead of the wheel.
import { ScrollView } from 'react-native-gesture-handler';
import { colors, fonts } from '../theme';

// A wheel of choices, like Apple's time wheel: swipe up or down, the one in
// the middle band is chosen, with a tick as each one passes. Used for a
// task's reminder, where a menu of nine lines was harder to read than a
// wheel you turn to "2 hours before".

const ROW = 40;
const VISIBLE = 5;

export default function ChoiceWheel<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const shown = useRef(index);

  // Opens on the current choice.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * ROW, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const at = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    Math.min(options.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ROW)));

  // A tick for each choice that passes the middle, as the real wheel does.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = at(e);
    if (i !== shown.current) {
      shown.current = i;
      Haptics.selectionAsync().catch(() => {});
    }
  };
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = at(e);
    if (options[i] && options[i].key !== value) onChange(options[i].key);
  };

  return (
    <View style={styles.wrap}>
      <View pointerEvents="none" style={styles.band} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(e) => {
          // A slow drag that stops without momentum still chooses.
          if ((e.nativeEvent.velocity?.y ?? 0) === 0) settle(e);
        }}
        contentContainerStyle={{ paddingVertical: ((VISIBLE - 1) / 2) * ROW }}
        nestedScrollEnabled
      >
        {options.map((o, i) => (
          <View key={o.key} style={styles.row}>
            <Text
              style={[styles.label, i === index && styles.labelOn]}
              onPress={() => {
                ref.current?.scrollTo({ y: i * ROW, animated: true });
                onChange(o.key);
              }}
            >
              {o.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: ROW * VISIBLE, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden' },
  // The middle row, where the choice sits — the same pale band as the
  // time wheel.
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ((VISIBLE - 1) / 2) * ROW,
    height: ROW,
    borderRadius: 10,
    backgroundColor: '#EEF3F3',
  },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.regular, fontSize: 17, color: '#9AA4A5' },
  labelOn: { fontFamily: fonts.medium, color: colors.ink },
});
