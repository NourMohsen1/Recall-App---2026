# Recall — which feature uses which API

Checked against the code on 3 October 2026. Every AI call goes through the
Recall server (Cloudflare Worker, `server/`), which holds the OpenAI and
DeepSeek keys. The app itself holds no provider key.

**Where to see usage**
- DeepSeek: platform.deepseek.com → Usage (by model)
- OpenAI: platform.openai.com → Usage (by model)
- Recall server: Cloudflare dashboard → Workers → `recall-keys` → Logs (every
  request, with its path and the account id or `signed-out`)

The dashboards split usage **by model, not by feature**. Several features
share `deepseek-v4-flash`, so the tables below say which feature each model's
usage comes from.

---

## At a glance

| Model | Provider | Used by | What drives the cost |
|---|---|---|---|
| `deepseek-v4-flash` | DeepSeek | Logging (intake), Recap, Ask, follows, safety check, story translation, manual tasks | Number of logs and questions — the bulk of all calls |
| `deepseek-v4-flash-vision-exp` | DeepSeek | Photo stories | Days of photos read — up to 20 small photos a day |
| `gpt-4o-mini` | OpenAI | **Backup only** for every DeepSeek call above | Only when DeepSeek fails |
| Tavily search (`/search/news`) | Tavily | On This Day — finds the real articles | Searches: 1 credit each, 1,000 free a month |
| `gpt-5-search-api` | OpenAI | **Backup only** for On This Day; Ask (dating world events) | Only when Tavily is unavailable, and some Ask questions |
| `gpt-transcribe` | OpenAI | Voice notes | Minutes of recording |
| `gpt-4o-mini-tts` | OpenAI | Ask's spoken answers | Characters read aloud |
| `gpt-realtime-2.1` + `gpt-live-transcribe` | OpenAI | Live voice | Minutes of conversation — the most expensive per minute (~$0.10/min) |

**Fallback rule:** text and vision calls try DeepSeek first. Only if DeepSeek
returns an error (outage, no credit, rate limit) does the same request go to
OpenAI `gpt-4o-mini`. OpenAI usage of `gpt-4o-mini` therefore means DeepSeek
was failing at that time.

---

## Feature by feature

### 1. Logging a memory (typed, spoken, photo caption, attachment) — "intake"
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **Server path:** `/chat/deepseek`
- **When:** once per log, right after saving. One call does everything: the
  polished memory, tasks, people, places, moments, birthdays.
- **Also:** a background sweep retries any log that didn't finish (up to 6 per
  screen open), and re-polishes old voice notes still showing their
  transcript (up to 4 at a time, once each).
- **Code:** `src/memoryIntake.ts`

### 2. Voice notes — speech to text
- **Model:** `gpt-transcribe` (OpenAI only)
- **Server path:** `/audio/transcriptions`
- **When:** once per recording; retried up to 4 times if it genuinely fails.
  Then the text goes through intake (1).
- **Cost:** by audio minute.
- **Code:** `src/transcription.ts`

### 3. Attachments (screenshots, PDFs)
- **On the phone, free:** the text is read on the iPhone (Apple Vision /
  PDFKit). No image is sent anywhere.
- **Then:** only the words go through intake (1), which turns appointments
  and bills into tasks.
- **Code:** `src/attachments.ts`, `modules/text-reader`

### 4. Photo stories ("what the photos seem to show")
- **Model:** `deepseek-v4-flash-vision-exp` (backup `gpt-4o-mini`)
- **Server path:** `/chat/deepseek`
- **When:** in the background after the app opens and after a photo sync —
  only if the user allowed it in **Profile → Reading your photos** ("All past
  days", or only days they tap). Off = no photos are ever sent.
- **Size:** one call per day, up to 20 photos resized to 512 px wide, low
  detail. Each day is read once and remembered; it is only read again if
  that day's photos or notes change.
- **Translate a story to Arabic:** `deepseek-v4-flash`, only when the user
  taps translate.
- **Photos never sent:** anything the on-device privacy check flags.
- **Code:** `src/assumedMemory.ts`, `src/photoAnalysisQueue.ts`

### 5. Recap (Weekly / Monthly / Yearly)
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **Server path:** `/chat/deepseek`
- **When:** opening a recap writes one short line per day (week), per week
  (month) or per month (year) — up to 7, 5 or 12 calls. Each line is saved
  and **not written again** unless that day's content changes (or Positive
  Focus is switched). Only text is sent, never photos.
