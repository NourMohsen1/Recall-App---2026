# Where Recall is — handoff

*Last updated 24 September 2026. This file is for picking the thread back up in
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

## The two most important things to know

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

**And the second thing: nothing about face recognition here should be changed
on the strength of reasoning alone.** Three confident, textbook-correct
assumptions were overturned in one evening by measuring them — including one
that had already been written into this file as settled. The harness that does
the measuring is `app/face-test.tsx`. Use it before changing anything below.

---

## What replaced it — done, measured, and switched on

*(24 September 2026. This section was "interface only, nothing registered"
until a Mac build existed; all of it now runs on a phone.)*

| Piece | File | State |
|---|---|---|
| Fingerprint storage + search | `src/faceIndex.ts` | Done |
| Reading the library once | `src/faceIndexing.ts` | Done |
| Photos to numbers | `src/facePixels.ts` | Done |
| Finding faces | `src/faceDetector.ts` | Done |
| Fingerprinting them | `src/faceEmbedderTflite.ts` | Done |
| One model call at a time | `src/modelQueue.ts` | Done |
| Status UI | `src/components/FaceIndexCard.tsx` | Done |
| Throwaway measuring harness | `app/face-test.tsx` | **Delete before TestFlight** |

It is registered at startup in `app/_layout.tsx` and indexes in the
background. No network, no per-photo cost, works on a plane.

### What the measurements settled, and what they overturned

117 pairs from Nour's own library: 9 photos of him against 9 of other
bearded men of similar age — including a face a few dozen pixels tall, red
stage lighting, sunglasses, photos years apart. Every combination of model,
crop, channel order and normalisation scored against all of them.

**The ranking metric matters as much as the result.** Rows were ranked by
the *worst* same-person score minus the *best* stranger score, not by
averages. MobileFaceNet looks fine on averages (0.449 same, 0.207
different) and is unusable: its worst same-person pair scored 0.104 while
some stranger scored 0.527. A setup that is right on average and wrong one
time in ten puts a stranger into a friend's profile.

What won, and is what the app uses:

    FaceNet-512 · no alignment · 0.4 padded crop · rgb · 0..1

    worst same-person pair ....  0.574
    best stranger pair ........  0.365
    margin ....................  +0.209
    averages ..................  0.709 same, 0.141 different

**Three things were the opposite of what was expected.** All three would
have shipped as settled if they had not been measured:

1. **MobileFaceNet cannot do this job.** Not a preparation problem — every
   one of its 24 preparations had a negative margin.
2. **Alignment hurts.** Rotating each face so the eyes are level is the
   textbook step and scored negative on every model. FaceNet is trained on
   loose, un-rotated crops. `alignedCrop` stays in `facePixels.ts` for a
   future model; **nothing uses it, and re-enabling it is not a fix.**
3. **The documented preprocessing lost.** FaceNet is documented to want each
   crop normalised by its own brightness; plain 0..1 beat it.

`MATCH_THRESHOLD` is **0.47** (`src/faceIndex.ts`), and two earlier values
were wrong for instructive reasons. 0.62 came from published figures and was
never measured — it sat *above* the same-person score, so the app would have
refused to recognise Nour in his own photos, a feature that silently never
works. 0.40 came from a single pair; a second pair reversed which settings
looked best. **One pair is one data point.** The harness in
`app/face-test.tsx` is how to redo this properly against a bigger sample.

### Distance, which is what nearly sank it

Nour noticed a photo of himself a few metres away returned no faces at all.
`blaze_face_short_range` is built for selfies and cannot see a small face —
Google's own docs say so, and it was the wrong choice for a photo library
where most pictures are not selfies. Two fixes:

- `DEFAULT_DETECTOR = 'full'` — BlazeFace full-range, good to ~5 metres.
- A **tiled fallback**: a photo that comes back empty is searched again in
  nine overlapping tiles. One look 102ms, ten looks 227ms — decoding the
  photo dominates and happens once — so only apparently-empty photos pay.
  On a museum photo where every single-look detector found nothing, tiling
  found two faces.

Group photos always worked: each face gets its own fingerprint and row.
Detection was the only limit.

### Traps, paid for once already

- **Two model calls must never overlap.** A TFLite interpreter has one set
  of buffers and hands back a view of its own output, so concurrent `run()`
  calls silently return each other's answers — no error, just fingerprints
  of the wrong face. Everything goes through `src/modelQueue.ts`. The
  symptom was a stranger and Nour scoring *identically*.
