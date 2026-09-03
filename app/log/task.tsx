import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import PillButton from '../../src/components/PillButton';
import { addTask, extractTasks, taskExtractionAvailable } from '../../src/tasks';
import { transcribeAudio, transcriptionAvailable } from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

function formatTime(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

export default function LogTask() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const canSpeak = transcriptionAvailable();
  const canParse = taskExtractionAvailable();

  const startVoice = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access so Recall can hear your task.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setVoiceState('recording');
  };

  const stopVoice = async () => {
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setVoiceState('idle');
      return;
    }
    setVoiceState('transcribing');
    const result = await transcribeAudio(uri, 'auto');
    setVoiceState('idle');
    if (result.ok && result.text.trim()) {
      // Append so the user can dictate in bursts and still edit by hand.
      setText((prev) => (prev.trim() ? `${prev.trim()} ${result.text.trim()}` : result.text.trim()));
    } else {
      Alert.alert('Couldn’t hear that', 'Try dictating your task again.');
    }
  };

  const create = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);

    // Let the same parser used on memories pull out the due date/time
    // ("get some fruits tomorrow morning" → Get some fruits, tomorrow 9:00).
    const parsed = canParse ? await extractTasks(trimmed) : null;
    if (parsed && parsed.length > 0) {
      for (const t of parsed) {
        await addTask({ ...t, source: 'manual' });
      }
    } else {
      // Parser unavailable or found nothing — save the words as-is.
      await addTask({ title: trimmed, source: 'manual' });
    }
    // Always opened from the Tasks tab — an explicit target instead of
    // back()/canGoBack(), which don't reliably restore the active tab (see
    // day/[offset]/index.tsx for why).
    router.dismissTo('/tasks');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.dismissTo('/tasks')} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={26} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>New Task</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.hint}>
          Say it like you'd say it out loud — “Get some fruits tomorrow morning”. Recall fills in
          the due date for you.
        </Text>

        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="What do you need to do?"
            placeholderTextColor="#9AA4A5"
            multiline
            autoFocus
            textAlignVertical="top"
            editable={voiceState === 'idle'}
          />

          {/* Dictate instead of typing — same mic + Whisper flow as Ask */}
          {canSpeak && voiceState === 'idle' && (
            <Pressable style={styles.micBtn} onPress={startVoice}>
              <Ionicons name="mic" size={22} color={colors.white} />
            </Pressable>
          )}
          {voiceState === 'recording' && (
            <View style={styles.recRow}>
              <View style={styles.recDot} />
              <Text style={styles.recTimer}>{formatTime(recorderState.durationMillis)}</Text>
              <Text style={styles.recHint}>Listening…</Text>
              <Pressable style={styles.stopBtn} onPress={stopVoice}>
                <Ionicons name="checkmark" size={20} color={colors.ink} />
              </Pressable>
            </View>
          )}
          {voiceState === 'transcribing' && (
            <View style={styles.recRow}>
              <MaterialCommunityIcons name="waveform" size={20} color={colors.teal} />
              <Text style={styles.recHint}>Writing it down…</Text>
            </View>
          )}
        </View>

        <PillButton
          label={saving ? 'Creating…' : 'Create Task'}
          onPress={create}
          style={[styles.save, (!text.trim() || saving || voiceState !== 'idle') && styles.saveDisabled]}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: '#2B2B2B' },

  body: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#8B9394', marginBottom: 14 },

  inputCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 22,
    padding: 18,
    minHeight: 200,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: '#2B2B2B',
  },

  micBtn: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E8E8',
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D' },
  recTimer: { fontFamily: fonts.semiBold, fontSize: 15, color: '#2B2B2B' },
  recHint: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: '#8B9394' },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  save: { alignSelf: 'stretch', marginVertical: 24 },
  saveDisabled: { opacity: 0.5 },
});
