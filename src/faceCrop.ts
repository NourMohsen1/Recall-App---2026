import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { chatCompletion, visionProviders } from './aiProviders';
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

const BOX_PROMPT = `You are given one photo. Find the single most prominent human face in it — the person the photo is of.

Reply with ONLY a JSON object giving that face's bounding box as fractions of the image, where 0,0 is the top-left corner and 1,1 is the bottom-right:

{"found": true, "x": <left edge 0-1>, "y": <top edge 0-1>, "w": <width 0-1>, "h": <height 0-1>}

The box must contain the face itself — brow to chin, ear to ear — not the whole head-and-shoulders, and not the whole person.

If there is no human face in the photo, or you cannot locate one confidently, reply {"found": false}. Guessing a box is worse than saying no.`;

// How much of the frame a real face occupies. A "face" reported as 2% of a
// photo is a distant figure, not a portrait; one reported as 95% is the
// model handing back the whole image because it didn't actually look. Both
// are rejected in favour of using the photo as it is.
const MIN_FACE_FRACTION = 0.02;
const MAX_FACE_FRACTION = 0.9;
// Grown outward from the reported box, because the useful signal for
// telling two people apart sits just outside a tight face crop — hairline,
// jaw, ears — and because the model's box is approximate.
const PADDING = 0.45;
// The crop is what gets sent, so it is kept large.
const CROP_WIDTH = 720;

type Box = { x: number; y: number; w: number; h: number };

// Locating a face is a different skill from describing one, and only one of
// the two providers has it.
//
// Measured on drawn scenes with a face placed at a known spot: DeepSeek put
// the box within 0.02-0.09 of it every time, wherever it was. gpt-4o-mini
// answered with the middle of the frame in every case — (0.50, 0.40) for a
// face at the top right, and again for one at the bottom left. It is not
// locating anything; it is guessing the centre.
//
// A wrong box here is worse than no box, because the crop it produces
// becomes the stored reference every future match is judged against. So
// this one step does not fall back: without a provider that can ground a
// coordinate, no crop is made and the whole photo is used, exactly as
// before.
function boxProviders() {
  return visionProviders().filter((p) => p.name === 'deepseek');
}

async function askForFaceBox(dataUri: string): Promise<Box | null> {
  const result = await chatCompletion(boxProviders(), (model) => ({
    model,
    messages: [
      { role: 'system', content: BOX_PROMPT },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: dataUri, detail: 'high' } }],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }));
  if (!result.ok) return null;

  try {
    const p = JSON.parse(result.content) as Partial<Box> & { found?: boolean };
    if (p.found === false) return null;
    const nums = [p.x, p.y, p.w, p.h];
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const box = { x: p.x as number, y: p.y as number, w: p.w as number, h: p.h as number };
    // Everything below is the model being checked, not trusted. A box that
    // runs off the edge, inverts, or covers the whole frame means it didn't
    // find a face — it produced the shape of an answer.
    if (box.w <= 0 || box.h <= 0) return null;
    if (box.x < 0 || box.y < 0 || box.x + box.w > 1.001 || box.y + box.h > 1.001) return null;
    const area = box.w * box.h;
    if (area < MIN_FACE_FRACTION || area > MAX_FACE_FRACTION) return null;
    // A face is roughly as tall as it is wide. Something four times longer
    // than it is high is a strip of the photo, not a head.
    const ratio = box.w / box.h;
    if (ratio < 0.25 || ratio > 4) return null;
    return box;
  } catch {
    return null;
  }
}

async function toDataUri(uri: string, width: number): Promise<string | null> {
  try {
    const shrunk = await manipulateAsync(uri, [{ resize: { width } }], {
      compress: 0.8,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return shrunk.base64 ? `data:image/jpeg;base64,${shrunk.base64}` : null;
  } catch {
    return null;
  }
}

// Produces the face crop for one person and stores it. Returns the stored
// URI, or null when no usable face was found — in which case the caller
// keeps using the photo as it is.
export async function buildFaceCrop(name: string, photoUri: string): Promise<string | null> {
  if (boxProviders().length === 0) return null;
  try {
    const resolved = await resolvePhotoUri(photoUri);
    if (!resolved) return null;

    // Resized first so the box comes back in a frame whose real pixel
    // dimensions are known — manipulateAsync reports them, and crop takes
    // pixels, not fractions.
    const base = await manipulateAsync(resolved, [{ resize: { width: 1024 } }], {
      compress: 0.9,
      format: SaveFormat.JPEG,
    });
    const asked = await toDataUri(base.uri, 1024);
    if (!asked) return null;

    const box = await askForFaceBox(asked);
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
// time so it never turns into a burst of calls, newest profiles first is not
// meaningful here — order is just whatever the store gives back.
export async function backfillFaceCrops(limit: number): Promise<number> {
  if (boxProviders().length === 0) return 0;
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
