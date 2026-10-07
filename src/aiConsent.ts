import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAiAllowed } from './backend';

// "Recall's AI" — whether the user's notes and voice may be sent to the AI
// companies that write them up, transcribe them and answer questions about
// them (OpenAI and DeepSeek, through Recall's server). Apple requires this
// to be asked, naming who receives what, before anything is sent.
//
//   'on'  — allowed.
//   'off' — "Not now": everything is saved exactly as logged; no write-ups,
//           transcripts, Ask or live voice. Changeable in Profile.
//   null  — not asked yet. Nothing is sent until they answer.
//
// Enforced in src/backend.ts (backendUrl), the one place every AI request
// finds the server. Notes left unpolished meanwhile are picked up by the
// background sweep once it's turned on.

export type AiConsent = 'on' | 'off';

export const AI_COMPANIES = 'OpenAI and DeepSeek';

const KEY = 'aiConsent';
let cached: AiConsent | null | undefined;
const listeners = new Set<() => void>();

export function onAiConsentChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Read once at launch, before anything tries to reach the server. */
export async function loadAiConsent(): Promise<AiConsent | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cached = raw === 'on' || raw === 'off' ? raw : null;
  } catch (e) {
    console.warn('[ai] could not read the AI permission — treating it as not given:', e);
    cached = null;
  }
  setAiAllowed(cached === 'on');
  console.log(`[ai] permission: ${cached ?? 'not asked yet'}`);
  return cached;
}

export function getAiConsent(): AiConsent | null {
  return cached ?? null;
}

export async function setAiConsent(value: AiConsent): Promise<void> {
  await AsyncStorage.setItem(KEY, value);
  cached = value;
  setAiAllowed(value === 'on');
  console.log(`[ai] permission set to "${value}"`);
  for (const fn of listeners) fn();
}
