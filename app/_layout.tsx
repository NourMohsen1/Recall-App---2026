import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { startPhotoAnalysis } from '../src/photoAnalysisQueue';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // Photo analysis runs as a background job from app start — never
  // triggered by, or waited on by, any screen the user is looking at.
  useEffect(() => {
    startPhotoAnalysis();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        {/* Presented as an ordinary pushed screen, like Ask and Day.
            'fullScreenModal' read better in theory and broke in practice: on
            a real phone the safe-area insets do not reach inside that
            presentation, so the header slid up under the Dynamic Island and
            took the way out with it. Every other screen in this app is a
            plain push, and every other screen is fine. */}
        <Stack.Screen name="live" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
