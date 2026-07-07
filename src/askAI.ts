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
  | { ok: true; answer: string; reference: Reference | null }
  | { ok: false; reason: 'no-key' | 'no-credits' | 'failed' };

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

export function askAvailable(): boolean {
  return !!apiKey();
}

const SYSTEM_PROMPT = `You are Recall, the user's personal memory assistant living inside their memory-journaling app. You answer questions using ONLY the memory log provided to you — never invent people, places, or events that aren't in it.

Rules:
- Be warm, direct, and conversational — like a friend who remembers everything, not a search engine reading results aloud.
- If the memory log doesn't contain the answer, say so plainly (e.g. "I don't have anything logged about that yet") rather than guessing.
- The user may write in English, Arabic, or a mix of both — reply in the same language(s) they used.
- Keep answers short: 1-3 sentences unless the user asks for detail.
- When your answer centers on one specific person, place, or day from the log, include a "reference" so the app can show a shortcut to it. Otherwise set reference to null.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"answer": "<your reply>", "reference": null | {"type": "person", "name": "<exact name from the log>"} | {"type": "place", "name": "<exact name from the log>"} | {"type": "day", "date": "<YYYY-MM-DD from the log>", "label": "<short label like 'Monday, Oct 1'>"}}`;

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
    const parsed = JSON.parse(content) as { answer?: string; reference?: Reference | null };
    if (!parsed.answer) return { ok: false, reason: 'failed' };

    return { ok: true, answer: parsed.answer, reference: parsed.reference ?? null };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
