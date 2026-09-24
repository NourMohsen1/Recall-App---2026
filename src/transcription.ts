import { Platform } from 'react-native';

// Speech-to-text for voice memories via OpenAI Whisper, which handles
// Arabic, English, and mixed Arabic/English speech in a single model.
//
// Setup: create `recall/.env` containing
//   EXPO_PUBLIC_RECALL_API_URL=https://recall-keys.nourmohsen-recall.workers.dev
//   EXPO_PUBLIC_RECALL_APP_TOKEN=...
// then restart the dev server. The OpenAI key itself lives on that server,
// not here — see src/backend.ts. Without those, recordings still save, they
// just won't be transcribed.

export type SpeechLanguage = 'auto' | 'ar' | 'en';

export type TranscriptWord = { word: string; start: number; end: number };

export type TranscriptionResult =
  | { ok: true; text: string; words: TranscriptWord[] }
  // 'rate-limited': too many requests too fast, transient — distinct from
  // 'no-credits' (the account actually ran out of prepaid balance). Both
  // are HTTP 429; only the response body tells them apart.
  | { ok: false; reason: 'no-key' | 'no-credits' | 'rate-limited' | 'failed' };

import { backendToken, backendUrl, ENDPOINTS } from './backend';
const API_URL = () => backendUrl(ENDPOINTS.transcribe);

// The app's own server holds the provider key; this is only what gets the
// app through its door. See src/backend.ts.
function apiKey(): string | undefined {
  return backendToken();
}

async function readErrorReason(res: Response): Promise<'no-credits' | 'rate-limited' | 'failed'> {
  if (res.status !== 429) return 'failed';
  try {
    const json = await res.json();
    // OpenAI signals "out of money" in more than one shape, and getting
    // this wrong is genuinely harmful: it told the user "you're sending
    // questions too fast" for days when the real problem was an exhausted
    // balance, so nobody looked at billing. Check BOTH fields and match
    // any quota/credit/billing wording rather than one exact string.
    //   type: "insufficient_quota", code: "credit_balance_exhausted"
    //   type: "insufficient_quota", code: "insufficient_quota"
    const signal = [json?.error?.type, json?.error?.code, json?.error?.message]
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    const outOfCredits =
      signal.includes('insufficient_quota') ||
      signal.includes('credit_balance_exhausted') ||
      signal.includes('no credits remaining') ||
      signal.includes('billing');
    return outOfCredits ? 'no-credits' : 'rate-limited';
  } catch {
    return 'rate-limited';
  }
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

    const res = await fetch(API_URL() ?? '', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (res.status === 429) return { ok: false, reason: await readErrorReason(res) };
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
