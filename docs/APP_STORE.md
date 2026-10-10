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

## Promotional text (170 max — can be changed any time without review)

Talk, type or snap — Recall files your day into people, places and tasks, and answers "when did I last see Omar?" in seconds.

## Description

Recall is a journal that remembers for you.

Say how your day went, type a line, or let Recall read the photos you took. It writes it up as a clean memory and files everything in its place: who you were with, where you went, what you need to do next.

ASK YOUR MEMORY
"When did I go to the pyramids?" "What did I do on Eid?" "When was the last time I saw Sara?" Ask in English or Arabic, by text or by voice, and Recall answers from your own memories — with the days it used, one tap away.

A TIMELINE YOU CAN MOVE AROUND
Every day is a canvas: your notes, photos, people, places and small icons for the moments that matter — paydays, medicine, birthdays. Hold a card to move it, zoom out to see the shape of a week.

PEOPLE AND PLACES, FILLED IN FOR YOU
Add a photo to someone once and Recall notices them in your other photos, on your phone — always as a suggestion you confirm. Places come from where your photos were taken, never from a map service tracking you.

TASKS FROM WHAT YOU SAY
"Dentist Thursday at 2" becomes a task with a reminder an hour before — or whenever you choose. Save a ticket or an appointment screenshot and Recall turns it into a task with the details.

RECAPS
A short recap of yesterday, last week or last month — with Positive Focus, which leaves out painful moments if you want it to.

PRIVATE BY DESIGN
Your memories live on your iPhone and come back with your iCloud Backup. Faces are matched on the phone and never leave it. The AI only runs if you allow it, and Recall's own server keeps none of your words or photos. No ads, no tracking, nothing sold.

## Keywords (100 max, commas, no spaces after them)

journal,diary,memory,voice journal,photo diary,life log,daily recap,reminders,ai diary,people,notes

(99 characters.)

## What's New (1.0)

The first version of Recall.

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

## Screenshots

Required: 6.9" iPhone (1320 × 2868), 3 to 10. Made on the iPhone 17 Pro Max simulator with test data, in this order:

1. Home — the week, the Ask pill, yesterday's summary
2. Ask — a question answered, with its source day
3. Timeline — a day's canvas with people, places and moment icons
4. People — the faces grid
5. Weekly recap — days with their people and places
6. Tasks — the reminder wheel
