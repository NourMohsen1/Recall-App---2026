import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import PillButton from '../../src/components/PillButton';
import { ICONS } from '../../src/images';
import { processMemoryIntake } from '../../src/memoryIntake';
import { dateKey, persistFile, saveMemory } from '../../src/memoryLog';
import { setPhotoMetaBatch, PhotoMeta } from '../../src/photoMeta';
import { detectPhotoSource } from '../../src/photoSource';
import { recordCurrentLocationForDay } from '../../src/placesFromPhotos';
import { colors, fonts } from '../../src/theme';
import { useReturnTo } from '../../src/useReturnTo';

type Picked = { uri: string; takenAt: Date; source?: PhotoMeta['source'] };

// EXIF timestamps look like "2026:07:02 14:31:08" (local time of the shot).
// iOS sometimes nests them under "{Exif}". Fall back to "now" when missing.
function takenAtFromAsset(asset: ImagePicker.ImagePickerAsset): Date {
  const exif = (asset.exif ?? {}) as Record<string, any>;
  const raw =
    exif.DateTimeOriginal ??
    exif.DateTimeDigitized ??
    exif.DateTime ??
    exif['{Exif}']?.DateTimeOriginal ??
    exif['{Exif}']?.DateTimeDigitized;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const parsed = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(d: Date) {
  const today = dateKey(new Date());
  if (dateKey(d) === today) return 'Today';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function LogPhoto() {
  const returnTo = useReturnTo();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);

  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    setPicked((prev) => [
      ...prev,
      ...assets.map((a) => ({
        uri: a.uri,
        takenAt: takenAtFromAsset(a),
        // The picker has no PHAsset mediaSubtypes, so screenshot detection
        // here relies on filename only — still catches Android's
        // "Screenshot_..." convention and iOS's rare literal-named ones.
        source: detectPhotoSource({ filename: a.fileName, exif: a.exif })?.key,
      })),
    ]);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach memories.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
      exif: true,
    });
    if (!result.canceled) addAssets(result.assets);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to capture a memory.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, exif: true });
    if (!result.canceled) addAssets(result.assets);
  };

  const removeAt = (index: number) => {
    setPicked((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (picked.length === 0 || saving) return;
    setSaving(true);

    // Copy files out of the volatile picker cache, then group by the day the
    // photo was taken — each group becomes its own memory on that date.
    const groups = new Map<string, Picked[]>();
    const photoMetaEntries: [string, PhotoMeta][] = [];
    for (const p of picked) {
      const permanent = { ...p, uri: await persistFile(p.uri, 'photo') };
      const key = dateKey(p.takenAt);
      const bucket = groups.get(key);
      if (bucket) bucket.push(permanent);
      else groups.set(key, [permanent]);
      const meta: PhotoMeta = { takenAt: permanent.takenAt.getTime() };
      if (permanent.source) meta.source = permanent.source;
      photoMetaEntries.push([permanent.uri, meta]);
    }
    await setPhotoMetaBatch(photoMetaEntries);
    const today = dateKey(new Date());
    for (const [key, group] of groups) {
      const earliest = group.reduce((a, b) => (a.takenAt <= b.takenAt ? a : b));
      const saved = await saveMemory({
        kind: 'photo',
        photoUris: group.map((g) => g.uri),
        text: caption.trim() || undefined,
        takenAt: earliest.takenAt,
      });
      // Only tag live location for photos taken today — an old picked photo
      // doesn't mean the user is standing where it was taken right now.
      if (key === today) recordCurrentLocationForDay(key).catch(() => {});
      // The caption goes through the same intake brain as any logging —
      // routed against the day the photos were taken, not today.
      if (caption.trim()) processMemoryIntake(saved.id, caption.trim(), key).catch(() => {});
    }
    returnTo();
  };

  // Preview of where the photos will land, grouped by day taken.
  const dayCounts = new Map<string, { label: string; count: number }>();
  for (const p of picked) {
    const key = dateKey(p.takenAt);
    const existing = dayCounts.get(key);
    if (existing) existing.count += 1;
    else dayCounts.set(key, { label: dayLabel(p.takenAt), count: 1 });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => returnTo()} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={26} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Add Photos</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Upload sources */}
        <View style={styles.sourceRow}>
          <Pressable style={styles.sourceBtn} onPress={pickFromLibrary}>
            <Image source={ICONS.upload} style={styles.sourceIcon} tintColor={colors.white} />
            <Text style={styles.sourceLabel}>Photo Library</Text>
          </Pressable>
          <Pressable style={styles.sourceBtn} onPress={takePhoto}>
            <Ionicons name="camera" size={28} color={colors.white} />
            <Text style={styles.sourceLabel}>Take Photo</Text>
          </Pressable>
        </View>

        {/* Selected thumbnails */}
        {picked.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{picked.length} selected</Text>
            <View style={styles.grid}>
              {picked.map((p, i) => (
                <View key={p.uri + i} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} resizeMode="cover" />
                  <View style={styles.thumbDate}>
                    <Text style={styles.thumbDateText}>{dayLabel(p.takenAt)}</Text>
                  </View>
                  <Pressable style={styles.removeBtn} onPress={() => removeAt(i)}>
                    <Ionicons name="close" size={14} color={colors.white} />
                  </Pressable>
                </View>
              ))}
            </View>

            {/* Where these will go on the Timeline */}
            <View style={styles.destCard}>
              <Ionicons name="calendar-outline" size={18} color={colors.teal} />
              <Text style={styles.destText}>
                {[...dayCounts.values()]
                  .map((d) => `${d.count} photo${d.count > 1 ? 's' : ''} → ${d.label}`)
                  .join('\n')}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Add a note (optional)</Text>
            <TextInput
              style={styles.caption}
              value={caption}
              onChangeText={setCaption}
              placeholder="What's happening in these photos?"
              placeholderTextColor="#9AA4A5"
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PillButton
          label={saving ? 'Saving…' : 'Save Memory'}
          onPress={save}
          style={picked.length === 0 && styles.saveDisabled}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  header: {
    paddingTop: 12,
    paddingBottom: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E8E8',
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: '#2B2B2B' },

  scroll: { padding: 24, paddingBottom: 40 },

  sourceRow: { flexDirection: 'row', gap: 14 },
  sourceBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  sourceIcon: { width: 28, height: 28 },
  sourceLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.white },

  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: '#1B1B1B',
    marginTop: 28,
    marginBottom: 14,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  thumbWrap: { width: 110, height: 110 },
  thumb: { width: '100%', height: '100%', borderRadius: 18 },
  thumbDate: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(8,17,18,0.65)',
    borderRadius: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  thumbDateText: { fontFamily: fonts.medium, fontSize: 10, color: colors.white },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },

  destCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.pale,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
  },
  destText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: '#2B4A4E' },

  caption: {
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 18,
    padding: 16,
    minHeight: 90,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: '#2B2B2B',
    textAlignVertical: 'top',
  },

  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E8E8',
  },
  saveDisabled: { opacity: 0.5 },
});
