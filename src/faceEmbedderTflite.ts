import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import type { SkImage } from '@shopify/react-native-skia';

import { useModels, type DetectedFace, type FaceBox } from './faceIndex';
import { registerFaceEmbedder, type FaceEmbedder } from './faceEmbedder';
import { serialized } from './modelQueue';
import {
  alignedCropWithImage,
  asDataUri,
  cropToImage,
  cropToPixels,
  decodePhoto,
  padBox,
  toModelInputWith,
  type PixelOptions,
} from './facePixels';
import {
  detectFacesThorough,
  detectFacesWithInput,
  loadFaceDetector,
  type Detection,
  type DetectorKind,
  type FaceDetector,
} from './faceDetector';

// The real embedder: the thing faceEmbedder.ts has been holding a door open
// for. Two models in sequence — BlazeFace says where the faces are,
// MobileFaceNet turns each one into a fingerprint.
//
// Nothing here talks to a network. Both models are files inside the app and
// both run on the phone's own chip.
//
// How a face is prepared before the model sees it is deliberately an
// option rather than a constant, because the first measurement on real
// photos scored the same person at 0.568 — below the 0.62 threshold. That
// is the signature of a mis-prepared face, not a broken model, and the only
// way to find out which preparation is right is to measure them.

export type EmbedOptions = PixelOptions & {
  /** Rotate the face so the eyes are level before measuring it. */
  align?: boolean;
  /** How much bigger than the detector's box to cut, when not aligning. */
  padding?: number;
  /** Which fingerprint model to use. */
  embedder?: EmbedderKind;
};


/** Which detector the app uses.
 *
 *  'short' was the original choice and was wrong: it is built for selfies
 *  and finds nothing in a photo taken across a room, which is most of a
 *  real photo library. 'full' sees to roughly five metres. */
export const DEFAULT_DETECTOR: DetectorKind = 'full';

/** Which model turns a face into numbers.
 *
 *  MobileFaceNet was tried first and failed its measurement: across 117
 *  pairs of real photos its worst same-person score (0.104) sat far BELOW
 *  its best stranger score (0.527), so no threshold could separate them.
 *  It has been removed; this is what replaced it. */
export type EmbedderKind = 'facenet512';

export const DEFAULT_EMBEDDER: EmbedderKind = 'facenet512';

const EMBEDDER_ASSETS: Record<EmbedderKind, number> = {
  facenet512: require('../assets/models/facenet_512.tflite'),
};

// What the app uses, chosen by measurement rather than by argument.
//
// 117 pairs from this library — 9 photos of Nour against 9 of other bearded
// men of similar age, including hard ones: far away, red light, sunglasses,
// years apart. Every combination of model, crop, channel order and
// normalisation was scored on all of them. This row won:
//
//   worst same-person pair ....  0.574
//   best stranger pair ........  0.365
//   margin ....................  +0.209
//   averages ..................  0.709 same, 0.141 different
//
// Three results here are the opposite of what was expected, and all three
// are why this was measured instead of reasoned about:
//
//   · ALIGNMENT HURTS. Rotating the face so the eyes are level — the
//     textbook step, and the thing that looked like the whole game on a
//     single lucky pair — scored NEGATIVE on every model here. FaceNet was
//     trained on loose, un-rotated crops; handing it a tight aligned face
//     is giving it something it has never seen. alignedCrop stays in the
//     codebase for the next model, but nothing uses it.
//   · THE WIDEST CROP WINS. 0.4 padding beat 0.25 and 0 — hair, jaw and
//     some background carry identity too.
//   · 0..1 BEATS THE DOCUMENTED PREPROCESSING. FaceNet is documented to
//     want each crop normalised by its own brightness; measured, that came
//     last. The documentation lost to the data.
export const DEFAULT_OPTIONS: EmbedOptions = {
  embedder: DEFAULT_EMBEDDER,
  align: false,
  padding: 0.4,
  order: 'rgb',
  range: 'unit',
};


type Loaded = { embedder: TfliteModel; size: number; dims: number };

const loadedEmbedders = new Map<EmbedderKind, Promise<Loaded>>();

// Detectors are loaded on demand and kept, so the test screen can compare
// two of them without paying to reload either.
const detectors = new Map<DetectorKind, Promise<FaceDetector>>();

