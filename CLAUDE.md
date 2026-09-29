@AGENTS.md

# Recall — notes for Claude

Recall is a personal memory app (Expo SDK 57, React Native 0.86, expo-router).
The user logs a day by typing, speaking, or letting it read their photos; the
app files it into Timeline, Tasks, People and Places, and answers questions
about it in Ask and in live voice.

**The rule everything else follows: a guess is never presented as a fact.**
Anything the app inferred — a face it recognised, a person it matched — is
stored apart from what the user recorded, drawn differently (dashed ring,
"Name?"), and spoken as "it looks like you saw Omar", never "you saw Omar".
It becomes real data only when the user says yes.

`HANDOFF.md` holds the history and the reasons behind big decisions. This file
holds the rules.

## Working with Nour

- Nour is a designer, not an engineer. Act as the senior developer: drive the
  work, recommend one approach rather than listing options, and explain in
  plain English without jargon.
- He often writes in Arabic. **Always reply in English** — proper English,
  never Franco.
- **End every reply with a short recap**: what happened, what's next, and
  anything needed from him.
- **Verify, don't assert.** Run it and show the output. If something couldn't
  be verified, say so and why. Add logging *before* asking him to test —
  several bugs here stayed invisible until a log line named them.
- Terminal steps: one command per fenced block.
- Keep the product simple for the user. He rejects features that hand the user
  work (review screens, naming sessions, buttons that maintain the app). If
  the app can do it quietly, it should.
- He pushes back when something is wrong, and he is usually right.

## Running it

Day to day, with a development build already on the phone:

```bash
npx expo start --dev-client
```

JS and model-file changes load over Wi-Fi from Metro. Only native changes
(new native module, `app.json` plugin change) need a rebuild, which takes
30–40 minutes the first time and happens on the Mac only.

- Team `JF22LNW5JZ` (paid, individual). Nour's iPhone 14 Pro Max:
  UDID `00008120-001478481188C01E`.
- `npx expo run:ios` failed here before a signing certificate existed. This is
  the command known to work; it creates the certificate and profile if they
  are missing. `-allowProvisioningDeviceRegistration` is the flag people forget:

```bash
xcodebuild -workspace ios/Recall.xcworkspace -scheme Recall -configuration Debug -destination "id=00008120-001478481188C01E" -derivedDataPath ios/build -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=JF22LNW5JZ CODE_SIGN_STYLE=Automatic build
```

```bash
xcrun devicectl device install app --device 00008120-001478481188C01E ios/build/Build/Products/Debug-iphoneos/Recall.app
```

- **`pod install` needs UTF-8**, or it fails with a misleading "no Podfile"
  error. Run `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install`. Prebuild's own
  pod step fails the same way.
- `ios/` is generated and gitignored. Native config lives in `app.json`
  plugins; regenerate with `npx expo prebuild --platform ios --clean`.
- The iOS 27 simulator is how to check layout without the phone: build with
  `-destination "generic/platform=iOS Simulator" -derivedDataPath ios/build-sim CODE_SIGNING_ALLOWED=NO`,
  then `xcrun simctl install booted …` and `xcrun simctl io booted screenshot`.
  It has no photo library, so it can't judge recognition quality.

## How it fits together

**No provider key ever ships in the app.** Every AI call goes through the
Cloudflare Worker in `server/` (`https://recall-keys.nourmohsen-recall.workers.dev`),
which holds the OpenAI and DeepSeek keys as secrets. The app carries only
`EXPO_PUBLIC_RECALL_API_URL` and `EXPO_PUBLIC_RECALL_APP_TOKEN` (see
`src/backend.ts`). Deploy with `cd server && npx wrangler deploy`.

| Job | Where | Model |
|---|---|---|
| Text, vision | `src/aiProviders.ts` | `deepseek-v4-flash` (+ `-vision-exp`), `gpt-4o-mini` fallback |
| Web search | `src/onThisDay.ts`, `src/worldEvents.ts` | `gpt-5-search-api` |
| Voice memo transcription | `src/transcription.ts` | `gpt-transcribe` |
| Speech out | `src/speech.ts` | `gpt-4o-mini-tts` |
| Live voice | `src/realtimeVoice.ts`, server `/realtime/token` | `gpt-realtime-2.1`, voice `marin`, input `gpt-live-transcribe`, 10-minute cap |

**A new or changed model must be added to `ALLOWED_MODELS` in
`server/src/index.ts` and redeployed**, or the server refuses it with a 400.
The allowlist only inspects JSON bodies — multipart uploads (transcription)
are not checked.

**Memory intake** (`src/memoryIntake.ts`): one AI call per log splits it into a
polished memory, tasks (dates resolved; undated ones get `needsDueDate` and
the Tasks page asks), people and places. The original words are kept as
`rawText`; the Source page shows those and the recording. `useMemoryPolish`
is a background sweep that retries transcription and intake for anything
unfinished.

**Face recognition** is on-device and deliberately small (`src/facePeople.ts`):
a person's profile photo becomes their fingerprint, every indexed photo is
compared against it, and matches become guesses on those days
(`src/guessedPeople.ts`). Pipeline: BlazeFace full-range → FaceNet-512 with a
0.4-padded crop, rgb, 0..1, no alignment (`src/faceEmbedderTflite.ts`);
stored in SQLite (`src/faceIndex.ts`); indexed in the background
(`src/faceIndexing.ts`). Only photos imported into Recall are indexed, not the
whole camera roll.

