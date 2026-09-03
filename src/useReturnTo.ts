import { useLocalSearchParams, useRouter } from 'expo-router';

// Screens opened from the MemoryFab (visible on every tab) carry a `from`
// param naming the tab they were opened from. Plain router.back() doesn't
// reliably return to that tab — this screen is pushed onto the root Stack
// from *inside* the bottom Tabs navigator, and Expo Router's implicit
// back-resolution doesn't restore which tab was active, landing on the tab
// bar's first tab instead. dismissTo(explicit target) sidesteps that.
export function useReturnTo(fallback: string = '/home') {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const target = (from || fallback) as Parameters<typeof router.dismissTo>[0];
  return () => router.dismissTo(target);
}
