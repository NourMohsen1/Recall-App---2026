import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The bottom menu's size, shared by the bar (src/components/AppNav.tsx) and
// the + that sits over it (src/components/MemoryFab.tsx).

/** Height of the menu above the home line, where its icons are centred. */
export const BAR_CONTENT = 56;

/** Height of the whole menu on this phone, home line included. */
export function useAppNavHeight(): number {
  return BAR_CONTENT + useSafeAreaInsets().bottom;
}

/** The home line sits about this far above the bottom edge. The icons are
 *  centred between the bar's top edge and it, which is the middle the eye
 *  sees; centred above the whole home-line area they looked high (Nour). */
export const HOME_LINE = 13;

/** How far the + reaches down into the bar: as it always has. */
export const FAB_OVERLAP = 24;
