import AsyncStorage from '@react-native-async-storage/async-storage';

// Positive Focus: the recaps leave out painful moments — a death, a
// breakup, a serious illness, things at that level. Only the recaps. The
// Timeline and Ask still hold everything, because a memory app that hides
// what happened when you ask about it would be lying to you.
//
// Asked once in onboarding, changed any time in Profile. Off unless the
// user turns it on.

const KEY = 'positiveFocus';

export async function getPositiveFocus(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setPositiveFocus(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, on ? 'true' : 'false');
  console.log(`[recap] positive focus ${on ? 'on' : 'off'}`);
}
