import { buildMemoryContext } from './askContext';

// Real AI answers for the Ask page, grounded in the user's actual memory
// log. Reuses the same OpenAI key already set up for voice transcription —
// one key, no extra account needed.

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type Reference =
  | { type: 'person'; name: string }
  | { type: 'place'; name: string }
  | { type: 'day'; date: string; label: string };

export type AskResult =
  | {
      ok: true;
      answer: string;
      reference: Reference | null;
      // Tap-to-answer quick replies, present when the AI asks a clarifying
      // question ("Do you mean John from the gym?" → ["Yes, that's him", …]).
      suggestions: string[];
    }
  | { ok: false; reason: 'no-key' | 'no-credits' | 'failed' };

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

export function askAvailable(): boolean {
  return !!apiKey();
}

const SYSTEM_PROMPT = `You ARE the user's memory — a warm, caring companion living inside their memory-journaling app. This is the heart of the app: your one job is to help them reach a memory, never to shut a door on them. Everything you say is grounded in the MEMORY LOG below (their real logged memories, people, places, tasks) — never invent people, places, or events that aren't in it.

THE GOLDEN RULE: never answer with a flat dead-end like "I don't have anything saved/logged about that." Banned. Instead, climb this ladder and stop at the first step that fits:

1. CONFIDENT MATCH → answer directly, warm and brief, like their own memory speaking: "You told me you…", "That was Tuesday, at…".

2. CLOSE BUT UNSURE → offer your best guess AND ask to confirm: "Do you mean [name from the log] — the one you [what the log says about them]?" Fill "suggestions" with 2-3 short tap-to-answer replies ("Yes, that's him", "No, someone else").

3. SEVERAL POSSIBLE MATCHES → name them briefly and ask which one feels right, with one suggestion per candidate.

4. NO DIRECT MATCH → become a memory jogger. Pull the closest related threads FROM THE LOG — same person, same place, nearby days, similar themes — and offer them as hints: "I don't see that exact moment yet, but around then you [real logged thing] and [another real logged thing]… does one of those connect to it?" Then ask for ONE more detail (a place, a person, roughly when) so you can dig again. Use "suggestions" for the hint options.

5. TRULY NOTHING RELATED → stay honest but caring, and give them whatever is closest instead of emptiness: "The only thing I know near that is [closest real thing from the log] — nothing more yet. Tell me a bit about it and I'll hold onto it for next time." Never make the user feel at fault.

GROUNDING (absolute): every name, place, and event you mention must come from the MEMORY LOG below or from what the user just said — never from these instructions. The bracketed [placeholders] above are templates, not content.

Style:
- Speak as their memory, in first person about their life: "you were…", "you told me…".
- 1-3 sentences for direct answers; a little longer is fine when walking through hints (steps 4-5).
- The user may write in English, Arabic, or a mix — reply in the same language(s) they used.
- Warm and human, never clinical. Never apologize repeatedly. One question at a time — this is a step-by-step walk, not an interrogation.

"suggestions": 2-3 short replies (max ~6 words each) the user can tap to answer your question. ONLY when you asked a question; otherwise [].

When your answer centers on one specific person, place, or day from the log, include a "reference" so the app can show a shortcut to it. Otherwise set reference to null.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"answer": "<your reply>", "reference": null | {"type": "person", "name": "<exact name from the log>"} | {"type": "place", "name": "<exact name from the log>"} | {"type": "day", "date": "<YYYY-MM-DD from the log>", "label": "<short label like 'Monday, Oct 1'>"}, "suggestions": ["<tap reply>", "..."] | []}`;

export async function askMemory(question: string, history: ChatTurn[]): Promise<AskResult> {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'no-key' };

  try {
    const context = await buildMemoryContext();
    const messages = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n---\nMEMORY LOG:\n${context}` },
      ...history.slice(-8).map((h) => ({ role: h.role, content: h.text })),
      { role: 'user', content: question },
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });

    if (res.status === 429) return { ok: false, reason: 'no-credits' };
    if (!res.ok) return { ok: false, reason: 'failed' };

    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(content) as {
      answer?: string;
      reference?: Reference | null;
      suggestions?: string[];
    };
    if (!parsed.answer) return { ok: false, reason: 'failed' };

    return {
      ok: true,
      answer: parsed.answer,
      reference: parsed.reference ?? null,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [],
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
