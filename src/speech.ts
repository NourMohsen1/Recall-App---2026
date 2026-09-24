import { Platform } from 'react-native';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

// Spoken answers for the Ask page — the user's memory talking back. Primary
// voice is OpenAI TTS (natural, same key as everything else, handles Arabic
// and English alike); the device's built-in speech engine is the fallback so
// answers are still spoken when the API can't be reached.

import { backendToken, backendUrl, ENDPOINTS } from './backend';
// The app's own server holds the provider key; this is only what gets the
// app through its door. See src/backend.ts.
function apiKey(): string | undefined {
  return backendToken();
}

// Only one thing speaks at a time.
let activePlayer: AudioPlayer | null = null;
let activeUsedDeviceSpeech = false;
let activeBlobUrl: string | null = null;

export function stopSpeaking(): void {
  if (activePlayer) {
    try {
      activePlayer.remove();
    } catch {
      // Already released.
    }
    activePlayer = null;
  }
  if (activeUsedDeviceSpeech) {
    Speech.stop();
    activeUsedDeviceSpeech = false;
  }
  if (activeBlobUrl) {
    try {
      URL.revokeObjectURL(activeBlobUrl);
    } catch {
      // Not a browser context.
    }
    activeBlobUrl = null;
  }
}

// Fetches natural speech for `text` and returns a playable local URI —
// a blob URL on web, a cached mp3 file on device.
async function fetchTtsUri(text: string, key: string): Promise<string | null> {
  const res = await fetch(backendUrl(ENDPOINTS.speak) ?? '', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) return null;

  const blob = await res.blob();
  if (Platform.OS === 'web') {
    activeBlobUrl = URL.createObjectURL(blob);
    return activeBlobUrl;
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
  if (!base64) return null;
  const path = `${FileSystem.cacheDirectory}speech-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

function looksArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

// Speaks `text` aloud. Resolves true if speech started; calls `onDone` when
// it finishes on its own (not when interrupted by stopSpeaking).
export async function speakText(text: string, onDone: () => void): Promise<boolean> {
  stopSpeaking();
  const trimmed = text.trim();
  if (!trimmed) return false;

  const key = apiKey();
  if (key) {
    try {
      const uri = await fetchTtsUri(trimmed, key);
      if (uri) {
        await setAudioModeAsync({ playsInSilentMode: true });
        const player = createAudioPlayer(uri);
        activePlayer = player;
        player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish && activePlayer === player) {
            stopSpeaking();
            onDone();
          }
        });
        player.play();
        return true;
      }
    } catch {
      // Fall through to the device voice.
    }
  }

  // Device fallback — robotic but free and offline.
  try {
    activeUsedDeviceSpeech = true;
    Speech.speak(trimmed, {
      language: looksArabic(trimmed) ? 'ar' : 'en-US',
      onDone: () => {
        activeUsedDeviceSpeech = false;
        onDone();
      },
      onError: () => {
        activeUsedDeviceSpeech = false;
        onDone();
      },
    });
    return true;
  } catch {
    return false;
  }
}