**Places** (`src/places.ts`) are private by design — Nour chose this over
Google Places. Every photo keeps its own GPS on the device; photos within
70 m are one place; the cover is the user's best photo from there (no faces
first). Names come only from the user: a log naming one place with photos
names that spot, and an unnamed spot's profile *asks* with places mentioned
on the same days. Unnamed spots show Apple's landmark/street label — the only
thing that leaves the phone. A background sweep (`startPlaceIndexing`) reads
locations of older photos and files everything.

**Attachments** (`src/attachments.ts`, `app/log/attachment.tsx`): a screenshot
or PDF saved as a `document` memory. The local native module
`modules/text-reader` reads its text on the phone (Vision + PDFKit); only the
words go to the intake, which turns upcoming appointments/tickets/bills into
tasks with `notes` details, the attachment, early reminders (evening before,
2 h before) and an icon on that day. Documents are never photo memories, so
photo analysis and face indexing never see them. Changing the Swift module
needs a native rebuild.

**Photo analysis** (`src/assumedMemory.ts`) sends a day's photos to DeepSeek to
describe them. That is deliberate and Nour's call — don't change it quietly,
and it must be declared on Apple's privacy questionnaire.
**Nour plans to move photo analysis on-device** so no photo leaves the phone.
He is researching it and will approve the approach himself — don't start it.
His iPhone 14 Pro Max can't run Apple Intelligence; measure before choosing. Face recognition and
face cropping never leave the device.

## Rules learned the hard way

Each of these cost real time once.

- **Read every stored file path through `localFile()`** (`src/memoryLog.ts`).
  `persistFile` stores absolute paths, and iOS changes the app container's UUID
  on every reinstall and App Store update — so recordings, photos and avatars
  look "missing" after an update while the files are still on disk.
- **Never show or store a library photo by its file path.** A
  `…/Media/DCIM/…` path from the Photos library is readable only in the app
  session that received it; after a restart every imported photo went blank
  until an import re-asked the library. Show library photos through
  `PhotoImage` (it uses `ph://<assetId>` via expo-image) and get pixels with
  `resolvePhotoUri()`, which asks for a fresh path each session. The
  simulator does not enforce this, so it can't catch it.
- **Don't upload files with `FormData` `{ uri, name, type }`.** React Native
  0.86 rejects it with `Unsupported FormDataPart implementation`. Use
  `FileSystem.uploadAsync` from `expo-file-system/legacy`. This broke all voice
  transcription, silently, from the SDK 57 upgrade until it was logged.
- **Never swallow an error on a path that marks something permanently done.**
  A silent `catch` in indexing filed 2,389 photos as "nobody here" forever; a
  silent one in transcription made a broken upload look slow. Log loudly.
- **Every TFLite `run()` goes through `serialized()`** (`src/modelQueue.ts`).
  Interpreters share one output buffer; overlapping calls silently return each
  other's answers.
- **Changing the face detector, embedder or search effort must change the
  signature** in `installFaceEmbedder`; `useModels()` wipes the face index when
  it changes. Otherwise photos already marked read are never re-read and the
  new model looks broken.
- **Face thresholds are measured, not reasoned.** A threshold taken from a small
  sample is too loose at library scale — 0.47 from 117 pairs filed 90% of 2,389
  photos as one person. Current values: `PERSON_MATCH_THRESHOLD` 0.58,
  `MATCH_THRESHOLD` 0.47. The quality gate (faces ≥ 90 px, confidence ≥ 0.75)
  matters more than any threshold: small faces make fingerprints that match
  everything.
- **Face alignment hurts FaceNet here** — it measured negative on every model.
  `alignedCrop` stays in `src/facePixels.ts`; nothing should use it.
- **Don't rebuild face clustering, a "Who is this?" screen, or naming flows.**
  They were built and deleted. Nour wants this done quietly from profile photos.
- **A person's day count is confirmed days only.** Guesses show separately and
  never inflate it.
- **Timers see stale state.** A `setTimeout` reading component state sees the
  render it was created in; use a ref. This once made the Source page call
  every recording missing after five seconds.
- **Keep iOS scene support on** (`expo-build-properties` → `ios.enableSceneSupport`
  in `app.json`). Without it the app won't launch on iOS 27. It becomes a no-op
  on SDK 58.
- **Word-level timestamps exist only in `whisper-1`.** The app uses
  `gpt-transcribe` for accuracy on mixed Arabic/English; `VoicePlayer` falls
  back to plain text.
- **The photo library returns coordinates as strings.** Pass every location
  through `toLocation()` (`src/places.ts`). Stored as text they look right
  and break every calculation — the first places sweep filed correctly and
  then failed to name a single place.
- **`grep` treats `src/peopleTags.ts` as binary** and silently skips it. Use
  `grep -a`.

## Before TestFlight

- Hard spend caps on the OpenAI and DeepSeek dashboards (Nour's to do). The
  server limits which models can be used, not how much.
- App Store Connect listing, then an EAS production build and submit
  (`eas.json` has the profiles).
- Privacy questionnaire: declare the DeepSeek photo analysis honestly.
- Internal testers only (people Nour knows) until there is a token per install
  rather than one shared app token.

## Commits

- Author `nour.walid347@gmail.com` (set in the repo's local git config on the Mac).
- Subject in plain imperative English. The body explains *why*: what was wrong,
  what was measured, what was chosen and what it costs.
- Keep secrets out. `.env` and `server/.dev.vars` are gitignored and must stay so.
