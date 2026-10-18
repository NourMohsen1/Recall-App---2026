// What talking over Recall means (Oct 2026).
//
// Before this, any sound while Recall spoke cut it off: OpenAI's own
// interruption stops the answer the moment its detector hears speech, so a
// "آه", a cough or a TV in the next room ended the sentence (Nour, from real
// use). People don't talk like that. A listener's "mm" or "تمام" says "go
// on"; only real words take the turn.
//
// So the app decides, in two steps, and OpenAI's automatic interruption is
// off (interrupt_response: false in realtimeVoice.ts):
//
//   1. The moment the user makes a sound while Recall is speaking, Recall
//      gets quieter (DUCKED) — what a person does when someone starts to
//      talk: yield a little, listen. Within a fraction of a second.
//   2. The live transcriber sends the user's words while they are still
//      talking (measured: the first word about 1.1–1.3 s after they start).
//      A backchannel ("آه", "ممم، تمام", "yeah") brings the voice back up
//      and Recall carries on. "لا", "استنى", "wait", or any real sentence
//      stops Recall and the turn is theirs. A sound with no words at all
//      (a cough, a door) is let go.
//
// What it can't do: tell whose voice it is. A TV saying real words, close
// enough to be heard, counts as someone talking (see LIMITS in the report).
//
// Transport-free: it reads OpenAI's events and answers with events to send
// and a volume to set, so the same code runs in the app and in the voice
// lab (tools/voice-lab).

export type TurnTakingIO = {
  /** Send a client event to OpenAI. */
  send: (event: Record<string, unknown>) => void;
  /** Recall's voice volume, 1 = normal. */
  setVolume: (volume: number) => void;
  log: (line: string) => void;
  /** Diagnostics only (src/liveDiag.ts): reports decisions and state, and
   *  must never change them. */
  trace?: (event: string, data?: Record<string, unknown>) => void;
};

/** How quiet Recall gets while it works out what the user is doing. */
export const DUCKED = 0.3;

// Words that only say "I'm listening". A turn made only of these, said while
// Recall is speaking, is not a turn.
const BACKCHANNEL = new Set([
  // Egyptian
  'اه', 'ااه', 'اها', 'اهاا', 'ايوه', 'ايوا', 'ايو', 'ام', 'مم', 'ممم', 'مممم', 'هم', 'همم', 'هممم',
  'تمام', 'ماشي', 'اوكي', 'اوك', 'صح', 'بالظبط', 'بالضبط', 'فعلا', 'معاك', 'معاكي', 'فاهم', 'فاهمه',
  'فاهمك', 'فاهماك', 'فاهمة', 'اكيد', 'طبعا', 'يا', 'سلام', 'والله', 'حلو', 'جميل', 'اشطا', 'عارف', 'عارفه',
  // English
  'ah', 'aha', 'ahh', 'oh', 'uh', 'huh', 'mm', 'mmm', 'mmmm', 'hmm', 'hm', 'mhm', 'mmhm', 'um', 'uhhuh',
  'yeah', 'yea', 'yes', 'yep', 'yup', 'ok', 'okay', 'right', 'sure', 'got', 'it', 'i', 'see', 'cool',
  'nice', 'wow', 'true', 'exactly', 'totally', 'alright',
]);
// Words that mean "stop, my turn", even alone. Decided on the first one.
const YIELD = new Set([
  'لا', 'استني', 'استنا', 'لحظه', 'ثانيه', 'تانيه', 'بس', 'اسكت', 'اسكتي', 'كفايه', 'خلاص', 'هي', 'يعني', 'طب', 'طيب',
  'wait', 'stop', 'hold', 'no', 'nope', 'hang', 'hey', 'actually', 'but', 'sorry', 'excuse',
]);
// A backchannel is short. Five words of "yeah, right, ok, sure, cool" is
// someone about to say something.
const MAX_BACKCHANNEL_WORDS = 4;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // harakat, tatweel
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/(.)\1{2,}/g, '$1$1') // "آآآآه" → "اه"-ish, "mmmmm" → "mm"
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export type Verdict = 'backchannel' | 'interrupt' | 'unsure';

/** What the words so far say about the user's intent. Exported for tests. */
export function judge(text: string, final: boolean): Verdict {
  const w = words(text);
  if (w.length === 0) return final ? 'backchannel' : 'unsure'; // a sound with no words
  if (w.some((x) => YIELD.has(x))) return 'interrupt';
  const isBack = (x: string) => BACKCHANNEL.has(x) || /^(ا+ه+|م+|ه+م+|a+h+|m+h*m*|h+m+|u+h+)$/.test(x);
  if (w.length > MAX_BACKCHANNEL_WORDS || !w.every(isBack)) return 'interrupt';
  return final ? 'backchannel' : 'unsure';
}

type Overlap = {
  itemId: string;
  text: string;
  verdict: Verdict;
  startedAt: number;
};

