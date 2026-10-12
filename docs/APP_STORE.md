# Recall — App Store listing (version 1.0)

Everything App Store Connect asks for, ready to paste. Every claim here
matches what the app does today; when that changes, this file and
`server/src/pages.ts` (the privacy page) change in the same commit.

## App information

| Field | Value |
|---|---|
| Name | Recall: Memory Journal |
| Subtitle (30 max) | Your days, remembered |
| Primary category | Lifestyle |
| Secondary category | Productivity |
| Privacy Policy URL | https://recall-keys.nourmohsen-recall.workers.dev/privacy |
| Support URL | https://recall-keys.nourmohsen-recall.workers.dev/support |
| Contact email | recallsupport10@gmail.com |
| Devices | iPhone only for 1.0 (`supportsTablet: false`) |
| Encryption | Standard HTTPS only — exempt (`usesNonExemptEncryption: false`, so the question doesn't come up per build) |

## Promotional text (170 max, can be changed any time without review)

No dashes in anything a reader sees (Nour: they read as written by AI).

Recall brings your days back to you, so you remember them yourself. Talk, type or snap a photo, and Recall keeps it for you.

## Description

Recall keeps your memory up to date. It doesn't remember for you. It brings your days back to you, again and again, so you remember them yourself.

Say how your day went, type a line, or let Recall read the photos you took. It writes it up as a clean memory and files everything in its place: who you were with, where you went, what you need to do next. Then it shows it back to you in a morning recap, on your timeline and next to the people and places, so the last few weeks stay fresh in your own head.

ASK WHEN YOU NEED TO
"When did I go to the pyramids?" "What did I do on Eid?" "When was the last time I saw Sara?" Ask in English or Arabic, by text or by voice, and Recall answers from your own memories, with the days it used one tap away.

A TIMELINE YOU CAN MOVE AROUND
Every day is a canvas: your notes, photos, people, places and small icons for the moments that matter, like paydays, medicine and birthdays. Hold a card to move it, zoom out to see the shape of a week.

PEOPLE AND PLACES, FILLED IN FOR YOU
Add a photo to someone once and Recall notices them in your other photos, on your phone, always as a suggestion you confirm. Places come from where your photos were taken, never from a map service tracking you.

TASKS FROM WHAT YOU SAY
"Dentist Thursday at 2" becomes a task with a reminder an hour before, or whenever you choose. Save a ticket or an appointment screenshot and Recall turns it into a task with the details.

RECAPS
A short recap of yesterday, last week or last month. Turn on Positive Focus and it leaves out the painful moments.

PRIVATE BY DESIGN
Your memories live on your iPhone and come back with your iCloud Backup. Faces are matched on the phone and never leave it. The AI only runs if you allow it, and Recall's own server keeps none of your words or photos. No ads, no tracking, nothing sold.

## Keywords (100 max, commas, no spaces after them)

journal,diary,memory,voice journal,photo diary,life log,daily recap,reminders,ai diary,people,notes

(99 characters.)

## What's New (1.0)

The first version of Recall.

## TestFlight test information

Beta App Description:

Recall keeps your own memory fresh. Talk, type or snap a photo of your day, and Recall files it into people, places and tasks, then brings it back to you in recaps, on your timeline and whenever you ask. The idea is that you remember your days yourself, not that you rely on the app. Please try: logging a day by voice or text, asking a question in Ask, the Timeline, and the weekly recap. Tell us anything that feels confusing or wrong.

Feedback email: recallsupport10@gmail.com · Privacy Policy URL: as above · Sign-in required: no · Review notes: the App Review notes below. Contact: Nour's name and phone, recallsupport10@gmail.com — private to Apple's reviewers.

## App Review notes

- Signing in is optional: tap "Not now" on the account screen. Everything can be reviewed without an account.
- Recall asks before anything is sent to an AI company ("Recall's AI", near the end of setup). Choose "Allow" to review Ask, voice notes and recaps.
- Requests reach the AI through Recall's own server, which verifies the app with App Attest. This works on a real device, and not in a simulator.
- Sign in with Apple can be removed in Profile → account → Delete account, which also revokes Recall's access at Apple.

## App Privacy (the "nutrition label")

Tracking: **No** — Recall does not track users across apps or websites, and has no ads or analytics.

| Data type | Collected? | Used for | Linked to the user? | Why |
|---|---|---|---|---|
| Photos or Videos | Yes | App Functionality | No | Only with "Reading your photos" on: a day's photos go to DeepSeek to write that day's story. |
| Audio Data | Yes | App Functionality | No | With Recall's AI on: voice notes go to OpenAI to be written out; live voice conversation goes to OpenAI. |
| Other User Content | Yes | App Functionality | No | With Recall's AI on: the words of notes, questions in Ask and the memories needed to answer them go to OpenAI or DeepSeek. |
| User ID | Yes | App Functionality | Yes | Sign in with Apple, if used: the server receives Apple's user id and keeps only a one-way hash of it, to sign sessions. |
| Crash Data | Yes | App Functionality | No | Sentry: the error and phone model — no memories, screenshots or breadcrumbs. |
| Everything else (location, contacts, health, name, email, browsing, purchases) | No | — | — | Location and contacts are used only on the phone. A place's street or landmark name comes from Apple. |

Third parties that receive content, for the review form: OpenAI, DeepSeek, Tavily (On This Day searches — topics and dates, not memories), Sentry.

## Age rating

Answer "None" to every content question: there is no user-to-user content, no web browsing, and news shown in On This Day is filtered for sexual content (`src/contentSafety.ts`). Expected result: 4+. If Apple's form asks about AI-generated content, answer yes — summaries and answers are written by AI.

## Screenshots (approved by Nour, 11 Oct 2026)

Required: 6.9" iPhone, 1320 × 2868 (and the same set at 6.3", 1206 × 2622).
Upload these eight, in this order, from `docs/app-store-screenshots/`:

