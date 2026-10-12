import { useCallback, useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { useFocusEffect, usePathname } from 'expo-router';

// The phone's top bar (clock, signal, battery) follows the screen under it:
// dark on the app's light screens, which is most of them, and white on the
// few dark ones (Ask, Live, the typing and voice screens, the photo viewer,
// onboarding).
//
// One keeper decides it, mounted once in the root layout. It used to be a
// <StatusBar> in the root plus each dark screen flipping it on focus and
// back on blur, and those fought: the root re-applied "dark" whenever it
// re-rendered, and going from one dark screen to another let the old
// screen's "back to dark" land after the new screen's "light". Nour saw
// white on white and dark on dark on every page.
//
// Now a dark screen only *claims* the white bar while it is focused. The
// keeper shows white while any claim is held and dark otherwise, so the
// order the events arrive in no longer matters. It re-applies on every
// screen change, on coming back to the app, and once a second, because the
// system camera and photo pickers change the bar and never put it back.

type Style = 'light-content' | 'dark-content';

const claims = new Set<number>();
const listeners = new Set<() => void>();
let nextClaim = 1;

function wanted(): Style {
  return claims.size > 0 ? 'light-content' : 'dark-content';
}

function changed(): void {
  for (const l of listeners) l();
}

/** Call in a dark screen: white top bar while it is the one showing. */
export function useLightStatusBar(enabled = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const id = nextClaim++;
      claims.add(id);
      changed();
      return () => {
        claims.delete(id);
        changed();
      };
    }, [enabled]),
  );
}

/** Mounted once, in the root layout. Renders nothing. */
export function StatusBarKeeper(): null {
  const pathname = usePathname();

  useEffect(() => {
    let shown: Style | undefined;
    const apply = (force = false) => {
      const style = wanted();
      if (!force && style === shown) return;
      shown = style;
      StatusBar.setBarStyle(style, true);
    };
    const onChange = () => apply();
    listeners.add(onChange);
    apply(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply(true);
    });
    // Same style again is a no-op on screen; this only repairs the bar after
    // something outside the app (camera, photo picker) changed it.
    const watch = setInterval(() => {
      if (AppState.currentState === 'active') {
        shown = wanted();
        StatusBar.setBarStyle(shown, false);
      }
    }, 1000);
    return () => {
      listeners.delete(onChange);
      sub.remove();
      clearInterval(watch);
    };
  }, []);

  // A screen change re-applies too: claims arrive on focus, which can come
  // a moment after the route has changed.
  useEffect(() => {
    StatusBar.setBarStyle(wanted(), true);
  }, [pathname]);

  return null;
}
