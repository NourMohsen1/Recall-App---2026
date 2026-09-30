import { Alert } from 'react-native';
import { runPhotoAnalysisNow } from './photoAnalysisQueue';
import {
  PHOTO_READER,
  chooseDay,
  getPhotoReading,
  markOfferedAll,
  setPhotoReading,
  shouldOfferAll,
} from './photoReading';

// "Tell me about this day" — the ask, on the day itself, where the value is
// in front of the user. See src/photoReading.ts for the choice this serves.

function confirm(title: string, message: string, yes: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: yes, onPress: () => resolve(true) },
    ]),
  );
}

/** The user tapped "Tell me about this day". Resolves to how many days they
 *  have chosen so far, or 0 when they decided not to after all. */
export async function askToReadDay(day: string, photoCount: number): Promise<number> {
  const mode = await getPhotoReading();
  if (mode === 'all') return 1;
  // Someone who said "start from today" (or was never asked) is told
  // exactly what reading this one day means before anything is sent.
  if (mode !== 'chosen') {
    const ok = await confirm(
      "Read this day's photos?",
      `Recall will send ${photoCount === 1 ? "this day's photo" : `this day's ${photoCount} photos`} to ${PHOTO_READER.name}, an AI service based in ${PHOTO_READER.where}, to write its story. From now on it reads only the days you choose — you can change this in Profile.`,
      'Read this day',
    );
    if (!ok) return 0;
    await setPhotoReading('chosen');
  }
  return chooseDay(day);
}

/** After a few days read by hand, offer the rest — once. */
export async function offerAllIfTime(chosenCount: number): Promise<void> {
  if (!(await shouldOfferAll(chosenCount))) return;
  await markOfferedAll();
  const yes = await confirm(
    'Want Recall to do this for all your past days?',
    `It will read your past days in the background the same way — sent to ${PHOTO_READER.name} to be read. You can change this any time in Profile.`,
    'Yes, all my past days',
  );
  if (!yes) return;
  await setPhotoReading('all');
  runPhotoAnalysisNow();
}
