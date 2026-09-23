import { Provider, textProviders } from './aiProviders';
import { QueryPlan, buildMemoryContext, focusDaysOf } from './askContext';
import { analyzeDaysNow, pauseBackgroundAnalysis, prioritizeDays } from './assumedMemory';
import { WEEKDAYS } from './data';
import {
  ResolvedEvent,
  daysOfEvent,
  eventFocusDays,
  matchLocalEvents,
  mergeEvents,
  resolveUnknownEvents,
} from './worldEvents';

// Real AI answers for the Ask page, grounded in the user's actual memory
// log. Runs on whichever text provider aiProviders.ts puts first — DeepSeek
// when configured, OpenAI otherwise.
//
// Answering happens in four steps:
//   1. matchLocalEvents() — free, offline: does the question name a
//      real-world event with a known date (Ramadan, Eid, a national day)?
//   2. planQuery() — tiny call that resolves which days the question is
//      about and what to search for, in English (the user often writes in
//      Arabic or franco-Arabic, which would never match English summaries).
//      It also dates any other real-world event it recognises, and flags
//      the ones it isn't sure about for a web lookup.
//   3. analyzeDaysNow() — if the day the question landed on has photos
//      nobody has read yet, read them now rather than answering "I haven't
//      looked at those".
//   4. askMemory() — the real answer, against a context built AROUND all
//      of that rather than dumping the whole year in and hoping.
//
// Step 1 and 2 exist because a question about a real event is unanswerable
// until the event becomes a date: the memory log has the photos from the
// first day of Ramadan, but it has never heard the word "Ramadan".

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

// A day the answer actually drew on. Every answer that uses any day returns
// these, so the user can always see — and tap through to — where it came
// from, including when it came from a photo guess rather than their own words.
export type Source = { date: string; label: string; kind: 'logged' | 'photoAnalysis' };

export type Reference =
  | { type: 'person'; name: string }
  | { type: 'place'; name: string };

export type AskResult =
  | {
      ok: true;
      answer: string;
      sources: Source[];
      reference: Reference | null;
      // Tap-to-answer quick replies, present when the AI asks a clarifying
      // question ("Do you mean John from the gym?" → ["Yes, that's him", …]).
      suggestions: string[];
    }
  // 'rate-limited': too many requests too fast (OpenAI's per-minute cap) —
  // transient, retry shortly. Distinct from 'no-credits': the account
  // actually ran out of prepaid balance. Both surface as HTTP 429; only the
  // response body tells them apart (see readErrorReason below).
  | { ok: false; reason: 'no-key' | 'no-credits' | 'rate-limited' | 'failed' };

// Ask sends no images, so it takes the cheapest text provider. Which one
// that is now lives in aiProviders.ts — this used to hardcode the model
// name, which is how the app ended up calling a DeepSeek alias that their
// API no longer lists.
function provider(): Provider | null {
  return textProviders()[0] ?? null;
}

