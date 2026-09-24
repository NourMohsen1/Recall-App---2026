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
import { installFaceEmbedder } from '../src/faceEmbedderTflite';
import { startBackgroundIndexing } from '../src/faceIndexing';

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

  // Face recognition, switched on.
  //
  // Order matters and is not obvious: indexing checks whether a model is
  // registered and quietly does nothing if it is not, so loading the models
  // has to finish first. Both models come from files inside the app and run
  // on the phone; this never touches the network.
  //
  // A failure here is not fatal. The app runs fine without face
  // recognition — that is the whole point of the model registering itself
  // rather than being imported — so this logs and lets everything else
  // carry on.
  useEffect(() => {
    installFaceEmbedder()
      .then(() => startBackgroundIndexing())
      .catch((e) => console.warn('[faces] not available:', e));
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
