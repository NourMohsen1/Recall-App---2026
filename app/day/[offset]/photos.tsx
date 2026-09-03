import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PhotoSourceSheet from '../../../src/components/PhotoSourceSheet';
import { dateWithOffset } from '../../../src/data';
import { dateKey, getMemoriesByDay } from '../../../src/memoryLog';
import PhotoImage from '../../../src/components/PhotoImage';
import { PhotoMeta, clearPhotoMeta, getAllPhotoMeta, setPhotoMeta } from '../../../src/photoMeta';
import { SOURCE_LABEL_STYLES } from '../../../src/photoSource';
import { colors, fonts } from '../../../src/theme';

const THUMB = 52;
const THUMB_GAP = 8;

// Full-screen, swipeable viewer for a day's real logged photos — reached by
// tapping any thumbnail in the Photo Library card or day-detail photo row.
export default function PhotoViewer() {
  const router = useRouter();
  const { offset, start } = useLocalSearchParams<{ offset: string; start?: string }>();
  const offsetNum = Number(offset ?? 0);
  const startIndex = Number(start ?? 0);

  const [uris, setUris] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, PhotoMeta>>({});
  const [index, setIndex] = useState(startIndex);
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<FlatList<string>>(null);
  const thumbListRef = useRef<FlatList<string>>(null);

  // Concrete pixel size of the pager area (not flex/percentage) — RN Web's
  // horizontal FlatList item wrapper doesn't stretch to a percentage height,
  // so each slide needs a real measured number to size its image against.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const onAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  useFocusEffect(
    useCallback(() => {
      const key = dateKey(dateWithOffset(offsetNum));
      getMemoriesByDay().then((byDay) => {
        const day = byDay.get(key) ?? [];
        setUris(day.filter((m) => m.kind === 'photo').flatMap((m) => m.photoUris ?? []));
      });
      getAllPhotoMeta().then(setMeta);
    }, [offsetNum]),
  );

  // Keep the thumbnail strip scrolled so the current photo's thumb stays
  // in view as the user swipes the main pager.
  useEffect(() => {
    thumbListRef.current?.scrollToOffset({
      offset: Math.max(0, index * (THUMB + THUMB_GAP) - THUMB * 2),
      animated: true,
    });
  }, [index]);

  const jumpTo = (i: number) => {
    setIndex(i);
    listRef.current?.scrollToOffset({ offset: area.width * i, animated: true });
  };

  const currentUri = uris[index];
  const currentMeta = currentUri ? (meta[currentUri] ?? null) : null;

  const handleSet = async (next: PhotoMeta) => {
    if (!currentUri) return;
    await setPhotoMeta(currentUri, next);
    setMeta((prev) => ({ ...prev, [currentUri]: next }));
  };
  const handleClear = async () => {
    if (!currentUri) return;
    await clearPhotoMeta(currentUri);
    setMeta((prev) => {
      const next = { ...prev };
      delete next[currentUri];
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.dismissTo('/timeline')} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>
        <View style={styles.headerRight}>
          {currentUri && (
            <Pressable onPress={() => setSheetOpen(true)} hitSlop={10} style={styles.tagBtn}>
              <Ionicons name="pricetag-outline" size={18} color={colors.white} />
            </Pressable>
          )}
          {uris.length > 0 && (
            <Text style={styles.counter}>
              {index + 1} / {uris.length}
            </Text>
          )}
        </View>
      </View>

      {/* Provenance label — its own row, never overlapping the photo */}
      <SourcePill meta={currentMeta} />

      <View style={styles.list} onLayout={onAreaLayout}>
        {area.width > 0 && area.height > 0 && (
          <FlatList
            ref={listRef}
            data={uris}
            keyExtractor={(uri) => uri}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: area.width, offset: area.width * i, index: i })}
            onMomentumScrollEnd={(e) => {
              setIndex(Math.round(e.nativeEvent.contentOffset.x / area.width));
            }}
            renderItem={({ item }) => (
              <View style={{ width: area.width, height: area.height, alignItems: 'center', justifyContent: 'center' }}>
                <PhotoImage
                  uri={item}
                  style={{ width: area.width, height: area.height }}
                  resizeMode="contain"
                />
              </View>
            )}
          />
        )}
      </View>

      {/* Quick-nav strip — a dedicated footer, not an overlay, so it never
          covers any part of the photo above it. Only shown when there's
          more than one photo to jump between. */}
      {uris.length > 1 && (
        <View style={styles.thumbStrip}>
          <FlatList
            ref={thumbListRef}
            data={uris}
            keyExtractor={(uri) => uri}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbStripContent}
            renderItem={({ item, index: i }) => (
              <Pressable onPress={() => jumpTo(i)}>
                <PhotoImage
                  uri={item}
                  style={[styles.thumb, i === index && styles.thumbActive]}
                />
              </Pressable>
            )}
          />
        </View>
      )}

      <PhotoSourceSheet
        visible={sheetOpen}
        current={currentMeta}
        onSet={handleSet}
        onClear={handleClear}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

// Small colored pill naming exactly where this photo came from — teal for a
// screenshot (a native OS action, not "from" anywhere), each app's own
// brand color otherwise, or whatever the user typed for "Other app…".
// Renders nothing when no source is set.
function SourcePill({ meta }: { meta: PhotoMeta | null }) {
  if (!meta || !meta.source) return null;
  const label =
    meta.source === 'other'
      ? { text: `Saved from ${meta.customLabel ?? 'another app'}`, bg: colors.slate, fg: colors.white }
      : SOURCE_LABEL_STYLES[meta.source];
  return (
    <View style={styles.pillRow}>
      <View style={[styles.pill, { backgroundColor: label.bg }]}>
        <Text style={[styles.pillText, { color: label.fg }]}>{label.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  back: { padding: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tagBtn: { padding: 4 },
  counter: { fontFamily: fonts.medium, fontSize: 14, color: colors.white },
  list: { flex: 1 },

  pillRow: { alignItems: 'center', paddingBottom: 10 },
  pill: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
  pillText: { fontFamily: fonts.bold, fontSize: 14 },

  thumbStrip: {
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
  },
  thumbStripContent: { paddingHorizontal: 14, gap: THUMB_GAP },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    opacity: 0.55,
  },
  thumbActive: {
    opacity: 1,
    borderWidth: 2,
    borderColor: colors.accent,
  },
});
