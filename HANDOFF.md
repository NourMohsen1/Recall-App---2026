# Where Recall is — handoff

*Last updated 23 September 2026. This file is for picking the thread back up in
a new session, on any machine. It is not documentation of the app; it is the
part that is hard to reconstruct — the decisions, the reasons, and the loose
ends. If it contradicts the code, the code is right and this file is stale.*

---

## The app, in a paragraph

Recall is a personal memory app. You log a day by typing, speaking or letting it
read your photos, and it files what it finds into a Timeline, Tasks, People and
Places. The AI's job is to **notice and flag, never to silently invent** — a
guess is always drawn differently from something the user recorded, and nothing
a guess produced becomes real data until the user says yes. That principle is
the spine of the whole thing and most of the harder decisions below fall out of
it.

Built with Expo (SDK 57 / RN 0.86) and expo-router. Nour is a designer, not an
engineer, learning mobile development as he goes — explanations should be plain,
terminal steps should be copy-pasteable, and anything native-only is worth
flagging up front rather than discovering later.

---

## The single most important thing to know

**Face recognition was rebuilt from scratch, because the first version was built
on the wrong technology and no amount of tuning could fix it.**

The first attempt asked a vision *language model* to compare a reference face
against library photos. It failed, repeatedly, and the failure that settled it:
after being told in the prompt, in as many words, that glasses are shared by
millions of people and prove nothing, it returned **two different strangers** for
the same person and gave *"round glasses, similar"* as its reason for both.

That is not a prompt problem. A language model looks at a picture and writes a
plausible sentence about it; it never *measures* a face. Real recognition turns
a face into a numeric fingerprint and measures the distance between two of them.
Different operation entirely.

It was also the wrong shape for cost: to let a model look at a face you upload
the whole photo, so one search moved tens of megabytes and got **slower and
dearer the more photos the user had**.

So `FACE_MATCHING_ENABLED = false` in `src/faceMatching.ts:51`. The code stays
because the plumbing around it is sound and reused — the suggestion store kept
apart from what the user tagged, the confirm/reject flow, the day screen's
questions. Only the thing doing the comparing is being replaced.

**If you find yourself about to improve the LLM face matching: don't. That road
was walked to the end.**

---

## What replaced it, and how much is done

| Piece | File | State |
|---|---|---|
| Fingerprint storage + search | `src/faceIndex.ts` | **Done**, tested |
| Reading the library once | `src/faceIndexing.ts` | **Done**, tested |
| The model itself | `src/faceEmbedder.ts` | **Interface only** — nothing registered |
| Status UI | `src/components/FaceIndexCard.tsx` | **Done** (Profile → Faces) |

A face becomes 192 numbers. Each photo is read **once, ever**, leaving a row in
SQLite; every search afterwards is a sweep over those rows — no network, no
per-photo cost, and no slower at ten thousand photos than at ten.

The model is deliberately **not imported anywhere**. It registers itself at
startup via `registerFaceEmbedder()`, and until it does `faceEmbedderAvailable()`
is false and nothing indexes. That is what lets the app still run without it, and
lets a test drive the whole pipeline with a stand-in.

Verified end to end that way: 97 photos read once and only once, screenshots
skipped, photos with nobody in them recorded as read rather than retried forever,
re-running free, new photos picked up. Same person across different photos scored
0.75–0.79; a lookalike deliberately built to sit at 0.56 was correctly refused by
the 0.62 threshold; a stranger returned nothing. A search took 0.3ms.

`MATCH_THRESHOLD = 0.62` in `src/faceIndex.ts:227` is **a starting point, not a
decision** — the number that counts is the one measured against real photos on a
real device.

### What is left, exactly

1. No `.tflite` model files exist in the repo yet.
2. Nothing calls `registerFaceEmbedder()`.
3. Nothing calls `startBackgroundIndexing()`.

The intended stack: **BlazeFace** (find faces) + **MobileFaceNet** (fingerprint),
both run through `react-native-fast-tflite`, with `@shopify/react-native-skia`
decoding photos into pixels to feed them. All installed, none wired.

**Before wiring any of it: build a throwaway two-photo similarity screen.** Pick
two photos, print the score. Nothing else gets built until a known person scores
high against themselves and low against a stranger. This was agreed explicitly
after the first version's failure, and it matters — the alternative is
discovering it doesn't work after another fortnight of building on top.

---

## Talking to Recall (live voice)

A voice conversation was added, aimed at **`gpt-realtime-2.1`** (real, GA since
July 2026, ~$0.10/minute of conversation).

