import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import {
  SIR_KINDS,
  SIR_KIND_LIST,
  type ShownMarker,
  type SirKind,
} from '../dayMarkers';
import { rtlIfArabic } from '../transcription';
import { colors, fonts } from '../theme';

// Smart Icon Reminders, drawn on the Timeline canvas. See src/dayMarkers.ts
// for what they are and where they come from.
//
// LAID OUT AS A SMALL GRID BELOW-LEFT OF THE DAY CARD, not scattered. That
// corner is the one part of the canvas no connector passes through: the day
// card's line to On This Day leaves from its bottom-centre, and everything
// right of it belongs to Places. Icons placed anywhere else end up sitting on
// a dashed line, which reads as if they were connected to something.

const SIZE = 44;
const GAP = 10;
const COLUMNS = 3;

/** Where a grid slot sits, counted from the top-left of the cluster. */
function slot(index: number, origin: { x: number; y: number }) {
  return {
    left: origin.x + (index % COLUMNS) * (SIZE + GAP),
    top: origin.y + Math.floor(index / COLUMNS) * (SIZE + GAP),
  };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

// The line under a marker's name in its bubble: how often it comes back, or
// where it came from. Said plainly, because an icon the user didn't add
// should always be able to explain itself.
function describe(m: ShownMarker): string {
  if (m.recurring) {
    const r = m.recurring;
    return r.every === 'year' && r.month
      ? `Every year · ${r.day} ${MONTHS[r.month - 1]}`
      : `Every month · the ${ordinal(r.day)}`;
  }
  return m.source === 'manual' ? 'Added by you' : 'Noticed in what you logged';
}

export default function SirCluster({
  markers,
  origin,
  onAdd,
  onRemove,
}: {
  markers: ShownMarker[];
  /** Top-left of the grid, in canvas coordinates. */
  origin: { x: number; y: number };
  onAdd: () => void;
  onRemove: (marker: ShownMarker) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const active = markers.find((m) => m.id === open) ?? null;
  const activeIndex = active ? markers.indexOf(active) : -1;

  return (
    <>
      {markers.map((m, i) => (
        <Pressable
          key={m.id}
          onPress={() => setOpen(open === m.id ? null : m.id)}
          hitSlop={4}
          style={[styles.icon, slot(i, origin), open === m.id && styles.iconOpen]}
        >
          <MaterialCommunityIcons
            name={SIR_KINDS[m.kind].icon}
            size={22}
            color={open === m.id ? colors.white : colors.primary}
          />
        </Pressable>
      ))}

      <Pressable
        onPress={onAdd}
        hitSlop={4}
        style={[styles.icon, styles.add, slot(markers.length, origin)]}
      >
        <MaterialCommunityIcons name="plus" size={20} color={colors.slate} />
      </Pressable>

      {/* Drawn last so it sits over the cards around it. Right beside the
          icon that was tapped — anchoring it to the edge of the whole grid
          left a gap when the day had one or two icons, and pushed the
          bubble off the right of the screen. */}
      {active && (
        <View
          style={[
            styles.bubble,
            {
              left: slot(activeIndex, origin).left + SIZE + 10,
              top: slot(activeIndex, origin).top - 6,
            },
          ]}
        >
          <View style={styles.bubbleHeader}>
            <MaterialCommunityIcons
              name={SIR_KINDS[active.kind].icon}
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.bubbleTitle, rtlIfArabic(active.label)]} numberOfLines={2}>
              {active.label}
            </Text>
          </View>
          <Text style={styles.bubbleSub}>{describe(active)}</Text>
          <Pressable
            onPress={() => {
              setOpen(null);
              onRemove(active);
            }}
            hitSlop={8}
          >
            <Text style={styles.bubbleRemove}>
              {active.recurring ? 'Remove from every year' : 'Remove'}
            </Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

/** The same markers on the day screen: a plain row of labelled icons rather
 *  than a floating grid, because this screen is a list, not a canvas. Both
 *  read one store, so removing an icon here removes it from the Timeline. */
export function SirRow({
  markers,
  onAdd,
  onRemove,
}: {
  markers: ShownMarker[];
  onAdd: () => void;
  onRemove: (marker: ShownMarker) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={styles.row}>
      {markers.map((m) => {
        const isOpen = open === m.id;
        return (
          <View key={m.id} style={styles.rowItem}>
            <Pressable
              onPress={() => setOpen(isOpen ? null : m.id)}
              style={[styles.chip, isOpen && styles.chipOpen]}
            >
              <MaterialCommunityIcons
                name={SIR_KINDS[m.kind].icon}
                size={18}
                color={isOpen ? colors.white : colors.primary}
              />
              <Text
                style={[styles.chipLabel, isOpen && styles.chipLabelOpen, rtlIfArabic(m.label)]}
                numberOfLines={1}
              >
                {m.label}
              </Text>
            </Pressable>
            {isOpen && (
              <View style={styles.chipDetail}>
                <Text style={styles.bubbleSub}>{describe(m)}</Text>
                <Pressable
                  onPress={() => {
                    setOpen(null);
                    onRemove(m);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.bubbleRemove}>
                    {m.recurring ? 'Remove from every year' : 'Remove'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      <Pressable onPress={onAdd} style={[styles.chip, styles.chipAdd]}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.slate} />
        <Text style={[styles.chipLabel, { color: colors.slate }]}>Mark this day</Text>
      </Pressable>
    </View>
  );
}

/** The list of icons to choose from, for the "+". */
export function SirPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (kind: SirKind) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Mark this day</Text>
        <Text style={styles.sheetHint}>
          Birthdays and anniversaries come back on this date every year.
        </Text>
        <ScrollView contentContainerStyle={styles.grid}>
          {SIR_KIND_LIST.map((kind) => (
            <Pressable key={kind} onPress={() => onPick(kind)} style={styles.choice}>
              <View style={styles.choiceIcon}>
                <MaterialCommunityIcons name={SIR_KINDS[kind].icon} size={24} color={colors.primary} />
              </View>
              <Text style={styles.choiceLabel} numberOfLines={2}>
                {SIR_KINDS[kind].label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  icon: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E1E7E8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconOpen: { backgroundColor: colors.primary, borderColor: colors.primary },
  // Quieter than a real marker, so an empty day doesn't look like it has
  // something on it.
  add: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: colors.soft,
    shadowOpacity: 0,
    elevation: 0,
  },
  bubble: {
    position: 'absolute',
    width: 200,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E1E7E8',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    gap: 4,
  },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bubbleTitle: { flex: 1, color: colors.ink, fontFamily: fonts.semiBold, fontSize: 14 },
  bubbleSub: { color: colors.slate, fontFamily: fonts.regular, fontSize: 12 },
  bubbleRemove: {
    color: '#B4574F',
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 6,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowItem: { gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF3F3',
  },
  chipOpen: { backgroundColor: colors.primary },
  chipAdd: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.soft,
  },
  chipLabel: { color: colors.primary, fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  chipLabelOpen: { color: colors.white },
  chipDetail: { paddingHorizontal: 12, gap: 2 },
  scrim: { flex: 1, backgroundColor: 'rgba(8,17,18,0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.pale,
    marginBottom: 14,
  },
  sheetTitle: { color: colors.ink, fontFamily: fonts.semiBold, fontSize: 18 },
  sheetHint: {
    color: colors.slate,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 12 },
  choice: { width: 76, alignItems: 'center', gap: 6 },
  choiceIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EEF3F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLabel: {
    color: colors.primary,
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: 'center',
  },
});
