import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import PersonAvatar from './PersonAvatar';
import { PlaceCover } from './PlaceTile';
import { getAllPersonMeta } from '../peopleTags';
import { recapCompany, type RecapPerson, type RecapPlace } from '../recap';
import { colors, fonts } from '../theme';

// The end of a day's or a week's recap: everyone the user was with and
// everywhere they went, each once, as a row to swipe through. A person the
// app only recognised by face is drawn as the guess it is — dashed, "Omar?"
// — like everywhere else in Recall. Tapping opens their profile.

const SIZE = 58;
/** Space either side of an avatar inside its cell, room for its name. */
const INSET = 8;

// The title, the line and the first avatar all start at this component's
// left edge; the screen places it under the timeline's dots.
export default function RecapCompany({
  from,
  to,
  style,
}: {
  from: string;
  to: string;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<RecapPerson[]>([]);
  const [places, setPlaces] = useState<RecapPlace[]>([]);
  const [faces, setFaces] = useState<Record<string, string | undefined>>({});

  // On every return to the screen too: tagging someone on a day page and
  // coming back should show them here.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([recapCompany(from, to), getAllPersonMeta()])
        .then(([company, meta]) => {
          if (!live) return;
          setPeople(company.people);
          setPlaces(company.places);
          setFaces(Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, m.photoUri])));
          console.log(`[recap] ${from}–${to}: ${company.people.length} people, ${company.places.length} places`);
        })
        .catch((e) => console.warn('[recap] could not gather people and places:', e));
      return () => {
        live = false;
      };
    }, [from, to]),
  );

  if (people.length === 0 && places.length === 0) return null;

  // First names fit under an avatar; the full name only when two people
  // here share one.
  const first = (n: string) => n.trim().split(/\s+/)[0];
  const shared = (n: string) => people.filter((p) => first(p.name) === first(n)).length > 1;
  const short = (n: string) => (shared(n) ? n : first(n));

  return (
    <View style={[styles.wrap, style]}>
      {people.length > 0 && (
        <Section title="People" count={people.length}>
          {people.map((p) => (
            <Pressable
              key={p.name}
              style={styles.cell}
              onPress={() =>
                router.push({
                  pathname: '/person/[name]',
                  params: { name: p.name },
                })
              }
            >
              <PersonAvatar name={p.name} photoUri={faces[p.name]} size={SIZE} unconfirmed={p.guessed} />
              <Text numberOfLines={1} style={[styles.label, p.guessed && styles.labelGuess]}>
                {p.guessed ? `${short(p.name)}?` : short(p.name)}
              </Text>
            </Pressable>
          ))}
        </Section>
      )}
      {places.length > 0 && (
        <Section title="Places" count={places.length}>
          {places.map((p) => (
            <Pressable
              key={p.id}
              style={styles.cell}
              onPress={() =>
                router.push({
                  pathname: '/place/[name]',
                  params: { name: p.id },
                })
              }
            >
              <PlaceCover cover={p.cover} kind={p.kind} size={SIZE} radius={SIZE / 2} style={styles.round} />
              <Text numberOfLines={1} style={styles.label}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </Section>
      )}
    </View>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{count}</Text>
        </View>
      </View>
      {/* Pulled out by a cell's side margin, so the first avatar's edge —
          not its cell's — lines up with the title. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
        contentContainerStyle={styles.row}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // A line under the timeline, like the ones between its rows.
  wrap: { marginTop: 22, borderTopWidth: 1, borderTopColor: '#A9C0C3' },
  section: { marginTop: 18 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Same title and chip as the recap's rows above.
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: '#111' },
  chip: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  chipText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: colors.white,
    letterSpacing: 0.5,
  },
  scroller: { marginHorizontal: -INSET },
  row: { gap: 6, paddingTop: 14 },
  cell: { width: SIZE + INSET * 2, alignItems: 'center' },
  round: { borderWidth: 0 },
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#4A5253',
    marginTop: 6,
    maxWidth: '100%',
  },
  labelGuess: { color: colors.slate, fontStyle: 'italic' },
});
