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
// If Recall ever opens beyond people Nour knows, the next step is a token
// per install rather than one shared by all, so a single abuser can be cut
// off without disturbing anyone else. That needs somewhere to keep them
// (Cloudflare KV) and is deliberately not built yet.

export type Env = {
  /** Secrets, set with `wrangler secret put` — never in the repo. */
  OPENAI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  /** What the app must present. Change it to lock every old build out. */
  RECALL_APP_TOKEN: string;
};

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
  'whisper-1',
  'gpt-4o-mini-tts',
]);

/** Photos are the big ones: a day's worth of images is a few megabytes. */
const MAX_BODY = 25 * 1024 * 1024;

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

    const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!env.RECALL_APP_TOKEN || !tokenMatches(presented, env.RECALL_APP_TOKEN)) {
      return deny(401, 'Not a Recall client.');
    }

    const size = Number(request.headers.get('content-length') ?? '0');
    if (size > MAX_BODY) return deny(413, 'Request too large.');

    const { pathname } = new URL(request.url);
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
    // only model is whisper-1 and it is priced by the minute, so the size
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
