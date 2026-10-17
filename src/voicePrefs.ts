import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VoiceTurn } from './voiceSession';

// How the user likes live voice to talk to them, remembered between calls
// (Oct 2026): the voice they picked, what they asked for in so many words
// ("always answer in English", "keep it short"), and a style learned
// quietly from how they talk.
//
// What it is NOT: a memory of their life. Facts about their days are logged
// with the + and live in their memories; this only shapes HOW Recall talks.
// No sentence they said is kept, only counts; nothing sensitive is asked
// for or stored; no audio. It lives on the phone with every other memory
// of theirs, so it is theirs alone, backed up with the phone, and never
// sent anywhere except as a few lines in the call's instructions.
//
// A style is only described once it has held for about three calls, and old
// calls fade (DECAY), so one odd day doesn't become "who they are" and a
// change in how they talk is followed.

export type VoiceChoice = 'female' | 'male';

/** OpenAI's voice for each choice. marin (female) was already Recall's
 *  voice and is OpenAI's recommended one. Male was ash (138 Hz, the
 *  plainest male pitch); Nour found it unpleasant and asked for ChatGPT's
 *  "Ember", which the API doesn't offer (it refuses it; ten voices only,
 *  Oct 2026). cedar is the nearest: OpenAI's newest, recommended alongside
 *  marin as the most natural, and as clear in Egyptian (1.3% error). */
export const VOICE_ID: Record<VoiceChoice, string> = { female: 'marin', male: 'cedar' };

/** How Recall speaks of itself in Arabic, which marks gender: a woman's
 *  voice saying "مش متأكد" sounds wrong to anyone who speaks it. */
const ADDRESS_THEM =
  'This is about YOU only, not them. Talk to the user in the gender they use for themselves ("أنا تعبانة" → feminine, "أنا تعبان" → masculine); until they have shown it, use the everyday masculine form Egyptians use when it is not known ("قابلته"، "روحت"، "قولّي"), never feminine forms by default.';

export const VOICE_PERSONA: Record<VoiceChoice, string> = {
  female: `YOUR VOICE IS A WOMAN'S. In Arabic, speak of yourself as a woman: "أنا مش متأكدة"، "أنا شايفة"، "مش لاقية"، "مش فاكرة". When they say "تقدري" or "إنتي", they are talking to you. ${ADDRESS_THEM}`,
  male: `YOUR VOICE IS A MAN'S. In Arabic, speak of yourself as a man: "أنا مش متأكد"، "أنا شايف"، "مش لاقي"، "مش فاكر". When they say "تقدر" or "إنت", they are talking to you. ${ADDRESS_THEM}`,
};

type Note = { id: string; text: string; at: number };
type Stats = {
  calls: number;
  arabic: number;
  english: number;
  other: number;
  /** Arabic turns with English words in them. */
  mixed: number;
  turns: number;
  words: number;
  shorter: number;
  longer: number;
};
export type VoicePrefs = {
  voice: VoiceChoice;
  /** Off: nothing is learned or used, and what was is cleared. */
  learn: boolean;
  notes: Note[];
  stats: Stats;
};

const KEY = 'livePrefs';
// Three calls, as weighed once older ones have faded (1 + 0.85 + 0.72).
const MIN_CALLS = 2.5;
const DECAY = 0.85;
const MAX_NOTES = 12;
const MAX_NOTE = 160;

const EMPTY_STATS: Stats = { calls: 0, arabic: 0, english: 0, other: 0, mixed: 0, turns: 0, words: 0, shorter: 0, longer: 0 };
const DEFAULTS: VoicePrefs = { voice: 'female', learn: true, notes: [], stats: EMPTY_STATS };

let cache: VoicePrefs | null = null;
const listeners = new Set<() => void>();

export async function getVoicePrefs(): Promise<VoicePrefs> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<VoicePrefs>) : {};
    cache = { ...DEFAULTS, ...saved, stats: { ...EMPTY_STATS, ...(saved.stats ?? {}) }, notes: saved.notes ?? [] };
  } catch (e) {
    console.warn('[voice prefs] could not read, using defaults:', e);
    cache = { ...DEFAULTS };
  }
  return cache;
}

