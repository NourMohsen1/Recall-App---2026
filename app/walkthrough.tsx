import { useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import OnboardingBackground from '../src/components/OnboardingBackground';
import PillButton from '../src/components/PillButton';
import { ICONS, MISC } from '../src/images';
import { markWalkthroughSeen } from '../src/walkthrough';
import { goBack } from '../src/navigation';
import { colors, fonts } from '../src/theme';

// How Recall works, in five pages: a picture each and one line under it.
// The fourth is the reason this exists: + saves, Ask only answers (see
// src/walkthrough.ts). The pictures are drawn from the app's own pieces,
// the + menu, a note turning into people, places and tasks, the brain,
// so what the user sees here is what they will find.

type Page = { title: string; body: string; art: ReactNode };

function Bubble({ icon, label, lit }: { icon: number; label: string; lit?: boolean }) {
  return (
    <View style={styles.bubbleWrap}>
      <View style={[styles.bubble, lit && styles.bubbleLit]}>
        <Image source={icon} style={styles.bubbleIcon} tintColor={lit ? colors.ink : colors.white} />
      </View>
      <Text style={styles.bubbleLabel}>{label}</Text>
    </View>
  );
}

function Chip({ icon, label }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.accent} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

// Built when the screen opens: the pictures use the styles defined below.
function buildPages(): Page[] {
  return [
  {
    title: 'Log your day',
    body: 'Tap + to talk, type or add photos. This is how something gets saved.',
    art: (
      <View style={styles.artCenter}>
        <View style={styles.fanRow}>
          <Bubble icon={ICONS.upload} label="Photos" />
          <View style={{ marginTop: -44 }}>
            <Bubble icon={ICONS.voice} label="Talk" lit />
          </View>
          <Bubble icon={ICONS.keyboard} label="Type" />
        </View>
        <View style={styles.plus}>
          <Ionicons name="add" size={44} color={colors.white} />
        </View>
      </View>
    ),
  },
  {
    title: 'Recall files it for you',
    body: 'From what you log, it finds the people, places and tasks, and sets the reminders.',
    art: (
      <View style={styles.artCenter}>
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>Lunch with Omar at Zooba. Dentist tomorrow at 2.</Text>
        </View>
        <MaterialCommunityIcons name="arrow-down" size={26} color={colors.soft} style={{ marginVertical: 14 }} />
        <View style={styles.chipRow}>
          <Chip icon="account" label="Omar" />
          <Chip icon="map-marker" label="Zooba" />
          <Chip icon="checkbox-marked-circle-outline" label="Dentist, 2 pm" />
        </View>
      </View>
    ),
  },
  {
    title: 'Ask your memory',
    body: 'Type a question or talk out loud. Recall answers from what you have logged.',
    art: (
      <View style={styles.artCenter}>
        <View style={styles.askBubble}>
          <Text style={styles.askText}>When did I last see Omar?</Text>
        </View>
        <View style={styles.askRow}>
          <View style={styles.brainRing}>
            <Image source={MISC.brainAvatar} style={styles.brain} />
          </View>
          <View style={styles.mic}>
            <MaterialCommunityIcons name="microphone" size={26} color={colors.ink} />
          </View>
        </View>
      </View>
    ),
  },
  {
    title: '+ saves. Ask answers.',
    body: 'Ask, typed or out loud, never saves what you tell it. Something new to remember? Use +.',
    art: (
      <View style={styles.compareRow}>
        <View style={styles.compareCard}>
          <View style={[styles.compareIcon, { backgroundColor: colors.accent }]}>
            <Ionicons name="add" size={30} color={colors.white} />
          </View>
          <Text style={styles.compareTitle}>Log</Text>
          <Text style={styles.compareLine}>Saves memories</Text>
          <Text style={styles.compareLine}>Makes tasks</Text>
        </View>
        <View style={styles.compareCard}>
          <View style={styles.compareBrainRing}>
            <Image source={MISC.brainAvatar} style={styles.compareBrain} />
          </View>
          <Text style={styles.compareTitle}>Ask</Text>
          <Text style={styles.compareLine}>Answers questions</Text>
          <Text style={styles.compareLine}>Saves nothing</Text>
        </View>
      </View>
    ),
  },
  {
    title: 'Your days come back',
    body: 'The Timeline, recaps, people and places fill in as you log.',
    art: (
      <View style={styles.tileRow}>
        {/* The Timeline's own tab icon; the others as on Home's tiles. */}
        <View style={styles.tile}>
          <View style={styles.tileIcon}>
            <Image source={ICONS.timeline} style={styles.tileImage} tintColor={colors.white} />
          </View>
          <Text style={styles.tileLabel}>Timeline</Text>
        </View>
        {(
          [
            ['book-open-page-variant', 'Recap'],
            ['account-group', 'People'],
            ['map-marker-radius', 'Places'],
          ] as const
        ).map(([icon, label]) => (
          <View key={label} style={styles.tile}>
            <View style={styles.tileIcon}>
              <MaterialCommunityIcons name={icon} size={28} color={colors.white} />
            </View>
            <Text style={styles.tileLabel}>{label}</Text>
          </View>
        ))}
      </View>
    ),
  },
  ];
}

export default function Walkthrough() {
  const PAGES = buildPages();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const last = page === PAGES.length - 1;

  const finish = async () => {
    await markWalkthroughSeen().catch((e) => console.warn('[walkthrough] could not remember it was seen:', e));
    console.log(`[walkthrough] finished on page ${page + 1} of ${PAGES.length}`);
    goBack(router, from === 'profile' ? '/profile' : '/home');
  };

  const next = () => {
    if (last) return finish();
    scroller.current?.scrollTo({ x: width * (page + 1), animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  return (
    <OnboardingBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          {!last && (
            <Pressable onPress={finish} hitSlop={12}>
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {PAGES.map((p) => (
            <View key={p.title} style={[styles.page, { width }]}>
              <View style={styles.art}>{p.art}</View>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.body}>{p.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.bottom}>
          <View style={styles.dots}>
            {PAGES.map((p, i) => (
              <View key={p.title} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
          <PillButton label={last ? 'Start using Recall' : 'Next'} onPress={next} style={styles.button} />
        </View>
      </SafeAreaView>
    </OnboardingBackground>
  );
}

const GLASS = 'rgba(255,255,255,0.10)';
const EDGE = 'rgba(255,255,255,0.22)';

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: { height: 44, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 24 },
  skip: { fontFamily: fonts.medium, fontSize: 15, color: colors.soft },
  page: { paddingHorizontal: 32, justifyContent: 'center' },
  art: { height: 300, justifyContent: 'center', marginBottom: 36 },
  artCenter: { alignItems: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 36, color: colors.white, marginBottom: 12 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, color: '#D6E1E2' },
  bottom: { paddingHorizontal: 32, paddingBottom: 12, gap: 22 },
  dots: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 22, backgroundColor: colors.accent },
  button: { alignSelf: 'stretch' },

  // Page 1: the + menu, as it opens in the app.
  fanRow: { flexDirection: 'row', gap: 26, alignItems: 'flex-end', marginBottom: 22 },
  bubbleWrap: { alignItems: 'center', gap: 8 },
  bubble: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: GLASS,
    borderWidth: 1.5,
    borderColor: EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleLit: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleIcon: { width: 32, height: 32, resizeMode: 'contain' },
  bubbleLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },
  plus: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Page 2: a note, and what Recall takes out of it.
  noteCard: {
    backgroundColor: colors.white,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignSelf: 'stretch',
  },
  noteText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: EDGE,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },

  // Page 3: a question, the brain, and live voice.
  askBubble: {
    backgroundColor: GLASS,
    borderWidth: 1.5,
    borderColor: EDGE,
    borderRadius: 22,
    borderBottomRightRadius: 6,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignSelf: 'flex-end',
    marginBottom: 26,
  },
  askText: { fontFamily: fonts.medium, fontSize: 15, color: colors.white },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  // The brain as on Home: light disc, teal ring.
  brainRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.pale,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brain: { width: 92, height: 92, resizeMode: 'contain' },
  mic: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Page 4: the difference, side by side.
  compareRow: { flexDirection: 'row', gap: 14 },
  compareCard: {
    flex: 1,
    backgroundColor: GLASS,
    borderWidth: 1.5,
    borderColor: EDGE,
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 6,
  },
  compareIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  compareBrainRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.pale,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  compareBrain: { width: 46, height: 46, resizeMode: 'contain' },
  compareTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.white, marginBottom: 2 },
  compareLine: { fontFamily: fonts.regular, fontSize: 13, color: '#D6E1E2', textAlign: 'center' },

  // Page 5: where it all shows up.
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  tile: { width: 120, alignItems: 'center', gap: 8 },
  tileIcon: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: 30, height: 30, resizeMode: 'contain' },
  tileLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.white },
});
