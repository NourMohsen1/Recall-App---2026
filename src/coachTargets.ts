import type { RefObject } from 'react';
import type { View } from 'react-native';

// Parts of the screen the Home tour points at that live in other
// components (the + is drawn by the tab bar, not by Home). Each registers
// its view here; the tour measures it where it is on screen right now.

export type Rect = { x: number; y: number; width: number; height: number };

// A list per key, newest last: the + is drawn by the tab bar and again by
// every screen opened over the tabs. The newest one still mounted is the
// one on screen; closing a screen hands the key back to the one beneath.
const targets = new Map<string, RefObject<View | null>[]>();

export function registerCoachTarget(key: string, ref: RefObject<View | null>): () => void {
  targets.set(key, [...(targets.get(key) ?? []), ref]);
  return () => targets.set(key, (targets.get(key) ?? []).filter((r) => r !== ref));
}

/** Where a view is in the window, or null when it isn't on screen. */
export function measureView(view: View | null | undefined): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

export function measureCoachTarget(key: string): Promise<Rect | null> {
  const list = targets.get(key) ?? [];
  return measureView(list[list.length - 1]?.current);
}
