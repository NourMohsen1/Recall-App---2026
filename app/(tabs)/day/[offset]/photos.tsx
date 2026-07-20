import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { dateWithOffset } from '../../../../src/data';
import { dateKey, getMemoriesByDay } from '../../../../src/memoryLog';
import { colors, fonts } from '../../../../src/theme';

// Full-screen, swipeable viewer for a day's real logged photos — reached by
// tapping any thumbnail in the Photo Library card or day-detail photo row.
export default function PhotoViewer() {
  const router = useRouter();
  const { offset, start } = useLocalSearchParams<{ offset: string; start?: string }>();
  const offsetNum = Number(offset ?? 0);
  const startIndex = Number(start ?? 0);

  const [uris, setUris] = useState<string[]>([]);
  const [index, setIndex] = useState(startIndex);
  const listRef = useRef<FlatList<string>>(null);

  // Concrete pixel size of the list area (not flex/percentage) — RN Web's
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
    }, [offsetNum]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={28} color={colors.white} />
        </Pressable>
        {uris.length > 0 && (
          <Text style={styles.counter}>
            {index + 1} / {uris.length}
          </Text>
        )}
      </View>

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
                <Image
                  source={{ uri: item }}
                  style={{ width: area.width, height: area.height }}
                  resizeMode="contain"
                />
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
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
  counter: { fontFamily: fonts.medium, fontSize: 14, color: colors.white },
  list: { flex: 1 },
});
