import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { makeStyles } from '../appearance';

export default function Toggle({
  value,
  onChange,
}: {
  value?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const styles = useStyles();
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

const useStyles = makeStyles((c) => ({
  track: {
    width: 58,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: c.toggleOn },
  trackOff: { backgroundColor: c.toggleOff },
  knob: { width: 24, height: 24, borderRadius: 12 },
  knobOn: { alignSelf: 'flex-end', backgroundColor: c.accent },
  knobOff: { alignSelf: 'flex-start', backgroundColor: c.knobOff },
}));
