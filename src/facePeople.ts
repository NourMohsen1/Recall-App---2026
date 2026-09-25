import {
  findPersonDays,
  getPersonFace,
  setPersonFace,
  forgetPersonFace,
} from './faceIndex';
import { detectAndEmbed } from './faceEmbedderTflite';
import { addGuess } from './guessedPeople';
import { getAllPersonMeta } from './peopleTags';
import { resolvePhotoUri } from './photoUri';

// Learning a face once, then noticing it forever.
//
// THE WHOLE FEATURE, and deliberately small. The user puts a photo on
// someone's profile and says who they are — something they already do, for
// their own reasons. That one photo becomes that person's fingerprint. From
// then on, every photo the app reads is compared against the people it
// knows, and a match quietly attaches that person to that day.
//
// Nothing here asks the user for anything. No screen to visit, no faces to
// sort, no questions to answer. If they never open anything again it still
// works — which is the difference between an app that helps someone
// remember and one that gives them a filing job.
//
// A match is always a GUESS until the user agrees: drawn with a dashed ring
// wherever it appears, and spoken as "you may have seen Omar", never "you
// saw Omar". See src/guessedPeople.ts.

// How alike a stored face must be to someone's profile photo.
//
// Higher than MATCH_THRESHOLD (0.47), and the reason is worth keeping. That
// number was measured across 117 pairs, where the best stranger scored
// 0.365. A library holds thousands of faces, so this comparison runs
// thousands of times per person — and the highest score among thousands is
// far above the highest among a hundred. A threshold taken from a small
// sample is always too loose at scale; measured once at 0.47 on a real
// library, it filed most of it as one person.
//
// 0.58 sits just above the worst same-person pair measured (0.574). It will
// miss someone in a bad photo, which costs a day the user can still add
// themselves. The other kind of mistake — quietly telling someone they met
// a friend they did not — is the one worth avoiding.
const PERSON_MATCH_THRESHOLD = 0.58;

/** Turn one person's profile photo into their fingerprint.
 *
 *  Returns false when there is no usable face in it — a photo of their dog,
 *  a group shot where nobody is clearly the subject, a picture too small to
 *  read. That is not an error; it just means this person cannot be spotted
 *  until they have a better photo. */
export async function learnFace(name: string, photoUri: string): Promise<boolean> {
  const resolved = await resolvePhotoUri(photoUri);
  if (!resolved) return false;

  const faces = await detectAndEmbed(resolved);
  if (faces.length === 0) return false;

  // The biggest face in a profile photo is the person whose profile it is.
  // Anyone else in the shot is standing next to them.
  const main = [...faces].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  await setPersonFace(name, main.embedding, photoUri);
  return true;
}

/** Every person who has a photo but no fingerprint yet.
 *
 *  Runs at startup and after a photo changes. Cheap when there is nothing
 *  to do, which is almost always. */
export async function learnKnownFaces(): Promise<number> {
  const meta = await getAllPersonMeta();
  let learned = 0;
  for (const [name, m] of Object.entries(meta)) {
    if (!m.photoUri) continue;
    if (await getPersonFace(name)) continue;
    try {
      if (await learnFace(name, m.photoUri)) learned += 1;
    } catch {
      // A photo that cannot be read today may be readable tomorrow — an
      // iCloud file still downloading, for instance. Leaving no fingerprint
      // means this is simply tried again next time.
    }
  }
  if (learned > 0) console.log(`[faces] learned ${learned} people from their photos`);
  return learned;
}

/** Look for everyone the app knows, in everything it has read.
 *
 *  The days come back as guesses. Days the user already recorded themselves
 *  are skipped by addGuess, as are ones they have already rejected — so
 *  running this repeatedly never re-asks a settled question. */
export async function linkKnownFaces(): Promise<number> {
  const meta = await getAllPersonMeta();
  let added = 0;
  let known = 0;

  for (const name of Object.keys(meta)) {
    if (!(await getPersonFace(name))) continue;
    known += 1;
    const days = await findPersonDays(name, { threshold: PERSON_MATCH_THRESHOLD });
    for (const d of days) {
      // The face that caused this, carried along: being asked "was Omar
      // there?" is unanswerable without the photo to look at.
      //
      // Counted only when it actually recorded something. Counting every
      // attempt made the log claim it had found five days every single
      // time it ran, including when it had found nothing new.
      if (await addGuess(d.day, name, -1, { photoUri: d.photoUri, box: d.box })) added += 1;
    }
  }
  if (added > 0) {
    console.log(`[faces] recognised people on ${added} new days (${known} faces known)`);
  }
  return added;
}

/** One person, from scratch — after their photo is set or changed. */
export async function refreshPerson(name: string, photoUri?: string): Promise<void> {
  await forgetPersonFace(name);
  if (!photoUri) return;
  if (await learnFace(name, photoUri)) await linkKnownFaces();
}

/** Learn anyone new, then look for everybody. Called after photos are read. */
export async function noticePeople(): Promise<void> {
  await learnKnownFaces();
  await linkKnownFaces();

  // Said out loud, because the commonest reason this feature appears to do
  // nothing is not a bug: it is that nobody has a profile photo yet, and
  // there is therefore nobody to look for. That is invisible from outside
  // and indistinguishable from a broken pipeline.
  const meta = await getAllPersonMeta();
  const names = Object.keys(meta);
  const withPhoto = names.filter((n) => meta[n].photoUri).length;
  let withFace = 0;
  for (const n of names) if (await getPersonFace(n)) withFace += 1;
  console.log(
    `[faces] ${names.length} people, ${withPhoto} with a photo, ${withFace} whose face is known` +
      (withFace === 0
        ? ' — add a photo to someone in People and they will be looked for'
        : ''),
  );
}
