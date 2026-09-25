// One place that decides which API answers which kind of request.
//
// Six modules used to each carry their own copy of "prefer DeepSeek, fall
// back to OpenAI", each with the model name hardcoded. That's how the app
// ended up still calling `deepseek-chat` — a name DeepSeek no longer lists,
// kept alive only by an alias that could be retired the way OpenAI's search
// model was.
//
// WHAT GOES WHERE, and why:
//   text   → DeepSeek. Cheaper, and it does not share a budget with
//            anything else the app needs.
//   vision → DeepSeek, OpenAI as fallback. Measured on a real 4-photo day:
//            1,015 input tokens against gpt-4o-mini's 11,446, because
//            gpt-4o-mini inflates image tokens ~33x. About 8x cheaper per
//            day analysed even though DeepSeek spends more tokens
//            reasoning. The model is flagged experimental by DeepSeek, so
//            OpenAI stays wired up behind it rather than being removed.
//   audio  → OpenAI only. DeepSeek serves no speech-to-text or TTS model:
//            /audio/transcriptions and /audio/speech both 404.
//   search → OpenAI only. DeepSeek cannot browse — passing
//            web_search_options is accepted and then ignored, and the model
//            says so itself when asked.

import { backendToken, backendUrl, ENDPOINTS } from './backend';

export const MODELS = {
  deepseekText: 'deepseek-v4-flash',
  deepseekVision: 'deepseek-v4-flash-vision-exp',
  openAiText: 'gpt-4o-mini',
  openAiVision: 'gpt-4o-mini',
  // OpenAI-only capabilities.
  openAiSearch: 'gpt-5-search-api',
  // gpt-transcribe, not whisper-1. Whisper is the 2022 model and is
  // noticeably weaker on the thing this app does most — Arabic and English
  // mixed inside one sentence. The transcript is what every other feature
  // is built from: tasks, people and places are all extracted from these
  // words, so a misheard word becomes a wrong task.
  //
  // THE COST OF THIS CHOICE: word-level timestamps are a whisper-1 feature
  // and no newer model offers them, so the karaoke-style highlight during
  // playback is gone. VoicePlayer already falls back to plain text when
  // there are no timings. Accuracy first — the highlight decorates words
  // that have to be right before they are worth decorating.
  openAiTranscribe: 'gpt-transcribe',
  openAiTts: 'gpt-4o-mini-tts',
} as const;

// Both go through the app's own server, which holds the provider keys.
// See src/backend.ts for why, and for what this does and does not protect.
const DEEPSEEK_URL = () => backendUrl(ENDPOINTS.deepseekChat);
const OPENAI_URL = () => backendUrl(ENDPOINTS.openAiChat);

export type Provider = { url: string; key: string; model: string; name: 'deepseek' | 'openai' };

// There used to be one of these per provider, because the app held one key
// per provider and either could be missing on its own. It now holds
// neither: both providers are reached through the same server with the same
// token, so there is one question left — is that server configured — and
// asking it per provider would only imply a distinction that no longer
// exists.

// Text-only work, cheapest capable provider first.
export function textProviders(): Provider[] {
  const token = backendToken();
  const deepseek = DEEPSEEK_URL();
  const openai = OPENAI_URL();
  if (!token || !deepseek || !openai) return [];
  return [
    { url: deepseek, key: token, model: MODELS.deepseekText, name: 'deepseek' },
    { url: openai, key: token, model: MODELS.openAiText, name: 'openai' },
  ];
}

// Anything that sends images. Same order, same reasoning — but the fallback
// matters more here because DeepSeek's vision model is experimental.
export function visionProviders(): Provider[] {
  const token = backendToken();
  const deepseek = DEEPSEEK_URL();
  const openai = OPENAI_URL();
  if (!token || !deepseek || !openai) return [];
  return [
    { url: deepseek, key: token, model: MODELS.deepseekVision, name: 'deepseek' },
    { url: openai, key: token, model: MODELS.openAiVision, name: 'openai' },
  ];
}

export function textAvailable(): boolean {
  return textProviders().length > 0;
}

export function visionAvailable(): boolean {
  return visionProviders().length > 0;
}

export type ChatResult = { ok: true; content: string; provider: Provider } | { ok: false; status: number; body: string };

// Sends the same request to each provider in turn until one answers.
//
// `buildBody` takes the model name because the body has to name the model,
// and the two providers use different ones. Only a genuine failure moves on
// to the next provider — a 200 that came back badly is the model's answer,
// not an outage, and retrying it elsewhere would just cost twice.
export async function chatCompletion(
  providers: Provider[],
  buildBody: (model: string) => Record<string, unknown>,
): Promise<ChatResult> {
  let last: { status: number; body: string } = { status: 0, body: 'no provider configured' };

  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(p.model)),
      });
      if (!res.ok) {
        last = { status: res.status, body: (await res.text()).slice(0, 400) };
        continue;
      }
      const json = await res.json();
      const content: string = json.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) {
        last = { status: 200, body: 'empty completion' };
        continue;
      }
      return { ok: true, content, provider: p };
    } catch (e) {
      last = { status: 0, body: e instanceof Error ? e.message : 'network error' };
    }
  }

  return { ok: false, ...last };
}

// The full message back, not just its text.
//
// chatCompletion above deliberately treats an empty completion as a failure
// and moves on to the next provider. That is right for every feature that
// wants prose — and wrong for tool calling, where an empty content field with
// a populated tool_calls is the NORMAL, successful answer: the model is
// saying "I need to look something up first". Hence a second door rather than
// a flag, so neither caller has to reason about the other's rules.
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type RawMessage = {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
};

export type RawResult =
  | { ok: true; message: RawMessage; provider: Provider }
  | { ok: false; status: number; body: string };

export async function chatCompletionRaw(
  providers: Provider[],
  buildBody: (model: string) => Record<string, unknown>,
): Promise<RawResult> {
  let last: { status: number; body: string } = { status: 0, body: 'no provider configured' };

  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(p.model)),
      });
      if (!res.ok) {
        last = { status: res.status, body: (await res.text()).slice(0, 400) };
        continue;
      }
      const json = await res.json();
      const message = json.choices?.[0]?.message as RawMessage | undefined;
      if (!message) {
        last = { status: 200, body: 'no message in response' };
        continue;
      }
      return { ok: true, message, provider: p };
    } catch (e) {
      last = { status: 0, body: e instanceof Error ? e.message : 'network error' };
    }
  }

  return { ok: false, ...last };
}
