import { Platform } from 'react-native';

// Speech-to-text for voice memories via OpenAI Whisper, which handles
// Arabic, English, and mixed Arabic/English speech in a single model.
//
// Setup: create `recall/.env` containing
//   EXPO_PUBLIC_OPENAI_API_KEY=sk-...
// then restart the dev server. Without a key, recordings still save —
// they just won't be transcribed.

export type SpeechLanguage = 'auto' | 'ar' | 'en';

export type TranscriptWord = { word: string; start: number; end: number };

export type TranscriptionResult =
  | { ok: true; text: string; words: TranscriptWord[] }
  | { ok: false; reason: 'no-key' | 'no-credits' | 'failed' };

const API_URL = 'https://api.openai.com/v1/audio/transcriptions';

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

export function transcriptionAvailable(): boolean {
  return !!apiKey();
}

export async function transcribeAudio(
  uri: string,
  language: SpeechLanguage = 'auto',
): Promise<TranscriptionResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'no-key' };

  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('file', blob, 'audio.webm');
    } else {
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
      form.append('file', {
        uri,
        name: `audio.${ext}`,
        type: ext === 'wav' ? 'audio/wav' : 'audio/m4a',
      } as any);
    }
    form.append('model', 'whisper-1');
    // verbose_json + word granularity gives per-word start/end times, which
    // drives the karaoke-style highlight while a memory plays back.
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    // Omitting `language` lets Whisper auto-detect — best for mixed speech.
    if (language !== 'auto') form.append('language', language);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (res.status === 429) return { ok: false, reason: 'no-credits' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    const json = (await res.json()) as {
      text?: string;
      words?: { word: string; start: number; end: number }[];
    };
    const text = json.text?.trim();
    if (!text) return { ok: false, reason: 'failed' };
    return { ok: true, text, words: json.words ?? [] };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

// Arabic script detection, used to flip text alignment to RTL.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿ]/;

export function isArabic(text?: string): boolean {
  return !!text && ARABIC_RE.test(text);
}

// Spread into a Text/TextInput style to render Arabic naturally.
export function rtlIfArabic(text?: string) {
  return isArabic(text)
    ? ({ textAlign: 'right', writingDirection: 'rtl' } as const)
    : null;
}
