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

**Accounts are Sign in with Apple only** (`src/account.ts`, Nour's call,
Oct 2026): one tap and Face ID, no passwords, no email requested. Skippable
("Not now") — Apple asks that an app that works without an account doesn't
force one. The server's `/auth/apple` checks Apple's identity token and
answers with a session it signed (`SESSION_SECRET`); the session rides in
the same header as the app token (`<token>~<session>`, `backendToken()`),
so no call site changed. The server stores nothing: an account is a hash of
Apple's user id, pausable with the `BLOCKED_ACCOUNTS` variable. The session
sits in the keychain, which survives reinstalling. **No iCloud sync at
launch** (Nour, Oct 2026): memories come back with the iPhone's own iCloud
Backup; live sync between devices is for later. "Delete account" asks for
Face ID once more and sends the fresh one-time code to `/auth/apple/revoke`,
which exchanges it and revokes it at Apple (required by Apple). It needs the
secrets `APPLE_SIGNIN_KEY` (the .p8 contents) and `APPLE_KEY_ID`; without
them it answers 503 and nothing is deleted.

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

**The user's own face** (`src/myFace.ts`, Oct 2026). Setup asks for a
photo of the user right after their name (selfie or library, checked on
the spot); Home asks once if it's missing; a profile photo set earlier is
learned at launch. It is a fingerprint like a person's, stored as `__me__`
(never in People). Each photo sent for a day story carries a label worked
out on the phone — "the user IS in this photo" / "people, NONE of them the
user" / "not known" — and the prompt never calls a person in the frame
"you" otherwise ("you photographed a friend in a car", not "you were in a
car"). Labels are part of the story's signature, so learning the face
rewrites the days with faces in them, and only those. The face never
leaves the phone; only the label words do.

**How Ask finds a day** (`src/memorySearch.ts`, Oct 2026) — one search for
Ask and live voice. Every day has search tags: photo stories return
`anchors` (everything visible, landmarks named even in the background, in
English and Arabic; `PROMPT_VERSION` 4 rewrites older stories once, paced,
standing aside for Ask) and notes get tags from `src/dayTags.ts` (text
only, 10 days a call, again only when a day's words change). The planner
gives search words in English AND Arabic script, because notes are kept in
Arabic and an English word never matches Arabic text. Words are folded
(Arabic letter forms, ال/بال prefixes, plurals) and weighted by rarity and
field. The best days always reach the answer with what they matched, and
the answer never dead-ends: it offers the closest day and asks "is this
it?". `[ask] looking for / found` logs both halves. Measured on a 300-day
test phone: museum/pyramids/beach questions 0/4 → 6/6 with the right day.

**Places** (`src/places.ts`) are private by design — Nour chose this over
Google Places. Every photo keeps its own GPS on the device; photos within
70 m are one place; the cover is the user's best photo from there (no faces
first). Names come only from the user: a log naming one place with photos
names that spot, and an unnamed spot's profile *asks* with places mentioned
on the same days. Unnamed spots show Apple's landmark/street label — the only
thing that leaves the phone. A background sweep (`startPlaceIndexing`) reads
locations of older photos and files everything.

**Tasks and reminders** (`src/tasks.ts`, `src/taskNotifications.ts`,
`app/log/task-edit.tsx`, Oct 2026). A task's time is when it *happens*; the
reminder comes before it, and is automatic — there is no "Remind me" switch.
Choices are a wheel (`ChoiceWheel`), always all of them; a choice already past falls back to 15 minutes before (or the day itself). Defaults (`planTaskReminders`): a time → 1 hour before; from a saved
ticket/letter (`remindEarly`) → the evening before and 2 hours before; a
date and a part of the day → when that part starts (afternoon → 1 pm); a
date only → 9 am. A task added too late for its reminder still gets one.
"Tomorrow afternoon" is stored as `duePeriod`, shown as "Afternoon" — never
turned into a made-up "3:00 PM". The + on Tasks opens the same editor as
editing; a name like "dentist tomorrow at 2" with no date picked is read by
the AI on save. The time wheel is Apple's own
(`@react-native-community/datetimepicker`, native — changing it needs a
rebuild).

**Notifications say nothing private** (`src/recapNotifications.ts`, Oct
2026). A lock screen is seen by anyone near the phone: no names, places,
moment labels or note text — only that a recap is ready and how many
moments it holds ("Your Tuesday recap is ready · 5 moments"). Nudges
("Did you log today?", "It's been a while", "On this day last year") are
at most one a day, never two days running, never on a day already
logged; a memory from a year ago wins over an ordinary nudge. Profile →
Gentle nudges turns them off.

**Attachments** (`src/attachments.ts`, `app/log/attachment.tsx`): a screenshot
or PDF saved as a `document` memory. The local native module
`modules/text-reader` reads its text on the phone (Vision + PDFKit); only the
words go to the intake, which turns upcoming appointments/tickets/bills into
tasks with `notes` details, the attachment, early reminders (evening before,
2 h before) and an icon on that day. Documents are never photo memories, so
photo analysis and face indexing never see them. Changing the Swift module
needs a native rebuild.

**Recall's AI permission** (`src/aiConsent.ts`, `app/ai-consent.tsx`, Oct
2026). Apple requires asking before personal data goes to an AI company,
naming the company. Asked at the end of setup (before the photo question)
and once on Home for existing users; changeable in Profile. Enforced in one
place: `backendUrl()` in `src/backend.ts` returns nothing for every path but
`/auth/*` until the answer is "on" — and before it has been read, since the
root layout loads it before anything mounts. Any new AI call is covered
automatically as long as it gets its URL from `backendUrl()`. "Not now"
keeps everything as logged; unpolished notes are picked up when it's turned
on. Name the companies (OpenAI, DeepSeek), not their countries — Nour's call.

