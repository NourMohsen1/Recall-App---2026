import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether Recall may send photos to an AI service to write the story of a
// day — the user's decision, asked once and changeable in Profile.
//
// The one path that sends photos anywhere is the day story
// (getAssumedMemory in src/assumedMemory.ts), and it checks here first.
// Faces, places and attachments never leave the phone whatever this says.
//
//   'all'    — "Bring back my past": every day with photos, in the background.
//   'chosen' — "Only the days I choose": a day is read only after the user
//              taps "Tell me about this day" on it.
//   'off'    — "Start from today": no photos are sent.
//   null     — not asked yet. Nothing is sent until they answer.

export type PhotoReading = 'all' | 'chosen' | 'off';

/** Who reads the photos, said plainly wherever the choice is made. */
export const PHOTO_READER = { name: 'DeepSeek' } as const;

const MODE_KEY = 'photoReading';
const CHOSEN_KEY = 'photoReadingChosenDays';
const OFFERED_ALL_KEY = 'photoReadingOfferedAll';

let cachedMode: PhotoReading | null | undefined;
let cachedChosen: Set<string> | undefined;
const listeners = new Set<() => void>();

export function onPhotoReadingChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function getPhotoReading(): Promise<PhotoReading | null> {
  if (cachedMode !== undefined) return cachedMode;
  const raw = await AsyncStorage.getItem(MODE_KEY);
  cachedMode = raw === 'all' || raw === 'chosen' || raw === 'off' ? raw : null;
  return cachedMode;
}

export async function setPhotoReading(mode: PhotoReading): Promise<void> {
  await AsyncStorage.setItem(MODE_KEY, mode);
  cachedMode = mode;
  console.log(`[photos] reading photos set to "${mode}"`);
  for (const fn of listeners) fn();
}

async function chosenDays(): Promise<Set<string>> {
  if (cachedChosen) return cachedChosen;
  const raw = await AsyncStorage.getItem(CHOSEN_KEY);
  cachedChosen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  return cachedChosen;
}

/** The user tapped "Tell me about this day". Returns how many days they
 *  have chosen so far, so the screen knows when to offer the rest. */
export async function chooseDay(day: string): Promise<number> {
  const days = await chosenDays();
  days.add(day);
  await AsyncStorage.setItem(CHOSEN_KEY, JSON.stringify([...days]));
  for (const fn of listeners) fn();
  return days.size;
}

/** May this day's photos be sent to be read? */
export async function mayReadDay(day: string): Promise<boolean> {
  const mode = await getPhotoReading();
  if (mode === 'all') return true;
  if (mode === 'chosen') return (await chosenDays()).has(day);
  return false;
}

/** "Want Recall to do this for all your past days?" — offered once, after
 *  the user has chosen a few days by hand and seen what it does. */
export async function shouldOfferAll(chosenCount: number): Promise<boolean> {
  if (chosenCount < 3) return false;
  if ((await getPhotoReading()) !== 'chosen') return false;
  return !(await AsyncStorage.getItem(OFFERED_ALL_KEY));
}

export async function markOfferedAll(): Promise<void> {
  await AsyncStorage.setItem(OFFERED_ALL_KEY, '1');
}
