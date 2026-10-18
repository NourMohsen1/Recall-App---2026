import {
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';

import { setAudioModeAsync } from 'expo-audio';

import { backendToken, backendUrl } from './backend';
import type { VoiceTurn } from './voiceSession';
import { createTurnTaker } from './turnTaking';
import { diag, diagCallStart, diagNow, diagText } from './liveDiag';
import { VOICE_ID, VOICE_PERSONA, type VoiceChoice } from './voicePrefs';
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
  /** What a lookup found, for the cards on screen (src/liveCards.ts). */
  | { type: 'found'; tool: string; output: unknown }
  /** 'dropped': the line went (signal, network); the screen reconnects. */
  | { type: 'ended'; reason: 'user' | 'time' | 'error' | 'dropped'; detail?: string };

export type LiveSession = {
  /** Stop talking and hang up. Safe to call twice. */
  end: () => void;
  /** Cut the model off mid-sentence without ending the call. */
  interrupt: () => void;
  /** Switch language mid-call: what it hears and what it says. */
  setLanguage: (language: LiveLanguage) => void;
};

/** The language picker on the live screen. 'auto' follows the user. */
export type LiveLanguage = 'auto' | 'ar' | 'en';

// Said to the model, and given to the transcriber as a hint. Without a
// choice it kept switching languages on Nour, so picking one pins both
// ends: the words it hears are read as that language, and it answers in
// it whatever it thinks it heard.
const LANGUAGE_RULE: Record<LiveLanguage, string> = {
  auto: 'LANGUAGE: follow the user, turn by turn, in any language they speak. Answer in the language of their latest turn, and switch the moment they switch, without comment. Arabic is Egyptian colloquial Arabic, the way people talk in Cairo, never Modern Standard Arabic unless they ask for it. When they mix Egyptian and English in one sentence ("روحت الـ gym امبارح"), answer the same way: Egyptian, with their English words kept in English, never translated. A single English word in an Arabic sentence does not make it English.',
  ar: 'LANGUAGE: always speak Egyptian colloquial Arabic, the way people talk in Cairo, never Modern Standard Arabic, whatever language you think you heard. English names and words the user uses stay as they say them.',
  en: 'LANGUAGE: always speak English, whatever language you think you heard. Names keep their own spelling and sound.',
};

// When the user has finished speaking. Measured, not assumed (Oct 2026):
// recordings of Egyptian, English and mixed questions with natural pauses
// of 0.6 to 0.9 s, streamed to the model in real time, counting answers
// that started mid-sentence. Each false start is heard on the phone as
// Recall starting to talk and going quiet again.
//   OpenAI's default (silence 500 ms):  9 false starts in 4 recordings
//   semantic_vad, medium:               8, and twice no answer at all
//   semantic_vad, low:                  4, and twice no answer at all
//   silence 800 ms:                     0, answering 1.1–1.4 s after the end
// 1000 ms was no better and 0.2 s slower. A thinking pause longer than this
// still ends a turn; the instructions handle that ("mm?", and let them go on).
const TURN_DETECTION = {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 800,
  // The app starts every answer itself (src/turnTaking.ts): an "آه" over
  // Recall must get none, and two starters raced.
  create_response: false,
  // Off: OpenAI's own interruption stopped Recall at any sound — a "آه", a
  // cough, the TV. The app decides instead, from the words
  // (src/turnTaking.ts), and cuts Recall off itself when they are real.
  interrupt_response: false,
} as const;

/** The session as the model gets it. Exported for the test harness. */
export function sessionSettings(language: LiveLanguage, bootstrap: string, voice: VoiceChoice = 'female') {
  return {
    type: 'realtime',
    instructions: `${VOICE_INSTRUCTIONS}\n\n${VOICE_PERSONA[voice]}\n\n${LANGUAGE_RULE[language]}\n\n${bootstrap}`,
    audio: {
      // Set before Recall says a word: OpenAI can't change a voice after
      // that, so a new choice mid-call reconnects (app/live.tsx).
      output: { voice: VOICE_ID[voice] },
      input: {
        turn_detection: TURN_DETECTION,
        // The phone is on the loudspeaker, held away (routeToSpeaker), so
        // far-field: room noise and the speaker's own sound are less often
        // taken for the user starting to talk.
        noise_reduction: { type: 'far_field' },
        // Without this the model HEARS the user but never writes down what
        // they said, so only its own half of the conversation could be saved
        // or shown. Mishearing is the commonest reason a spoken answer is
        // wrong, and out loud there is no telling a misheard question from a
        // bad answer unless both are on screen. A chosen language is a hint
        // to it (accepted as "languages": ["ar"], checked against OpenAI).
        transcription: {
          model: 'gpt-live-transcribe',
          // What it will hear, so a mixed sentence isn't forced into one
          // language on screen. Only a hint; the model hears the audio.
          // Measured on 9 recordings (Egyptian, mixed, English, French):
          // 7.6% of characters wrong with no hint, 6.9% with "Egyptian and
          // English mixed", 5.7% with this one, English and French unharmed.
          prompt:
            'The speaker is usually Egyptian and speaks Egyptian Arabic, written in Arabic script, with some English words such as gym, meeting or project written in English. They may also speak English or another language.',
          ...(language === 'auto' ? {} : { language }),
        },
      },
    },
  };
}

export function liveVoiceAvailable(): boolean {
  return !!backendUrl('/') && !!backendToken();
}

// What the user is told when OpenAI says no. "OpenAI refused the
// connection (429)" reached a tester and meant nothing to him: it was the
// OpenAI account running out of credit. The code and OpenAI's own reason
// go to the log; the screen gets a sentence.
async function refusal(res: Response, step: string): Promise<Error> {
  let code = '';
  let message = '';
  try {
    const body = (await res.json()) as { error?: { code?: string; type?: string; message?: string } };
    code = body.error?.code || body.error?.type || '';
    message = body.error?.message ?? '';
  } catch {
    // Not JSON: the status is all there is.
  }
  console.warn(`[live] ${step} refused: HTTP ${res.status} ${code} ${message.slice(0, 160)}`);
  if (code === 'insufficient_quota' || code === 'credit_balance_exhausted') {
    return new Error('Live voice is unavailable right now. Please try again later.');
  }
  if (res.status === 429) return new Error('Live voice is busy right now. Try again in a minute.');
  return new Error(`Could not start the conversation (${res.status}). Try again in a moment.`);
}

async function mintToken(): Promise<string> {
  const url = backendUrl('/realtime/token');
  const token = backendToken();
  if (!url || !token) throw new Error('Live voice is not set up.');

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await refusal(res, 'key');
  const json = (await res.json()) as { value?: string };
  if (!json.value) throw new Error('No key came back for the conversation.');
  return json.value;
}

// Out loud, through the phone's speaker. WebRTC sets the phone up for a
// call, and a call plays through the earpiece at the top of the screen, so
// Recall sounded like it was whispering unless the phone was held to the
// ear (Nour). "Default to speaker" keeps recording on and still prefers
// headphones or Bluetooth when they are connected; echo is still taken
// care of by WebRTC's voice processing, which does not depend on this.
//
// Applied when the call connects and again when the voice starts: WebRTC
// configures the audio session itself as the call comes up, and whatever
// it set last would win.
async function routeToSpeaker(when: string): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: 'doNotMix',
    });
    console.log(`[live] audio through the speaker (${when})`);
  } catch (e) {
    console.warn('[live] could not move the audio to the speaker:', e);
  }
}

