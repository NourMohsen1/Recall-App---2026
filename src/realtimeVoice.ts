import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';

import { backendToken, backendUrl } from './backend';
import {
  REALTIME_TOOLS,
  VOICE_INSTRUCTIONS,
  buildVoiceBootstrap,
  runRealtimeTool,
} from './realtimeTools';

// The live conversation: audio both ways, and interruption.
//
// The difference from the turn-based version is only the transport. Same
// instructions, same six tools, same refusal to invent — see
// realtimeTools.ts. What changes is that the model hears the user while it
// is still speaking, so it can be cut off mid-sentence, and answers begin
// before the sentence asking them has finished.
//
// HOW IT CONNECTS, and why it is shaped this way. The audio goes straight
// from the phone to OpenAI over WebRTC; nothing is relayed through Recall's
// server, because putting a server in the middle of a live audio stream
// would add delay to the one thing that has to feel immediate.
//
// That means the phone needs a credential. It is never given the real API
// key — it asks Recall's server for a short-lived one that expires in about
// a minute and can only open the session the server configured. See
// server/src/index.ts.

/** How long one conversation may run.
 *
 *  Roughly ten cents a minute, so this is a pound a call at worst. It
 *  exists because the failure that costs money is not a runaway model, it
 *  is a phone put down on a table with the screen still on. */
const MAX_SESSION_MS = 10 * 60 * 1000;
/** Said out loud before the end, so it does not just stop. */
const WARN_AT_MS = 9 * 60 * 1000;

const SDP_URL = 'https://api.openai.com/v1/realtime/calls';

export type LiveEvent =
  | { type: 'connecting' }
  | { type: 'listening' }
  | { type: 'thinking' }
  | { type: 'speaking' }
  | { type: 'said'; role: 'user' | 'assistant'; text: string }
  | { type: 'looked-up'; label: string }
  | { type: 'ended'; reason: 'user' | 'time' | 'error'; detail?: string };

export type LiveSession = {
  /** Stop talking and hang up. Safe to call twice. */
  end: () => void;
  /** Cut the model off mid-sentence without ending the call. */
  interrupt: () => void;
};

export function liveVoiceAvailable(): boolean {
  return !!backendUrl('/') && !!backendToken();
}

async function mintToken(): Promise<string> {
  const url = backendUrl('/realtime/token');
  const token = backendToken();
  if (!url || !token) throw new Error('Live voice is not set up.');

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Could not start a conversation (${res.status}).`);
  }
  const json = (await res.json()) as { value?: string };
  if (!json.value) throw new Error('No key came back for the conversation.');
  return json.value;
}

export async function startLiveVoice(
  onEvent: (e: LiveEvent) => void,
): Promise<LiveSession> {
  onEvent({ type: 'connecting' });

  const key = await mintToken();
  const bootstrap = await buildVoiceBootstrap();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  let mic: MediaStream | null = null;
  let ended = false;
  let warnTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (reason: 'user' | 'time' | 'error', detail?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(warnTimer);
    clearTimeout(endTimer);
    mic?.getTracks().forEach((t) => t.stop());
    try {
      pc.close();
    } catch {
      // Already closed.
    }
    onEvent({ type: 'ended', reason, detail });
  };

  try {
    // The microphone. Asked for before anything is sent, so a refusal costs
    // nothing and is not discovered halfway through connecting.
    mic = (await mediaDevices.getUserMedia({ audio: true })) as MediaStream;
    mic.getTracks().forEach((track) => pc.addTrack(track, mic as MediaStream));

    // The model's voice arrives as an ordinary remote track; react-native-webrtc
    // plays it through the phone's audio session without anything further.
    (pc as unknown as { ontrack: (e: unknown) => void }).ontrack = () => {
      onEvent({ type: 'speaking' });
    };

    const channel = pc.createDataChannel('oai-events');

    channel.onopen = () => {
      // Everything the model needs to know, sent once. The instructions and
      // tools are the same ones the typed version uses.
      channel.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: `${VOICE_INSTRUCTIONS}\n\n${bootstrap}`,
            tools: REALTIME_TOOLS,
            tool_choice: 'auto',
            audio: {
              input: {
                // Without this the model HEARS the user but never writes
                // down what they said, so only its own half of the
                // conversation could be saved or shown. Transcribing the
                // user's side is not a nicety here: mishearing is the
                // commonest reason a spoken answer is wrong, and out loud
                // there is no way to tell a misheard question from a bad
                // answer unless both are on screen.
                transcription: { model: 'gpt-live-transcribe' },
              },
            },
          },
        }),
      );
      onEvent({ type: 'listening' });
    };

    channel.onmessage = (event: { data?: string }) => {
      if (!event?.data) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      void handleEvent(msg, channel, onEvent);
    };

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);

    const answer = await fetch(SDP_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!answer.ok) {
      throw new Error(`OpenAI refused the connection (${answer.status}).`);
    }
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: await answer.text() }),
    );

    // The cap. A spoken warning first, because a call that simply stops
    // feels like a fault rather than a limit.
    warnTimer = setTimeout(() => {
      if (ended) return;
      channel.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            instructions:
              'Tell the user, briefly and naturally, that this conversation will end in about a minute and they can start another whenever they like.',
          },
        }),
      );
    }, WARN_AT_MS);
    endTimer = setTimeout(() => cleanup('time'), MAX_SESSION_MS);

    return {
      end: () => cleanup('user'),
      interrupt: () => {
        if (!ended) channel.send(JSON.stringify({ type: 'response.cancel' }));
      },
    };
  } catch (e) {
    cleanup('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// One message from the model. Only a few of them matter to a screen.
async function handleEvent(
  msg: Record<string, unknown>,
  channel: { send: (data: string) => void },
  onEvent: (e: LiveEvent) => void,
): Promise<void> {
  const type = String(msg.type ?? '');

  // What the user said, as the model heard it. Worth showing: mishearing is
  // the commonest reason a spoken answer is wrong, and it is invisible
  // unless the transcript is on screen.
  if (type === 'conversation.item.input_audio_transcription.completed') {
    const text = String(msg.transcript ?? '').trim();
    if (text) onEvent({ type: 'said', role: 'user', text });
    return;
  }

  if (type === 'response.output_audio_transcript.done') {
    const text = String(msg.transcript ?? '').trim();
    if (text) onEvent({ type: 'said', role: 'assistant', text });
    return;
  }

  if (type === 'input_audio_buffer.speech_started') {
    onEvent({ type: 'listening' });
    return;
  }

  // A finished response may contain calls to go and look something up.
  if (type === 'response.done') {
    const response = msg.response as { output?: unknown[] } | undefined;
    const calls = (response?.output ?? []).filter(
      (o): o is { type: string; name: string; arguments: string; call_id: string } =>
        !!o && typeof o === 'object' && (o as { type?: string }).type === 'function_call',
    );
    if (calls.length === 0) return;

    onEvent({ type: 'thinking' });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
      } catch {
        // A malformed argument list is the model's mistake to recover from;
        // an empty object lets the tool answer "nothing found" rather than
        // the conversation stalling in silence.
      }
      onEvent({ type: 'looked-up', label: call.name });

      let output: unknown;
      try {
        output = await runRealtimeTool(call.name, args);
      } catch (e) {
        // Told to the model rather than thrown away, so it can say it could
        // not look something up instead of inventing what it would have
        // found.
        output = { error: e instanceof Error ? e.message : 'Lookup failed.' };
      }

      channel.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(output),
          },
        }),
      );
    }
    // Now that it has what it asked for, let it answer.
    channel.send(JSON.stringify({ type: 'response.create' }));
  }
}
