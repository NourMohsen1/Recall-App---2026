import AsyncStorage from '@react-native-async-storage/async-storage';

// The Home tour (src/components/CoachTour.tsx, steps in Home): tips on the
// real screen, shown once after setup to new users and to everyone who had
// Recall before it existed. Profile → "How Recall works" runs it again.
//
// Why it exists: a tester thought live voice in Ask would save what he told
// it and make tasks. It doesn't. The + logs; Ask only answers. The
// walkthrough says that plainly, once, before it becomes a surprise.

// A new key for the tour: the five-page walkthrough it replaced was out
// for an hour, and anyone who saw that should still see this once.
const KEY = 'homeTourSeen';

export async function walkthroughSeen(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(KEY));
  } catch {
    // Unknown is treated as seen: never trap someone in it on a bad read.
    return true;
  }
}

export async function markWalkthroughSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, new Date().toISOString());
}
