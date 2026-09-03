import { QueryPlan, buildMemoryContext } from './askContext';
import { pauseBackgroundAnalysis } from './assumedMemory';
import { WEEKDAYS } from './data';

// Real AI answers for the Ask page, grounded in the user's actual memory
// log. Reuses the same OpenAI key already set up for voice transcription —
// one key, no extra account needed.
//
// Answering happens in two steps:
//   1. planQuery()  — tiny call that resolves which days the question is
//      about and what to search for, in English (the user often writes in
//      Arabic or franco-Arabic, which would never match English summaries).
//   2. askMemory()  — the real answer, against a context that was built
//      AROUND that plan rather than dumping the whole year in and hoping.

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

function openAiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

function deepseekKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

// Ask is text-only, so it can run on either provider. DeepSeek is preferred
// when configured: it's far cheaper per question, and — the reason this
// matters here — it does NOT share a budget with the photo analysis, which
// runs on OpenAI because it needs vision. Splitting them means a heavy
// analysis pass (or an exhausted OpenAI balance) can no longer take the
// chat down with it, which is exactly what kept happening.
function provider(): { url: string; key: string; model: string } | null {
  const ds = deepseekKey();
  if (ds) return { url: 'https://api.deepseek.com/chat/completions', key: ds, model: 'deepseek-chat' };
  const oa = openAiKey();
  if (oa) return { url: 'https://api.openai.com/v1/chat/completions', key: oa, model: 'gpt-4o-mini' };
  return null;
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

Return JSON: {"dates": ["YYYY-MM-DD", ...], "keywords": ["...", ...]}

"dates" — every specific calendar day the question points at, resolved against the calendar below. "yesterday", "last Friday", "on the 24th of July" all resolve to real dates. A range ("last week", "that weekend") lists each day in it, max 14. Empty array if the question doesn't point at any particular day.

"keywords" — 3 to 8 short search terms for the things, places, activities and people the question is about. ALWAYS IN ENGLISH, no matter what language the question is in. The user often writes Arabic in Latin letters (franco-Arabic): "farah" = wedding, "al3a" = castle, "makan" = place, "shaklo" = looks like, "emta" = when, "mata3am" = restaurant, "sha8l" = work, "bahr" = sea/beach. Translate the meaning, then give English search terms plus obvious synonyms (wedding → wedding, bride, groom, ceremony). Skip filler words like "when", "did", "I".`;

// Step 1: work out what to actually look for. Cheap, tiny prompt. On any
// failure we fall back to a keyword-free plan — the answer still gets the
// compact index of every day, it's just less targeted.
async function planQuery(question: string): Promise<QueryPlan> {
  const p = provider();
  if (!p) return { dates: [], keywords: [] };
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: `${PLAN_PROMPT}\n\nCalendar: ${recentCalendar()}` },
          { role: 'user', content: question },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });
    if (!res.ok) return { dates: [], keywords: [] };
    const json = await res.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as Partial<QueryPlan>;
    return {
      dates: (parsed.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 14),
      keywords: (parsed.keywords ?? []).filter((k) => typeof k === 'string' && k.trim()).slice(0, 8),
    };
  } catch {
    return { dates: [], keywords: [] };
  }
}

const SYSTEM_PROMPT = `You are the user's own memory, answering questions about their life. Everything you say comes from the memory log below — never invent a person, place or event that isn't in it.

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
    const plan = await planQuery(question);
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
