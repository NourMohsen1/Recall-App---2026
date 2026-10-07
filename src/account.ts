import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';
import { appToken, backendUrl, setSession } from './backend';

// The user's Recall account: Sign in with Apple, nothing else. One tap and
// Face ID — no password to invent, no email to confirm.
//
// What an account is, exactly: Apple vouches for who the user is, and our
// server answers with a signed session. The server keeps nothing — not the
// name, not the email (never even asked for), not a single memory. The
// memories stay on the phone and, once iCloud sync is built, in the user's
// own iCloud.
//
// The session lives in the iPhone's keychain, which survives deleting and
// reinstalling the app, so signing in is something people do once.

export type Account = {
  /** Apple's id for this user in Recall — needed to ask Apple whether
   *  the user still allows the app. */
  appleUser: string;
  /** Our id: a hash of Apple's, made by the server. */
  account: string;
  session: string;
  expiresAt: number;
};

const KEY = 'recallAccount';
const DAY = 86_400_000;

let current: Account | null = null;
const listeners = new Set<() => void>();

function changed(next: Account | null) {
  current = next;
  setSession(next?.session);
  listeners.forEach((fn) => fn());
}

export function getAccount(): Account | null {
  return current;
}

export function onAccountChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function save(next: Account | null): Promise<void> {
  if (next) await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(KEY);
  changed(next);
}

async function askServer(path: string, body: unknown, session?: string): Promise<Response> {
  return fetch(backendUrl(path) ?? '', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken() ?? ''}${session ? `~${session}` : ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** On launch: the account from the keychain, checked with Apple and
 *  renewed quietly when under half its life is left. */
export async function loadAccount(): Promise<Account | null> {
  if (Platform.OS !== 'ios') return null;
  let stored: Account | null = null;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    stored = raw ? (JSON.parse(raw) as Account) : null;
  } catch (e) {
    console.warn('[account] could not read the keychain:', e);
  }
  if (!stored) {
    console.log('[account] signed out');
    return null;
  }
  changed(stored);

  // The user can stop using their Apple ID with Recall from iPhone
  // Settings. Then this account is over, and the app says so by showing
  // "Sign in" again rather than pretending.
  try {
    const state = await AppleAuthentication.getCredentialStateAsync(stored.appleUser);
    if (state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED) {
      console.log('[account] Apple sign-in was revoked in Settings — signing out');
      await save(null);
      return null;
    }
  } catch (e) {
    console.warn('[account] could not check the Apple credential:', e);
  }

  if (stored.expiresAt - Date.now() < 180 * DAY) {
    try {
      const res = await askServer('/auth/refresh', {}, stored.session);
      if (res.ok) {
        const { session, expiresAt } = (await res.json()) as { session: string; expiresAt: number };
        stored = { ...stored, session, expiresAt };
        await save(stored);
        console.log('[account] session renewed');
      } else if (res.status === 401) {
        // The server no longer recognises it. One tap in Profile fixes it.
        console.warn('[account] session no longer valid — signing out');
        await save(null);
        return null;
      }
    } catch (e) {
      console.warn('[account] could not renew the session (will try next launch):', e);
    }
  }
  console.log(`[account] signed in as ${stored.account}`);
  return stored;
}

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export type SignInResult = { ok: true; name?: string } | { ok: false; canceled: boolean; message?: string };

/** The Face ID sheet, then our server. `name` is set only the very first
 *  time someone signs in to Recall — Apple shares it once. */
export async function signInWithApple(): Promise<SignInResult> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    // The name only. No email: there is nothing we would send to it.
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
    });
  } catch (e) {
    const canceled = (e as { code?: string }).code === 'ERR_REQUEST_CANCELED';
    if (!canceled) console.warn('[account] Apple sign-in failed:', e);
    return { ok: false, canceled };
  }
  if (!credential.identityToken) {
    console.warn('[account] Apple returned no identity token');
    return { ok: false, canceled: false, message: 'Apple did not finish signing you in.' };
  }
  try {
    const res = await askServer('/auth/apple', { identityToken: credential.identityToken });
    if (!res.ok) {
      const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
      console.warn(`[account] server refused sign-in: HTTP ${res.status} ${message ?? ''}`);
      return { ok: false, canceled: false, message };
    }
    const { account, session, expiresAt } = (await res.json()) as {
      account: string;
      session: string;
      expiresAt: number;
    };
    await save({ appleUser: credential.user, account, session, expiresAt });
    console.log(`[account] signed in as ${account}`);
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { ok: true, name: name || undefined };
  } catch (e) {
    console.warn('[account] could not reach the server to sign in:', e);
    return { ok: false, canceled: false, message: 'No connection. Try again in a moment.' };
  }
}

/** Forgets the account on this phone. The memories stay. */
export async function signOut(): Promise<void> {
  await save(null);
  console.log('[account] signed out');
}

export type DeleteResult = { ok: true } | { ok: false; canceled: boolean; message?: string };

/** Required by Apple for any app with accounts. Apple asks for Face ID
 *  once more — that gives a fresh one-time code — and our server uses it
 *  to have Apple forget the link (token revocation, also required). The
 *  server keeps nothing else to delete. The memories on the phone are the
 *  user's and stay. Cancelling Face ID deletes nothing. */
export async function deleteAccount(): Promise<DeleteResult> {
  const was = current?.account;
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
  } catch (e) {
    const canceled = (e as { code?: string }).code === 'ERR_REQUEST_CANCELED';
    if (!canceled) console.warn('[account] Apple confirmation failed:', e);
    return { ok: false, canceled };
  }
  if (!credential.identityToken || !credential.authorizationCode) {
    console.warn('[account] Apple returned no code to revoke with');
    return { ok: false, canceled: false, message: 'Apple did not confirm. Try again.' };
  }
  try {
    const res = await askServer('/auth/apple/revoke', {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
    });
    if (!res.ok) {
      const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
      console.warn(`[account] server could not revoke: HTTP ${res.status} ${message ?? ''}`);
      return { ok: false, canceled: false, message };
    }
  } catch (e) {
    console.warn('[account] could not reach the server to delete the account:', e);
    return { ok: false, canceled: false, message: 'No connection. Try again in a moment.' };
  }
  await save(null);
  console.log(`[account] deleted account ${was ?? '(none)'}; Apple sign-in revoked`);
  return { ok: true };
}
