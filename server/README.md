# Recall's key server

A single Cloudflare Worker that holds the OpenAI and DeepSeek keys so the
app doesn't have to.

## Why it exists

Anything named `EXPO_PUBLIC_*` is written into the app's JavaScript bundle,
and the bundle is a file inside the installed app. On Nour's own phone that
is fine. The moment a tester installs Recall, those keys can be pulled out
and spent by somebody else, on anything, until the bill is noticed.

So the app carries a token that reaches this server and nothing else.

**What that does not fix.** The token is in the bundle too, and a determined
tester can extract it. The difference is what it buys them: four endpoints,
six named models, and a token that can be changed in seconds without
touching the provider accounts or rebuilding the app. A leaked provider key
has none of those limits.

## What it carries

| the app asks | it forwards to |
|---|---|
| `POST /chat/deepseek` | DeepSeek chat completions |
| `POST /chat/openai` | OpenAI chat completions |
| `POST /audio/transcriptions` | OpenAI Whisper |
| `POST /audio/speech` | OpenAI text-to-speech |

Anything else is a 404. Any model not in `ALLOWED_MODELS` is a 400.

## Deploying

```
cd server
npx wrangler login          # opens a browser
npx wrangler deploy         # prints the URL
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put RECALL_APP_TOKEN
```

Then put the printed URL and the same app token into the app's `.env` as
`EXPO_PUBLIC_RECALL_API_URL` and `EXPO_PUBLIC_RECALL_APP_TOKEN`, and restart
the dev server.

## Running it locally

`.dev.vars` holds fake secrets for `npx wrangler dev`. It is gitignored and
must stay that way.

## Still to do before anyone but Nour uses it

- **Hard spend caps on both provider accounts.** This server limits which
  models can be used; it does not limit how much. The caps are the actual
  ceiling on a bad day, and they live in the provider dashboards, not here.
- **A token per install** rather than one shared by every copy of the app,
  so a single abuser can be cut off without locking out everyone. Needs
  somewhere to keep them (Cloudflare KV). Worth doing if Recall goes beyond
  people Nour knows.
- **Rate limiting.** Cloudflare can do this at the edge without code.
