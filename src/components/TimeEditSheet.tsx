import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { makeStyles, useColors } from '../appearance';
import { fonts } from '../theme';

// When a moment happened, set by hand: a tap on its time on the day page.
// The AI's time is a best guess (the "≈"); this makes it exact. Apple's own
// time wheel, the one the task editor uses.

export default function TimeEditSheet({
  visible,
  value,
  onCancel,
  onSave,
}: {
  visible: boolean;
  /** The time shown now (after midnight as its real time). */
  value: Date;
  onCancel: () => void;
  onSave: (hours: number, minutes: number) => void;
}) {
  const c = useColors();
  const styles = useStyles();
  const [picked, setPicked] = useState(value);
  // Reset only when the sheet opens: the page passes a new Date on every
  // redraw, and following that undid the user's pick mid-turn.
  const start = value.getTime();
  useEffect(() => {
    if (visible) setPicked(new Date(start));
  }, [visible, start]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>When did this happen?</Text>
          <DateTimePicker
            value={picked}
            mode="time"
            display="spinner"
            themeVariant={c.scheme}
            textColor={c.text}
            minuteInterval={5}
            onValueChange={(_, d) => setPicked(d)}
            style={styles.wheel}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={[styles.button, styles.cancel]} hitSlop={6}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onSave(picked.getHours(), picked.getMinutes())} style={[styles.button, styles.save]} hitSlop={6}>
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.backdrop },
  sheet: {
    backgroundColor: c.raised,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: c.scheme === 'dark' ? 1 : 0,
    borderColor: c.edge,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.grabber, alignSelf: 'center', marginBottom: 14 },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: c.text, textAlign: 'center' },
  wheel: { alignSelf: 'stretch', height: 200 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancel: { backgroundColor: c.fill },
  cancelText: { fontFamily: fonts.medium, fontSize: 15, color: c.textBody },
  save: { backgroundColor: c.tile },
  saveText: { fontFamily: fonts.semiBold, fontSize: 15, color: c.onTile },
}));
