// Recall's public pages: the privacy policy and support page the App Store
// links to. Plain HTML from this worker, so there is no website to keep.
//
// Every statement here must match what the app does. When something that
// leaves the phone changes — a new AI company, crash reporting off, a new
// service — this page changes in the same commit.

const CONTACT = 'recallsupport10@gmail.com';
const UPDATED = '7 October 2026';

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Recall</title>
<style>
  :root{--ink:#081112;--teal:#29545A;--soft:#5C878D;--pale:#EEF4F4}
  body{margin:0;background:var(--pale);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:680px;margin:0 auto;padding:40px 20px 64px}
  h1{color:var(--teal);font-size:30px;margin:0 0 4px}
  h2{color:var(--teal);font-size:19px;margin:32px 0 6px}
  .updated{color:var(--soft);font-size:14px;margin:0 0 28px}
  .card{background:#fff;border-radius:18px;padding:18px 20px;margin:14px 0}
  a{color:var(--teal)} ul{padding-left:20px} li{margin:4px 0}
</style></head><body><main>${body}</main></body></html>`;

export const PRIVACY = shell(
  'Privacy',
  `<h1>Privacy</h1>
<p class="updated">Recall: Memory Journal · updated ${UPDATED}</p>

<div class="card"><strong>In short:</strong> your memories live on your iPhone. Recall has no
account database and keeps none of your memories on its own server. Words and recordings are
sent to an AI company only if you allow it, and only to do what you asked. No ads, no tracking,
nothing sold.</div>

<h2>What stays on your iPhone</h2>
<ul>
<li>Everything you log: notes, voice recordings, photos you add, tasks, people and places.</li>
<li>Face matching is done entirely on the phone. Faces never leave it.</li>
<li>Where your photos were taken is kept on the phone to group them into places.</li>
<li>Your iPhone's own iCloud Backup includes Recall's data, as it does for most apps. That is
Apple's backup, under your Apple Account.</li>
</ul>

<h2>What is sent, and to whom</h2>
<ul>
<li><strong>AI (OpenAI and DeepSeek)</strong>, only if you turn on "Recall's AI": the words of
your notes and voice notes, to write them up and file them; voice recordings, to turn them into
text; your questions in Ask, with the memories needed to answer them; your voice in live
conversation; and text read aloud to you. Turned off, nothing is sent.</li>
<li><strong>Photos (DeepSeek)</strong>, only if you allow it separately: a day's photos, to write
that day's story. Photos flagged as private are never sent.</li>
<li><strong>On This Day (Tavily)</strong>: searches for news on dates in your history, built from
the topics you pick. Not your memories.</li>
<li><strong>Apple</strong>: Sign in with Apple, if you use it (Recall asks for your name only, not
your email); and the location of a place you haven't named, to show its street or landmark name.</li>
<li><strong>Crash reports (Sentry)</strong>: when the app crashes, the error and the phone model —
no memories, no screenshots, no personal details.</li>
</ul>
<p>All AI and search requests pass through Recall's own server, which forwards them and keeps
nothing: no content, no copies. It records only that a request happened, tied to an anonymous
code for your install, so misuse can be stopped. What each company does with what it receives is
covered by its own policy:
<a href="https://openai.com/policies/privacy-policy">OpenAI</a>,
<a href="https://platform.deepseek.com/downloads/DeepSeek%20Open%20Platform%20Privacy%20Policy.html">DeepSeek</a>,
<a href="https://tavily.com/privacy">Tavily</a>,
<a href="https://sentry.io/privacy/">Sentry</a>.</p>

<h2>Your choices</h2>
<ul>
<li>Turn the AI or photo reading on or off any time: Profile → Recall's AI, and Profile → Reading your photos.</li>
<li>Delete your account in Profile: it also removes Recall's link to your Apple Account. Your memories stay on the phone.</li>
<li>Delete the app to remove everything Recall keeps on your phone.</li>
</ul>

<h2>Children</h2>
<p>Recall is not meant for children under 13.</p>

<h2>Contact</h2>
<p>Questions about privacy: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`,
);

export const SUPPORT = shell(
  'Support',
  `<h1>Support</h1>
<p class="updated">Recall: Memory Journal</p>

<div class="card">Write to <a href="mailto:${CONTACT}">${CONTACT}</a> — say what happened and,
if you can, when. You'll get a reply from a person.</div>

<h2>Common questions</h2>
<p><strong>A voice note shows no words.</strong> Turn on Recall's AI in Profile; the words are
written out once it's on. Without it, the recording is still saved.</p>
<p><strong>I got a new iPhone.</strong> Restore it from your iCloud Backup and Recall comes back with your memories.</p>
<p><strong>How do I delete my account?</strong> Profile → your account → Delete account.</p>
<p><a href="/privacy">Privacy</a></p>`,
);
