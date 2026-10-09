import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PersonAvatar from './PersonAvatar';
import { PlaceCover } from './PlaceTile';
import { getAllPersonMeta } from '../peopleTags';
import { recapCompany, type RecapPerson, type RecapPlace } from '../recap';
import { colors, fonts } from '../theme';

// Who and where, inside one day of a weekly recap — so each person and
// place sits with the day it belongs to, instead of the whole week's
// worth piled up at the end. One line of faces with their first names,
// one line of places; a few of each, then "+2", so it never wraps. A face the app only
// recognised is drawn as the guess it is (dashed, "Omar?").

const FACE = 26;
const MAX_FACES = 4;
const MAX_PLACES = 2;

export default function DayCompany({ day }: { day: string }) {
  const router = useRouter();
  const [people, setPeople] = useState<RecapPerson[]>([]);
  const [places, setPlaces] = useState<RecapPlace[]>([]);
  const [faces, setFaces] = useState<Record<string, string | undefined>>({});

  useFocusEffect(
    useCallback(() => {
      let live = true;
      Promise.all([recapCompany(day, day), getAllPersonMeta()])
        .then(([company, meta]) => {
          if (!live) return;
          setPeople(company.people);
          setPlaces(company.places);
          setFaces(Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, m.photoUri])));
        })
        .catch((e) => console.warn(`[recap] ${day}: could not gather people and places:`, e));
      return () => {
        live = false;
      };
    }, [day]),
  );

  if (people.length === 0 && places.length === 0) return null;

  const first = (n: string) => n.trim().split(/\s+/)[0];
  const shownPeople = people.slice(0, MAX_FACES);
  const morePeople = people.length - shownPeople.length;
  const names =
    shownPeople.map((p) => (p.guessed ? `${first(p.name)}?` : first(p.name))).join(', ') +
    (morePeople > 0 ? ` +${morePeople}` : '');
  const shownPlaces = places.slice(0, MAX_PLACES);
  const morePlaces = places.length - shownPlaces.length;

  const openPerson = (name: string) => router.push({ pathname: '/person/[name]', params: { name } });

  return (
    <View style={styles.wrap}>
      {people.length > 0 && (
        <Pressable
          style={styles.peopleRow}
          // One person opens them; several open the first — the names say who.
          onPress={() => openPerson(people[0].name)}
          hitSlop={4}
        >
          <View style={styles.stack}>
            {shownPeople.map((p, i) => (
              <View key={p.name} style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: MAX_FACES - i }]}>
                <PersonAvatar name={p.name} photoUri={faces[p.name]} size={FACE} unconfirmed={p.guessed} />
              </View>
            ))}
          </View>
          <Text numberOfLines={1} style={styles.names}>
            {names}
          </Text>
        </Pressable>
      )}
      {places.length > 0 && (
        <View style={styles.placesRow}>
          {shownPlaces.map((p) => (
            <Pressable
              key={p.id}
              style={styles.placeChip}
              onPress={() => router.push({ pathname: '/place/[name]', params: { name: p.id } })}
              hitSlop={4}
            >
              {p.cover ? (
                <PlaceCover cover={p.cover} kind={p.kind} size={18} radius={9} style={styles.placeCover} />
              ) : (
                <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.teal} />
              )}
              <Text numberOfLines={1} style={styles.placeText}>
                {p.label}
              </Text>
            </Pressable>
          ))}
          {morePlaces > 0 && (
            <View style={[styles.placeChip, styles.moreChip]}>
              <Text style={styles.placeText}>+{morePlaces}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 10 },
  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stack: { flexDirection: 'row' },
  // A white edge between overlapping faces, like a contact list.
  face: { borderRadius: FACE / 2 + 2, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.white },
  faceOverlap: { marginLeft: -9 },
  names: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: '#4A5253' },
  placesRow: { flexDirection: 'row', gap: 6 },
  placeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 118,
    backgroundColor: colors.pale,
    borderRadius: 999,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
  },
  placeCover: { borderWidth: 0 },
  moreChip: { paddingLeft: 10 },
  placeText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.ink },
});
