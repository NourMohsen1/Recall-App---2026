import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPhotoSync, requestLibraryPermission, setPhotoSync, syncNewPhotosIfOn } from './photoImport';
import { runPhotoAnalysisNow } from './photoAnalysisQueue';

// "Explore your past": bringing in the photos already on the phone, so the
// past year fills in by itself (places, people, days) without logging any
// of it. Offered once in setup (app/explore-past.tsx) and, for anyone who
// never saw that, once on Home (src/components/ExplorePastCard.tsx).
// Profile → Import photos stays the way back in.
//
// Why: Nour opened the app fresh and never found the import. It sat in
// Profile, and the one feature that makes Recall full on day one was the
// one nobody turned on.

const ASKED_KEY = 'explorePastAsked';

export async function explorePastAsked(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(ASKED_KEY)) || (await getPhotoSync());
  } catch {
    return true;
  }
}

export async function markExplorePastAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => {});
}

/** Asks for the photos, turns Sync photos on and starts bringing the past
 *  year in, in the background. Returns false when access was refused. */
export async function startExplorePast(): Promise<boolean> {
  await markExplorePastAsked();
  const granted = await requestLibraryPermission();
  if (!granted) {
    console.log('[explore] photo access refused');
    return false;
  }
  await setPhotoSync(true);
  console.log('[explore] bringing the past year in');
  syncNewPhotosIfOn()
    .then((res) => {
      if (res) console.log(`[explore] ${res.imported} photos across ${res.days} days`);
      // Each day's story, as far as the user's photo-reading choice allows.
      runPhotoAnalysisNow();
    })
    .catch((e) => console.warn('[explore] import failed:', e));
  return true;
}