- **Code:** `src/recap.ts`

### 6. On This Day
- **Search:** Tavily, through the Recall server (`/search/news`, key
  `TAVILY_API_KEY`). One search per thing the user follows in a topic (up to
  2 per topic), or one per topic they follow nothing in — about **3–6 credits
  per day** shown. A topic card opened for more events: up to 4 more.
- **Writing:** `deepseek-v4-flash`, thinking off — one call per day writes all
  that day's cards **from the articles only** (it never recalls news itself).
  Its source link must be one of the search results.
- **When:** once per day shown on screen, saved once found. Collapsed months
  cost nothing until opened.
- **Backup:** if Tavily is unavailable (no key, outage, out of credits), the
  old OpenAI `gpt-5-search-api` path runs instead, so cards never go empty
  because of it.
- **News photos:** downloaded straight from the news site and checked on the
  phone — no AI call.
- **Measured (4 Oct 2026):** 4 credits + one DeepSeek call (~4,000 in / ~290
  out) per day. Every card's source was a real article from the results.
- **Code:** `src/onThisDay.ts`, server `/search/news`

### 7. What you follow (On This Day)
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **Server path:** `/chat/deepseek`
- **When:** a quiet pass reads new memories for teams, artists, shows the user
  follows — at most every 6 hours, up to 3 calls of 40 memories each. Each
  memory is read once.
- **Code:** `src/follows.ts`

### 8. Safety check on typed topics
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **When:** once per topic the user types ("Other" in setup, or a follow they
  add) — after a free word list, which catches the obvious ones without a call.
- **Code:** `src/contentSafety.ts`

### 9. Ask (chat)
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **Server path:** `/chat/deepseek`
- **When:** per question —
  1. a small call that works out which days the question is about;
  2. the answer, with those days' memories attached (retried once in a
     shorter form if too long).
- **Sometimes:** `gpt-5-search-api` when the question names a world event
  the app can't date on its own ("the last Clasico") — free for events in
  its built-in table (Ramadan, Eid, national days).
- **Code:** `src/askAI.ts`, `src/worldEvents.ts`

### 10. Spoken answers in Ask
- **Model:** `gpt-4o-mini-tts`, voice from the server
- **Server path:** `/audio/speech`
- **When:** only when the user taps to hear an answer. If it fails, the
  iPhone's own voice reads it for free.
- **Code:** `src/speech.ts`

### 11. Live voice
- **Model:** `gpt-realtime-2.1`, voice `marin`; the user's speech is
  transcribed by `gpt-live-transcribe`
- **Server path:** `/realtime/token` — the server only issues a one-minute key;
  the audio then goes straight from the phone to OpenAI.
- **When:** only while a live conversation is open. **Capped at 10 minutes**
  per conversation, with a spoken warning.
- **Cost:** the most expensive feature per minute.
- **Code:** `src/realtimeVoice.ts`, `app/live.tsx`

### 12. Adding a task by hand
- **Model:** `deepseek-v4-flash` (backup `gpt-4o-mini`)
- **When:** once, when a task is typed on the add-task screen, to read the
  date and time out of it.
- **Code:** `src/tasks.ts` (`extractTasks`), `app/log/task.tsx`

---

## No AI provider (free, or not an AI service)

| Feature | What it uses |
|---|---|
| Face recognition (People) | On the iPhone — BlazeFace + FaceNet models. No photo leaves the phone. |
| Private / nude photo check | On the iPhone — Marqo model + Apple's detector |
| Places | Photo GPS on the iPhone; the street/landmark name comes from **Apple's** geocoding (free) |
| Reading screenshots and PDFs | On the iPhone — Apple Vision, PDFKit |
| Recap, task and day reminders | Notifications scheduled on the iPhone |
| Yesterday's Summary, Timeline, Tasks list | The user's own saved data — no call |
| Sign in with Apple | Apple, then the Recall server (`/auth/apple`, `/auth/refresh`) — no AI cost |
| Crash reports | Sentry (free tier) |
| Recall server itself | Cloudflare Workers (free tier covers this volume) |

---

## Switched off in the code (no usage)

- **Cloud face search** (`src/faceMatching.ts`) — sent photos to the vision
  model to find a person. Replaced by on-device face recognition;
  `FACE_MATCHING_ENABLED = false`.