- **Changing a model invalidates the index.** Photos already read are marked
  read, so a swap looks exactly like the new model not working.
  `useModels()` in `faceIndex.ts` stores a signature of detector, embedder
  and search effort, and wipes the index when it changes. It is automatic;
  do not remove it.
- Face cropping (`src/faceCrop.ts`) no longer uploads a photo to DeepSeek to
  locate a face — it uses the on-device detector. Kept from the old version
  because it is a fact about vision models rather than about faces: asked to
  point at a face, DeepSeek landed within 0.02–0.09 every time, while
  gpt-4o-mini answered with the centre of the frame in every case.

### Before TestFlight

`app/face-test.tsx`, the Developer row in `app/(tabs)/profile.tsx`, and
three of the five `.tflite` files exist only for measuring. Bundled assets
are 40MB today; deleting them saves ~6MB. Keep them until the threshold has
been checked against a bigger sample — recalibrating is the one thing that
harness is for.

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
- **Expo Go can no longer run Recall.** A development build is required.
- **Building locally on the Mac works, and these are the exact steps.** Four
  separate things had to be fixed before the first build; each failed the
  build in under a minute, but only one at a time:
  1. `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`
     — the Mac was pointed at the bare Command Line Tools.
  2. Apple ID signed into Xcode → Settings → Accounts. Team `JF22LNW5JZ`,
     Individual, paid (so builds last a year, not seven days).
  3. **Developer Mode on the iPhone** — Settings → Privacy & Security →
     Developer Mode → restart. It only appears once a Mac has tried to build
     to the phone.
  4. The build command. `npx expo run:ios` fails with "No code signing
     certificates are available"; this works and creates the certificate and
     profile on first use:

         xcodebuild -workspace ios/Recall.xcworkspace -scheme Recall \
           -configuration Debug -destination "id=<UDID>" \
           -derivedDataPath ios/build \
           -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
           DEVELOPMENT_TEAM=JF22LNW5JZ CODE_SIGN_STYLE=Automatic build

     **`-allowProvisioningDeviceRegistration` is the one people forget** —
     without it, `-allowProvisioningUpdates` alone still fails with "Device
     isn't registered in your developer account".
  Then `xcrun devicectl device install app --device <UDID> \
  ios/build/Build/Products/Debug-iphoneos/Recall.app`, and
  `npx expo start --dev-client`. The phone is an iPhone 14 Pro Max, UDID
  `00008120-001478481188C01E`.
- A debug build contains no JavaScript and no models — both come from Metro
  over Wi-Fi. So model files and face code can be changed without rebuilding;
  only native changes need the 30-minute compile.
- Day-to-day development stays on Windows: `npx expo start --dev-client`.

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

- **Recall does not launch on iOS 27.** Apps built against the current SDK
  must adopt the UIKit scene life cycle; this one does not, so iOS 27 kills
  it at launch (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
  Nour's phone is on 26.6.2, where it is tolerated, which is why it has
  never been seen in use. **Any tester on iOS 27 would be unable to open the
  app at all.** Fix: `expo` 57.0.23+ (project has 57.0.19), then
  `["expo-build-properties", { "ios": { "enableSceneSupport": true } }]` and
  a prebuild. Check expo/expo#47570 first — on SDK 57 that reportedly trades
  the crash for a blank screen, and the fix properly landed in SDK 58.
  Deferred deliberately on 24 September; **must be fixed before TestFlight**,
  and it is why the iOS Simulator cannot be used to preview work.
- ~~**API keys ship inside the app.**~~ **Solved 24 September.** The keys now
  live on a Cloudflare Worker (`server/`), and the app carries only a token
  that reaches four endpoints with six named models. Proved by searching the
  built bundle: no provider key appears in it. What remains is **hard spend
  caps in the provider dashboards** — this server limits which models can be
  used, not how much, and the caps are the real ceiling if the app's token
  leaks. See `server/README.md`.
- `.env` is gitignored and has never been committed. A second machine needs it
  recreated by hand.
- **The agreed order to testers** (Nour's, 23 September): dev build on his phone
  → prove face recognition on his own photos → fix the keys with a small server
  → TestFlight, internal testers only. The first two are done. **Do not jump
  ahead to TestFlight with the keys still in the bundle.**
- **Where photos go, decided deliberately.** Face recognition and face cropping
  are entirely on-device. Day analysis (`src/assumedMemory.ts`) still sends
  photos to DeepSeek and **stays that way for now** — Nour's words: "until we
  find a smart private and safe way later." Do not quietly change it, and
  declare it truthfully on Apple's privacy questionnaire.
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
