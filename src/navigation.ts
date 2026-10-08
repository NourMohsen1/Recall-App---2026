import type { Href, useRouter } from 'expo-router';

// Back, the way iOS apps do it: return to the exact screen you came from —
// Ask, a person, a place, the photos you opened — and only when there is
// nothing to go back to (the screen was opened by a notification or a
// link) go to its natural parent instead.
//
// It used to jump to fixed places (dismissTo('/timeline'), '/home'…), so a
// day opened from Ask came back to today's Timeline instead of the answer.

type Router = ReturnType<typeof useRouter>;

export function goBack(router: Router, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
