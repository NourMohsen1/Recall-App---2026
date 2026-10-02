import * as FileSystem from 'expo-file-system/legacy';
import { checkFile, photoGuardAvailable } from '../modules/photo-guard';
import { chatCompletion, textProviders } from './aiProviders';
import { SENSITIVE_THRESHOLD } from './photoGuard';

// Nothing sexual comes into Recall from the outside.
//
// The user's own photos are already guarded (photoGuard.ts). This covers
// what the app fetches from the web for them: On This Day's headlines and
// news photos, steered by topics the user can now type themselves. Three
// layers, each one failing closed — when a check can't run, the thing it
// checks is left out, never let through:
//
//   1. A typed topic (or the "what I care about" text inside one) is checked
//      before it is accepted: a word list first, then the AI.
//   2. Every web search is told never to return explicit content.
//   3. Every news photo is read by the same on-device nudity model that
//      guards the camera roll, and dropped at the "sensitive" line (0.6),
//      not only at "private" — a news photo is never worth the risk.

// Obvious cases only, in English, Arabic and Franco — caught without asking
// anyone. Kept to words with no innocent meaning: "dick" (Moby Dick),
// "escort" (the Ford), "kinks" (the band), "naked" (The Naked Chef), "جنس" (inside جنسية,
// nationality) and "عري" (inside عريس, groom) would all refuse ordinary
// interests, so subtler cases are left to the AI check below.
const BLOCKED = [
  /\b(sex|sexy|porn\w*|nsfw|nude|nudes|nudity|xxx|hentai|erotica?|onlyfans|camgirls?|strip ?clubs?|milf|bdsm|orgasms?)\b/i,
  /(سكس|إباحي|اباحي|إباحية|اباحية|شرموط|متناك)/,
  /\b(seks|sks|sharmoot\w*)\b/i,
];

function blockedWords(text: string): boolean {
  return BLOCKED.some((re) => re.test(text));
}

const TOPIC_PROMPT = `You review interests a user types into Recall, a personal memory app. The app searches the news for each interest, so an interest must be something safe to show anyone: a hobby, a field, a team, an artist, a place.

Reply "unsafe" if it is, refers to, or would mostly bring up sexual or nude content, pornography, sex work, fetishes, or sexual services — in any language or spelling. Otherwise reply "safe". Ordinary topics are safe, including health, relationships in general, fashion and swimwear sport.

Respond with ONLY JSON: {"verdict": "safe" | "unsafe"}`;

export type TopicCheck = { ok: true } | { ok: false; reason: 'blocked' | 'unavailable' };

/** Whether a typed interest may be used. Fails closed: if the AI can't be
 *  asked, the topic isn't accepted yet. */
export async function checkTopic(text: string): Promise<TopicCheck> {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'blocked' };
  if (blockedWords(t)) {
    console.log('[safety] typed topic refused by the word list');
    return { ok: false, reason: 'blocked' };
  }
  const result = await chatCompletion(textProviders(), (model) => ({
    model,
    messages: [
      { role: 'system', content: TOPIC_PROMPT },
      { role: 'user', content: t.slice(0, 200) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }));
  if (!result.ok) {
    console.warn(`[safety] could not check a typed topic: HTTP ${result.status}`);
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const verdict = (JSON.parse(result.content) as { verdict?: string }).verdict;
    if (verdict === 'safe') return { ok: true };
    console.log(`[safety] typed topic refused by the AI (${verdict ?? 'no verdict'})`);
    return { ok: false, reason: verdict === 'unsafe' ? 'blocked' : 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Added to every web search the app makes for On This Day. */
// Worded without the explicit words themselves: the instruction is just as
// clear, and a search prompt full of them is more likely to be refused.
export const SAFE_SEARCH_RULE =
  'Keep every result family-friendly and suitable for all ages — never adult or explicit content, and never link to it. If a topic would only produce that, give a notable general news event from that date instead.';

/** Whether a news photo may be shown: downloaded, read on the phone, and
 *  only kept clearly below the sensitive line. Anything that can't be
 *  checked is treated as not safe — the card shows its topic icon. */
export async function isSafeWebImage(url: string): Promise<boolean> {
  if (!photoGuardAvailable) return false;
  const path = `${FileSystem.cacheDirectory}otd-check-${Date.now()}-${Math.random().toString(36).slice(2)}.img`;
  try {
    const { status } = await FileSystem.downloadAsync(url, path);
    if (status !== 200) return false;
    const { score, apple } = await checkFile(path);
    const safe = !apple && score < SENSITIVE_THRESHOLD;
    if (!safe) console.log(`[safety] news photo dropped (score ${score.toFixed(2)}${apple ? ', Apple' : ''})`);
    return safe;
  } catch (e) {
    console.warn('[safety] could not check a news photo, leaving it out:', e);
    return false;
  } finally {
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}
