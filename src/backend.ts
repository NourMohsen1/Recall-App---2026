// Where the app sends anything that costs money.
//
// It used to send them straight to OpenAI and DeepSeek, carrying the keys.
// Anything named EXPO_PUBLIC_* is written into the JavaScript bundle, and
// the bundle is a file inside the installed app — so on a tester's phone
// those keys can be extracted and spent by somebody else. That is fine
// while Recall only runs on Nour's own phone and stops being fine the day
// anyone else installs it.
//
// So the keys moved to a small server (server/ in this repo) and the app
// now carries only a token that reaches that server and nothing else. The
// difference is what a leak costs: this token works on four endpoints with
// six named models, and can be changed in seconds without touching the
// provider accounts. A leaked provider key has no such limits.
//
// THIS TOKEN IS STILL IN THE BUNDLE. It is not a secret from a determined
// tester, and pretending otherwise would be the same mistake in a new
// place. It is a throttle and a revocation switch, not a lock.

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v.length > 10 ? v : undefined;
}

/** e.g. https://recall-keys.nourmohsen-recall.workers.dev */
export function backendUrl(path: string): string | undefined {
  const base = trimmed(process.env.EXPO_PUBLIC_RECALL_API_URL);
  return base ? `${base.replace(/\/+$/, '')}${path}` : undefined;
}

/** What the app presents to that server. Not a provider key. */
export function backendToken(): string | undefined {
  return trimmed(process.env.EXPO_PUBLIC_RECALL_APP_TOKEN);
}

/** Both halves have to be present; one without the other reaches nothing. */
export function backendReady(): boolean {
  return !!backendUrl('/') && !!backendToken();
}

// The four things the server will carry. Named here so a typo is a missing
// URL at startup rather than a 404 in the middle of somebody's sentence.
export const ENDPOINTS = {
  deepseekChat: '/chat/deepseek',
  openAiChat: '/chat/openai',
  transcribe: '/audio/transcriptions',
  speak: '/audio/speech',
} as const;