export function detector(kind: DetectorKind = DEFAULT_DETECTOR): Promise<FaceDetector> {
  const existing = detectors.get(kind);
  if (existing) return existing;
  const next = loadFaceDetector(kind);
  detectors.set(kind, next);
  next.catch(() => detectors.delete(kind));
  return next;
}

// A model's input shape is [batch, height, width, channels] and its output
// [batch, dimensions]. Reading them rather than assuming means a swapped
// model works without a code change — and, more to the point, that a
// mismatched one fails loudly here instead of producing fingerprints that
// compare as noise.
function inputSize(model: TfliteModel): number {
  const shape = model.inputs[0]?.shape ?? [];
  const size = shape[1];
  if (!size || shape[1] !== shape[2]) {
    throw new Error(`Fingerprint model wants a shape this code cannot feed: [${shape}]`);
  }
  return size;
}

function outputDims(model: TfliteModel): number {
  const shape = model.outputs[0]?.shape ?? [];
  const dims = shape[shape.length - 1];
  if (!dims) throw new Error(`Fingerprint model reports no output size: [${shape}]`);
  return dims;
}

async function load(kind: EmbedderKind = DEFAULT_EMBEDDER): Promise<Loaded> {
  const existing = loadedEmbedders.get(kind);
  if (existing) return existing;

  const next = (async () => {
    const embedder = await loadTensorflowModel(EMBEDDER_ASSETS[kind], ['core-ml']);
    return { embedder, size: inputSize(embedder), dims: outputDims(embedder) };
  })();
  // A failed load must not be remembered as a permanent failure — a
  // transient one (memory pressure while another app is in front) should
  // be retryable rather than disabling faces until the app restarts.
  next.catch(() => loadedEmbedders.delete(kind));
  loadedEmbedders.set(kind, next);
  return next;
}

export async function modelInfo(
  kind: EmbedderKind = DEFAULT_EMBEDDER,
): Promise<{ size: number; dims: number; delegates: string[] }> {
  const { embedder, size, dims } = await load(kind);
  return { size, dims, delegates: embedder.delegates as string[] };
}

/** Decode a photo and find every face in it. Kept separate from measuring
 *  so a sweep can detect once and then try many preparations. */
/** How a photo is searched.
 *
 *  'once'     — one look at the whole photo. Cheapest, misses distant faces.
 *  'thorough' — the whole photo plus nine overlapping tiles. Finds faces a
 *               few pixels tall, ten times the detection work.
 *  'fallback' — 'once', then 'thorough' only if that found nobody.
 *
 *  'fallback' is the default because it is nearly free in the common case.
 *  Measured on an iPhone 14 Pro Max: one look 102ms, ten looks 227ms — most
 *  of the cost is decoding the photo, which happens once either way. A
 *  photo with someone near the camera pays nothing extra; only the empty
 *  ones get searched again, which is exactly where the extra effort
 *  belongs. */
export type SearchEffort = 'once' | 'thorough' | 'fallback';

export async function findFaces(
  photoUri: string,
  kind: DetectorKind = DEFAULT_DETECTOR,
  effort: SearchEffort = 'fallback',
): Promise<{ image: SkImage; faces: Detection[]; detectorInput: string | null } | null> {
  const image = await decodePhoto(photoUri);
  if (!image) return null;
  const d = await detector(kind);

  if (effort === 'thorough') {
    return { image, faces: await detectFacesThorough(d, image), detectorInput: null };
  }

  const { faces, square } = await detectFacesWithInput(d, image);
  const detectorInput = square ? asDataUri(square) : null;
  if (faces.length > 0 || effort === 'once') return { image, faces, detectorInput };

  // Nothing at a glance. Either the photo has nobody in it, or the people
  // in it are small — and those two cases are indistinguishable without
  // looking closer.
  return { image, faces: await detectFacesThorough(d, image), detectorInput };
}

/** One face, cut out of its photo, as a picture to show someone.
 *
 *  Padded well past the detector's box: a question like "who is this?" is
 *  much easier to answer with some hair, neck and background than with a
 *  tight rectangle of features. */