Same split as the faces: the brain is done and works, the audio transport needs
the native build.

- `src/realtimeTools.ts` — the six things it can look up, plus the instructions
- `src/voiceSession.ts` — the tool-calling loop, transport-agnostic
- `app/live.tsx` — the screen (button beside the mic in Ask)

**Why tools and not one big prompt:** the typed Ask builds a large context up
front, which works because the question is already known. A conversation wanders,
and what matters at minute four wasn't guessable at minute zero. So it starts
knowing almost nothing — today's date, who it's talking to, and the names it's
likely to hear — and fetches precisely, mid-sentence.

Having to go and look is also what keeps it honest, and honesty matters more here
than anywhere else in the app: **written down a hedge is visible; spoken aloud a
guess and a fact sound identical**, and being told something happened is
uncomfortably close to remembering that it did.

Verified against the live API, both providers, 10/10. The one that matters:

> **"Have I ever been skydiving?"** → searched "skydiving", then searched
> "parachute", then: *"Nothing at all. So as far as your memories go: no."*

Settled decisions: open mic (not push-to-talk), **read-only** (it cannot write
anything — verified by running every tool and confirming storage is byte-identical
after), follows the user's language automatically including Arabic/English
mid-sentence, lives as a button inside Ask.

Today it works in **turns** — tap, speak, tap. The live version streams both ways
and allows interrupting. That is the *only* difference; the instructions, tools
and answers are shared.

---

## Where the build is up to

Nour is on **Windows**, with a **Mac** available, and has a paid Apple Developer
account.

- `main` is current (previously everything lived on `upgrade/expo-sdk-57`).
- `backup/july-2026` and tag `v0.1-july-2026` hold the last pre-upgrade state.
- **Expo Go can no longer run Recall.** Native modules are installed; a
  development build is required from here on.
- The plan is to build **locally on the Mac** (`npx expo run:ios --device`) rather
  than EAS cloud, because the free EAS tier is 15 iOS builds a month behind a
  low-priority queue that reaches 90+ minutes at peak. `eas.json` still exists and
  works if ever needed.
- Day-to-day development stays on Windows: once the build is on the phone,
  `npx expo start --dev-client` from either machine. The Mac is only needed when
  native code changes.

Installed and resolved cleanly against RN 0.86: `react-native-fast-tflite` 3.0.1,
`react-native-nitro-modules` 0.37.1, `@shopify/react-native-skia` 2.6.2,
`react-native-webrtc` 124.0.8 + `@config-plugins/react-native-webrtc` 15.0.2,
`expo-dev-client` 57.0.19, `expo-sqlite` 57.0.3.

Three things already fixed that would each have cost a separate 40-minute build
to discover: the microphone had no iOS usage description (fatal in a standalone
build, harmless in Expo Go); Metro didn't know `.tflite` was an asset, so the
model would have been silently dropped; CoreML wasn't enabled, which is the
difference between reading a library in minutes and in hours.

---

## Loose ends and landmines

- **API keys ship inside the app.** Anything `EXPO_PUBLIC_*` is written into the
  JavaScript bundle. Fine on Nour's own phone, **not fine the moment a tester
  installs it** — they can be extracted. This must be solved (a small server, or
  at minimum hard spend caps) **before TestFlight**, not after.
- `.env` is gitignored and has never been committed. A second machine needs it
  recreated by hand.
- `src/faceRegions.ts` is dead — nothing imports it. Apple's Photos "People" album
  is not reachable by any app, which is why the app brings its own model.
- Contacts matching is off behind a flag; it matched on name and was wrong often.
- `expo-doctor` reports ~17 packages slightly behind their SDK 57 versions.
  Pre-existing, worth tidying before a build.
- Provider split lives in one place, `src/aiProviders.ts`: text and vision to
  DeepSeek, audio and web search to OpenAI (DeepSeek serves neither). Search uses
  `gpt-5-search-api` — the older `*-search-preview` models are dead.

---

## How Nour likes to work

- **Verify, don't assert.** Claims should be backed by something that was actually
  run. Several real bugs in this project were caught only because a test was
  written rather than a summary — a self-cancelling loop that made zero API calls,
  a lost-update race, a "3 days from now" rendered as "-3 days ago".
- Say plainly when something **couldn't** be verified, and why.
- Keep explanations simple and jargon-light; expand only when asked.
- Terminal steps: one command per block, ready to run.
- He will push back when something is wrong, and he is usually right. The
  glasses/face-matching failure was diagnosed almost entirely from his
  observation that the same two photos kept coming back for different people.
