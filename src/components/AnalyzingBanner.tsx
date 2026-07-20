import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';

// Visible proof that the AI is reading and polishing a memory — shown while
// useMemoryPolish() is sweeping. Without this the whole pipeline looks like
// nothing is happening, even though notes/tasks/people are being rewritten
// underneath.
export default function AnalyzingBanner() {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={{
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }}
      >
        <MaterialCommunityIcons name="creation" size={15} color={colors.teal} />
      </Animated.View>
      <Text style={styles.text}>Analyzing your memory…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(99,188,198,0.14)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  text: { fontFamily: fonts.medium, fontSize: 12, color: colors.teal },
});
