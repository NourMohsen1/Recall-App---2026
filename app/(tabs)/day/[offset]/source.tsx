import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import VoicePlayer from '../../../../src/components/VoicePlayer';
import { dateWithOffset } from '../../../../src/data';
import { processMemoryIntake } from '../../../../src/memoryIntake';
import {
  LoggedMemory,
  dateKey,
  deleteMemory,
  formatClockTime,
  getMemoriesByDay,
  updateMemory,
} from '../../../../src/memoryLog';
import { transcribeAudio, transcriptionAvailable } from '../../../../src/transcription';
import { colors, fonts } from '../../../../src/theme';

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
        <Ionicons name="arrow-back" size={28} color={colors.primary} />
      </Pressable>
      <Text style={styles.headerTitle}>Source</Text>
    </View>
  );
}

// How long we give a recording to report itself loaded before assuming the
// underlying file is gone (e.g. an old memory saved before permanent
// storage was wired up correctly, whose cache copy has since been cleared).
const LOAD_TIMEOUT_MS = 5000;

// Plays back the actual recording the user made that day, with a scrubbable
// timeline and the transcript highlighting word-by-word as it plays.
function RealSource({
  voice,
  onRemoved,
  onUpdated,
}: {
  voice: LoggedMemory;
  onRemoved: () => void;
  onUpdated: () => void;
}) {
  const player = useAudioPlayer(voice.audioUri!);
  const status = useAudioPlayerStatus(player);
  const [unavailable, setUnavailable] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    setUnavailable(false);
    const timer = setTimeout(() => {
      if (!status.isLoaded) setUnavailable(true);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [voice.audioUri]);

  useEffect(() => {
    if (status.isLoaded) setUnavailable(false);
  }, [status.isLoaded]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const removeMemory = () => {
    Alert.alert('Remove this memory?', 'The recording can’t be played back anymore.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteMemory(voice.id);
          onRemoved();
        },
      },
    ]);
  };

  const generateTranscript = async () => {
    if (!voice.audioUri || transcribing) return;
    setTranscribing(true);
    const result = await transcribeAudio(voice.audioUri, 'auto');
    setTranscribing(false);
    if (result.ok) {
      await updateMemory(voice.id, { text: result.text, words: result.words });
      // A transcript arriving late still goes through the intake brain —
      // polish for the Timeline, tasks/people/places routed like any log.
      processMemoryIntake(voice.id, result.text, dateKey(new Date(voice.takenAt))).catch(() => {});
      onUpdated();
    } else {
      Alert.alert('Couldn’t transcribe', 'Try again in a moment.');
    }
  };

  return (
    <>
      <Text style={styles.title}>
        This Data was recorded by voice at {formatClockTime(new Date(voice.takenAt))}
      </Text>

      {unavailable ? (
        <View style={styles.unavailableBox}>
          <Ionicons name="alert-circle-outline" size={28} color="#8B9394" />
          <Text style={styles.unavailableText}>
            This recording can’t be found on your device anymore — it may have been made before
            an app update changed how recordings are stored.
          </Text>
          <Pressable style={styles.removeBtn} onPress={removeMemory}>
            <Text style={styles.removeBtnText}>Remove this memory</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginTop: 28 }}>
          <VoicePlayer
            variant="light"
            playing={status.playing}
            currentTime={status.currentTime}
            duration={
              Number.isFinite(status.duration) && status.duration > 0
                ? status.duration
                : (voice.durationMillis ?? 0) / 1000
            }
            onToggle={toggle}
            onSeek={(s) => player.seekTo(s)}
            words={voice.words}
            // The source always shows the verbatim transcript — the polished
            // version of this memory lives on the Timeline.
            text={voice.rawText ?? voice.text}
            note={voice.note}
          />
          {!voice.text && transcriptionAvailable() && (
            <Pressable style={styles.transcribeBtn} onPress={generateTranscript} disabled={transcribing}>
              <Ionicons name="text-outline" size={16} color={colors.teal} />
              <Text style={styles.transcribeBtnText}>
                {transcribing ? 'Transcribing…' : 'Generate transcript'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

// No voice memory logged for this day — nothing to play back.
function EmptySource() {
  return (
    <View style={styles.emptyBox}>
      <MaterialCommunityIcons name="microphone-off" size={28} color="#8B9394" />
      <Text style={styles.emptyText}>No voice memory recorded for this day.</Text>
    </View>
  );
}

export default function SourceScreen() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const [loaded, setLoaded] = useState(false);
  const [voice, setVoice] = useState<LoggedMemory | null>(null);

  const reload = useCallback(() => {
    getMemoriesByDay().then((byDay) => {
      const day = byDay.get(dateKey(dateWithOffset(offsetNum))) ?? [];
      const voices = day.filter((m) => m.kind === 'voice' && m.audioUri);
      setVoice(voices[voices.length - 1] ?? null);
      setLoaded(true);
    });
  }, [offsetNum]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.waveBadge}>
          <MaterialCommunityIcons name="waveform" size={40} color={colors.primary} />
        </View>

        {loaded &&
          (voice ? (
            <RealSource
              key={voice.id}
              voice={voice}
              onRemoved={() => router.back()}
              onUpdated={reload}
            />
          ) : (
            <EmptySource />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: { paddingTop: 12, paddingBottom: 20, alignItems: 'center' },
  back: { position: 'absolute', left: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 28, paddingBottom: 140 },

  waveBadge: {
    width: 80,
    height: 80,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  title: { fontFamily: fonts.medium, fontSize: 24, lineHeight: 34, color: '#111', marginTop: 24 },

  unavailableBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E8E8',
    borderRadius: 18,
    padding: 24,
    marginTop: 28,
    gap: 14,
  },
  unavailableText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#5B6364',
    textAlign: 'center',
  },
  removeBtn: {
    backgroundColor: '#F3E9E9',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  removeBtnText: { fontFamily: fonts.medium, fontSize: 13, color: '#B24545' },

  transcribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
  },
  transcribeBtnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.teal },

  emptyBox: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, color: '#8B9394' },
});
