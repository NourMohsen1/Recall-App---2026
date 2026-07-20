import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import VoicePlayer from '../../src/components/VoicePlayer';
import { MISC } from '../../src/images';
import { TranscriptWord, dateKey, persistFile, saveMemory } from '../../src/memoryLog';
import { processMemoryIntake } from '../../src/memoryIntake';
import { recordCurrentLocationForDay } from '../../src/placesFromPhotos';
import {
  SpeechLanguage,
  transcribeAudio,
  transcriptionAvailable,
} from '../../src/transcription';
import { colors, fonts } from '../../src/theme';

function formatTime(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const LANGUAGES: { key: SpeechLanguage; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'ar', label: 'العربية' },
  { key: 'en', label: 'English' },
];

// Looping bars that fake a live waveform while recording — expo-audio's
// metering API isn't available cross-platform, so this keeps the screen
// feeling alive without depending on it.
function LiveWaveform({ active }: { active: boolean }) {
  const bars = useRef(Array.from({ length: 22 }, () => new Animated.Value(0.3))).current;

  useEffect(() => {
    if (!active) return;
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.4 + Math.random() * 0.6,
            duration: 260 + (i % 5) * 40,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.2 + Math.random() * 0.3,
            duration: 260 + (i % 5) * 40,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    Animated.stagger(30, loops).start();
    return () => loops.forEach((l) => l.stop());
  }, [active]);

  return (
    <View style={styles.waveRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              height: bar.interpolate({ inputRange: [0, 1], outputRange: [8, 54] }),
              opacity: active ? 1 : 0.35,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function LogVoice() {
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'review'>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Speech-to-text state. Whisper auto-detects Arabic/English/mixed speech;
  // the chips let the user force a language when detection guesses wrong.
  const [language, setLanguage] = useState<SpeechLanguage>('auto');
  const [transcript, setTranscript] = useState('');
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<'failed' | 'no-credits' | null>(null);
  const canTranscribe = transcriptionAvailable();

  // A manually-typed note the user can attach regardless of whether
  // transcription is on, off, or got something wrong.
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const player = useAudioPlayer(recordedUri ?? undefined);
  const playerStatus = useAudioPlayerStatus(player);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'recording') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.12,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);

  const runTranscription = async (uri: string, lang: SpeechLanguage) => {
    if (!canTranscribe) return;
    setTranscribing(true);
    setTranscribeError(null);
    const result = await transcribeAudio(uri, lang);
    setTranscribing(false);
    if (result.ok) {
      setTranscript(result.text);
      setWords(result.words);
    } else if (result.reason === 'no-credits') {
      setTranscribeError('no-credits');
    } else if (result.reason === 'failed') {
      setTranscribeError('failed');
    }
  };

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access so Recall can hear you.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('recording');
  };

  const stopRecording = async () => {
    await recorder.stop();
    const uri = recorder.uri;
    setRecordedUri(uri);
    setPhase('review');
    if (uri) runTranscription(uri, language);
  };

  const switchLanguage = (lang: SpeechLanguage) => {
    setLanguage(lang);
    // Re-run recognition in the newly chosen language during review.
    if (phase === 'review' && recordedUri) runTranscription(recordedUri, lang);
  };

  const discard = () => {
    setRecordedUri(null);
    setTranscript('');
    setWords([]);
    setTranscribeError(null);
    setNote('');
    setNoteOpen(false);
    setPhase('idle');
  };

  const save = async () => {
    if (!recordedUri || saving) return;
    setSaving(true);
    // Move the recording out of the cache so the OS can't clean it up —
    // this must be awaited, or the memory can end up pointing at a file
    // that gets evicted later and silently stops playing.
    const permanentUri = await persistFile(recordedUri, 'voice');
    const saved = await saveMemory({
      kind: 'voice',
      audioUri: permanentUri,
      text: transcript.trim() || undefined,
      words: words.length > 0 ? words : undefined,
      note: note.trim() || undefined,
      durationMillis: playerStatus?.duration
        ? playerStatus.duration * 1000
        : recorderState.durationMillis,
    });
    recordCurrentLocationForDay(dateKey(new Date())).catch(() => {});
    // The intake brain reads the transcript (plus any typed note) and routes
    // everything: polished memory → Timeline, commitments → Tasks, people
    // met → People, places mentioned → Places. Works in any language.
    const spokenText = [transcript.trim(), note.trim()].filter(Boolean).join(' — ');
    if (spokenText) processMemoryIntake(saved.id, spokenText, dateKey(new Date())).catch(() => {});
    router.back();
  };

  const togglePlayback = () => {
    if (playerStatus?.playing) {
      player.pause();
    } else {
      if (playerStatus.didJustFinish || (playerStatus.duration > 0 && playerStatus.currentTime >= playerStatus.duration)) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  return (
    <View style={styles.fill}>
      <View style={styles.background} />
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Ionicons name="close" size={26} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Talk to Recall</Text>
        </View>

        {/* Language selector — English, Arabic, or auto-detect (mixed) */}
        <View style={styles.langRow}>
          {LANGUAGES.map((l) => (
            <Pressable
              key={l.key}
              onPress={() => switchLanguage(l.key)}
              style={[styles.langChip, language === l.key && styles.langChipActive]}
            >
              <Text style={[styles.langText, language === l.key && styles.langTextActive]}>
                {l.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.center}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {phase !== 'review' && (
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <View style={[styles.brainRing, phase === 'recording' && styles.brainRingActive]}>
                  <Image source={MISC.brain3d} style={styles.brainImg} resizeMode="contain" />
                </View>
              </Animated.View>
            )}

            {phase !== 'review' && (
              <Text style={styles.prompt}>
                {phase === 'idle' && 'Tap the mic and tell me what happened.'}
                {phase === 'recording' && 'I’m listening…'}
              </Text>
            )}

            {phase === 'recording' && (
              <>
                <Text style={styles.timer}>{formatTime(recorderState.durationMillis)}</Text>
                <LiveWaveform active />
              </>
            )}

            {/* Review — the real, scrubbable player with live transcript */}
            {phase === 'review' && (
              <View style={styles.reviewWrap}>
                <Text style={styles.reviewPrompt}>Got it. Want to save this memory?</Text>

                {transcribing ? (
                  <View style={styles.transcribingBox}>
                    <Text style={styles.transcribingText}>Transcribing…</Text>
                  </View>
                ) : transcribeError === 'no-credits' ? (
                  <Text style={styles.errorHint}>
                    Your OpenAI account has no credits yet — add a prepaid balance at
                    platform.openai.com → Billing.
                  </Text>
                ) : transcribeError === 'failed' ? (
                  <Pressable onPress={() => recordedUri && runTranscription(recordedUri, language)}>
                    <Text style={styles.errorHint}>Couldn’t transcribe — tap to try again.</Text>
                  </Pressable>
                ) : (
                  <VoicePlayer
                    variant="dark"
                    playing={!!playerStatus?.playing}
                    currentTime={playerStatus?.currentTime ?? 0}
                    duration={playerStatus?.duration ?? 0}
                    onToggle={togglePlayback}
                    onSeek={(s) => player.seekTo(s)}
                    words={words}
                    text={transcript}
                    note={note.trim() || undefined}
                  />
                )}

                {/* Add a note — always available, even without transcription */}
                {noteOpen ? (
                  <TextInput
                    style={styles.noteInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Add a note — clarify or correct something…"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    multiline
                    autoFocus
                  />
                ) : (
                  <Pressable style={styles.addNoteBtn} onPress={() => setNoteOpen(true)}>
                    <Ionicons name="create-outline" size={18} color={colors.accent} />
                    <Text style={styles.addNoteText}>Add a note</Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.controls}>
            {phase === 'idle' && (
              <Pressable style={styles.micBtn} onPress={startRecording}>
                <Ionicons name="mic" size={34} color={colors.white} />
              </Pressable>
            )}

            {phase === 'recording' && (
              <Pressable style={styles.stopBtn} onPress={stopRecording}>
                <View style={styles.stopSquare} />
              </Pressable>
            )}

            {phase === 'review' && (
              <View style={styles.reviewRow}>
                <Pressable style={styles.discardBtn} onPress={discard}>
                  <Ionicons name="trash-outline" size={22} color={colors.white} />
                </Pressable>
                <Pressable style={styles.saveBtn} onPress={save}>
                  <Ionicons name={saving ? 'hourglass' : 'checkmark'} size={26} color={colors.ink} />
                  <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Memory'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  background: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink },
  header: { paddingVertical: 16, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 18 },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white },

  langRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 4 },
  langChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  langChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  langText: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },
  langTextActive: { color: colors.ink },

  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  brainRing: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99,188,198,0.08)',
    borderWidth: 2,
    borderColor: 'rgba(99,188,198,0.25)',
  },
  brainRingActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(99,188,198,0.16)',
  },
  brainImg: { width: 130, height: 130 },

  prompt: {
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.white,
    textAlign: 'center',
    marginTop: 32,
  },
  timer: {
    fontFamily: fonts.semiBold,
    fontSize: 22,
    color: colors.accent,
    marginTop: 20,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 60,
    marginTop: 18,
  },
  waveBar: { width: 4, borderRadius: 2, backgroundColor: colors.accent },

  reviewWrap: { alignSelf: 'stretch' },
  reviewPrompt: {
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.white,
    textAlign: 'center',
    marginBottom: 24,
  },
  transcribingBox: { alignItems: 'center', paddingVertical: 30 },
  transcribingText: { fontFamily: fonts.regular, fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  errorHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginVertical: 20,
  },

  addNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 22,
    alignSelf: 'center',
  },
  addNoteText: { fontFamily: fonts.medium, fontSize: 14, color: colors.accent },
  noteInput: {
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 16,
    padding: 14,
    marginTop: 22,
    minHeight: 70,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.white,
    textAlignVertical: 'top',
  },

  controls: { alignItems: 'center', paddingBottom: 60, paddingTop: 10 },
  micBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.primary },

  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  discardBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
  },
  saveBtnText: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.ink },
});
