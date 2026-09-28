import * as FileSystem from 'expo-file-system/legacy';

// Speech-to-text for voice memories, via OpenAI's gpt-transcribe — chosen
// over Whisper for mixed Arabic/English speech, which is most of what this
// app hears. See MODELS.openAiTranscribe for what that choice costs.
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

import { MODELS } from './aiProviders';
import { backendToken, backendUrl, ENDPOINTS } from './backend';
const API_URL = () => backendUrl(ENDPOINTS.transcribe);

/** Long enough for a several-minute recording on a poor connection, short
 *  enough that a stuck request becomes a visible failure. */
const TRANSCRIBE_TIMEOUT_MS = 90_000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`gave up after ${TRANSCRIBE_TIMEOUT_MS / 1000}s`)),
        TRANSCRIBE_TIMEOUT_MS,
      ),
    ),
  ]);
}

// The app's own server holds the provider key; this is only what gets the
// app through its door. See src/backend.ts.
function apiKey(): string | undefined {
  return backendToken();
}

function readUploadErrorReason(body: string): 'no-credits' | 'rate-limited' | 'failed' {
  try {
    const json = JSON.parse(body) as {
      error?: { type?: string; code?: string; message?: string };
    };
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
    const startedAt = Date.now();
    const parameters: Record<string, string> = {
      model: MODELS.openAiTranscribe,
      // Plain json: verbose_json and timestamp_granularities are whisper-1
      // only, and asking a newer model for them is an error rather than a
      // silently ignored option.
      response_format: 'json',
    };
    // Omitting `language` lets it auto-detect — best for mixed speech.
    if (language !== 'auto') parameters.language = language;

    // UPLOADED NATIVELY, not through FormData.
    //
    // The old code appended `{ uri, name, type }` to a FormData — the shape
    // every React Native guide shows. React Native 0.86 rejects it:
    //
    //   [voice] transcription error: Unsupported FormDataPart implementation
    //
    // So every recording made since the SDK 57 upgrade failed at this line,
    // and because the error was swallowed it looked like transcription
    // being slow rather than transcription being broken.
    //
    // uploadAsync builds the multipart body in native code from a file on
    // disk. It never constructs a FormData, so it cannot break this way,
    // and it does not read a whole recording into JavaScript memory first.
    // uploadAsync has no deadline of its own, so one is put around it. A
    // request that never resolves is what left recordings saying "still
    // writing this one up" forever, with nothing to act on.
    const uploaded = await withTimeout(FileSystem.uploadAsync(API_URL() ?? '', uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      // OpenAI decides how to decode the audio from the filename, so the
      // real extension has to survive the upload.
      mimeType: uri.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/m4a',
      parameters,
      headers: { authorization: `Bearer ${key}` },
    }));

    const res = {
      ok: uploaded.status >= 200 && uploaded.status < 300,
      status: uploaded.status,
      json: async () => JSON.parse(uploaded.body) as unknown,
    };

    if (uploaded.status === 429) {
      return { ok: false, reason: readUploadErrorReason(uploaded.body) };
    }
    if (!res.ok) {
      console.warn(`[voice] transcription failed: HTTP ${res.status} ${uploaded.body.slice(0, 160)}`);
      return { ok: false, reason: 'failed' };
    }

    const json = (await res.json()) as {
      text?: string;
      words?: { word: string; start: number; end: number }[];
    };
    const text = json.text?.trim();
    if (!text) {
      console.warn('[voice] transcription came back empty');
      return { ok: false, reason: 'failed' };
    }
    console.log(`[voice] transcribed ${text.length} chars in ${Date.now() - startedAt}ms`);
    return { ok: true, text, words: json.words ?? [] };
  } catch (e) {
    // Named rather than swallowed. "It never finished" was impossible to
    // tell apart from "it failed instantly" while this said nothing.
    const aborted = e instanceof Error && e.name === 'AbortError';
    console.warn(
      aborted
        ? `[voice] transcription gave up after ${TRANSCRIBE_TIMEOUT_MS / 1000}s`
        : `[voice] transcription error: ${e instanceof Error ? e.message : String(e)}`,
    );
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
