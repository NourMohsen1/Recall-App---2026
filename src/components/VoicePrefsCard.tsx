import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toggle from './Toggle';
import { makeStyles, useColors } from '../appearance';
import { fonts } from '../theme';
import {
  forgetAll,
  forgetNote,
  getVoicePrefs,
  learnedLines,
  onVoicePrefsChanged,
  setLearning,
  setVoiceChoice,
  type VoiceChoice,
  type VoicePrefs,
} from '../voicePrefs';

// Profile → Live voice: the voice, and everything Recall remembers about how
// the user likes to be talked to, to see, correct and remove
// (src/voicePrefs.ts). Correcting is removing and saying it again.

export default function VoicePrefsCard() {
  const c = useColors();
  const styles = useStyles();
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const load = useCallback(() => {
    getVoicePrefs().then((p) => setPrefs({ ...p }));
  }, []);
  useFocusEffect(load);
  useEffect(() => onVoicePrefsChanged(load), [load]);
  if (!prefs) return null;

  const learned = learnedLines(prefs);
  const empty = prefs.notes.length === 0 && learned.length === 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Live voice</Text>

      <Text style={styles.label}>Voice</Text>
      <View style={styles.switch}>
        {(['female', 'male'] as VoiceChoice[]).map((v) => {
          const on = prefs.voice === v;
          return (
            <Pressable
              key={v}
              style={[styles.option, on && styles.optionOn]}
              onPress={() => setVoiceChoice(v)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={v === 'female' ? 'woman-outline' : 'man-outline'} size={16} color={on ? c.onTile : c.brand} />
              <Text style={[styles.optionText, on && styles.optionTextOn]}>{v === 'female' ? 'Female' : 'Male'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>Remember how I like to talk</Text>
          <Text style={styles.hint}>Language, answer length, what you ask for. Kept on this phone.</Text>
        </View>
        <Toggle
          value={prefs.learn}
          onChange={(on) => {
            if (on) void setLearning(true);
            else
              Alert.alert('Stop remembering?', 'What Recall has picked up about how you talk is forgotten too.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Turn off', style: 'destructive', onPress: () => void setLearning(false) },
              ]);
          }}
        />
      </View>

      {prefs.learn && (
        <View style={styles.list}>
          {empty && <Text style={styles.hint}>Nothing yet. It learns from a few conversations, or ask it to, out loud.</Text>}
          {prefs.notes.map((n) => (
            <View key={n.id} style={styles.item}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={c.brandSoft} />
              <Text style={styles.itemText}>{n.text}</Text>
              <Pressable onPress={() => forgetNote(n.id)} hitSlop={10} accessibilityLabel={`Forget: ${n.text}`}>
                <Ionicons name="close" size={18} color={c.textFaint} />
              </Pressable>
            </View>
          ))}
          {learned.map((l) => (
            <View key={l} style={styles.item}>
              <Ionicons name="sparkles-outline" size={16} color={c.brandSoft} />
              <Text style={styles.itemText}>{l}</Text>
            </View>
          ))}
          {!empty && (
            <Pressable
              onPress={() =>
                Alert.alert('Forget all of this?', 'Recall starts learning how you talk from scratch.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Forget', style: 'destructive', onPress: () => void forgetAll() },
                ])
              }
              hitSlop={8}
              style={styles.forget}
            >
              <Text style={styles.forgetText}>Forget all of this</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface, borderRadius: 24, padding: 22, marginTop: 24 },
  title: { fontFamily: fonts.bold, fontSize: 20, color: c.text, marginBottom: 12 },
  label: { fontFamily: fonts.semiBold, fontSize: 16, color: c.textBody, marginBottom: 10 },
  switch: { flexDirection: 'row', backgroundColor: c.fill, borderRadius: 14, padding: 3 },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11 },
  optionOn: { backgroundColor: c.tile },
  optionText: { fontFamily: fonts.medium, fontSize: 15, color: c.brand },
  optionTextOn: { color: c.onTile },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.divider },
  rowLabel: { fontFamily: fonts.semiBold, fontSize: 16, color: c.textBody },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: c.textFaint, marginTop: 2 },
  list: { marginTop: 12, gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: c.textBody },
  forget: { alignSelf: 'flex-start', marginTop: 4 },
  forgetText: { fontFamily: fonts.medium, fontSize: 13, color: c.danger },
}));
