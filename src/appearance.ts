import { useSyncExternalStore } from 'react';
import { Appearance, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { palettes, type Palette, type Scheme } from './theme';

// Light or dark, the user's choice in Profile → Appearance (Nour, Oct 2026).
// Light until they choose.
//
// The choice is read before the first screen mounts (app/_layout.tsx), so
// the app never opens in one mode and flips to the other. It also sets
// iOS's own mode for the app, so the keyboard, alerts, menus and the time
// wheel match the screen around them.
//
// "Match iPhone" needs the app built with userInterfaceStyle "automatic";
// build 2 is built light-only, so iOS reports light whatever the phone is
// set to. The option appears by itself on a build that supports it.
// (Changing app.json changes the native fingerprint, so it waits for the
// next build rather than cutting the testers off from updates.)

export type AppearanceChoice = 'light' | 'dark' | 'auto';

const KEY = 'appearance';

export const canMatchPhone = Constants.expoConfig?.userInterfaceStyle === 'automatic';

let choice: AppearanceChoice = 'light';
let scheme: Scheme = 'light';
const listeners = new Set<() => void>();

function resolve(): Scheme {
  if (choice === 'auto') return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  return choice;
}

function apply(): void {
  // iOS's own controls follow: a fixed choice overrides the phone, "auto"
  // hands it back.
  try {
    Appearance.setColorScheme(choice === 'auto' ? 'unspecified' : choice);
  } catch (e) {
    console.warn('[appearance] could not set the iOS mode:', e);
  }
  const next = resolve();
  if (next === scheme) return;
  scheme = next;
  for (const l of listeners) l();
}

// The phone switching between light and dark (only seen when "auto").
Appearance.addChangeListener(() => {
  if (choice !== 'auto') return;
  const next = resolve();
  if (next === scheme) return;
  scheme = next;
  for (const l of listeners) l();
});

/** Read once at launch, before anything is drawn. */
export async function loadAppearance(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light' || (saved === 'auto' && canMatchPhone)) choice = saved;
  } catch (e) {
    console.warn('[appearance] could not read the choice, staying light:', e);
  }
  apply();
  console.log(`[appearance] ${choice} → ${scheme}`);
}

export function getAppearance(): AppearanceChoice {
  return choice;
}

export async function setAppearance(next: AppearanceChoice): Promise<void> {
  choice = next;
  apply();
  console.log(`[appearance] chose ${next} → ${scheme}`);
  await AsyncStorage.setItem(KEY, next);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The mode on screen now. Re-renders when it changes. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, () => scheme);
}

export function useAppearanceChoice(): AppearanceChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

/** The palette for the mode on screen. */
export function useColors(): Palette {
  return palettes[useScheme()];
}

/** The palette now, outside a component (a value read at the moment it's
 *  needed, never stored). */
export function currentColors(): Palette {
  return palettes[scheme];
}

/**
 * A screen's styles, made from the palette: write them once with the
 * palette's roles, and each mode gets its own sheet, built the first time
 * it's shown and kept.
 *
 *   const useStyles = makeStyles((c) => ({ page: { backgroundColor: c.bg } }));
 *   …in the component: const styles = useStyles();
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  build: (c: Palette) => T,
): () => T {
  const sheets: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const s = useScheme();
    return (sheets[s] ??= StyleSheet.create(build(palettes[s])) as T);
  };
}
