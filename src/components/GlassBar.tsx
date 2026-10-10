import { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requireOptionalNativeModule } from 'expo-modules-core';

// A page's top bar as frosted glass, the way iOS draws its own: the page
// scrolls up underneath it and shows through, blurred, instead of meeting
// a solid white block (Nour, Oct 2026).
//
// The bar has a fixed height so a page knows where its content starts on
// the very first frame — GLASS_BAR + the status bar. A page passes
// `glassScroll(top)` to its ScrollView: the content starts below the bar
// and the scroll indicator and pull-to-refresh spinner do too.
//
// The blur is a native view. A build made before it was added (the
// development build already on a phone) gets the same bar without the
// blur — a little more opaque — rather than a crash.

/** The bar's own height, under the status bar. */
export const GLASS_BAR = 60;

type BlurModule = typeof import('expo-blur');
const Blur: BlurModule['BlurView'] | null = requireOptionalNativeModule('ExpoBlur')
  ? (require('expo-blur') as BlurModule).BlurView
  : null;

/** Where a glass page's content starts: below the status bar and the bar. */
export function useGlassTop(): number {
  return useSafeAreaInsets().top + GLASS_BAR;
}

/** Scroll props for a page under a glass bar. */
export function glassScroll(top: number) {
  return {
    contentInset: { top },
    contentOffset: { x: 0, y: -top },
    scrollIndicatorInsets: { top },
    automaticallyAdjustContentInsets: false,
  } as const;
}

export default function GlassBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + GLASS_BAR }, style]} pointerEvents="box-none">
      {Blur ? (
        <Blur intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, Blur ? styles.tint : styles.tintSolid]} />
      <View style={styles.content} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    // A hairline that reads as the edge of the glass, not a wall.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(8,17,18,0.08)',
    overflow: 'hidden',
  },
  // White over the blur, so the title always reads.
  tint: { backgroundColor: 'rgba(255,255,255,0.62)' },
  tintSolid: { backgroundColor: 'rgba(255,255,255,0.9)' },
  content: { flex: 1, justifyContent: 'center' },
});
