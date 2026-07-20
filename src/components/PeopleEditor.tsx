import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

// Manual "who was I with" tagging — no face recognition, just a fast way to
// record real people per day and remove one if it was tagged by mistake.
export default function PeopleEditor({
  people,
  suggestions,
  onAdd,
  onRemove,
  pinSize = 64,
}: {
  people: string[];
  suggestions: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  pinSize?: number;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const matches =
    draft.trim().length > 0
      ? suggestions.filter(
          (s) => s.toLowerCase().includes(draft.trim().toLowerCase()) && !people.includes(s),
        )
      : [];

  const commit = (name: string) => {
    if (name.trim()) onAdd(name.trim());
    setDraft('');
    setAdding(false);
  };

  return (
    <View style={styles.grid}>
      {people.map((name) => (
        <View key={name} style={[styles.cell, { width: pinSize + 24 }]}>
          <View style={[styles.pin, { width: pinSize, height: pinSize, borderRadius: pinSize / 2 }]}>
            <Text style={styles.initials}>{initials(name)}</Text>
            <Pressable style={styles.removeBtn} onPress={() => onRemove(name)} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#B24545" />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={styles.label}>
            {name}
          </Text>
        </View>
      ))}

      {adding ? (
        <View style={[styles.cell, { width: 140 }]}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => commit(draft)}
            onBlur={() => (draft.trim() ? commit(draft) : setAdding(false))}
            placeholder="Name…"
            placeholderTextColor="#A9B0B1"
            style={styles.input}
          />
          {matches.length > 0 && (
            <View style={styles.suggestBox}>
              {matches.slice(0, 4).map((m) => (
                <Pressable key={m} style={styles.suggestRow} onPress={() => commit(m)}>
                  <Text style={styles.suggestText}>{m}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.cell, { width: pinSize + 24 }]}>
          <Pressable
            style={[
              styles.pin,
              styles.addPin,
              { width: pinSize, height: pinSize, borderRadius: pinSize / 2 },
            ]}
            onPress={() => setAdding(true)}
          >
            <MaterialCommunityIcons name="account-plus-outline" size={26} color={colors.teal} />
          </Pressable>
          <Text style={styles.label}>Add</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { alignItems: 'center' },
  pin: {
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPin: { borderWidth: 1.5, borderColor: colors.teal, borderStyle: 'dashed', backgroundColor: 'transparent' },
  initials: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.teal },
  removeBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.white,
    borderRadius: 9,
  },
  label: { fontFamily: fonts.regular, fontSize: 12, color: '#4A5253', marginTop: 6 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#2B2B2B',
    borderBottomWidth: 1,
    borderBottomColor: colors.teal,
    paddingVertical: 4,
    width: '100%',
  },
  suggestBox: {
    position: 'absolute',
    top: 34,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4E8E8',
    zIndex: 10,
    elevation: 4,
  },
  suggestRow: { paddingVertical: 8, paddingHorizontal: 10 },
  suggestText: { fontFamily: fonts.regular, fontSize: 13, color: '#2B2B2B' },
});
