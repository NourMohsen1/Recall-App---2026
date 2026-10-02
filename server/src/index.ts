// The key server.
//
// WHY THIS EXISTS. Anything named EXPO_PUBLIC_* is written into the
// JavaScript bundle, and a bundle is just a file inside the installed app.
// On Nour's own phone that is fine. The moment a tester installs Recall,
// the OpenAI and DeepSeek keys can be pulled out of it and spent by
// somebody else, on anything, until the bill is noticed.
//
// So the app stops carrying them. It asks this instead, and this asks the
// providers. The provider keys live only in Cloudflare's encrypted secret
// store and never reach a phone.
//
// WHAT THIS DOES NOT FIX, stated plainly because it would be easy to
// believe otherwise: the app still has to identify itself somehow, and that
// credential is in the bundle too. A determined tester can extract
// RECALL_APP_TOKEN and call this server directly. The difference is what
// that buys them — this token only reaches these four endpoints, only with
// the models listed below, and it can be changed in ten seconds without
// rebuilding the app or touching the provider accounts. A leaked provider
// key has none of those limits.
//
// ACCOUNTS. A user who signs in with Apple also carries a session this
// server signed (see /auth/apple below), so each request can be tied to one
// account — and one account can be paused without disturbing anyone else
// (BLOCKED_ACCOUNTS). The server stores nothing about anyone: an account is
// a hash of Apple's user id, and the session proves it by its signature.
// Memories never come here; they live on the phone and in the user's own
// iCloud. People who tap "Not now" still use the shared token alone.

export type Env = {
  /** Secrets, set with `wrangler secret put` — never in the repo. */
  OPENAI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  /** What the app must present. Change it to lock every old build out. */
  RECALL_APP_TOKEN: string;
  /** Signs sessions. Changing it signs everyone out (they sign in again
   *  with one tap). */
  SESSION_SECRET?: string;
  /** Account ids to pause, comma-separated. A plain variable, not a secret. */
  BLOCKED_ACCOUNTS?: string;
};

// ── Sign in with Apple ────────────────────────────────────────────────────

/** The app's bundle id: Apple's token must have been issued to Recall. */
const APPLE_AUDIENCE = 'com.nourwalid.recall';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

/** A year; the app renews it quietly when under half is left. */
const SESSION_DAYS = 365;

const enc = new TextEncoder();

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(part))) as T;
}

// Apple rotates its signing keys now and then; kept for six hours per
// worker, and fetched again at once for a key id not seen yet.
let appleKeys: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function appleKey(kid: string): Promise<(JsonWebKey & { kid?: string }) | undefined> {
  const fresh = appleKeys && Date.now() - appleKeys.at < 6 * 3600_000;
  let key = fresh ? appleKeys!.keys.find((k) => k.kid === kid) : undefined;
  if (!key) {
    const res = await fetch(APPLE_KEYS_URL);
    if (!res.ok) return undefined;
    appleKeys = { at: Date.now(), keys: ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys };
    key = appleKeys.keys.find((k) => k.kid === kid);
  }
  return key;
}

/** Apple's user id from a genuine, unexpired identity token issued to
 *  Recall — or null. */
async function verifyAppleToken(token: string): Promise<string | null> {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = jsonPart<{ alg?: string; kid?: string }>(h);
    if (header.alg !== 'RS256' || !header.kid) return null;
    const jwk = await appleKey(header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
      'verify',
    ]);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const claims = jsonPart<{ iss?: string; aud?: string | string[]; exp?: number; sub?: string }>(p);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ISSUER || !aud.includes(APPLE_AUDIENCE)) return null;
    if (!claims.exp || claims.exp * 1000 < Date.now() || !claims.sub) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

/** The account id: a hash of Apple's user id, so neither the logs nor the
 *  app's requests carry Apple's own identifier. */