export function createTurnTaker(io: TurnTakingIO) {
  const trace = io.trace ?? (() => {});
  /** Recall's voice is playing on the phone right now. */
  let audible = false;
  /** OpenAI is still writing an answer. */
  let responding = false;
  /** The user's current turn, when it began while Recall was speaking. */
  let overlap: Overlap | null = null;
  /** A turn found to be only a backchannel: the answer OpenAI starts for it
   *  is cancelled before it makes a sound. */
  /** The user finished a real turn while an answer was still being
   *  written: theirs is started as soon as that one is done. */
  let answerOwed = false;
  /** A real user turn is waiting for its answer (an "آه" never is). */
  let userTurnWaiting = false;
  /** An answer was cancelled because the user went on talking before it
   *  played (the yield below): any lookup it asked for is dropped too. */
  let yielded = false;
  /** An answer was asked for and OpenAI hasn't confirmed it yet. (Gap A:
   *  speech in that ~100 ms window used to slip past the yield.) */
  let requested = false;
  /** The user spoke inside that window: cancel the answer as it arrives. */
  let yieldOnCreate = false;
  /** The user is speaking now (speech started, not yet stopped). */
  let userSpeaking = false;
  /** A waiting answer held back because the user was speaking (Gap B). If
   *  their speech gets no answer of its own (an "آه", a cough), it is sent
   *  when that speech ends, so the earlier question is never lost. */
  let owedHeld = false;

  // The app starts every answer (create_response: false in
  // realtimeVoice.ts). With OpenAI also starting them, an "آه" said during
  // a lookup raced the lookup's own answer: the reply came back as "nothing
  // found", measured in 5 of 6 overlaps.
  const answer = () => {
    owedHeld = false;
    userTurnWaiting = true;
    if (responding) {
      answerOwed = true;
      trace('answer owed (a response is still active)');
      return;
    }
    trace('answer now');
    requested = true;
    io.send({ type: 'response.create' });
  };

  const cut = (why: string) => {
    if (!overlap || overlap.verdict === 'interrupt') return;
    overlap.verdict = 'interrupt';
    io.log(`[live] interrupted (${why}) after ${Date.now() - overlap.startedAt} ms`);
    trace('cut', { why, ms_since_overlap_start: Date.now() - overlap.startedAt, responding, audible });
    if (responding) io.send({ type: 'response.cancel' });
    // Drops what was queued to play and trims the conversation to what was
    // heard (OpenAI docs: WebRTC output_audio_buffer.clear).
    io.send({ type: 'output_audio_buffer.clear' });
    io.setVolume(1);
  };

  const letGo = (why: string) => {
    if (!overlap) return;
    overlap.verdict = 'backchannel';
    io.log(`[live] kept talking (${why}: "${overlap.text.trim()}")`);
    trace('let go', { why, ms_since_overlap_start: Date.now() - overlap.startedAt });
    io.setVolume(1);
  };

  return {
    /** Every event from OpenAI passes through here. */
    onEvent(msg: Record<string, unknown>) {
      const type = String(msg.type ?? '');
      const itemId = String(msg.item_id ?? '');

      switch (type) {
        case 'output_audio_buffer.started':
          trace('state audible', { from: audible, to: true });
          audible = true;
          return;
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
          trace('state audible', { from: audible, to: false, by: type });
          audible = false;
          io.setVolume(1);
          return;
        case 'response.created': {
          trace('state responding', { from: responding, to: true });
          responding = true;
          userTurnWaiting = false;
          requested = false;
          // A yield whose answer finished before the cancel landed leaves
          // nothing to drop; it must not mark a later answer.
          yielded = false;
          // Gap A: the user started speaking after this answer was asked for
          // but before OpenAI confirmed it (seen on Nour's phone: 15 ms
          // after, and it then played over him for ~1.8 s). Cancelled now,
          // as the yield does for an answer already confirmed.
          if (yieldOnCreate) {
            yieldOnCreate = false;
      owedHeld = false;
            trace('yield: cancel the answer as it is confirmed (user resumed before)');
            yielded = true;
            io.send({ type: 'response.cancel' });
            io.send({ type: 'output_audio_buffer.clear' });
          }
          return;
        }
        case 'response.done':
          trace('state responding', { from: responding, to: false, answer_owed: answerOwed });
          responding = false;
          if (answerOwed) {
            answerOwed = false;
            // Gap B: never start the waiting answer while the user is
            // speaking (seen on Nour's phone: it started 80 ms after his
            // next sentence began). The end of that sentence answers, and
            // the answer covers everything they said.
            if (userSpeaking) {
              trace('owed answer held: the user is speaking; their turn end answers it');
              owedHeld = true;
              return;
            }
            requested = true;
            io.send({ type: 'response.create' });
          }
          return;

        case 'input_audio_buffer.speech_stopped':
          userSpeaking = false;
          return;

        case 'input_audio_buffer.speech_started':
          userSpeaking = true;
          if (!audible) {
            trace('speech start: ordinary turn (not audible, no duck)', { item: itemId, responding });
            overlap = null; // An ordinary turn: Recall is quiet.
            // The user went on talking after a pause, and an answer to the
            // first half is already being written but not yet playing. Left
            // alone, it started playing over them: OpenAI only cuts audio
            // that is already playing (measured on Nour's phone, Oct 2026:
            // twice in one call, ~2 s each). The half-written answer goes,
            // with anything of it already on its way; the turn they are now
            // finishing is answered when it ends, as every turn is.
            if (responding) {
              trace('yield: cancel the answer not yet playing (user resumed)', { item: itemId });
              yielded = true;
              io.send({ type: 'response.cancel' });
              io.send({ type: 'output_audio_buffer.clear' });
            } else if (requested) {
              trace('yield pending: answer asked for, not yet confirmed (user resumed)', { item: itemId });
              yieldOnCreate = true;
            }
            return;
          }
          overlap = { itemId, text: '', verdict: 'unsure', startedAt: Date.now() };
          trace('speech start: overlap, duck', { item: itemId, responding });
          io.setVolume(DUCKED);
          return;

        case 'conversation.item.input_audio_transcription.delta':
          if (!overlap || overlap.itemId !== itemId || overlap.verdict !== 'unsure') return;
          overlap.text += String(msg.delta ?? '');
          trace('overlap words so far', { words: overlap.text.trim().slice(0, 40), verdict: judge(overlap.text, false), ms_since_overlap_start: Date.now() - overlap.startedAt });
          if (judge(overlap.text, false) === 'interrupt') cut(`"${overlap.text.trim()}"`);
          return;

        case 'input_audio_buffer.committed': {
          // An ordinary turn, Recall quiet: answer it.
          if (!overlap || overlap.itemId !== itemId) {
            trace('committed: ordinary turn', { item: itemId });
            answer();
            return;
          }
          trace('committed: overlap turn', { item: itemId, verdict_before: overlap.verdict, words: overlap.text.trim().slice(0, 40), ms_since_overlap_start: Date.now() - overlap.startedAt });
          if (overlap.verdict === 'unsure') {
            if (judge(overlap.text, true) === 'interrupt') cut(`"${overlap.text.trim()}" at the end`);
            else letGo(overlap.text.trim() ? 'a backchannel' : 'no words');
          }
          // A backchannel gets no answer; real words do.
          if (overlap.verdict === 'interrupt') answer();
          else if (owedHeld) {
            trace('held answer sent: the speech that held it needed no answer of its own');
            answer();
          }
          return;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          // The full words, sometimes after the turn has ended. A turn let go
          // as wordless that turns out to have said "stop" is taken back;
          // a real backchannel leaves the conversation, so the model never
          // later reads "آه" as something it was asked.
          if (!overlap || overlap.itemId !== itemId || overlap.verdict !== 'backchannel') return;
          const text = String(msg.transcript ?? '');
          trace('final words of a let-go turn', { words: text.trim().slice(0, 40), verdict: judge(text, true) });
          if (judge(text, true) === 'interrupt') {
            overlap.verdict = 'unsure';
            overlap.text = text;
            cut(`"${text.trim()}" (late)`);
            answer();
          } else {
            io.send({ type: 'conversation.item.delete', item_id: itemId });
          }
          overlap = null;
          return;
        }
      }
    },
    /** The user has started a turn the app will answer: a lookup that was
     *  running for the previous question shouldn't answer that one too. */
    userTookTurn(): boolean {
      return userTurnWaiting;
    },
    /** The user is speaking right now: a lookup's reply must wait for the
     *  end of their turn (Gap B, the same rule as a waiting answer). */
    userSpeakingNow(): boolean {
      return userSpeaking;
    },
    /** A lookup's reply held back because the user is speaking
     *  (realtimeVoice.ts): sent when their speech ends if it needed no
     *  answer of its own, like a held waiting answer (Gap B). */
    holdAnswer(): void {
      trace('lookup reply held: the user is speaking; their turn end answers it');
      owedHeld = true;
    },
    /** A lookup's reply was asked for (realtimeVoice.ts): speech before
     *  OpenAI confirms it cancels it, as for any answer (Gap A). */
    noteAnswerRequested(): void {
      requested = true;
    },
    /** True once per yield: the cancelled answer's lookups must not run (and
     *  then answer the old question over the user). Reading it clears it. */
    takeYielded(): boolean {
      const was = yielded;
      yielded = false;
      return was;
    },
    /** Recall is about to be cut off by a tap: the same as words. */
    reset() {
      trace('reset (orb tapped)');
      overlap = null;
      answerOwed = false;
      userTurnWaiting = false;
      yieldOnCreate = false;
      io.setVolume(1);
    },
  };
}