/** A call picked up again after the line dropped: what was said so far,
 *  given back to the new session so it carries on rather than starting
 *  over, and how much of the ten minutes is left. */
export type Resume = { turns: VoiceTurn[]; remainingMs: number };

// The last few exchanges are enough to carry on; the whole call would only
// cost more on every answer.
const RESUME_TURNS = 20;

export async function startLiveVoice(
  onEvent: (e: LiveEvent) => void,
  initialLanguage: LiveLanguage = 'auto',
  resume?: Resume,
  voice: VoiceChoice = 'female',
): Promise<LiveSession> {
  let language = initialLanguage;
  onEvent({ type: 'connecting' });
  diagCallStart({ transport: 'webrtc', voice, language, resumed: !!resume, turn_detection: TURN_DETECTION.type, silence_ms: TURN_DETECTION.silence_duration_ms, create_response: TURN_DETECTION.create_response, interrupt_response: TURN_DETECTION.interrupt_response });

  const key = await mintToken();
  const bootstrap = await buildVoiceBootstrap();

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  let mic: MediaStream | null = null;
  let ended = false;
  let warnTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  const state = { responding: false, speaking: false, userTookTurn: () => false, takeYielded: () => false };
  // Recall's voice, as the phone receives it: turned down while the user
  // starts to speak over it (src/turnTaking.ts).
  let voiceTrack: { _setVolume?: (v: number) => void } | null = null;
  let send: (event: Record<string, unknown>) => void = () => {};
  const turns = createTurnTaker({
    send: (e) => send(e),
    setVolume: (v) => {
      // Diagnostics: the app ASKED for this volume. Whether the sound changed
      // is not shown by this line (see the "level" lines).
      const track = voiceTrack as { id?: string; _setVolume?: unknown } | null;
      let result = 'no track';
      try {
        if (track && typeof track._setVolume === 'function') result = 'called';
        else if (track) result = 'track has no _setVolume';
        voiceTrack?._setVolume?.(v);
      } catch (err) {
        result = `threw ${String(err).slice(0, 80)}`;
        console.warn('[live] could not set the voice volume:', err);
      }
      diag('APP', 'volume set', { value: v, track_present: !!track, track_id: track?.id, result });
    },
    log: (line) => console.log(line),
    trace: (event, data) => diag('APP', event, data),
  });
  state.userTookTurn = () => turns.userTookTurn();
  state.takeYielded = () => turns.takeYielded();

  const cleanup = (reason: 'user' | 'time' | 'error' | 'dropped', detail?: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(warnTimer);
    clearTimeout(endTimer);
    clearTimeout(dropTimer);
    clearInterval(levelTimer);
    diag('APP', 'call ended', { reason });
    mic?.getTracks().forEach((t) => t.stop());
    try {
      pc.close();
    } catch {
      // Already closed.
    }
    // Back to plain playback, so the next sound in the app isn't a call.
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    onEvent({ type: 'ended', reason, detail });
  };

  try {
    // The microphone. Asked for before anything is sent, so a refusal costs
    // nothing and is not discovered halfway through connecting.
    mic = (await mediaDevices.getUserMedia({ audio: true })) as MediaStream;
    mic.getTracks().forEach((track) => pc.addTrack(track, mic as MediaStream));

    // The model's voice arrives as an ordinary remote track; react-native-webrtc
    // plays it through the phone's audio session without anything further.
    let voiceRouted = false;
    // (The track arrives once, when the call connects, not when Recall
    // talks: "speaking" comes from output_audio_buffer.started instead.
    // Taken from here, the screen showed "speaking" while it listened, and
    // a tap meant to cut it off hung up.)
    (pc as unknown as { ontrack: (e: { track?: unknown }) => void }).ontrack = (e) => {
      const t = e?.track as { id?: string; kind?: string; remote?: boolean } | undefined;
      diag('OBS', 'webrtc track', { present: !!t, kind: t?.kind, id: t?.id, remote: t?.remote, replaces_previous: !!voiceTrack });
      if (e?.track) voiceTrack = e.track as typeof voiceTrack;
      if (!voiceRouted) {
        voiceRouted = true;
        void routeToSpeaker('voice arrived');
      }
    };
    (pc as unknown as { onconnectionstatechange: () => void }).onconnectionstatechange = () => {
      const now = (pc as unknown as { connectionState?: string }).connectionState;
      console.log(`[live] connection ${now}`);
      diag('OBS', 'webrtc connection', { state: now });
      if (now === 'connected') {
        clearTimeout(dropTimer);
        void routeToSpeaker('connected');
        // Once more after the audio has settled, in case WebRTC set the
        // session again while starting the audio.
        setTimeout(() => {
          if (!ended) void routeToSpeaker('settled');
        }, 1500);
      } else if (now === 'failed') {
        cleanup('dropped', 'The line dropped.');
      } else if (now === 'disconnected') {
        // Often back by itself within a second or two (a Wi-Fi to 4G hand
        // over). Gone for longer, the screen reconnects with what was said.
        clearTimeout(dropTimer);
        dropTimer = setTimeout(() => cleanup('dropped', 'The line dropped.'), 4000);
      }
    };

    const channel = pc.createDataChannel('oai-events');
    // Diagnostics: every command leaves through here, from any part of the
    // app (turn-taking, lookups, the orb). Logged, then sent as before.
    const rawSend = channel.send.bind(channel);
    (channel as { send: (data: string) => void }).send = (data: string) => {
      diagCommand(data);
      rawSend(data);
    };
    send = (e) => {
      if (!ended) channel.send(JSON.stringify(e));
    };

    channel.onopen = () => {
      // Everything the model needs to know, sent once. The instructions and
      // tools are the same ones the typed version uses.
      channel.send(
        JSON.stringify({
          type: 'session.update',
          session: { ...sessionSettings(language, bootstrap, voice), tools: REALTIME_TOOLS, tool_choice: 'auto' },
        }),
      );
      // Picking up a dropped call: the conversation so far, as plain text
      // turns, so "and what about her?" still means who it meant. Nothing
      // is said until the user speaks.
      if (resume?.turns.length) {
        for (const t of resume.turns.slice(-RESUME_TURNS)) {
          channel.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: t.role,
                content: [{ type: t.role === 'user' ? 'input_text' : 'output_text', text: t.text }],
              },
            }),
          );
        }
        console.log(`[live] picked up again with ${Math.min(resume.turns.length, RESUME_TURNS)} turns`);
      }
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
      diagObserved(msg);
      turns.onEvent(msg);
      void handleEvent(msg, channel, onEvent, state);
    };

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);

    const answer = await fetch(SDP_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!answer.ok) throw await refusal(answer, 'call');
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: await answer.text() }),
    );
    levelTimer = startLevelSampling(pc, () => ended);

    // The cap. A spoken warning first, because a call that simply stops
    // feels like a fault rather than a limit.
    const total = resume ? Math.max(resume.remainingMs, 30_000) : MAX_SESSION_MS;
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
    }, Math.max(total - (MAX_SESSION_MS - WARN_AT_MS), 0));
    endTimer = setTimeout(() => cleanup('time'), total);

    return {
      end: () => cleanup('user'),
      interrupt: () => {
        if (ended) return;
        turns.reset();
        // Stop thinking, and stop the sound already on its way: over
        // WebRTC the model sends audio ahead of playback, and cancelling
        // alone let a second or two of it play on.
        channel.send(JSON.stringify({ type: 'response.cancel' }));
        channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
      },
      setLanguage: (next) => {
        if (ended || next === language) return;
        language = next;
        // Everything but the voice, which can't change once Recall has spoken.
        const { audio, ...rest } = sessionSettings(next, bootstrap, voice);
        channel.send(JSON.stringify({ type: 'session.update', session: { ...rest, audio: { input: audio.input } } }));
        console.log(`[live] language now ${next}`);
      },
    };
  } catch (e) {
    cleanup('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ── Diagnostics (src/liveDiag.ts): observation only ───────────────────

// The OpenAI events worth timing, with only what matters about each.
let lastSpeechStartedAt = -1;
let lastSpeechStoppedAt = -1;
let firstWordsOfResponse = new Set<string>();
let diagAudible = false;

function diagObserved(msg: Record<string, unknown>): void {
  const type = String(msg.type ?? '');
  const t = diagNow();
  const since = (at: number) => (at >= 0 ? t - at : undefined);
  switch (type) {
    case 'input_audio_buffer.speech_started':
      lastSpeechStartedAt = t;
      diag('OBS', type, { item: msg.item_id, audio_start_ms: msg.audio_start_ms, recall_audible: diagAudible });
      return;
    case 'input_audio_buffer.speech_stopped':
      lastSpeechStoppedAt = t;
      diag('OBS', type, { item: msg.item_id, audio_end_ms: msg.audio_end_ms, ms_since_speech_started: since(lastSpeechStartedAt) });
      return;
    case 'input_audio_buffer.committed':
      diag('OBS', type, { item: msg.item_id, ms_since_speech_stopped: since(lastSpeechStoppedAt) });
      return;
    case 'conversation.item.input_audio_transcription.delta':
      diag('OBS', 'transcript delta', { item: msg.item_id, chars: String(msg.delta ?? '').length, ms_since_speech_started: since(lastSpeechStartedAt) });
      return;
    case 'conversation.item.input_audio_transcription.completed':
      diag('OBS', 'transcript completed', { item: msg.item_id, text: diagText(String(msg.transcript ?? ''), false), ms_since_speech_stopped: since(lastSpeechStoppedAt) });
      return;
    case 'output_audio_buffer.started':
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      diagAudible = type === 'output_audio_buffer.started';
      diag('OBS', type, { response: msg.response_id });
      return;
    case 'response.created': {
      const r = msg.response as { id?: string } | undefined;
      diag('OBS', type, { response: r?.id });
      return;
    }
    case 'response.done': {
      const r = msg.response as { id?: string; status?: string; status_details?: { reason?: string } } | undefined;
      diag('OBS', type, { response: r?.id, status: r?.status, reason: r?.status_details?.reason });
      return;
    }
    case 'response.output_audio_transcript.delta': {
      const id = String(msg.response_id ?? '');
      if (firstWordsOfResponse.has(id)) return;
      firstWordsOfResponse.add(id);
      diag('OBS', 'first words of response (transcript)', { response: id, ms_since_speech_stopped: since(lastSpeechStoppedAt) });
      return;
    }
    case 'conversation.item.deleted':
    case 'conversation.item.truncated':
      diag('OBS', type, { item: msg.item_id, audio_end_ms: msg.audio_end_ms });
      return;
    case 'error': {
      const e = msg.error as { code?: string; type?: string } | undefined;
      diag('OBS', 'error', { code: e?.code ?? e?.type });
      return;
    }
  }
}

function diagCommand(data: string): void {
  try {
    const e = JSON.parse(data) as { type?: string; item?: { type?: string; role?: string }; item_id?: string; response?: { instructions?: string } };
    if (e.type === 'input_audio_buffer.append') return;
    diag('CMD', String(e.type), {
      item: e.item?.type ? `${e.item.type}${e.item.role ? `/${e.item.role}` : ''}` : undefined,
      item_id: e.item_id,
      with_instructions: e.response?.instructions ? true : undefined,
    });
  } catch {
    diag('CMD', 'unparsed');
  }
}

// WebRTC's own measure of Recall's received audio (inbound-rtp audioLevel,
// and the level worked out from totalAudioEnergy over each interval). Every
// 100 ms for 3 s after the user starts speaking over Recall; every 500 ms
// otherwise while Recall is audible. What it is NOT: the sound in the room.
// It is the decoded stream inside WebRTC; whether the app's volume setting
// is applied before this measure depends on WebRTC internals, and the
// iPhone's own volume and speaker come after it. A drop here when the app
// ducks is evidence the setting reached the stream; no drop is evidence it
// didn't; neither proves what the ear heard.
function startLevelSampling(pc: RTCPeerConnection, ended: () => boolean): ReturnType<typeof setInterval> {
  let busy = false;
  let tick = 0;
  let lastEnergy: number | undefined;
  let lastDuration: number | undefined;
  firstWordsOfResponse = new Set();
  lastSpeechStartedAt = -1;
  lastSpeechStoppedAt = -1;
  diagAudible = false;
  return setInterval(() => {
    tick += 1;
    if (ended() || busy || !diagAudible) return;
    const t = diagNow();
    const nearOverlap = lastSpeechStartedAt >= 0 && t - lastSpeechStartedAt < 3000;
    if (!nearOverlap && tick % 5 !== 0) return;
    busy = true;
    (pc as unknown as { getStats: () => Promise<Map<string, Record<string, unknown>>> })
      .getStats()
      .then((report) => {
        report.forEach((s) => {
          if (s.type !== 'inbound-rtp' || s.kind !== 'audio') return;
          const energy = typeof s.totalAudioEnergy === 'number' ? s.totalAudioEnergy : undefined;
          const duration = typeof s.totalSamplesDuration === 'number' ? s.totalSamplesDuration : undefined;
          let interval: number | undefined;
          if (energy !== undefined && duration !== undefined && lastEnergy !== undefined && lastDuration !== undefined && duration > lastDuration) {
            interval = Math.sqrt((energy - lastEnergy) / (duration - lastDuration));
          }
          lastEnergy = energy;
          lastDuration = duration;
          diag('OBS', 'level', {
            audioLevel: typeof s.audioLevel === 'number' ? Number(s.audioLevel.toFixed(3)) : undefined,
            interval_level: interval !== undefined ? Number(interval.toFixed(3)) : undefined,
            near_overlap: nearOverlap,
          });
        });
      })
      .catch(() => diag('OBS', 'level unavailable'))
      .finally(() => {
        busy = false;
      });
  }, 100);
}

// What each lookup is called on screen ("It searched your memories, then
// opened the day."). The tool names themselves used to show.
const TOOL_WORDS: Record<string, string> = {
  search_memories: 'searched your memories',
  get_day: 'opened the day',
  find_person: 'looked them up',
  find_place: 'looked up the place',
  list_people: 'went through your people',
  list_tasks: 'checked your tasks',
  recent_days: 'went through your recent days',
  get_period: 'went through that time',
  days_with_person: 'found your days together',
  remember_preference: 'noted how you like to talk',
  forget_preference: 'forgot that',
};

// One message from the model. Only a few of them matter to a screen.
async function handleEvent(
  msg: Record<string, unknown>,
  channel: { send: (data: string) => void },
  onEvent: (e: LiveEvent) => void,
  state: { responding: boolean; speaking: boolean; userTookTurn: () => boolean; takeYielded: () => boolean },
): Promise<void> {
  const type = String(msg.type ?? '');

  // Whose turn it is, from what is actually happening: Recall's voice
  // starting and stopping on the phone, the user starting and stopping.
  if (type === 'output_audio_buffer.started') {
    state.speaking = true;
    onEvent({ type: 'speaking' });
    return;
  }
  // A safety net: the first words of an answer mean it is speaking, should
  // the playback event above ever not arrive.
  if (type === 'response.output_audio_transcript.delta') {
    if (!state.speaking) {
      state.speaking = true;
      onEvent({ type: 'speaking' });
    }
    return;
  }
  if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared') {
    state.speaking = false;
    onEvent({ type: 'listening' });
    return;
  }
  if (type === 'input_audio_buffer.speech_stopped') {
    onEvent({ type: 'thinking' });
    return;
  }
  if (type === 'response.created') {
    state.responding = true;
    return;
  }

  // Said out loud by nobody, but the only way to see why a call went wrong.
  if (type === 'error') {
    const err = msg.error as { code?: string; message?: string } | undefined;
    // Cancelling when nothing is playing is harmless and common.
    if (err?.code === 'response_cancel_not_active') return;
    console.warn(`[live] error from OpenAI: ${err?.code ?? ''} ${(err?.message ?? '').slice(0, 200)}`);
    return;
  }

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
    // Over Recall's voice it may only be an "آه" (src/turnTaking.ts): the
    // screen changes only if Recall is actually cut off.
    if (state.speaking) return;
    onEvent({ type: 'listening' });
    return;
  }

  // A finished response may contain calls to go and look something up.
  if (type === 'response.done') {
    state.responding = false;
    const response = msg.response as { output?: unknown[]; status?: string } | undefined;
    if (response?.status === 'cancelled') console.log('[live] answer cut off (the user spoke)');
    // Cancelled because the user went on talking before it played (Fix 2,
    // src/turnTaking.ts): its lookups are dropped, or their answer to the
    // old question would play over them. Their finished turn is answered
    // when it ends.
    if (response?.status === 'cancelled' && state.takeYielded()) {
      diag('APP', 'yield: lookups of the cancelled answer dropped');
      return;
    }
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
      onEvent({ type: 'looked-up', label: TOOL_WORDS[call.name] ?? 'looked something up' });

      let output: unknown;
      try {
        output = await runRealtimeTool(call.name, args);
      } catch (e) {
        // Told to the model rather than thrown away, so it can say it could
        // not look something up instead of inventing what it would have
        // found.
        output = { error: e instanceof Error ? e.message : 'Lookup failed.' };
      }
      onEvent({ type: 'found', tool: call.name, output });

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
    // Now that it has what it asked for, let it answer: unless the user
    // has already started something new, which the answer under way will
    // cover. Asking for a second one then was refused, or answered twice.
    if (state.responding || state.userTookTurn()) {
      console.log('[live] the user moved on during the lookup; not answering the old question');
      return;
    }
    // It has already said its "one sec" before the first lookup. Told
    // here, at the one moment it would otherwise say another: measured, it
    // said a second filler ("ok, going through the days now…") before a
    // second lookup about half the time, which is what sounded scripted.
    channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'You already said your short filler for this question. Now either answer, or call another tool without saying anything first.' }],
        },
      }),
    );
    channel.send(JSON.stringify({ type: 'response.create' }));
  }
}
