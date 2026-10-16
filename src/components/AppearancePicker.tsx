import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { canMatchPhone, makeStyles, setAppearance, useAppearanceChoice, type AppearanceChoice } from '../appearance';
import { fonts, palettes, type Palette } from '../theme';

// Profile → Appearance: a small Recall in each mode, the way iOS shows
// Light and Dark in Display & Brightness. Each preview is drawn in its own
// palette, whatever mode is on screen, so the choice is seen, not read.

const OPTIONS: { key: AppearanceChoice; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  ...(canMatchPhone ? [{ key: 'auto' as const, label: 'Match iPhone' }] : []),
];

/** A tiny Home: the logo line, the week, the Ask pill, a card and a tile. */
function MiniHome({ p }: { p: Palette }) {
  const styles = useStyles();
  return (
    <View style={[styles.mini, { backgroundColor: p.bg }]}>
      <View style={[styles.miniLogo, { backgroundColor: p.brand }]} />
      <View style={styles.miniWeek}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.miniDay, { backgroundColor: i === 3 ? p.tile : p.chip }]} />
        ))}
      </View>
      <View style={[styles.miniPill, { backgroundColor: p.tile, borderColor: p.accent }]} />
      <View style={[styles.miniCard, { backgroundColor: p.surface, borderColor: p.border }]}>
        <View style={[styles.miniLine, { backgroundColor: p.text, width: '55%' }]} />
        <View style={[styles.miniLine, { backgroundColor: p.textFaint, width: '80%', opacity: 0.6 }]} />
      </View>
      <View style={styles.miniTiles}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.miniTile, { backgroundColor: p.tile }]} />
        ))}
      </View>
    </View>
  );
}

function Preview({ choice }: { choice: AppearanceChoice }) {
  const styles = useStyles();
  if (choice !== 'auto') return <MiniHome p={palettes[choice]} />;
  // Match iPhone: light and dark side by side, split down the middle.
  return (
    <View style={styles.split}>
      <View style={styles.half}>
        <MiniHome p={palettes.light} />
      </View>
      <View style={[styles.half, styles.halfRight]}>
        <View style={styles.shiftLeft}>
          <MiniHome p={palettes.dark} />
        </View>
      </View>
    </View>
  );
}

export default function AppearancePicker() {
  const styles = useStyles();
  const chosen = useAppearanceChoice();
  return (
    <View style={styles.row}>
      {OPTIONS.map(({ key, label }) => {
        const on = chosen === key;
        return (
          <Pressable
            key={key}
            style={styles.option}
            onPress={() => setAppearance(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label} appearance`}
          >
            <View style={[styles.frame, on && styles.frameOn]}>
              <Preview choice={key} />
            </View>
            <Text style={[styles.label, on && styles.labelOn]}>{label}</Text>
            <View style={[styles.radio, on && styles.radioOn]}>
              {on && <Ionicons name="checkmark" size={14} color={palettes.light.onTile} />}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const MINI_W = 74;
const MINI_H = 132;

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', justifyContent: 'space-evenly', paddingTop: 10, paddingBottom: 4 },
  option: { alignItems: 'center', gap: 8 },
  // The ring sits a little outside the preview, like a selected wallpaper.
  frame: { padding: 3, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  frameOn: { borderColor: c.accent },
  label: { fontFamily: fonts.medium, fontSize: 14, color: c.textMuted, marginTop: 2 },
  labelOn: { color: c.text, fontFamily: fonts.semiBold },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: c.textGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: c.accent, borderColor: c.accent },

  mini: {
    width: MINI_W,
    height: MINI_H,
    borderRadius: 13,
    paddingHorizontal: 7,
    paddingTop: 10,
    overflow: 'hidden',
    // A hairline, so the light one doesn't melt into a light card and the
    // dark one doesn't into a dark card.
    borderWidth: 1,
    borderColor: c.scheme === 'dark' ? 'rgba(227,235,235,0.12)' : 'rgba(8,17,18,0.10)',
  },
  miniLogo: { width: 24, height: 5, borderRadius: 3 },
  miniWeek: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  miniDay: { width: 9, height: 9, borderRadius: 5 },
  miniPill: { height: 10, borderRadius: 5, borderWidth: 1, marginTop: 8 },
  miniCard: { borderRadius: 6, borderWidth: 1, padding: 5, gap: 3, marginTop: 7 },
  miniLine: { height: 3, borderRadius: 2 },
  miniTiles: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  miniTile: { width: 17, height: 17, borderRadius: 4 },

  split: { width: MINI_W, height: MINI_H, flexDirection: 'row', borderRadius: 13, overflow: 'hidden' },
  half: { width: MINI_W / 2, height: MINI_H, overflow: 'hidden' },
  halfRight: { alignItems: 'flex-start' },
  shiftLeft: { marginLeft: -MINI_W / 2 },
}));
