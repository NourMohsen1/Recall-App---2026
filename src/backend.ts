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
// And since Oct 2026 the App Store build carries no token at all. Each
// install proves itself to the server with Apple's App Attest and gets its
// own pass (src/install.ts); a pass works only for that phone, for a week,
// and is renewed only by the phone's Secure Enclave. The old shared token
// survives for development builds alone — DEV_TOKEN below is compiled out
// of release bundles (checked: the token's value is not in the App Store
// bundle).

function trimmed(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v.length > 10 ? v : undefined;
}

// The user's answer to "Recall's AI" (src/aiConsent.ts). Until they say
// yes — and before the answer has even been read from storage — nothing
// but signing in reaches the server: every AI request finds its address
// here, so this one check covers all of them, including any added later.
let aiAllowed = false;

export function setAiAllowed(allowed: boolean): void {
  aiAllowed = allowed;
}

/** e.g. https://recall-keys.nourmohsen-recall.workers.dev */
export function backendUrl(path: string): string | undefined {
  // Signing in and getting an install pass send nothing about the user.
  if (!aiAllowed && !path.startsWith('/auth/') && !path.startsWith('/attest/')) return undefined;
  const base = trimmed(process.env.EXPO_PUBLIC_RECALL_API_URL);
  return base ? `${base.replace(/\/+$/, '')}${path}` : undefined;
}

/** Development builds only: `__DEV__` is false in a release build, so the
 *  minifier drops this branch and the value never enters the bundle. */
const DEV_TOKEN = __DEV__ ? trimmed(process.env.EXPO_PUBLIC_RECALL_APP_TOKEN) : undefined;

// This install's pass from the server (src/install.ts), once it has one.
let installPass: string | undefined;

export function setInstallPass(next: string | undefined): void {
  installPass = next;
}

/** What identifies this copy of the app: its App Attest pass, or — in a
 *  development build without one (the simulator can't attest) — the
 *  development token. */
export function appToken(): string | undefined {
  return installPass ?? DEV_TOKEN;
}

// Signed in with Apple (src/account.ts), the account's session rides along
// in the same credential: "<token>~<session>". Every call site already sends
// backendToken(), so none of them had to change.
let session: string | undefined;

export function setSession(next: string | undefined): void {
  session = next;
}

/** What the app presents to that server. Not a provider key. */
export function backendToken(): string | undefined {
  const token = appToken();
  return token && session ? `${token}~${session}` : token;
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
