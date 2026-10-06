import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { DEFAULT_STATUS_BAR } from '../src/statusBar';
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
import { startPlaceIndexing } from '../src/places';
import { refreshTaskReminders } from '../src/tasks';
import { syncPhotosWithLibrary } from '../src/photoGuard';
import { recoverWronglyRemovedPhotos, syncNewPhotosIfOn } from '../src/photoImport';
import { syncRecapNotifications } from '../src/recapNotifications';
import { loadAccount } from '../src/account';
import { startCrashReporting, wrapWithCrashReporting } from '../src/crashReporting';

// Before anything else, so a crash during startup is reported too.
startCrashReporting();

function RootLayout() {
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
  // Places: read where imported photos were taken and file them under
  // places, quietly. Needs no model, so it does not wait for the faces.
  useEffect(() => {
    startPlaceIndexing();
    // Tasks saved before reminders moved ahead of the time get re-planned
    // once (no-op after that).
    refreshTaskReminders();
  }, []);

  // "Your recap is ready": keep the schedule matching Profile's switches,
  // and open the Recap on the right tab when one is tapped — including the
  // tap that launched the app.
  const router = useRouter();
  useEffect(() => {
    loadAccount();
    syncRecapNotifications();
    const open = (response: Notifications.NotificationResponse | null) => {
      const tab = response?.notification.request.content.data?.recap;
      if (typeof tab !== 'string') return;
      console.log(`[recap] notification opened the ${tab} recap`);
      const offset = response?.notification.request.content.data?.offset;
      router.push({
        pathname: '/recap',
        params: typeof offset === 'number' ? { period: tab, offset: String(offset) } : { period: tab },
      });
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);

  // Photos deleted from Photos leave Recall, and any photo not yet checked
  // for privacy is checked — on open, and whenever the app comes back.
  useEffect(() => {
    // Then, when Sync photos is on, bring in anything new (photoImport.ts).
    const sync = () =>
      syncPhotosWithLibrary()
        .then(() => recoverWronglyRemovedPhotos())
        .then(() => syncNewPhotosIfOn());
    sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => sub.remove();
  }, []);

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
      <StatusBar style={DEFAULT_STATUS_BAR} />
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

export default wrapWithCrashReporting(RootLayout);