| # | File | Screen | Headline | Line under it |
|---|---|---|---|---|
| 1 | `1-home.png` | Home | Your Days, **Remembered** | Talk, type or snap. Recall files the rest. |
| 2 | `2-ask-brain.png` | Ask, the 3D brain | Ask Your **Memory** | Speak or type, in any language |
| 3 | `3-ask.png` | Ask, an answer with its days | Find Details **Fast** | Real answers from your own days |
| 4 | `4-timeline.png` | A day | Remember With **Context** | Linked to who, when and where |
| 5 | `5-canvas.png` | The Timeline canvas | Every Day, One **Canvas** | Move things around. It all stays linked. |
| 6 | `6-people.png` | People | Everyone You **Love** | People fill in from what you log |
| 7 | `7-recap.png` | Weekly recap | Your Week, **At a Glance** | A short recap, day by day |
| 8 | `8-tasks.png` | Tasks | Keep Life **Organized** | Tasks from what you say |

Style (after a reference Nour chose): light pale and teal slides
alternating, Poppins Bold headlines with one word in a pill or the accent
colour, the real screen in a black phone frame with a soft glow, a few
hand-drawn touches. Only the app's own fonts and colours. On This Day on the
canvas slide shows real headlines for 10 Oct 2026, fetched by the app's own
search.

The content is real app output, not arranged by hand: a made-up user
(Layla) logged a week of notes, filed by the app's own intake with the
real AI (`tools/app-store-screenshots/demo-week.ts`), loaded into a
Release build on an iPhone 17 Pro Max simulator (`load-demo.py`). One
edit: on the brain screen, the line "Recall's AI is off" — shown only
because a simulator can't pass App Attest — was removed from the
background above the field.

To redo them after screens change: capture the seven screens again into
`tools/app-store-screenshots/captures/` (same names), then
`python tools/app-store-screenshots/frame.py tools/app-store-screenshots/captures docs/app-store-screenshots`
(needs Pillow).
