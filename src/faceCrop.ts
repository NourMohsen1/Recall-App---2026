import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { findFaces } from './faceEmbedderTflite';
import { persistFile } from './memoryLog';
import { getAllPersonMeta, setPersonFace } from './peopleTags';
import { resolvePhotoUri } from './photoUri';

// Cuts a person's profile photo down to their face, once, and keeps it.
//
// WHY THIS EXISTS — the reason is resolution, and it is arithmetic rather
// than a theory about what the model attends to.
//
// The reference is sent at a fixed width. In a profile photo where the face
// takes up, say, a sixth of the frame, that fixed width buys about 150px of
// actual face and spends the rest on shoulders, clothes and the room. Cut to
// the face first and the same budget is spent entirely on the face — several
// times the linear detail on the only part that identifies anyone, at no
// extra cost per call.
//
// (The tempting second argument — that a full-body reference makes the model
// match on clothing — was tested and NOT demonstrated: on a rigged pair
// where the wrong person wore the reference's shirt, both providers picked
// the right person from the whole picture anyway. So it is left out of the
// reasoning here. Resolution is enough.)
//
// Asking the user to crop tightly would work and won't happen — it's a
// chore, and it's invisible: nothing about the app tells you that the crop
// is what the recognition stands on. So the app does it: one vision call per
// person, ever, and the result is stored beside the photo.
//
// The original photo is untouched and stays the avatar everywhere. This is
// only what goes into the matcher.

// jaw, ears — and because the model's box is approximate.
const PADDING = 0.45;
// The crop is what gets sent, so it is kept large.
const CROP_WIDTH = 720;

type Box = { x: number; y: number; w: number; h: number };


// Where the face is, found on the phone.
//
// (Worth keeping from the version this replaces: asked to locate a face,
// DeepSeek put the box within 0.02-0.09 of a known position every time,
// while gpt-4o-mini answered with the middle of the frame in every case —
// (0.50, 0.40) for a face at the top right and again for one at the bottom
// left. It was not locating anything. That is a fact about gpt-4o-mini and
// coordinates, not about faces, and it will be true the next time anyone
// asks a vision model to point at something.)
//
// This used to ask DeepSeek: upload the photo, have a vision model describe
// a box, check the answer was shaped like a box. It worked, but it sent a
// personal photo to a third party, cost a call per person, needed the
// network, and could return a plausible box around no face at all.
//
// The app now carries a face detector for its own recognition, so the same
// question is answered locally in about a tenth of a second, for nothing,
// offline, by something that only ever reports faces it actually found.
//
// The checks the old version needed — is this box inside the photo, is it
// face-shaped, is it a sane size — are gone with it. They existed to catch
// a language model producing the shape of an answer. A detector either
// finds a face or does not.
async function findFaceBox(photoUri: string): Promise<Box | null> {
  const found = await findFaces(photoUri);
  if (!found?.faces.length) return null;

  // The biggest face is the subject of a portrait; anyone else in it is a
  // bystander, and this is building that person's profile picture.
  const main = [...found.faces].sort(
    (a, b) => b.box.w * b.box.h - a.box.w * a.box.h,
  )[0];
  return main.box;
}


