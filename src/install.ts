import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as AppIntegrity from '@expo/app-integrity';
import { backendUrl, setInstallPass } from './backend';

// This install's pass to Recall's server — how the App Store build proves
// it is the genuine Recall on a real iPhone, with no secret in the app.
//
// Once: the phone makes a key in its Secure Enclave (unreadable, even by
// the app), Apple's App Attest vouches for it, and the server answers with
// a pass for this install, good for a week. After that the same key signs
// a fresh challenge to renew it. Checked on the server in
// server/src/appAttest.ts.
//
// Kept in the keychain for this device only: an App Attest key never
// survives a reinstall or a restore to another phone, so neither should a
// pass that depends on it. If the key is gone, the install simply attests
// again.

type Stored = { keyId: string; pass: string; expiresAt: number };

const KEY = 'installPass';
const STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
/** Renewed when less than this is left of its week. */
const RENEW_WHEN_LEFT_MS = 3.5 * 86400_000;

let running: Promise<void> | null = null;

async function load(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE_OPTIONS);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch (e) {
    console.warn('[install] could not read the pass:', e);
    return null;
  }
}

async function save(stored: Stored | null): Promise<void> {
  if (stored) await SecureStore.setItemAsync(KEY, JSON.stringify(stored), STORE_OPTIONS);
  else await SecureStore.deleteItemAsync(KEY, STORE_OPTIONS);
  setInstallPass(stored?.pass);
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(backendUrl(path) ?? '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function challenge(): Promise<string> {
  const { status, json } = await post('/attest/challenge', {});
  if (status !== 200 || typeof json.challenge !== 'string') throw new Error(`challenge HTTP ${status}`);
  return json.challenge;
}

/** A new key, vouched for by Apple. */
async function attest(): Promise<void> {
  const keyId = await AppIntegrity.generateKeyAsync();
  const c = await challenge();
  const attestation = await AppIntegrity.attestKeyAsync(keyId, c);
  const { status, json } = await post('/attest/register', { keyId, attestation, challenge: c });
  if (status !== 200 || typeof json.pass !== 'string') {
    throw new Error(`register HTTP ${status} ${JSON.stringify(json.error ?? '')}`);
  }
  await save({ keyId, pass: json.pass, expiresAt: Number(json.expiresAt) });
  console.log('[install] verified by Apple — this install has its pass');
}

/** The same key signs a fresh challenge. False when it has to attest again. */
async function renew(stored: Stored): Promise<boolean> {
  const c = await challenge();
  let assertion: string;
  try {
    assertion = await AppIntegrity.generateAssertionAsync(stored.keyId, c);
  } catch (e) {
    console.warn('[install] the key is gone (reinstalled or restored) — attesting again:', e);
    return false;
  }
  const { status, json } = await post('/attest/renew', { pass: stored.pass, assertion, challenge: c });
  if (status === 401) return false;
  if (status !== 200 || typeof json.pass !== 'string') throw new Error(`renew HTTP ${status}`);
  await save({ keyId: stored.keyId, pass: json.pass, expiresAt: Number(json.expiresAt) });
  console.log('[install] pass renewed');
  return true;
}

async function ensure(): Promise<void> {
  const stored = await load();
  if (stored) setInstallPass(stored.pass);
  if (stored && stored.expiresAt - Date.now() > RENEW_WHEN_LEFT_MS) return;
  if (!AppIntegrity.isSupported) {
    // The simulator, or a device without App Attest. A development build
    // falls back to its development token; a release build can't reach
    // the AI — said loudly so it is never a silent mystery.
    console.warn('[install] App Attest is not available on this device');
    return;
  }
  try {
    if (stored && (await renew(stored))) return;
    await save(null);
    await attest();
  } catch (e) {
    // Keep any pass still in date; try again next time the app opens.
    console.warn('[install] could not get or renew the pass:', e);
  }
}

/** Makes sure this install has a current pass. Safe to call often. */
export function ensureInstallPass(): Promise<void> {
  if (!running) running = ensure().finally(() => (running = null));
  return running;
}

/** At launch and whenever the app comes back to the front. */
export function startInstallPass(): () => void {
  ensureInstallPass();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') ensureInstallPass();
  });
  return () => sub.remove();
}
