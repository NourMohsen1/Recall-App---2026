import { RawMessage, chatCompletionRaw, textAvailable, textProviders } from './aiProviders';
import {
  REALTIME_TOOLS,
  VOICE_INSTRUCTIONS,
  buildVoiceBootstrap,
  runRealtimeTool,
} from './realtimeTools';

// The conversation itself, with the microphone left out of it.
//
// There are two ways to talk to Recall and only one brain between them. The
// live one — gpt-realtime over WebRTC — streams audio both ways and needs
// native code, so it only exists in an installed build. This one records,
// transcribes, thinks and speaks in turns, which needs nothing native and
// therefore works in Expo Go today.
//
// What they SHARE is the part that decides whether any of it is worth having:
// the same instructions, the same tools, the same refusal to invent. The
// realtime model runs that loop inside itself; here it is run by hand. So
// testing this is really testing the brain, and swapping the transport later
// changes how the words arrive, not what gets said.

// The tool definitions are written in the Realtime API's shape — a flat name,
// description and parameters. Chat Completions wants the same thing nested
// under `function`. One definition, translated, rather than two lists that
// drift apart.
function asChatTools() {
  return REALTIME_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export type VoiceTurn = { role: 'user' | 'assistant'; text: string };

export type VoiceAnswer =
  | { ok: true; text: string; lookedUp: string[] }
  | { ok: false; error: string };

export function voiceSessionAvailable(): boolean {
  return textAvailable();
}

// How many times it may go and look something up before answering.
//
// Capped because a model that can call tools can also loop calling them, and
// a loop in a conversation is silence. Four is enough for the real pattern —
// search, then open the day it found, then check who was there.
const MAX_LOOKUPS = 4;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: RawMessage['tool_calls'];
  tool_call_id?: string;
};

// One question, answered out loud.
//
// `lookedUp` comes back so a screen can show what it actually consulted. That
// is not decoration: it is the difference between an answer the user can
// check and one they have to take on faith, and this is the feature where
// taking things on faith is most dangerous.
export async function answerAloud(
  question: string,
  history: VoiceTurn[] = [],
): Promise<VoiceAnswer> {
  if (!voiceSessionAvailable()) {
    return { ok: false, error: 'No API key configured.' };
  }

  const bootstrap = await buildVoiceBootstrap();
  const messages: ChatMessage[] = [
    { role: 'system', content: `${VOICE_INSTRUCTIONS}\n\n${bootstrap}` },
    ...history.map((t) => ({ role: t.role, content: t.text }) as ChatMessage),
    { role: 'user', content: question },
  ];

  const lookedUp: string[] = [];
  const tools = asChatTools();

  for (let round = 0; round <= MAX_LOOKUPS; round++) {
    // On the last round the tools are taken away, which forces an answer out
    // of whatever it already has instead of another lookup it has no budget
    // for. Better a hedged sentence than dead air.
    const allowTools = round < MAX_LOOKUPS;
    const result = await chatCompletionRaw(textProviders(), (model) => ({
      model,
      messages,
      ...(allowTools ? { tools, tool_choice: 'auto' } : {}),
      temperature: 0.6,
    }));

    if (!result.ok) {
      return {
        ok: false,
        error:
          result.status === 429
            ? 'Too many requests just now — give it a moment.'
            : 'Could not reach the assistant.',
      };
    }

    const message = result.message;
    const calls = message.tool_calls ?? [];

    if (calls.length === 0) {
      const text = (message.content ?? '').trim();
      if (!text) return { ok: false, error: 'No answer came back.' };
      return { ok: true, text, lookedUp };
    }

    // Keep the assistant's own turn in the thread before the results, or the
    // model has no record of having asked.
    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: calls });

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        // A malformed argument string is the model's mistake, not a crash.
        // It gets told, and usually fixes it on the next round.
        args = {};
      }
      const output = await runRealtimeTool(call.function.name, args);
      lookedUp.push(describeLookup(call.function.name, args));
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  return { ok: false, error: 'Got stuck looking things up.' };
}

// What to show the user about a lookup, in their words rather than the
// function's.
function describeLookup(name: string, args: Record<string, unknown>): string {
  const q = typeof args.query === 'string' ? args.query : '';
  const who = typeof args.name === 'string' ? args.name : '';
  const date = typeof args.date === 'string' ? args.date : '';
  switch (name) {
    case 'search_memories':
      return q ? `searched your memories for “${q}”` : 'searched your memories';
    case 'get_day':
      return date ? `opened ${date}` : 'opened a day';
    case 'find_person':
      return who ? `looked up ${who}` : 'looked up a person';
    case 'list_people':
      return 'checked who you know';
    case 'list_tasks':
      return 'checked your tasks';
    case 'recent_days':
      return 'looked at your recent days';
    default:
      return name;
  }
}
