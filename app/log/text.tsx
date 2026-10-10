import { logDayKey } from '../../src/logicalDay';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import EarAnimation, { type EarHandle } from '../../src/components/EarAnimation';
import PillButton from '../../src/components/PillButton';
import { processMemoryIntake } from '../../src/memoryIntake';
import { saveMemory } from '../../src/memoryLog';
import { recordCurrentLocationForDay } from '../../src/places';
import { useLightStatusBar } from '../../src/statusBar';
import { colors, fonts } from '../../src/theme';
import { useReturnTo } from '../../src/useReturnTo';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The ear page's own background, so the band and the screen are one surface.
const INK = '#021416';

function todayLabel() {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** What was just typed: the characters added between two versions of the
 *  text (nothing for a deletion). */
function inserted(prev: string, next: string): string {
  if (next.length <= prev.length) return '';
  let p = 0;
  while (p < prev.length && prev[p] === next[p]) p++;
  return next.slice(p, p + (next.length - prev.length));
}

export default function LogText() {
  // Dark screen: white top bar while it shows (src/statusBar.ts).
  useLightStatusBar();
  const returnTo = useReturnTo();
  const { height } = useWindowDimensions();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [typing, setTyping] = useState(true);
  const ear = useRef<EarHandle>(null);
  // Room for the keyboard, taken from where iOS says it is. (Measured:
  // KeyboardAvoidingView left 269 of the 328 pt needed on iOS 27, which hid
  // the Save button under the suggestion bar.)
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(e.duration || 250, 'keyboard', 'opacity'));
      setKeyboard(Math.max(0, height - e.endCoordinates.screenY));
    });
    return () => sub.remove();
  }, [height]);
  // The ear takes what the writing doesn't need (date, box, button ≈ 216 pt):
  // smaller while the keyboard is up, full size when it's down.
  const [bodyH, setBodyH] = useState(0);
  const earH = Math.round(Math.max(130, Math.min(280, (bodyH || height * 0.8) - keyboard - 216)));

  const onChange = (next: string) => {
    // Each character typed flies into the ear — Arabic as Arabic. A paste
    // sends only its last few, not the whole thing.
    const added = inserted(text, next);
    if (added) ear.current?.key(added.slice(-4));
    setText(next);
  };

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    // The entry condenses into a bead and slips into the ear; the screen
    // closes once it's in (~0.9 s), while saving carries on underneath.
    ear.current?.saved();
    const closing = new Promise((r) => setTimeout(r, 900));
    const saved = await saveMemory({ kind: 'text', text: trimmed });
    // Tag where this happened — best-effort, never blocks saving the memory.
    recordCurrentLocationForDay(logDayKey()).catch(() => {});
    // The intake brain reads the entry and routes everything to its place:
    // polished memory → Timeline, commitments → Tasks, people → People,
    // mentioned places → Places.
    processMemoryIntake(saved.id, trimmed, logDayKey()).catch(() => {});
    await closing;
    returnTo();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={returnTo} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>New Memory</Text>
      </View>

      <View style={[styles.body, { paddingBottom: keyboard }]} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
        {/* The ear listens while the keyboard is up */}
        <EarAnimation
          ref={ear}
          mode="type"
          active={typing || saving}
          style={[styles.ear, { height: earH }]}
        />

        <View style={styles.writing}>
          <Text style={styles.date}>{todayLabel()}</Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={onChange}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder="What happened today?"
              placeholderTextColor="rgba(255,255,255,0.4)"
              selectionColor={colors.accent}
              multiline
              autoFocus
              textAlignVertical="top"
            />
          </View>

          <PillButton
            label={saving ? 'Saving…' : 'Save Memory'}
            onPress={save}
            style={[styles.save, (!text.trim() || saving) && styles.saveDisabled]}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INK },
  header: { paddingTop: 12, paddingBottom: 14, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: colors.white },

  body: { flex: 1 },
  ear: { alignSelf: 'stretch' },

  writing: { flex: 1, paddingHorizontal: 24, paddingTop: 6 },
  date: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.accent, marginBottom: 12 },

  inputCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(99,188,198,0.55)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 22,
    padding: 18,
    minHeight: 96,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.white,
  },

  save: { alignSelf: 'stretch', marginVertical: 14 },
  saveDisabled: { opacity: 0.5 },
});
