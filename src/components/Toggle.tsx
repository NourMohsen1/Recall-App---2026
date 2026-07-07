import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

export default function Toggle({
  value,
  onChange,
}: {
  value?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [internal, setInternal] = useState(value ?? false);
  const on = value ?? internal;

  const toggle = () => {
    const next = !on;
    setInternal(next);
    onChange?.(next);
  };

  return (
    <Pressable onPress={toggle} style={[styles.track, on ? styles.trackOn : styles.trackOff]}>
      <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 58,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: '#DCE6E7' },
  trackOff: { backgroundColor: '#E4E6E6' },
  knob: { width: 24, height: 24, borderRadius: 12 },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  knobOff: { alignSelf: 'flex-start', backgroundColor: '#AEB6B7' },
});