export async function faceThumbnail(
  photoUri: string,
  box: FaceBox,
  size = 160,
): Promise<string | null> {
  const image = await decodePhoto(photoUri);
  if (!image) return null;
  const cut = cropToImage(image, padBox(box, 0.8), size);
  return cut ? asDataUri(cut.square) : null;
}

/** The 112x112 the fingerprint model is actually handed, as a picture.
 *  If this is not a level, centred face, nothing downstream can work. */
export async function alignedPreview(
  image: SkImage,
  face: Detection,
): Promise<string | null> {
  const { size } = await load();
  const cut = alignedCropWithImage(image, face.keypoints.eyeA, face.keypoints.eyeB, size);
  return cut ? asDataUri(cut.square) : null;
}

export async function embedFace(
  image: SkImage,
  face: Detection,
  options: EmbedOptions = DEFAULT_OPTIONS,
): Promise<Float32Array | null> {
  const { embedder, size } = await load(options.embedder ?? DEFAULT_EMBEDDER);

  const pixels = options.align
    ? alignedCropWithImage(image, face.keypoints.eyeA, face.keypoints.eyeB, size)?.pixels
    : cropToPixels(image, padBox(face.box, options.padding ?? 0.25), size);
  if (!pixels) return null;

  const input = toModelInputWith(pixels, size, options);
  const result = await serialized(() => embedder.run([input.buffer as ArrayBuffer]));
  if (!result[0]) return null;

  // Copied out deliberately. The buffer the model returns is reused for
  // the next call, so keeping a view of it means every face in a photo
  // ends up holding the last face's numbers.
  return new Float32Array(new Float32Array(result[0]));
}

// A face has to be worth measuring before it is measured.
//
// THIS IS NOT A TIDINESS RULE, it is what keeps recognition honest. A face
// forty pixels across carries almost no detail, so the fingerprint it
// produces is mush — and mush is vaguely similar to everything. Those faces
// do not merely fail to match; they actively poison the grouping, because
// each one lands in whichever group is nearest and drags that group's
// average towards the middle, where it then attracts more mush.
//
// Measured consequence of not having this: 90% of every face in a 2,389
// photo library was filed as one person.
//
// 90 pixels is roughly a face that a person could recognise if they were
// shown just that crop — which is the same bar the app asks the user to
// meet when it shows them one.
const MIN_FACE_PIXELS = 90;

// Above the detector's own floor. A hesitant detection is usually a face
// that is turned away, motion blurred, or not a face at all.
const MIN_FACE_CONFIDENCE = 0.75;

export async function detectAndEmbed(photoUri: string): Promise<DetectedFace[]> {
  const found = await findFaces(photoUri);
  if (!found) return [];

  const width = found.image.width();
  const height = found.image.height();

  const out: DetectedFace[] = [];
  for (const face of found.faces) {
    const pixels = Math.min(face.box.w * width, face.box.h * height);
    if (pixels < MIN_FACE_PIXELS) continue;
    if (face.score < MIN_FACE_CONFIDENCE) continue;

    const embedding = await embedFace(found.image, face, DEFAULT_OPTIONS);
    if (embedding) out.push({ box: face.box, embedding });
  }
  return out;
}

/** Switch face recognition on. Call once at startup.
 *
 *  Loading the detector here rather than lazily is deliberate: the name
 *  below has to describe what will actually read the photos, and the index
 *  is thrown away when that name changes. */
export async function installFaceEmbedder(): Promise<FaceEmbedder> {
  const [{ dims }] = await Promise.all([load(), detector(DEFAULT_DETECTOR)]);

  // Everything that would change the numbers goes in the name: a different
  // detector finds different faces, searching harder finds more of them,
  // and a different embedder measures them differently. Any of the three
  // makes what is already stored incomparable — or, worse, leaves photos
  // marked as read that a better search would have found someone in.
  const name = `blazeface-${DEFAULT_DETECTOR}-fallback+${DEFAULT_EMBEDDER}-${dims}`;
  if (await useModels(name)) {
    console.log(`[faces] models changed to ${name} — index cleared, re-reading`);
  }

  const impl: FaceEmbedder = { name, dimensions: dims, detectAndEmbed };
  registerFaceEmbedder(impl);
  return impl;
}
