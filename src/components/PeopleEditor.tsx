import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import PersonAvatar from './PersonAvatar';
import { getAllPersonMeta, getAllTaggedPeople } from '../peopleTags';
import { colors, fonts } from '../theme';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/** Lowercase, without accents — so "omar", "Omar" and "Ómar" match. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** The name with the typed part in bold, like a search bar's suggestions. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = fold(text).indexOf(fold(query));
  if (!query || at < 0) return <Text style={styles.suggestText}>{text}</Text>;
  return (
    <Text style={styles.suggestText}>
      {text.slice(0, at)}
      <Text style={styles.suggestBold}>{text.slice(at, at + query.length)}</Text>
      {text.slice(at + query.length)}
    </Text>
  );
}

// Who the user was with on a day: the people they tagged themselves, plus
// any the app recognised in that day's photos and is asking about. The two
// are drawn differently on purpose — see PersonAvatar's `unconfirmed`.
export default function PeopleEditor({
  people,
  suggestions,
  onAdd,
  onRemove,
  pinSize = 64,
  photos,
  suggested = [],
  onConfirm,
  onDismiss,
  onSearchOpen,
}: {
  people: string[];
  suggestions: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  pinSize?: number;
  /** Each person's reference face, so the row shows people not initials. */
  photos?: Record<string, string | undefined>;
  /** People the app thinks were here — awaiting the user's yes or no. */
  suggested?: { name: string }[];
  onConfirm?: (name: string) => void;
  onDismiss?: (name: string) => void;
  /** The search opened — the screen can lift it above the keyboard. */
  onSearchOpen?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // Everyone the user knows — tagged on a day or added on People — with
  // their faces and who they are, for suggestions as they type.
  const [known, setKnown] = useState<{ name: string; photo?: string; descriptor?: string }[]>([]);
  useEffect(() => {
    if (!adding) return;
    Promise.all([getAllTaggedPeople(), getAllPersonMeta()]).then(([tagged, meta]) => {
      const names = [...new Set([...suggestions, ...tagged, ...Object.keys(meta)])];
      setKnown(names.map((n) => ({ name: n, photo: meta[n]?.photoUri, descriptor: meta[n]?.descriptor })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding]);

  // Like a search bar: names starting with what's typed first, then any
  // word in the name starting with it, then anywhere in it — and the
  // descriptor ("Dad", "coworker") counts too.
  const q = fold(draft.trim());
  const ranked = q
    ? known
        .filter((k) => !people.some((p) => fold(p) === fold(k.name)))
        .map((k) => {
          const n = fold(k.name);
          const score = n.startsWith(q)
            ? 0
            : n.split(/\s+/).some((w) => w.startsWith(q))
              ? 1
              : n.includes(q)
                ? 2
                : k.descriptor && fold(k.descriptor).includes(q)
                  ? 3
                  : -1;
          return { ...k, score };
        })
        .filter((k) => k.score >= 0)
        .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
        .slice(0, 5)
    : [];
  const exact = ranked.some((r) => fold(r.name) === q);

  const commit = (name: string) => {
    if (name.trim()) onAdd(name.trim());
    setDraft('');
    setAdding(false);
  };

  return (
    <View style={styles.grid}>
      {people.map((name) => (
        <View key={name} style={[styles.cell, { width: pinSize + 24 }]}>
          <View>
            <PersonAvatar name={name} photoUri={photos?.[name]} size={pinSize} />
            <Pressable style={styles.removeBtn} onPress={() => onRemove(name)} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#B24545" />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={styles.label}>
            {name}
          </Text>
        </View>
      ))}

      {/* People the app recognised in this day's photos but the user hasn't
          confirmed. Dashed and lighter so a guess never reads as something
          they recorded, with the two answers right there rather than hidden
          behind a tap. */}
      {suggested.map((s) => (
        <View key={`s-${s.name}`} style={[styles.cell, { width: pinSize + 24 }]}>
          <PersonAvatar name={s.name} photoUri={photos?.[s.name]} size={pinSize} unconfirmed />
          {/* First name only: a full name plus the question mark overflows
              this cell, and the "?" is the bit that carries the meaning. */}
          <Text numberOfLines={1} style={[styles.label, styles.labelUnconfirmed]}>
            {s.name.trim().split(/\s+/)[0]}?
          </Text>
          <View style={styles.confirmRow}>
            <Pressable onPress={() => onConfirm?.(s.name)} hitSlop={14}>
              <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
            </Pressable>
            <Pressable onPress={() => onDismiss?.(s.name)} hitSlop={14}>
              <Ionicons name="close-circle" size={22} color="#B4B8B8" />
            </Pressable>
          </View>
        </View>
      ))}

      {adding ? (
        <View style={styles.searchCell}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={15} color={colors.teal} />
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              // Return takes the top suggestion when it starts with what was
              // typed ("om" → Omar), like a search bar; else the typed name.
              onSubmitEditing={() => commit(!exact && ranked[0]?.score === 0 ? ranked[0].name : draft)}
              // Leaving the field with nothing typed closes it; with a name
              // typed it stays, so tapping a suggestion isn't beaten by the
              // half-typed text being saved first.
              onBlur={() => !draft.trim() && setAdding(false)}
              placeholder="Who were you with?"
              placeholderTextColor="#A9B0B1"
              style={styles.searchInput}
              returnKeyType="done"
            />
            <Pressable onPress={() => { setDraft(''); setAdding(false); }} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color="#B4B8B8" />
            </Pressable>
          </View>
          {(ranked.length > 0 || (q && !exact)) && (
            <View style={styles.suggestList}>
              {ranked.map((r) => (
                <Pressable key={r.name} style={styles.suggestRow} onPress={() => commit(r.name)}>
                  <PersonAvatar name={r.name} photoUri={r.photo ?? photos?.[r.name]} size={30} />
                  <View style={{ flex: 1 }}>
                    <Highlight text={r.name} query={draft.trim()} />
                    {r.descriptor ? <Text style={styles.suggestSub}>{r.descriptor}</Text> : null}
                  </View>
                </Pressable>
              ))}
              {q && !exact ? (
                <Pressable style={styles.suggestRow} onPress={() => commit(draft)}>
                  <View style={styles.newIcon}>
                    <Ionicons name="add" size={18} color={colors.teal} />
                  </View>
                  <Text style={styles.suggestText}>
                    Add <Text style={styles.suggestBold}>“{draft.trim()}”</Text>
                  </Text>
                </Pressable>
              ) : null}
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
            onPress={() => {
              setAdding(true);
              onSearchOpen?.();
            }}
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
  labelUnconfirmed: { color: colors.slate, fontStyle: 'italic' },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 4, justifyContent: 'center' },
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
  // Typing a name: a full-width search field, suggestions in the flow
  // below it (never a floating box a card's edge could cut off).
  searchCell: { width: '100%' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: '#2B2B2B', padding: 0 },
  suggestList: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E4E8E8',
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F2',
  },
  suggestText: { fontFamily: fonts.regular, fontSize: 14, color: '#2B2B2B' },
  suggestBold: { fontFamily: fonts.semiBold, color: colors.primary },
  suggestSub: { fontFamily: fonts.regular, fontSize: 11, color: '#8B9394', marginTop: 1 },
  newIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