export function askAvailable(): boolean {
  return !!provider();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// OpenAI returns 429 for two very different reasons — a real "no more
// prepaid balance" (error.code 'insufficient_quota') and ordinary
// rate-limiting (too many requests/tokens per minute, which clears itself
// in moments). Telling a user they're "out of credits" when they're really
// just rate-limited is actively misleading, so this reads the actual error
// body instead of assuming the worse case.
async function readErrorReason(res: Response): Promise<'no-credits' | 'rate-limited' | 'failed'> {
  if (res.status !== 429) return 'failed';
  try {
    const json = await res.json();
    // OpenAI signals "out of money" in more than one shape, and getting
    // this wrong is genuinely harmful: it told the user "you're sending
    // questions too fast" for days when the real problem was an exhausted
    // balance, so nobody looked at billing. Check BOTH fields and match
    // any quota/credit/billing wording rather than one exact string.
    //   type: "insufficient_quota", code: "credit_balance_exhausted"
    //   type: "insufficient_quota", code: "insufficient_quota"
    const signal = [json?.error?.type, json?.error?.code, json?.error?.message]
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    const outOfCredits =
      signal.includes('insufficient_quota') ||
      signal.includes('credit_balance_exhausted') ||
      signal.includes('no credits remaining') ||
      signal.includes('billing');
    return outOfCredits ? 'no-credits' : 'rate-limited';
  } catch {
    return 'rate-limited';
  }
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The last few weeks spelled out, so relative phrases ("last Friday",
// "the weekend before last") resolve against a real calendar instead of
// the model doing shaky date arithmetic.
function recentCalendar(): string {
  const today = new Date();
  return Array.from({ length: 21 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return `${WEEKDAYS[d.getDay()]} ${isoDate(d)}${i === 0 ? ' (today)' : i === 1 ? ' (yesterday)' : ''}`;
  }).join(', ');
}

const PLAN_PROMPT = `You turn a question about someone's personal memory log into a search plan. You never answer the question.

Return JSON: {"dates": ["YYYY-MM-DD", ...], "ranges": [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}], "keywords": ["...", ...], "events": [{"name": "...", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}], "lookup": ["...", ...]}

"dates" — every specific calendar day the question points at, resolved against the calendar below. "yesterday", "last Friday", "on the 24th of July" all resolve to real dates. If the question asks about ONE day of a longer event ("the first day of Ramadan", "the second day of Eid"), work that single day out and put it here. Max 14. Empty array if the question doesn't point at a particular day.

"ranges" — any stretch of days the question covers ("last week", "that weekend", "over the summer"). Use this instead of listing 30 dates.

"keywords" — 3 to 8 short search terms for the things, places, activities and people the question is about. ALWAYS IN ENGLISH, no matter what language the question is in. The user often writes Arabic in Latin letters (franco-Arabic): "farah" = wedding, "al3a" = castle, "makan" = place, "shaklo" = looks like, "emta" = when, "mata3am" = restaurant, "sha8l" = work, "bahr" = sea/beach. Translate the meaning, then give English search terms plus obvious synonyms (wedding → wedding, bride, groom, ceremony). For a real-world event, add keywords for what would VISIBLY be in that day's photos — Ramadan → iftar, suhoor, family dinner, mosque; a football match → football, TV, cafe, screen, jersey. Skip filler words like "when", "did", "I".

"events" — real-world events the question refers to (a holiday, a football match, a tournament, an election, a big news day) that you ALREADY KNOW the date of, confidently. Give the real dates. Do NOT include an event whose date you're guessing at.

"lookup" — the same kind of real-world event, but ones whose exact date you do NOT know, or aren't sure about, or that are recent enough that you might be out of date. Write each as a short search phrase someone could look up: "last Real Madrid vs Barcelona match before September 2026". These get looked up on the web, so be specific and include the timeframe. Empty array if there's nothing to look up — never put a guessed date in "events" instead.

Anything already listed under "Already resolved" below is settled: don't repeat it in "events" and don't put it in "lookup". Do still use it to work out "dates" when the question asks about one specific day of it.`;

// Step 1: work out what to actually look for. Cheap, tiny prompt. On any
// failure we fall back to a keyword-free plan — the answer still gets the
// compact index of every day, it's just less targeted.
type PlanResult = QueryPlan & { lookup: string[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_PLAN: PlanResult = { dates: [], keywords: [], ranges: [], events: [], lookup: [] };

async function planQuery(question: string, resolved: ResolvedEvent[]): Promise<PlanResult> {
  const p = provider();
  if (!p) return EMPTY_PLAN;
  const known =
    resolved.length > 0
      ? `\n\nAlready resolved (established dates — treat as fact): ${resolved
          .map((e) => `${e.name} = ${e.start}${e.end !== e.start ? ` to ${e.end}` : ''}`)
          .join('; ')}`
      : '';
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: `${PLAN_PROMPT}\n\nCalendar: ${recentCalendar()}${known}` },
          { role: 'user', content: question },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (!res.ok) return EMPTY_PLAN;
    const json = await res.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as {
      dates?: string[];
      keywords?: string[];
      ranges?: { start?: string; end?: string }[];
      events?: { name?: string; start?: string; end?: string }[];
      lookup?: string[];
    };
    return {
      dates: (parsed.dates ?? []).filter((d) => ISO.test(d)).slice(0, 14),
      keywords: (parsed.keywords ?? []).filter((k) => typeof k === 'string' && k.trim()).slice(0, 8),
      ranges: (parsed.ranges ?? [])
        .filter((r): r is { start: string; end: string } => !!r?.start && !!r?.end && ISO.test(r.start) && ISO.test(r.end))
        .slice(0, 3),
      // Dates the model volunteered. Trusted only as far as the merge in
      // worldEvents puts them — behind the local calendar table, which is
      // the one source here that can't be hallucinated.
      events: (parsed.events ?? [])
        .filter((e) => e?.start && ISO.test(e.start))
        .map<ResolvedEvent>((e) => ({
          name: e.name?.trim() || 'that event',
          start: e.start!,
          end: e.end && ISO.test(e.end) ? e.end : e.start!,
          via: 'model',
        }))
        .slice(0, 3),
      lookup: (parsed.lookup ?? []).filter((l) => typeof l === 'string' && l.trim()).slice(0, 3),
    };
  } catch {
    return EMPTY_PLAN;
  }
}

const SYSTEM_PROMPT = `You are the user's own memory, answering questions about their life. Everything you say about THEIR life comes from the memory log below — never invent a person, place or event that isn't in it.

WHAT YOU KNOW vs WHAT THEY DID — keep these completely separate:
- You know about the world: when Ramadan started, when a match was played, what happened on a date. Use that freely to UNDERSTAND the question and to tell them the date. When a date is given under "WHEN THE EVENT(S) IN THE QUESTION ACTUALLY HAPPENED", it is established fact — state it plainly and move on. Never ask the user when a public event was, and never say you don't know what Ramadan is or when it fell.
- You do NOT know their life except from the log. Never fill a gap with what a person "probably" does on a holiday or a match night. If the log has nothing for that day, give them the date and say there's nothing recorded — that's a useful answer, an invented one isn't.
- Shape: date first, then what the log has. "Ramadan started 17 Feb. That day your photos show a big family table around 6pm and a drive after." / "Ramadan started 17 Feb — nothing logged that day, and no photos either."
- If a day has photos that haven't been read yet, say exactly that in one clause and don't speculate about what's in them.

HOW YOU WRITE — this matters as much as being right:
- Direct and concrete. Say what happened, where, when. Nothing else.
- NO filler adjectives or mood-painting. Banned: "amazing", "lovely", "beautiful", "cozy", "wonderful", "perfect", "peaceful", "special". Never describe atmosphere or how they must have felt.
- Full sentences in a natural voice — like a friend recapping your own day back to you. Not a bullet list, not a diary entry, not a travel blog.
- Short. 1-3 sentences for a normal answer. Never pad.
- Don't open with filler ("Sure!", "Of course", "Great question"). Start with the answer.

Good: "You were at the aquarium on Saturday 15 Aug — a while at the jellyfish tank, then the sharks around mid-afternoon."
Bad: "It looks like you had a wonderful time at the aquarium, perhaps enjoying the peaceful atmosphere of the jellyfish tank before wandering over to see the magnificent sharks!"

LANGUAGE:
- Reply in the same language AND script the user wrote in. English question → English. Arabic script → Egyptian colloquial Arabic in Arabic script. Franco-Arabic (Arabic typed in Latin letters) → reply the same way, in Latin letters.
- Any Arabic you write is EGYPTIAN COLLOQUIAL — the way people actually speak and text in Cairo. Never Modern Standard Arabic / Fusha, and never a mix of the two. No tashkeel.

WHERE ANSWERS COME FROM — the log has two kinds of day content:
- "What the user logged themselves" — their own words. Solid fact.
- "From their photos (AI photo analysis)" — a guess reconstructed from that day's photos. The user never said it. Don't dress it up as something they told you, but don't clutter every sentence with hedges either — the app labels the source for them. One light "looks like" is plenty, and only when it matters.

BEING USEFUL:
- If you know it, answer it. If you're unsure which of a few days they mean, say which ones and ask — briefly.
- If nothing in the log matches, say so plainly in one line and offer the nearest real thing from the log. Never invent something to fill the gap, and never lecture them about what they should log.
- One question at a time, and only when it actually helps.

ALWAYS report which days you used, in "sources" — every day whose content shaped your answer, with the right "kind" for each ("logged" if you used their own words for that day, "photoAnalysis" if you used the photo guess). Empty only when the answer used no specific day at all.

Respond with ONLY a JSON object:
{"answer": "<your reply>", "sources": [{"date": "YYYY-MM-DD", "kind": "logged" | "photoAnalysis"}], "reference": null | {"type": "person", "name": "<exact name from the log>"} | {"type": "place", "name": "<exact name from the log>"}, "suggestions": ["<short tap reply>", "..."] | []}`;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sourceLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export async function askMemory(question: string, history: ChatTurn[]): Promise<AskResult> {
  const p = provider();
  if (!p) return { ok: false, reason: 'no-key' };

  // Claims priority over the background photo-analysis pass for the whole
  // exchange (plan + answer + any retry) — that pass steps aside rather
  // than firing its own request into the same window, so a live question
  // can no longer collide with it. Re-claimed before the retry below too,
  // in case the exchange runs long.
  pauseBackgroundAnalysis();

  try {
    // Free and offline: the recurring dates this user asks about most.
    // Handed to the planner so it can narrow ("the first day of Ramadan"
    // → one date) instead of re-deriving a date it might get wrong.
    const localEvents = matchLocalEvents(question);
    const draft = await planQuery(question, localEvents);

    // Only the events the planner admitted it couldn't date get looked up
    // on the web — and each lookup is cached for good, so the same event
    // is never paid for twice.
    const web =
      draft.lookup.length > 0
        ? await resolveUnknownEvents(draft.lookup)
        : { events: [], unresolved: [] };
    const events = mergeEvents(localEvents, draft.events ?? [], web.events);
    // Whatever the question hangs on that nothing could date — no key, no
    // credit, or genuinely not findable. The answer has to own that rather
    // than quietly answering about some other day.
    const plan: QueryPlan = { ...draft, events, unresolved: web.unresolved };

    // Read the photos for the days this question actually landed on, if
    // nobody has read them yet. Order is priority order — only a couple
    // get read on the spot, so it goes: the dates they named, then each
    // event's own opening days, then the days either side.
    const candidates = [
      ...new Set([
        ...plan.dates,
        ...events.flatMap((e) => eventFocusDays(e)),
        ...focusDaysOf(plan),
      ]),
    ];
    if (candidates.length > 0) await analyzeDaysNow(candidates);
    // Everything else the events cover is too much to read while someone
    // waits, but it should still jump the background queue.
    const eventDays = events.flatMap((e) => daysOfEvent(e));
    if (eventDays.length > 0) prioritizeDays(eventDays);

    // Re-claimed after the analysis above, which may have taken a few
    // seconds of the original hold.
    pauseBackgroundAnalysis();

    const headers = { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' };

    const buildBody = async (mode: 'full' | 'compact') => {
      const context = await buildMemoryContext(plan, mode);
      return JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\n---\nMEMORY LOG:\n${context}` },
          ...history.slice(-8).map((h) => ({ role: h.role, content: h.text })),
          { role: 'user', content: question },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });
    };

    let res = await fetch(p.url, { method: 'POST', headers, body: await buildBody('full') });

    // Rate limits here are on TOKENS per minute, not request count — so
    // resending the SAME oversized payload was never going to work, it
    // just burned more of the budget it was already short of. Each retry
    // now sends the compact context instead (only the days actually
    // retrieved for this question — a fraction of the size), which is what
    // actually gets an answer through a tight budget. A genuine
    // "out of credits" case skips retrying entirely.
    for (const backoffMs of [1500, 4000]) {
      if (res.status !== 429 || (await readErrorReason(res.clone())) !== 'rate-limited') break;
      pauseBackgroundAnalysis();
      await sleep(backoffMs);
      res = await fetch(p.url, { method: 'POST', headers, body: await buildBody('compact') });
    }

    if (res.status === 429) return { ok: false, reason: await readErrorReason(res) };
    if (!res.ok) return { ok: false, reason: 'failed' };

    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as {
      answer?: string;
      sources?: { date?: string; kind?: string }[];
      reference?: Reference | null;
      suggestions?: string[];
    };
    if (!parsed.answer) return { ok: false, reason: 'failed' };

    const sources: Source[] = (parsed.sources ?? [])
      .filter((s): s is { date: string; kind?: string } => !!s?.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map<Source>((s) => ({
        date: s.date,
        label: sourceLabel(s.date),
        kind: s.kind === 'photoAnalysis' ? 'photoAnalysis' : 'logged',
      }))
      // The model sometimes repeats a day; one row per day is enough.
      .filter((s, i, arr) => arr.findIndex((o) => o.date === s.date) === i)
      .slice(0, 5);

    return {
      ok: true,
      answer: parsed.answer,
      sources,
      reference: parsed.reference ?? null,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [],
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
