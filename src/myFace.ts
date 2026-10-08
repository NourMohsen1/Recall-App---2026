import { detectAndEmbed } from './faceEmbedderTflite';
import { MATCH_THRESHOLD, forgetPersonFace, getFacesInPhotos, getPersonFace, setPersonFace, similarity } from './faceIndex';
import { resolvePhotoUri } from './photoUri';
import { getUserProfile } from './userProfile';

// The user's own face — so the app can tell "a photo of me" from "a photo
// of someone else".
//
// Before this, the photo stories were told about whoever was in the frame
// as "you": a friend sitting in a car became "you were in a car". The AI
// that writes them cannot know who is holding the phone; the phone can. The
// user's photo becomes a fingerprint here, exactly like a person's profile
// photo does in facePeople.ts, and each photo sent for a story carries a
// short label worked out on the phone — "you're in this one", "people,
// none of them you". The face itself never leaves the device; only those
// words do.
//
// Stored beside the People fingerprints under a name no person can have.
// Nothing that walks People sees it: they go by the People list, which
// never contains the user (see userProfile.ts).

const ME = '__me__';

// The same bar a person's profile photo has to clear (facePeople.ts):
// 0.58 is just above the worst same-person pair measured. Between the two
// thresholds a face is "maybe you" and the story is told to say nobody.
const IS_ME = 0.58;

export type MyFaceResult = 'learned' | 'no-face';

/** Learns the user's face from their photo. 'no-face' when no clear face
 *  is in it — a dog, a landscape, a face too small to read. */
export async function learnMyFace(photoUri: string): Promise<MyFaceResult> {
  const resolved = await resolvePhotoUri(photoUri);
  const faces = resolved ? await detectAndEmbed(resolved) : [];
  if (faces.length === 0) {
    console.log('[me] no clear face in the photo');
    return 'no-face';
  }
  // The biggest face is the user; anyone else is standing beside them.
  const main = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  await setPersonFace(ME, main.embedding, photoUri);
  console.log(`[me] learned your face (${faces.length} face(s) in the photo)`);
  return 'learned';
}

export async function forgetMyFace(): Promise<void> {
  await forgetPersonFace(ME);
}

export async function knowsMyFace(): Promise<boolean> {
  return !!(await getPersonFace(ME));
}

/** At launch: someone who set a profile photo before this existed has it
 *  learned quietly — they did their part already. */
export async function learnMyFaceIfMissing(): Promise<void> {
  try {
    if (await knowsMyFace()) return;
    const { photoUri } = await getUserProfile();
    if (photoUri) await learnMyFace(photoUri);
  } catch (e) {
    console.warn('[me] could not learn your face from your profile photo:', e);
  }
}

/** What the phone knows about who is in a photo:
 *  'you'    — the user's face is in it;
 *  'maybe'  — a face close to the user's, not close enough to say;
 *  'others' — faces, none of them the user;
 *  'people' — faces, but the user's face isn't known yet;
 *  absent   — no faces, or the photo hasn't been read yet. */
export type WhoLabel = 'you' | 'maybe' | 'others' | 'people';

export async function whoIsInPhotos(uris: string[]): Promise<Map<string, WhoLabel>> {
  const out = new Map<string, WhoLabel>();
  const [faces, me] = await Promise.all([getFacesInPhotos(uris), getPersonFace(ME)]);
  for (const [uri, list] of faces) {
    if (list.length === 0) continue;
    if (!me) {
      out.set(uri, 'people');
      continue;
    }
    const best = Math.max(...list.map((f) => similarity(me, f)));
    out.set(uri, best >= IS_ME ? 'you' : best >= MATCH_THRESHOLD ? 'maybe' : 'others');
  }
  return out;
}

/** The user chose a new photo of themselves: learn it, and let the photo
 *  stories that depend on knowing who they are be told again. */
export async function adoptMyPhoto(photoUri: string): Promise<MyFaceResult> {
  await forgetMyFace();
  const result = await learnMyFace(photoUri).catch((e) => {
    console.warn('[me] could not read your photo:', e);
    return 'no-face' as const;
  });
  // Loaded late: the story pass imports this file.
  if (result === 'learned') (await import('./photoAnalysisQueue')).runPhotoAnalysisNow();
  return result;
}