async function save(next: VoicePrefs): Promise<void> {
  cache = next;
  for (const l of listeners) l();
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export function onVoicePrefsChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function setVoiceChoice(voice: VoiceChoice): Promise<void> {
  await save({ ...(await getVoicePrefs()), voice });
  console.log(`[voice prefs] voice ${voice} (${VOICE_ID[voice]})`);
}

/** Off forgets everything learned and said; on starts fresh. */
export async function setLearning(learn: boolean): Promise<void> {
  const p = await getVoicePrefs();
  await save(learn ? { ...p, learn } : { ...p, learn, notes: [], stats: EMPTY_STATS });
  console.log(`[voice prefs] learning ${learn ? 'on' : 'off, and forgotten'}`);
}

export async function forgetAll(): Promise<void> {
  await save({ ...(await getVoicePrefs()), notes: [], stats: EMPTY_STATS });
}

// ── What they asked for in so many words ──────────────────────────────

/** Saved by the model's remember_preference tool. */
export async function rememberNote(text: string): Promise<{ saved: boolean; reason?: string }> {
  const p = await getVoicePrefs();
  if (!p.learn) return { saved: false, reason: 'The user has turned off remembering how they like to talk.' };
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  if (!clean) return { saved: false, reason: 'Nothing to remember.' };
  // The same wish said again replaces the old one rather than piling up.
  const notes = p.notes.filter((n) => n.text.toLowerCase() !== clean.toLowerCase());
  notes.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: clean, at: Date.now() });
  await save({ ...p, notes: notes.slice(-MAX_NOTES) });
  console.log(`[voice prefs] remembered: ${clean}`);
  return { saved: true };
}

/** Removed by the model's forget_preference tool (their words), or from
 *  Profile (an id). */
export async function forgetNote(match: string): Promise<{ forgotten: number }> {
  const p = await getVoicePrefs();
  const m = match.toLowerCase();
  const notes = p.notes.filter((n) => n.id !== match && !n.text.toLowerCase().includes(m));
  await save({ ...p, notes });
  return { forgotten: p.notes.length - notes.length };
}

// ── Learned quietly from how they talk ────────────────────────────────

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /\b[a-zA-Z]{2,}\b/;
const ASK_SHORTER = /(باختصار|اختصر|قصر|أقصر|اقصر|من غير تفاصيل|short(er)?|brief(ly)?|in a word|tl;?dr)/i;
const ASK_LONGER = /(بالتفصيل|تفاصيل أكتر|احكيلي أكتر|اشرح|more detail|tell me more|explain|elaborate)/i;

/** After a call: what its turns say about how they talk. Counts only. */
export async function learnFromCall(turns: VoiceTurn[]): Promise<void> {
  const p = await getVoicePrefs();
  if (!p.learn) return;
  const said = turns.filter((t) => t.role === 'user' && t.text.trim().length > 1);
  if (said.length === 0) return;
  const s = Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, v * DECAY])) as Stats;
  s.calls += 1;
  for (const t of said) {
    const text = t.text.trim();
    s.turns += 1;
    s.words += text.split(/\s+/).length;
    if (ARABIC.test(text)) {
      s.arabic += 1;
      if (LATIN_WORD.test(text)) s.mixed += 1;
    } else if (/^[\x00-\x7F’“”—–…]+$/.test(text)) s.english += 1;
    else s.other += 1;
    if (ASK_SHORTER.test(text)) s.shorter += 1;
    if (ASK_LONGER.test(text)) s.longer += 1;
  }
  await save({ ...p, stats: s });
  console.log(`[voice prefs] learned from ${said.length} turns (${Math.round(s.calls)} calls weighed)`);
}

/** The style, in plain lines, once it has held long enough. */
export function learnedLines(p: VoicePrefs): string[] {
  const s = p.stats;
  if (!p.learn || s.calls < MIN_CALLS || s.turns < 6) return [];
  const lines: string[] = [];
  const total = s.arabic + s.english + s.other;
  if (s.arabic / total >= 0.7) lines.push('Usually talks in Egyptian Arabic.');
  else if (s.english / total >= 0.7) lines.push('Usually talks in English.');
  else if (s.arabic > 0 && s.english > 0) lines.push('Moves between Arabic and English.');
  if (s.arabic > 0 && s.mixed / s.arabic >= 0.3) lines.push('Mixes English words into Arabic; keep those words in English.');
  const avg = s.words / s.turns;
  if (avg <= 7) lines.push('Asks short, quick questions; short answers suit them.');
  else if (avg >= 20) lines.push('Talks at length; fuller answers are welcome.');
  if (s.shorter >= 1.5 && s.shorter > s.longer) lines.push('Has asked for shorter answers more than once.');
  if (s.longer >= 1.5 && s.longer > s.shorter) lines.push('Has asked for more detail more than once.');
  return lines;
}

/** A few lines for the call's instructions. Empty when there's nothing. */
export async function prefsBlock(): Promise<string> {
  const p = await getVoicePrefs();
  if (!p.learn) return '';
  const learned = learnedLines(p);
  if (!learned.length && !p.notes.length) return '';
  return [
    'HOW THEY LIKE TO TALK (from earlier calls; a guide, not a script, and what they say now always wins):',
    ...p.notes.map((n) => `- They asked: ${n.text}`),
    ...learned.map((l) => `- ${l}`),
  ].join('\n');
}