async function accountId(appleSub: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`recall:${appleSub}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function issueSession(account: string, secret: string): Promise<{ session: string; expiresAt: number }> {
  const expiresAt = Date.now() + SESSION_DAYS * 86400_000;
  const payload = bytesB64url(enc.encode(JSON.stringify({ a: account, e: expiresAt })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return { session: `${payload}.${bytesB64url(sig)}`, expiresAt };
}

/** The account a session belongs to, if this server signed it and it has
 *  not expired. */
async function verifySession(session: string, secret: string | undefined): Promise<string | null> {
  if (!secret) return null;
  const [payload, sig] = session.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlBytes(sig), enc.encode(payload));
    if (!ok) return null;
    const { a, e } = jsonPart<{ a?: string; e?: number }>(payload);
    return a && e && e > Date.now() ? a : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Only these models, whoever is asking.
//
// A token that can reach any model is a token that can run the most
// expensive one ever made, thousands of times, before anyone notices. This
// list is the difference between a leak that costs a few pounds and one
// that costs a fortune. It must match MODELS in src/aiProviders.ts.
const ALLOWED_MODELS = new Set([
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'gpt-4o-mini',
  'gpt-5-search-api',
  'gpt-transcribe',
  'gpt-4o-mini-tts',
]);

/** Photos are the big ones: a day's worth of images is a few megabytes. */
const MAX_BODY = 25 * 1024 * 1024;

// Live voice runs against this model and no other. The app never gets to
// choose: a realtime session is the most expensive thing this token can
// start, at roughly ten cents a minute, so what it costs per minute is
// decided here rather than by whoever is holding the token.
const REALTIME_MODEL = 'gpt-realtime-2.1';

// The voice, also decided here. Not a security matter — it is simply
// something the server can change for every build at once, without anyone
// updating an app.
const REALTIME_VOICE = 'marin';

const UPSTREAM = {
  openai: 'https://api.openai.com',
  deepseek: 'https://api.deepseek.com',
} as const;

function deny(status: number, message: string): Response {
  // Shaped like the providers' own errors, so the app's existing handling
  // reads them without a special case.
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Constant time, so the comparison cannot be used to guess the token one
 *  character at a time by watching how long the answer takes. */
function tokenMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return deny(405, 'Only POST is accepted.');

    // "<app token>" or, once signed in, "<app token>~<session>" — the
    // session rides in the same header so no call site in the app changes.
    const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const cut = presented.lastIndexOf('~');
    const appToken = cut === -1 ? presented : presented.slice(0, cut);
    const session = cut === -1 ? '' : presented.slice(cut + 1);
    if (!env.RECALL_APP_TOKEN || !tokenMatches(appToken, env.RECALL_APP_TOKEN)) {
      return deny(401, 'Not a Recall client.');
    }

    const size = Number(request.headers.get('content-length') ?? '0');
    if (size > MAX_BODY) return deny(413, 'Request too large.');

    const { pathname } = new URL(request.url);

    // A session that no longer checks out (expired, or the secret changed)
    // is served as if signed out rather than refused: the app renews it at
    // launch, and nobody should lose a voice note over it in the meantime.
    const account = session ? await verifySession(session, env.SESSION_SECRET) : null;
    if (session && !account) console.log(`[auth] stale session on ${pathname}`);
    const blocked = (env.BLOCKED_ACCOUNTS ?? '').split(',').map((x) => x.trim());
    if (account && blocked.includes(account)) return deny(403, 'This account is paused.');
    console.log(`[${account ?? 'signed-out'}] ${pathname}`);

    // Sign in with Apple: the app sends the identity token Apple gave it;
    // this checks Apple signed it for Recall and answers with a session.
    if (pathname === '/auth/apple') {
      if (!env.SESSION_SECRET) return deny(503, 'Sign-in is not set up on this server.');
      let identityToken: unknown;
      try {
        identityToken = ((await request.json()) as { identityToken?: unknown }).identityToken;
      } catch {
        return deny(400, 'Body is not valid JSON.');
      }
      if (typeof identityToken !== 'string') return deny(400, 'Missing identityToken.');
      const sub = await verifyAppleToken(identityToken);
      if (!sub) return deny(401, 'Apple did not confirm this sign-in.');
      const id = await accountId(sub);
      if (blocked.includes(id)) return deny(403, 'This account is paused.');
      console.log(`[auth] signed in ${id}`);
      return json({ account: id, ...(await issueSession(id, env.SESSION_SECRET)) });
    }

    // A fresh session for a valid one — the app's quiet renewal.
    if (pathname === '/auth/refresh') {
      if (!account || !env.SESSION_SECRET) return deny(401, 'Sign in again.');
      return json({ account, ...(await issueSession(account, env.SESSION_SECRET)) });
    }

    // Live voice: a short-lived key the app can connect WebRTC with.
    //
    // The app cannot be given the real key — a realtime connection is made
    // from the phone straight to OpenAI, so whatever it holds is on the
    // phone. This mints a credential that expires in about a minute and can
    // only start the session configured below.
    if (pathname === '/realtime/token') {
      const minted = await fetch(`${UPSTREAM.openai}/v1/realtime/client_secrets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: REALTIME_MODEL,
            audio: { output: { voice: REALTIME_VOICE } },
          },
        }),
      });
      return new Response(minted.body, {
        status: minted.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    let upstream: string;
    let path: string;

    switch (pathname) {
      // Text and vision. The app decides which provider it wants, because
      // it is the thing that knows what the request is for — this only
      // carries it there.
      case '/chat/deepseek':
        upstream = UPSTREAM.deepseek;
        path = '/chat/completions';
        break;
      case '/chat/openai':
        upstream = UPSTREAM.openai;
        path = '/v1/chat/completions';
        break;
      // Speech, both directions. OpenAI only: DeepSeek serves neither.
      case '/audio/transcriptions':
        upstream = UPSTREAM.openai;
        path = '/v1/audio/transcriptions';
        break;
      case '/audio/speech':
        upstream = UPSTREAM.openai;
        path = '/v1/audio/speech';
        break;
      default:
        return deny(404, 'No such endpoint.');
    }

    const key = upstream === UPSTREAM.deepseek ? env.DEEPSEEK_API_KEY : env.OPENAI_API_KEY;
    if (!key) return deny(503, 'This server is missing its provider key.');

    // JSON requests get their model checked. Transcription is multipart
    // with an audio file in it, and reading that body here to inspect it
    // would mean holding a whole recording in memory for no benefit — its
    // only model is gpt-transcribe and it is priced by the minute, so the size
    // limit above is the control that matters there.
    const contentType = request.headers.get('content-type') ?? '';
    let body: BodyInit | null = request.body;

    if (contentType.includes('application/json')) {
      const text = await request.text();
      let model: unknown;
      try {
        model = (JSON.parse(text) as { model?: unknown }).model;
      } catch {
        return deny(400, 'Body is not valid JSON.');
      }
      if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
        return deny(400, `Model not allowed: ${String(model)}`);
      }
      body = text;
    }

    const headers = new Headers();
    headers.set('authorization', `Bearer ${key}`);
    if (contentType) headers.set('content-type', contentType);

    const response = await fetch(`${upstream}${path}`, {
      method: 'POST',
      headers,
      body,
    });

    // Passed back as it came, including errors: the app already knows how
    // to read what these providers say, and rewriting their messages here
    // would only hide the reason a call failed.
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  },
};
