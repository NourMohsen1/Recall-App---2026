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
        {/* The live conversation comes up from the bottom and covers
            everything, the way a call does — it is not a page you navigated
            to, it is something you are in until you drop it. */}
        <Stack.Screen
          name="live"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      </Stack>
    </>
  );
}
