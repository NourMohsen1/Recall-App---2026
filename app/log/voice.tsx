import { logDayKey } from '../../src/logicalDay';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import EarAnimation, { type EarHandle } from '../../src/components/EarAnimation';
import VoicePlayer from '../../src/components/VoicePlayer';
import { TranscriptWord, persistFile, saveMemory } from '../../src/memoryLog';
import { processMemoryIntake } from '../../src/memoryIntake';
import { recordCurrentLocationForDay } from '../../src/places';
import {
  SpeechLanguage,
  transcribeAudio,
  transcriptionAvailable,
} from '../../src/transcription';
import { useReturnTo } from '../../src/useReturnTo';
import { colors, fonts } from '../../src/theme';
import { useLightStatusBar } from '../../src/statusBar';

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

// The microphone's level in decibels (about -160 silent … 0 loudest) as
// 0–1 for the ear. Speech sits roughly between -50 dB (quiet, far) and
// -10 dB (close, loud).
function levelFromDb(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 50) / 40));
}

export default function LogVoice() {
  // Dark teal screen: white top bar while it shows (src/statusBar.ts).
  useLightStatusBar();
  const returnTo = useReturnTo();
  // Metering on: the ear follows how loud the user is speaking.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const ear = useRef<EarHandle>(null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'review'>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Speech-to-text state. Whisper auto-detects Arabic/English/mixed speech;
  // the chips let the user force a language when detection guesses wrong.
  const [language, setLanguage] = useState<SpeechLanguage>('auto');
  const [transcript, setTranscript] = useState('');
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<
    'failed' | 'no-credits' | 'rate-limited' | null
  >(null);
  const canTranscribe = transcriptionAvailable();

  // A manually-typed note the user can attach regardless of whether
  // transcription is on, off, or got something wrong.
  const [noteOpen, setNoteOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  // The dropdown is placed from the top of the screen, so it needs the
  // status-bar height to land just under the pill.
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');

  const player = useAudioPlayer(recordedUri ?? undefined);
  const playerStatus = useAudioPlayerStatus(player);

  // While reviewing, the ear steps back so the player and words read clearly.
  const earDim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(earDim, { toValue: phase === 'review' ? 0.3 : 1, duration: 500, useNativeDriver: true }).start();
  }, [phase, earDim]);

  const micLevel = phase === 'recording' ? levelFromDb(recorderState.metering) : 0;
  const lastLog = useRef(0);
  useEffect(() => {
    if (phase !== 'recording' || Date.now() - lastLog.current < 1000) return;
    lastLog.current = Date.now();
    console.log(`[ear] mic ${recorderState.metering?.toFixed(1) ?? 'none'} dB → ${micLevel.toFixed(2)}`);
  }, [phase, recorderState.metering, micLevel]);

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
    } else if (result.reason === 'rate-limited') {
      setTranscribeError('rate-limited');
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
    // "Got it": what was said condenses into a bead and slips into the ear.
    ear.current?.saved();
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
    recordCurrentLocationForDay(logDayKey()).catch(() => {});
    // The intake brain reads the transcript (plus any typed note) and routes
    // everything: polished memory → Timeline, commitments → Tasks, people
    // met → People, places mentioned → Places. Works in any language.
    const spokenText = [transcript.trim(), note.trim()].filter(Boolean).join(' — ');
    if (spokenText) processMemoryIntake(saved.id, spokenText, logDayKey()).catch(() => {});
    returnTo();
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
          <Pressable onPress={() => returnTo()} hitSlop={12} style={styles.back}>
            <Ionicons name="close" size={26} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Talk to Recall</Text>
          {/* Language — Auto (mixed), Arabic or English — one small pill in
              the corner, so the ear has the screen. */}
          <Pressable style={styles.langPill} onPress={() => setLangOpen((v) => !v)} hitSlop={8}>
            <Ionicons name="language" size={15} color={colors.white} />
            <Text style={styles.langPillText}>{LANGUAGES.find((l) => l.key === language)?.label}</Text>
            <Ionicons name={langOpen ? 'chevron-up' : 'chevron-down'} size={13} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        {/* The ear listens in the space between the language chips and the
            words below; the rest of the screen stays clear for the controls. */}
        <View style={styles.fill}>
          <Animated.View style={[styles.earLayer, { opacity: earDim }]} pointerEvents="none">
            <EarAnimation ref={ear} mode="voice" active={phase === 'recording'} level={micLevel} style={styles.fill} />
          </Animated.View>

          <KeyboardAvoidingView
            style={styles.fill}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={[styles.center, phase !== 'review' && styles.belowEar]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {phase === 'recording' && <Text style={styles.prompt}>I’m listening…</Text>}

              {phase === 'recording' && (
                <Text style={styles.timer}>{formatTime(recorderState.durationMillis)}</Text>
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
                      Saved. The words will be written out a little later.
                    </Text>
                  ) : transcribeError === 'rate-limited' ? (
                    <Pressable onPress={() => recordedUri && runTranscription(recordedUri, language)}>
                      <Text style={styles.errorHint}>
                        Sending requests a bit too fast — tap to try again in a moment.
                      </Text>
                    </Pressable>
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

                  {!canTranscribe && (
                  <Text style={styles.errorHint}>
                    Saved as a recording. Turn on Recall’s AI in Profile to get the words.
                  </Text>
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
        </View>

        {langOpen && (
          <>
            <Pressable style={styles.langScrim} onPress={() => setLangOpen(false)} />
            <View style={[styles.langMenu, { top: insets.top + 56 }]}>
              {LANGUAGES.map((l) => (
                <Pressable
                  key={l.key}
                  style={styles.langOption}
                  onPress={() => {
                    setLangOpen(false);
                    switchLanguage(l.key);
                  }}
                >
                  <Text style={styles.langOptionText}>{l.label}</Text>
                  {language === l.key && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Written out rather than spreading a StyleSheet helper: RN 0.85 removed
  // `absoluteFillObject`, and its `absoluteFill` is a plain object on
  // native but a compiled style on react-native-web — so spreading either
  // one silently loses the positioning on one of the two platforms.
  background: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // The ear page's own background, so the scene and screen are one surface.
    backgroundColor: '#021416',
  },
  header: { paddingVertical: 16, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 18 },
  headerTitle: { fontFamily: fonts.semiBold, fontSize: 20, color: colors.white },

  langPill: {
    position: 'absolute',
    right: 16,
    top: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  langPillText: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },
  // The three choices, dropped down under the pill.
  langScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  langMenu: {
    position: 'absolute',
    right: 16,
    minWidth: 150,
    backgroundColor: '#0C2427',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99,188,198,0.25)',
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  langOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 10, paddingHorizontal: 16 },
  langOptionText: { fontFamily: fonts.medium, fontSize: 15, color: colors.white },

  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  // The ear fills the screen behind everything; the words sit low, under it.
  // Leaves the bottom ~240 pt to the prompt, timer and mic.
  earLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 200 },
  belowEar: { justifyContent: 'flex-end', paddingBottom: 28 },

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
