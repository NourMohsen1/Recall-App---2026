import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import VoicePlayer from '../../../../src/components/VoicePlayer';
import { dateWithOffset, getDayDetail } from '../../../../src/data';
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
            text={voice.text}
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

// The seeded mock shown for demo days with no real recording — kept as a
// simple static display since there's no actual audio file to scrub.
function DemoSource({ offset }: { offset: number }) {
  const detail = getDayDetail(offset);
  const WAVE = [3, 3, 4, 3, 4, 3, 3, 4, 3, 3, 4, 3, 4, 3, 3, 10, 16, 12, 8, 4, 3, 4, 3, 3, 4, 3, 3, 4, 3, 4, 3, 3, 4, 3, 3, 5, 6, 4];
  return (
    <>
      <Text style={styles.title}>
        This Data was recorded by voice at {detail?.recordedAt ?? '11:57 pm'}
      </Text>
      <View style={styles.demoTranscript}>
        <Text style={styles.demoTranscriptText}>
          {detail?.transcriptPreview ?? 'Today i had my design class at 10:00 am were I stayed……'}
        </Text>
      </View>
      <View style={styles.demoPlayer}>
        <Text style={styles.demoPlayerTime}>
          {detail?.audio.position ?? '0:02'} / {detail?.audio.duration ?? '2:49'}
        </Text>
        <View style={styles.demoWaveRow}>
          {WAVE.map((h, i) => (
            <View key={i} style={[styles.demoWaveBar, { height: h }]} />
          ))}
        </View>
        <View style={styles.demoStopBtn}>
          <View style={styles.demoStopSquare} />
        </View>
      </View>
    </>
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
            <DemoSource offset={offsetNum} />
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

  demoTranscript: {
    borderWidth: 1,
    borderColor: '#BFC9CA',
    borderRadius: 18,
    padding: 18,
    marginTop: 26,
  },
  demoTranscriptText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: colors.teal },

  demoPlayer: {
    backgroundColor: '#CFDCDD',
    borderRadius: 28,
    marginTop: 28,
    paddingTop: 36,
    alignItems: 'center',
  },
  demoPlayerTime: { fontFamily: fonts.medium, fontSize: 20, color: colors.primary },
  demoWaveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 44, marginBottom: 40 },
  demoWaveBar: { width: 5, borderRadius: 3, backgroundColor: colors.primary },
  demoStopBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -38,
  },
  demoStopSquare: { width: 26, height: 26, borderRadius: 6, backgroundColor: colors.primary },
});
