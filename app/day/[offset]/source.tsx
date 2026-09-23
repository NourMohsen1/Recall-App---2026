import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import VoicePlayer from '../../../src/components/VoicePlayer';
import { dateWithOffset } from '../../../src/data';
import { processMemoryIntake } from '../../../src/memoryIntake';
import {
  LoggedMemory,
  dateKey,
  deleteMemory,
  formatClockTime,
  getMemoriesByDay,
  updateMemory,
} from '../../../src/memoryLog';
import { rtlIfArabic, transcribeAudio, transcriptionAvailable } from '../../../src/transcription';
import { colors, fonts } from '../../../src/theme';

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

// A typed entry's own source: the words the user actually typed, before the
// intake brain reorganized them. No player — the typing IS the recording.
function TypedSource({ memory }: { memory: LoggedMemory }) {
  const original = memory.rawText ?? memory.text;
  return (
    <View style={styles.typedBlock}>
      <Text style={styles.title}>
        This Data was typed at {formatClockTime(new Date(memory.takenAt))}
      </Text>
      {original ? (
        <Text style={[styles.typedText, rtlIfArabic(original)]}>{original}</Text>
      ) : (
        <Text style={styles.emptyText}>Nothing was written in this entry.</Text>
      )}
      {memory.note && <Text style={[styles.typedNote, rtlIfArabic(memory.note)]}>📝 {memory.note}</Text>}
    </View>
  );
}

// Nothing was logged by voice or typing on this day.
function EmptySource() {
  return (
    <View style={styles.emptyBox}>
      <MaterialCommunityIcons name="microphone-off" size={28} color="#8B9394" />
      <Text style={styles.emptyText}>Nothing was logged by voice or typing on this day.</Text>
    </View>
  );
}

export default function SourceScreen() {
  const router = useRouter();
  const { offset } = useLocalSearchParams<{ offset: string }>();
  const offsetNum = Number(offset ?? 0);
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<LoggedMemory[]>([]);

  const reload = useCallback(() => {
    getMemoriesByDay().then((byDay) => {
      const day = byDay.get(dateKey(dateWithOffset(offsetNum))) ?? [];
      // Every way the day was logged, oldest first — a voice note in the
      // morning and a typed one at night are two separate sources and both
      // belong here. This page used to show only the LAST voice memory,
      // which meant an earlier recording was unreachable and a typed entry
      // had no source at all. Photos are excluded: they have their own
      // full-screen viewer.
      setEntries(
        day
          .filter((m) => (m.kind === 'voice' && m.audioUri) || m.kind === 'text')
          .sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
      );
      setLoaded(true);
    });
  }, [offsetNum]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Pushed onto the root Stack from Day Detail (or Timeline's waveform
  // icon) — always for this exact day, so that's the reliable, explicit
  // place to return to. See the note in day/[offset]/index.tsx.
  const backToDay = () => router.dismissTo(`/day/${offsetNum}` as Parameters<typeof router.dismissTo>[0]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={backToDay} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.waveBadge}>
          <MaterialCommunityIcons name="waveform" size={40} color={colors.primary} />
        </View>

        {loaded &&
          (entries.length > 0 ? (
            entries.map((m) =>
              m.kind === 'voice' ? (
                <RealSource
                  key={m.id}
                  voice={m}
                  // Removing one entry leaves the rest — only leave the page
                  // when that was the last thing on it.
                  onRemoved={entries.length > 1 ? reload : backToDay}
                  onUpdated={reload}
                />
              ) : (
                <TypedSource key={m.id} memory={m} />
              ),
            )
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

  typedBlock: { marginBottom: 8 },
  typedText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
    color: '#3D4546',
    marginTop: 18,
  },
  typedNote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: '#7C8586',
    marginTop: 10,
  },
});
