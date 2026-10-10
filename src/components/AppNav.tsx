import type { ComponentType } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import MemoryFab from './MemoryFab';
import { ICONS } from '../images';
import { colors, fonts } from '../theme';

// The app's bottom menu — Home, Timeline, Tasks, Ask and the "+" —
// for screens opened on top of the tabs (Places, People, Recap, a day…),
// which otherwise cover the real tab bar. Drawn to match it exactly: same
// height, icons, labels and colours as app/(tabs)/_layout.tsx.

const TABS = [
  { href: '/home', label: 'Home', icon: ICONS.home },
  { href: '/timeline', label: 'Timeline', icon: ICONS.timeline },
  { href: '/tasks', label: 'Tasks', icon: ICONS.tasks },
  { href: '/chat', label: 'Ask', icon: ICONS.ask },
] as const;

/** Height of the menu, for screens that need room above it. */
export const APP_NAV_HEIGHT = 84;

export default function AppNav() {
  const router = useRouter();
  const path = usePathname();
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.bar}>
        {TABS.map((t) => (
          <Pressable
            key={t.href}
            style={styles.tab}
            onPress={() => {
              // Already there: nothing to open (Ask would stack a second copy).
              if (path === t.href) return;
              // Ask opens on top; the tabs are gone back to.
              if (t.href === '/chat') router.push('/chat');
              else router.dismissTo(t.href as Parameters<typeof router.dismissTo>[0]);
            }}
          >
            <Image source={t.icon} style={styles.icon} tintColor={colors.primary} resizeMode="contain" />
            <Text style={styles.label}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <MemoryFab />
    </View>
  );
}

/** A screen with the bottom menu over its bottom edge. */
export function withAppNav<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function WithNav(props: P) {
    return (
      <View style={{ flex: 1 }}>
        <Screen {...props} />
        <AppNav />
      </View>
    );
  }
  WithNav.displayName = `WithAppNav(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return WithNav;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: APP_NAV_HEIGHT,
    paddingTop: 8,
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.pale,
  },
  tab: { flex: 1, alignItems: 'center' },
  icon: { width: 26, height: 26 },
  label: { fontFamily: fonts.regular, fontSize: 11, color: colors.primary, marginTop: 3 },
});