**Onboarding** (`app/onboarding/quiz.tsx`) asks only what changes the app:
name → profile, interests → On This Day (`quizAnswers[0]`), recap
frequency → recap notifications, Positive Focus. No accounts: memories live
on the phone and return with its iCloud backup.

**After midnight it's still the day before** (`src/logicalDay.ts`, Oct
2026). Nour's day runs to 1 or 2 am. Until 4 am a new log belongs to the
evening still going — placed at 23:59 of it, later notes after earlier
ones — with no question asked; the intake is told it's still that day
("tomorrow" = the date the clock shows), and the Timeline and Recap's
Today open on it. A log that names its day ("yesterday morning…") goes
there as before. Measured at a faked 1:30 am, 4/4 placed right.

**Polishing never rewrites** (`src/memoryIntake.ts`, Oct 2026). Voice notes
are always polished as transcripts (misheard words worked out from the
same day's notes); the raw words live only in Source. Nothing is reworded:
"edy" (hand) once came back as "ضهري" (back). **No Franco in polished text**
(Nour's call, Oct 2026, reversing "Franco stays Franco"): Arabic and Franco
are written in Arabic script, English words stay English ("روحت الـ gym").
Franco is converted sound by sound — "jamica" (a pitch) once became
"الجامعة", so the prompt names that mistake and says to transliterate
(جاميكا) when unsure; names keep their spelling. The code detects Franco
(`isFranco`) and marks the entry, because a rule alone was ignored 3 times
in 4. Recaps follow the same rule; Ask's chat replies still answer in the
script the question was asked in. Measured on 4 notes: jamica → جاميكا,
edy → إيدي, English words untouched. Each entry is placed at the time it
states (`happened`), and moved to another day when it says so ("yesterday
afternoon…"), never into the future.

**On This Day shows same-day facts** (`src/onThisDay.ts`, Oct 2026): the
day of the user's life beside what happened in the world THAT day ("the
doctor's day was the day Liverpool beat City"). Tavily searches only that
day and the next morning; DeepSeek must give each event's own date and it
is checked in code (`event_date === target`) — previews, reactions and
follow-ups are dropped. A story shown on one day is remembered
(`otdStories`) and never used within six days of it. 👍 follows a story's
subject, 👎 mutes it (`follows.ts`); "Your mix" (header) shows and undoes
all of it. Measured: Liverpool–City on 10 Mar 2024 kept; the 11 Mar
write-ups of the same match dropped.

**Nothing sexual comes in from the web** (`src/contentSafety.ts`). Users can
type their own On This Day topics ("Other") and "what I care about" text,
which steer a web search, so: a typed topic is checked (short word list,
then the AI) before it is accepted — and refused if the check can't run;
every search carries `SAFE_SEARCH_RULE`; every news photo is downloaded and
read by the on-device nudity model, kept only below 0.6. Each layer fails
closed. Measured on 24 typed topics in English, Arabic and Franco: 0 wrong
(Moby Dick, Ford Escort, sexual health and الجنسية all pass). Keep the word
list to words with no innocent meaning — "جنس" sits inside جنسية.

**Positive Focus** (`src/positiveFocus.ts`, Profile switch) makes the AI
recaps leave out painful moments (death, breakup, illness…). Recaps only —
Timeline and Ask keep everything. With it on, a recap never falls back to
the user's raw words, which could be the painful part.

**Private photos and deleted photos** (`src/photoGuard.ts`, `modules/photo-guard`):
every photo is checked for nudity on the phone before it enters Recall
(Marqo nsfw-image-detection-384, Apache-2.0, 11 MB; ≥ 0.9 never enters,
0.6–0.9 kept but never sent — 0.35 removed 26 ordinary photos on Nour's phone; plus
Apple's detector when the user has Sensitive Content Warning on). A flagged
photo is never stored, shown, read or sent; the day-story path checks again
before sending. On open and on return, library photos deleted from Photos
(incl. Recently Deleted) are removed with everything derived from them.
**What the user added by hand is an app-owned copy and is never removed**
— Add Photos, attached screenshots, and place covers chosen by hand
(copied with persistFile, even when picked from their own photos).

**Photo analysis** (`src/assumedMemory.ts`) sends a day's photos to DeepSeek to
describe them. That is deliberate and Nour's call — don't change it quietly,
and it must be declared on Apple's privacy questionnaire.
**Decided (Sept 2026): photo analysis becomes hybrid.** Default for everyone
is on-device — Apple Vision + a small MobileCLIP model, results kept on the
phone, day summaries written by the app itself from the facts (no on-device
LLM). An optional switch on the Profile page sends photos to an external AI
for richer summaries, with the provider chosen by the user and declared
honestly (OpenAI is the alternative). Not built
yet — the restore point is tag `v0.9-before-photo-analysis`. Measure on
Nour's iPhone before committing to a model; his 14 Pro Max can't run Apple
Intelligence, which this plan doesn't need. Face recognition and
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
- **An animation follows only the shared values its own code reads.**
  Reached through a helper function, a value's changes go unseen: the
  Timeline's dashed lines stayed where a dragged card used to be. Read
  them in the `useDerivedValue` / `useAnimatedStyle` body itself
  (`src/components/CanvasCards.tsx`).
- **`grep` treats `src/peopleTags.ts` as binary** and silently skips it. Use
  `grep -a`.

## Backup, restore and scale

- **Backup is the iPhone's own iCloud Backup**, as most apps do. Keep user
  data in Application Support (AsyncStorage) and Documents; never in Caches
  or tmp, which iOS does not back up.
- **Photo asset ids are per device.** A restored or new phone can give every
  photo a new id. Each photo also stores its `cloudId` (PHCloudIdentifier);
  missing photos are looked up by it before anything is removed. The
  deleted-photo sync never acts without full photo access, and never on a
  loss of more than 20% at once — either would wipe a library.
- **Stress-tested at 2,000 photos** (Sept 2026, simulator): import with the
  privacy check 2 min 39 s; Places builds in under 150 ms; photo details
  are ~310 bytes a photo and cached in memory (`photoMeta.ts`). At 20,000
  photos that is ~6 MB; if screens slow down, move photo details to SQLite.
- **Crash reports: Sentry**, off until `EXPO_PUBLIC_SENTRY_DSN` is set. Never
  send console breadcrumbs, screenshots or bodies — they carry memories.
  Local builds need `SENTRY_DISABLE_AUTO_UPLOAD=true` until there is an
  auth token for symbol upload.

## Shipping changes after release

- **JS and assets** (screens, prompts, logic — most of what we change) go
  out as an EAS Update: `npx eas-cli update --channel production -m "…"`.
  Phones download it in the background and use it on the next launch;
  no App Store review. `expo-updates` with `runtimeVersion` policy
  `fingerprint`: an update only reaches builds with the same native code.
- **Native changes** (a new native module, an `app.json` plugin or
  permission, the Swift modules) need a new build through App Store review.
- Cloud builds don't see `.env`: the server address is in `eas.json`
  (`EXPO_PUBLIC_RECALL_API_URL`). The dev token must never go there.
- Listing texts and privacy answers: `docs/APP_STORE.md`.

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
