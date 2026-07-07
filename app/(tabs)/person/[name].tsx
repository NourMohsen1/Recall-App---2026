import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PEOPLE } from '../../../src/data';
import { PERSON_PLACEHOLDER, personPhoto, placePhoto } from '../../../src/images';
import { colors, fonts } from '../../../src/theme';

export default function PersonProfile() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name: string }>();
  const person = PEOPLE.find((p) => p.name === name) ?? {
    name: name ?? 'Unknown',
    hasPhoto: false,
    tint: colors.slate,
    relation: 'Acquaintance',
    lastSeen: 'No memories together yet…',
    tags: [],
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Big photo */}
        <Image
          source={person.hasPhoto ? personPhoto(person.name) : PERSON_PLACEHOLDER}
          style={styles.photo}
          resizeMode="cover"
        />

        <Text style={styles.name}>{person.name}</Text>
        <Text style={styles.relation}>{person.relation}</Text>
        <Text style={styles.lastSeen}>{person.lastSeen}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 18 }}>
          <View style={styles.tagRow}>
            {person.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.sectionTitle}>Memories With {person.name}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.memoryRow}>
            {['Soccer Roof', '787 Coffee', 'College'].map((place) => (
              <Image
                key={place}
                source={placePhoto(place)}
                style={styles.memoryTile}
                resizeMode="cover"
              />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 16 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 24, color: '#2B2B2B' },
  scroll: { paddingHorizontal: 24, paddingBottom: 140 },

  photo: {
    width: '100%',
    aspectRatio: 0.97,
    borderRadius: 24,
    marginTop: 14,
    overflow: 'hidden',
  },

  name: { fontFamily: fonts.bold, fontSize: 34, color: '#1B1B1B', marginTop: 14, lineHeight: 42 },
  relation: { fontFamily: fonts.semiBold, fontSize: 16, color: '#2B2B2B', marginTop: 2 },
  lastSeen: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: '#3A4243',
    marginTop: 12,
  },
  tagRow: { flexDirection: 'row', gap: 10 },
  tag: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 20,
  },
  tagText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: '#1B1B1B', marginTop: 26, marginBottom: 12 },
  memoryRow: { flexDirection: 'row', gap: 12 },
  memoryTile: {
    width: 220,
    height: 160,
    borderRadius: 18,
    overflow: 'hidden',
  },
});
