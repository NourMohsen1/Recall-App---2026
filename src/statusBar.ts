import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';

// The phone's top bar (clock, signal, battery) follows the screen under it:
// dark on the app's light screens — which is most of them — and white on
// the few dark teal ones. It was white everywhere, so on light screens it
// could not be seen at all.
//
// Set on focus rather than by mounting a <StatusBar>: a dark screen stays
// mounted underneath whatever opens on top of it, and a mounted component
// would keep the top bar white over a light screen.

export const DEFAULT_STATUS_BAR = 'dark' as const;

/** Call in a dark screen: white top bar while it is the one showing. */
export function useLightStatusBar(): void {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light', true);
      return () => setStatusBarStyle(DEFAULT_STATUS_BAR, true);
    }, []),
  );
}
