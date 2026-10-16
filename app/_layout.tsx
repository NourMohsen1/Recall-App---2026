import { LogBox } from 'react-native';
// The simulator copy is built unsigned, so it has no keychain and Expo's
// push-registration read fails on every launch. A real phone has one; the
// warning only hid the bottom of the screen during simulator checks.
if (__DEV__) LogBox.ignoreLogs(['[expo-notifications] Error reading persisted server registration']);
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { StatusBarKeeper } from '../src/statusBar';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { startPhotoAnalysis } from '../src/photoAnalysisQueue';
import { fileLateNightPhotos } from '../src/lateNightPhotos';
import { installFaceEmbedder } from '../src/faceEmbedderTflite';
import { learnMyFaceIfMissing } from '../src/myFace';
import { startBackgroundIndexing } from '../src/faceIndexing';
import { startPlaceIndexing } from '../src/places';
import { refreshTaskReminders } from '../src/tasks';
import { syncPhotosWithLibrary } from '../src/photoGuard';
import { recoverWronglyRemovedPhotos, syncNewPhotosIfOn } from '../src/photoImport';
import { notificationTarget, startNotifications } from '../src/recapNotifications';
import { loadAccount } from '../src/account';
import { loadAiConsent } from '../src/aiConsent';
import { loadAppearance, useColors } from '../src/appearance';
import { startInstallPass } from '../src/install';
import { startCrashReporting, wrapWithCrashReporting } from '../src/crashReporting';

// Before anything else, so a crash during startup is reported too.
startCrashReporting();

function AppRoot() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // Photo analysis runs as a background job from app start — never
  // triggered by, or waited on by, any screen the user is looking at.
  //
  // After photos from after midnight are back on the night they belong to
  // (src/lateNightPhotos.ts, once per install), so no story is written from
  // photos about to move.
  useEffect(() => {
    fileLateNightPhotos().finally(() => startPhotoAnalysis());
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

  // Notifications (src/recapNotifications.ts): rebuilt at launch and on
  // leaving the app; a tap opens what it's about — including the tap that
  // launched the app.
  const router = useRouter();
  useEffect(() => {
    loadAccount();
    const stop = startNotifications();
    const open = (response: Notifications.NotificationResponse | null) => {
      const target = notificationTarget(response?.notification.request.content.data);
      if (!target) return;
      console.log(`[notify] opened ${target.pathname}`);
      router.push(target as Parameters<typeof router.push>[0]);
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      sub.remove();
      stop();
    };
  }, [router]);

  // Photos deleted from Photos leave Recall, and any photo not yet checked
  // for privacy is checked — on open, and whenever the app comes back.
  useEffect(() => {
    // Then, when Sync photos is on, bring in anything new (photoImport.ts).
    const sync = () =>
      fileLateNightPhotos()
        .then(() => syncPhotosWithLibrary())
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
      // The user's own face first (src/myFace.ts): a profile photo set
      // before this existed is learned quietly, so the photo stories stop
      // calling other people "you".
      .then(() => learnMyFaceIfMissing())
      .then(() => fileLateNightPhotos())
      .then(() => startBackgroundIndexing())
      .catch((e) => console.warn('[faces] not available:', e));
  }, []);

  // Light or dark (src/appearance.ts): the navigation frame takes the
  // page colour too, so nothing flashes white between screens or behind a
  // sheet.
  const c = useColors();
  const base = c.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.divider, primary: c.brand },
  };

  if (!fontsLoaded) {
    return null;
  }

  return (
    // Gestures anywhere in the app — the + button's hold-and-drag needs it.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <ThemeProvider value={navTheme}>
      <StatusBarKeeper />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        {/* Presented as an ordinary pushed screen, like Ask and Day.
            'fullScreenModal' read better in theory and broke in practice: on
            a real phone the safe-area insets do not reach inside that
            presentation, so the header slid up under the Dynamic Island and
            took the way out with it. Every other screen in this app is a
            plain push, and every other screen is fine. */}
        <Stack.Screen name="live" options={{ animation: 'slide_from_bottom' }} />
        {/* Ask's brain turns with a finger, so going back is the left-edge
            swipe only — iOS 26+ otherwise takes a swipe anywhere as "back". */}
        <Stack.Screen name="chat" options={{ fullScreenGestureEnabled: false }} />
        {/* Opened from live voice's cards: a sheet over the call, swiped
            down to get back to talking. */}
        <Stack.Screen name="peek/day/[offset]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="peek/place/[name]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="peek/person/[name]" options={{ presentation: 'modal' }} />
      </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// The AI permission is read before anything else mounts: the background
// jobs below start at once, and must already know whether they may reach
// the AI (src/aiConsent.ts).
function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // And light or dark, so the first screen is drawn in the right one.
    Promise.allSettled([loadAiConsent(), loadAppearance()]).finally(() => setReady(true));
  }, []);
  // This install's pass to the server (App Attest) — at launch and on
  // every return to the app.
  useEffect(() => startInstallPass(), []);
  return ready ? <AppRoot /> : null;
}

export default wrapWithCrashReporting(RootLayout);