- **Turn-based voice** (`src/voiceSession.ts`) — superseded by live voice;
  not called anywhere.

---

## The server's model allowlist

The server refuses any model not on this list (`server/src/index.ts`,
`ALLOWED_MODELS`), whoever asks:
`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `gpt-4o-mini`,
`gpt-5-search-api`, `gpt-transcribe`, `gpt-4o-mini-tts`. Live voice's
`gpt-realtime-2.1` is fixed by the server itself.

---

## Cost estimates (prices checked 3 October 2026)

Measured on real requests through the Recall server, priced with the
providers' published rates. Estimates — the dashboards are the truth.

**Prices used**
- DeepSeek `deepseek-v4-flash` (billed as `deepseek-flash`), per 1M tokens:
  input cache hit $0.006 · input cache miss $0.30 · output $1.20 — **half
  that off-peak** (peak is 01–04 and 06–10 UTC on weekdays, i.e. 9 pm–midnight
  and 2–6 am New York time).
- OpenAI `gpt-4o-mini`: input $0.15 · output $0.60 per 1M.
- OpenAI `gpt-5-search-api`: input $1.25 · output $10.00 per 1M, plus $10 per
  1,000 web searches.
- Tavily search: 1,000 free credits a month, then $0.008 per credit; a basic
  search is 1 credit.

**Logging a memory (one intake call), measured:** ~2,100 tokens in (about
1,800 of them DeepSeek's cheap cache hits — the instructions are the same
every time), ~370 out.
- DeepSeek: ~$0.0005 peak, ~$0.0003 off-peak
- gpt-4o-mini (for comparison): ~$0.0003
- → 1,000 logs ≈ $0.30–0.55. **DeepSeek is not cheaper than gpt-4o-mini for
  text** — about the same, both tiny.

**On This Day (one day of news), measured:** OpenAI's search read 31,673
tokens of web pages for one day — that is what makes it expensive and what
trips the 6,000-tokens-a-minute limit.
- Today, OpenAI search: ≈ **$0.055 per day loaded** (+ more when a topic is
  opened)
- Tavily + DeepSeek: 3 searches + DeepSeek writing ≈ **$0.026** pay-as-you-go,
  ≈ **$0.002** while inside Tavily's free 1,000 credits a month

**Per active user, per month (rough):** 300 logs and 30 days opened in On This
Day.
| | Logging | On This Day | Total |
|---|---|---|---|
| Now (DeepSeek + OpenAI search) | ~$0.15 | ~$1.65 | **~$1.80** |
| With Tavily + DeepSeek | ~$0.15 | ~$0.80 (free tier first) | **~$0.95** |

On This Day is ~90% of the AI bill today. Live voice is billed by the
minute and is the most expensive per use (~$0.10 a minute) — not included
above because it depends entirely on how much people talk to it.

## Which text model — tested 3 October 2026

Recall's real logging prompt, on two entries: an easy English log, and a
real Arabic voice note with misheard words ("إيميل من غير إس" = an email
from the IRS). The voice note is the test that matters.

| Model | Price in / out per 1M | Arabic voice note | Cost per hard note |
|---|---|---|---|
| **DeepSeek v4-flash, thinking off** ✅ | $0.30 / $1.20 (half off-peak) | Right: IRS, refund, user's own language mix, no invented tasks | **~$0.0003**, 1.3 s |
| DeepSeek v4-flash, thinking on (old) | same | Right | ~$0.0028, 11 s |
| gpt-4o-mini | $0.15 / $0.60 | Got IRS, kept "المشرفين", invented a task | ~$0.0004 |
| gpt-6-luna | $0.10 / $0.50 | Understood it, but rewrote it in formal Arabic ("رنين مغناطيسي") — not the user's voice | ~$0.0008, 9.5 s |
| gpt-4.1-nano | $0.10 / $0.40 | Wrong: kept "غير إس", invented a date and a task | ~$0.0003 |
| gpt-5-nano | $0.05 / $0.40 | Wrong: filed "المشرفين" and "غير إس" as people, "MRI" as a place | ~$0.0003 |

All six handled the easy English log. **Choice: DeepSeek v4-flash with
thinking off** for the app's fixed jobs (logging, Recap, follows, safety
check, translation, typed tasks) — the only one right on the hard note,
and as cheap as the cheapest. Ask keeps thinking on.