// Produces the face crop for one person and stores it. Returns the stored
// URI, or null when no usable face was found — in which case the caller
// keeps using the photo as it is.
export async function buildFaceCrop(name: string, photoUri: string): Promise<string | null> {
  try {
    const resolved = await resolvePhotoUri(photoUri);
    if (!resolved) return null;

    // Resized first so the crop below has a frame whose real pixel
    // dimensions are known — manipulateAsync reports them, and crop takes
    // pixels, not fractions.
    const base = await manipulateAsync(resolved, [{ resize: { width: 1024 } }], {
      compress: 0.9,
      format: SaveFormat.JPEG,
    });

    const box = await findFaceBox(resolved);
    if (!box) return null;

    // Pad outward, then clamp back inside the photo.
    const padX = box.w * PADDING;
    const padY = box.h * PADDING;
    const left = Math.max(0, box.x - padX);
    const top = Math.max(0, box.y - padY);
    const right = Math.min(1, box.x + box.w + padX);
    const bottom = Math.min(1, box.y + box.h + padY);

    const originX = Math.round(left * base.width);
    const originY = Math.round(top * base.height);
    const width = Math.round((right - left) * base.width);
    const height = Math.round((bottom - top) * base.height);
    if (width < 40 || height < 40) return null;

    const cropped = await manipulateAsync(
      base.uri,
      [
        { crop: { originX, originY, width, height } },
        { resize: { width: Math.min(CROP_WIDTH, width) } },
      ],
      { compress: 0.9, format: SaveFormat.JPEG },
    );

    // Copied out of the manipulator's cache, same as every other file the
    // app means to keep — that directory is temporary.
    const stored = await persistFile(cropped.uri, 'face');
    await setPersonFace(name, stored);
    return stored;
  } catch {
    return null;
  }
}

// People whose crop is already being worked out, so two screens asking at
// once don't each pay for a vision call.
const inFlight = new Map<string, Promise<string | null>>();

// PHOTOS already tried this session with no locatable face in them. Without
// this, a photo the model can't find a face in is paid for again every time
// the profile is opened, forever.
//
// Keyed by the photo and not by the person on purpose: swapping in a better
// picture is exactly what someone does after being told no face was found,
// and keying by name would refuse to look at the new one.
const triedAndFailed = new Set<string>();

// The reference to compare against: the stored face crop, made on first use
// and kept, falling back to the whole photo when no face could be found.
//
// Callers pass the photo they already have so this doesn't re-read the meta
// store on every candidate batch.
export async function referenceFaceUri(
  name: string,
  photoUri: string,
  // When false, an existing crop is used but a missing one is not made.
  // Lets a caller cut faces for the first few people and get on with the
  // job, rather than opening a day and waiting through eight of these
  // before a single photo is read. The rest are cut on a later pass.
  build = true,
): Promise<string> {
  const meta = (await getAllPersonMeta())[name];
  if (meta?.faceUri) return meta.faceUri;
  if (!build) return photoUri;
  if (triedAndFailed.has(photoUri)) return photoUri;

  const existing = inFlight.get(name);
  if (existing) return (await existing) ?? photoUri;

  const task = buildFaceCrop(name, photoUri).then((r) => {
    if (!r) triedAndFailed.add(photoUri);
    return r;
  });
  inFlight.set(name, task);
  try {
    return (await task) ?? photoUri;
  } finally {
    inFlight.delete(name);
  }
}

// Cuts faces for people who already have a photo but no crop yet.
//
// The crop was added after these profiles were made, so every photo already
// uploaded has no face cut from it and would only get one the next time that
// person happened to be searched for. This goes and does them, a few at a
// time. That pacing was originally about not firing off a burst of API
// calls; it still earns its place now the work is local, because each one
// decodes a full-sized photo and this runs while someone is using the app.
export async function backfillFaceCrops(limit: number): Promise<number> {
  const all = await getAllPersonMeta();
  let done = 0;
  for (const [name, m] of Object.entries(all)) {
    if (done >= limit) break;
    if (!m.photoUri || m.faceUri) continue;
    if (triedAndFailed.has(m.photoUri)) continue;
    const cut = await buildFaceCrop(name, m.photoUri);
    if (!cut) triedAndFailed.add(m.photoUri);
    done += 1;
  }
  return done;
}

// How many people still have a photo the app has never cut a face from.
// Lets a screen say so out loud instead of the work being invisible.
export async function pendingFaceCropCount(): Promise<number> {
  const all = await getAllPersonMeta();
  return Object.values(all).filter((m) => !!m.photoUri && !m.faceUri).length;
}
