import type { ComponentType } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BAR_CONTENT, HOME_LINE, useAppNavHeight } from '../navBar';
import MemoryFab from './MemoryFab';
import { ICONS } from '../images';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// The app's bottom menu — Home, Timeline, Tasks, Ask and the "+" —
// for screens opened on top of the tabs (Places, People, Recap, a day…),
// which otherwise cover the real tab bar. The tabs draw the same BottomBar,
// so it is one bar wherever it shows.

const TABS = [
  { href: '/home', label: 'Home', icon: ICONS.home },
  { href: '/timeline', label: 'Timeline', icon: ICONS.timeline },
  { href: '/tasks', label: 'Tasks', icon: ICONS.tasks },
  { href: '/chat', label: 'Ask', icon: ICONS.ask },
] as const;

export { BAR_CONTENT, useAppNavHeight };

export type TabKey = (typeof TABS)[number]['href'];

/**
 * The bar itself: drawn by the tabs (app/(tabs)/_layout.tsx) and by every
 * screen over them, so the icons never move between screens. They used to
 * be two bars, the tab bar's own and a copy here, laid out differently:
 * the icons jumped about 5 pt and sat high in the bar (Nour). Each icon and
 * its label are centred together in the part above the home line.
 */
export function BottomBar({ onSelect }: { onSelect: (href: TabKey) => void }) {
  const styles = useStyles();
  const c = useColors();
  const height = useAppNavHeight();
  const inset = useSafeAreaInsets().bottom;
  // Centred between the top edge and the home line (none on a phone with
  // a home button).
  const below = inset > 0 ? HOME_LINE : 0;
  return (
    <View style={[styles.bar, { height, paddingBottom: below }]}>
      {TABS.map((t) => (
        <Pressable
          key={t.href}
          style={styles.tab}
          onPress={() => onSelect(t.href)}
          accessibilityRole="button"
          accessibilityLabel={t.label}
        >
          <Image source={t.icon} style={styles.icon} tintColor={c.brand} resizeMode="contain" />
          <Text style={styles.label}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function AppNav() {
  const router = useRouter();
  const path = usePathname();
  // A sheet opened from a live voice card (app/peek/…) has no menu: every
  // tab in it would leave the conversation that is still going underneath.
  if (path.startsWith('/peek')) return null;
  return (
    <View style={stylesOverlay.overlay} pointerEvents="box-none">
      <View style={stylesOverlay.bottom}>
        <BottomBar
          onSelect={(href) => {
            // Already there: nothing to open (Ask would stack a second copy).
            if (path === href) return;
            // Ask opens on top; the tabs are gone back to.
            if (href === '/chat') router.push('/chat');
            else router.dismissTo(href as Parameters<typeof router.dismissTo>[0]);
          }}
        />
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

const stylesOverlay = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: c.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.divider,
  },
  // Each tab fills the bar down to the home line and centres its icon and
  // label in it, as one group.
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 26, height: 26 },
  label: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, color: c.brand, marginTop: 3 },
}));
