import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLoggedMemories } from './memoryLog';

// Who the user is.
//
// The app knew every person in the user's life except the one holding the
// phone. That gap runs deeper than a missing avatar: the intake brain can
// tag the user as a person they "met", the Ask feature has no idea whose
// life it's describing, and nothing can tell "a photo of me" from "a photo
// of someone". Everything here exists to close that.
//
// Deliberately NOT part of peopleTags: the user isn't someone they were with
// on a day, and putting them in the People list would mean tagging yourself
// into your own memories.

const KEY = 'userProfile';

export type UserProfile = {
  name?: string;
  /** "You are a product designer, you created me Recall." — free text the
   *  user writes about themselves, fed to the AI as standing context. */
  bio?: string;
  /** Their face. Same role as a person's reference photo. */
  photoUri?: string;
  email?: string;
  phone?: string;
  /** ISO date the profile was first filled in. */
  joinedAt?: string;
};

export async function getUserProfile(): Promise<UserProfile> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : {};
  } catch {
    return {};
  }
}

export async function setUserProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const current = await getUserProfile();
  const next: UserProfile = { ...current, ...patch };
  // Stamped the first time anything is saved, so "Joined" is a real date
  // rather than a placeholder.
  if (!next.joinedAt) next.joinedAt = new Date().toISOString();
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function hasIdentity(profile: UserProfile): boolean {
  return !!profile.name?.trim();
}

// When they started using Recall. Prefers the stored stamp, but falls back to
// their oldest memory — for anyone who was logging before this screen
// existed, that's the truer answer.
export async function joinedDate(profile: UserProfile): Promise<Date | null> {
  const memories = await getLoggedMemories();
  const oldest = memories
    .map((m) => new Date(m.createdAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];

  const stamped = profile.joinedAt ? new Date(profile.joinedAt).getTime() : undefined;
  const earliest = [oldest, stamped].filter((t): t is number => typeof t === 'number').sort((a, b) => a - b)[0];
  return earliest ? new Date(earliest) : null;
}

export async function memoryCount(): Promise<number> {
  return (await getLoggedMemories()).length;
}

// The standing "who am I talking to" line handed to the AI. Empty when the
// user hasn't said who they are, so nothing is invented on their behalf.
export function identityForPrompt(profile: UserProfile): string {
  if (!hasIdentity(profile)) return '';
  const bits = [`The user's name is ${profile.name!.trim()}.`];
  // The bio is quoted and labelled rather than pasted in raw. People write
  // it addressed TO the app — "You are a product designer, you created me
  // Recall" — and dropped straight into a system prompt that "You" reads as
  // the assistant itself, which would have the model believing it was the
  // designer. Quoting it makes clear whose words describe whom.
  if (profile.bio?.trim()) {
    bits.push(`What they told the app about themselves: "${profile.bio.trim()}"`);
  }
  return bits.join(' ');
}
