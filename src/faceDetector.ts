import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import type { SkImage } from '@shopify/react-native-skia';

import type { FaceBox } from './faceIndex';
import { letterboxRegion, toModelInput } from './facePixels';
import { serialized } from './modelQueue';

// Finding faces in a photo, with BlazeFace.
//
// The model does not hand back "here are two faces". It hands back a fixed
// grid of guesses — one per anchor, a candidate position baked in when it
// was trained — each with a score and a nudge away from its anchor. Nearly
// all of them are rubbish. Turning that into face boxes is this file.
//
// THREE MODELS, because distance matters more than it sounds. The
// short-range model is built for selfies and cannot see a face that is
// small in the frame: a photo of someone standing across a room comes back
// empty. That is fatal for a photo library, where most pictures are not
// selfies. The full-range models see to roughly five metres.
//
// Every constant below is from Google's own configuration for these exact
// models, checked against a reference implementation rather than
// remembered. They are not tunable: a wrong scale puts boxes slightly
// beside faces rather than on them, which looks like a bad model.

export type DetectorKind = 'short' | 'full' | 'full-sparse';

type Grid = { cells: number; perCell: number };

type Config = {
  label: string;
  inputSize: number;
  anchors: number;
  grids: Grid[];
  /** Below this, a detection is discarded. Google's figure per model. */
  minScore: number;
  asset: number;
};

const CONFIGS: Record<DetectorKind, Config> = {
  // Selfie distance only. Kept because it is the fastest and the most
  // accurate at what it does — a face filling the frame.
  short: {
    label: 'short range',
    inputSize: 128,
    anchors: 896,
    grids: [
      { cells: 16, perCell: 2 },
      { cells: 8, perCell: 6 },
    ],
    minScore: 0.6,
    asset: require('../assets/models/blaze_face_short_range.tflite'),
  },
  // To about five metres. One flat 48x48 grid, one anchor per cell.
  full: {
    label: 'full range',
    inputSize: 192,
    anchors: 2304,
    grids: [{ cells: 48, perCell: 1 }],
    minScore: 0.5,
    asset: require('../assets/models/blaze_face_full_range.tflite'),
  },
  // Same shape, a smaller and faster network. Google's own note: the sparse
  // model has higher precision, the dense one slightly better recall.
  'full-sparse': {
    label: 'full range (sparse)',
    inputSize: 192,
    anchors: 2304,
    grids: [{ cells: 48, perCell: 1 }],
    minScore: 0.5,
    asset: require('../assets/models/face_detection_full_range_sparse.tflite'),
  },
};

/** Values per anchor: 4 box numbers then 6 keypoints as x,y pairs. */
const BOX_STRIDE = 16;
/** Two boxes overlapping by more than this are the same face. */
const NMS_IOU = 0.3;

/** Per-photo tracing. Off by default: indexing a library is thousands of
 *  photos, and a console line each is both noise and a real slowdown —
 *  every message crosses from native into JavaScript. */
export let TRACE = false;

export function setTrace(on: boolean): void {
  TRACE = on;
}

/** A point on the face, in fractions of the photo. */
export type Point = { x: number; y: number };

/** BlazeFace returns six of these per face, in this order. Only the eyes
 *  are used today — to level the face before fingerprinting it — but the
 *  rest are kept because nose and mouth are what a better alignment would
 *  need, and they cost nothing to carry. */
export type Keypoints = {
  eyeA: Point;
  eyeB: Point;
  nose: Point;
  mouth: Point;
  earA: Point;
  earB: Point;
};

export type Detection = { box: FaceBox; score: number; keypoints: Keypoints };

export type FaceDetector = { kind: DetectorKind; model: TfliteModel; config: Config };

// The anchor grid. Fixed for the life of a model, so built once each.
//
// Every anchor is one unit wide and tall (these were trained with
// fixed_anchor_size), so only the centres matter and the width and height
// terms in the decode below collapse to 1.
const anchorCache = new Map<DetectorKind, Float32Array>();

function anchorGrid(kind: DetectorKind): Float32Array {
  const cached = anchorCache.get(kind);
  if (cached) return cached;

  const { grids, anchors } = CONFIGS[kind];
  const out = new Float32Array(anchors * 2);
  let i = 0;
  for (const { cells, perCell } of grids) {
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        for (let a = 0; a < perCell; a++) {
          out[i++] = (col + 0.5) / cells;
          out[i++] = (row + 0.5) / cells;
        }
      }
    }
  }
  if (i !== anchors * 2) {
    throw new Error(`${kind}: built ${i / 2} anchors, expected ${anchors}`);
  }
  anchorCache.set(kind, out);
  return out;
}

function sigmoid(x: number): number {
  // Clipped first, as the reference does: a raw score of -1000 overflows to
  // NaN rather than to zero, and one NaN poisons the whole sort.
  const c = Math.max(-100, Math.min(100, x));
  return 1 / (1 + Math.exp(-c));
}

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - overlap;
  return union <= 0 ? 0 : overlap / union;
}

// Keep the best box, drop everything sitting on top of it, repeat.
function suppress(found: Detection[]): Detection[] {
  const sorted = [...found].sort((p, q) => q.score - p.score);
  const kept: Detection[] = [];
  for (const candidate of sorted) {
    if (!kept.some((k) => iou(k.box, candidate.box) > NMS_IOU)) kept.push(candidate);
  }
  return kept;
}

export async function loadFaceDetector(kind: DetectorKind): Promise<FaceDetector> {
  const config = CONFIGS[kind];
  // core-ml puts this on the iPhone's Neural Engine. The delegate is a
  // request, not a guarantee — TensorFlow Lite silently falls back to the
  // CPU for any operation CoreML cannot take, which is why this is safe to
  // ask for unconditionally.
  const model = await loadTensorflowModel(config.asset, ['core-ml']);
  return { kind, model, config };
}

export async function detectFaces(
  detector: FaceDetector,
  image: SkImage,
): Promise<Detection[]> {
  return (await detectFacesWithInput(detector, image)).faces;
}

/** Same work, but also hands back the square the model was given. Only a
 *  diagnostic screen needs that; everything else wants just the faces. */
export async function detectFacesWithInput(
  detector: FaceDetector,
  image: SkImage,
): Promise<{ faces: Detection[]; square: SkImage | null }> {
  return detectRegion(detector, image, WHOLE);
}

const WHOLE: FaceBox = { x: 0, y: 0, w: 1, h: 1 };

async function detectRegion(
  { kind, model, config }: FaceDetector,
  image: SkImage,
  region: FaceBox,
): Promise<{ faces: Detection[]; square: SkImage | null }> {
  const { inputSize, anchors: NUM_ANCHORS, minScore } = config;

  const framed = letterboxRegion(image, region, inputSize);
  if (!framed) return { faces: [], square: null };

  const input = toModelInput(framed.pixels, inputSize);
  const outputs = await serialized(() => model.run([input.buffer as ArrayBuffer]));

  // Which output is which is decided by shape, not by position. The order
  // of a model's outputs is not part of its contract and has changed
  // between published versions of these very models.
  let raw: Float32Array | null = null;
  let scores: Float32Array | null = null;
  for (const buffer of outputs) {
    const view = new Float32Array(buffer);
    if (view.length === NUM_ANCHORS * BOX_STRIDE) raw = view;
    else if (view.length === NUM_ANCHORS) scores = view;
  }
  if (!raw || !scores) {
    console.warn(
      `[faces] ${kind}: expected ${NUM_ANCHORS} anchors, got ` +
        outputs.map((b) => new Float32Array(b).length).join(' and '),
    );
    return { faces: [], square: framed.square };
  }

  const grid = anchorGrid(kind);
  const found: Detection[] = [];

  // Out of the square, back into the original photo — undoing the bars the
  // letterbox added and then the tile's own position. Without the first
  // every box drifts towards the middle; without the second every box from
  // a tile lands in the top-left corner of the photo.
  const toX = (v: number) =>
    ((v * inputSize - framed.dx) / framed.scale + framed.originX) / image.width();
  const toY = (v: number) =>
    ((v * inputSize - framed.dy) / framed.scale + framed.originY) / image.height();

  for (let i = 0; i < NUM_ANCHORS; i++) {
    const score = sigmoid(scores[i]);
    if (score < minScore) continue;

    const o = i * BOX_STRIDE;
    const ax = grid[i * 2];
    const ay = grid[i * 2 + 1];

    // Raw numbers are in model pixels; dividing by the input size puts them
    // back into fractions of the square.
    const cx = raw[o] / inputSize + ax;
    const cy = raw[o + 1] / inputSize + ay;
    const bw = raw[o + 2] / inputSize;
    const bh = raw[o + 3] / inputSize;

    const x = toX(cx - bw / 2);
    const y = toY(cy - bh / 2);
    const box: FaceBox = { x, y, w: toX(cx + bw / 2) - x, h: toY(cy + bh / 2) - y };

    // A face mostly outside the frame cannot be cropped usefully.
    if (box.w <= 0 || box.h <= 0) continue;
    if (box.x + box.w < 0 || box.y + box.h < 0 || box.x > 1 || box.y > 1) continue;

    // The six keypoints sit after the four box numbers, as x,y pairs, and
    // decode exactly like the box centre does.
    const point = (n: number): Point => ({
      x: toX(raw[o + 4 + n * 2] / inputSize + ax),
      y: toY(raw[o + 5 + n * 2] / inputSize + ay),
    });

    found.push({
      box,
      score,
      keypoints: {
        eyeA: point(0),
        eyeB: point(1),
        nose: point(2),
        mouth: point(3),
        earA: point(4),
        earB: point(5),
      },
    });
  }

  const faces = suppress(found);
  if (TRACE) {
    console.log(
      `[faces] ${kind} on ${image.width()}x${image.height()}: ` +
        `${faces.length} of ${found.length} candidates`,
    );
  }
  return { faces, square: framed.square };
}

// How many tiles across, and how far apart. Half-size tiles a quarter of
// the way apart give a 3x3 grid that overlaps by half, so a face on a
// seam is still whole in a neighbouring tile.
const TILE = 0.5;
const STEP = 0.25;

/** A thorough pass: the whole photo, then nine overlapping pieces of it.
 *
 *  Ten times the work of a single look, so this is not what a library
 *  index should do to every photo. It is for the pictures a normal pass
 *  finds nothing in — a person standing across a museum hall, whose face
 *  is four pixels tall once the photo has been shrunk to fit the model. */
export async function detectFacesThorough(
  detector: FaceDetector,
  image: SkImage,
): Promise<Detection[]> {
  const all: Detection[] = [...(await detectRegion(detector, image, WHOLE)).faces];

  for (let ty = 0; ty + TILE <= 1.0001; ty += STEP) {
    for (let tx = 0; tx + TILE <= 1.0001; tx += STEP) {
      const { faces } = await detectRegion(detector, image, {
        x: tx,
        y: ty,
        w: TILE,
        h: TILE,
      });
      all.push(...faces);
    }
  }

  // The same face is found by up to four overlapping tiles, so the merge
  // matters as much as the search.
  const merged = suppress(all);
  if (TRACE) {
    console.log(`[faces] thorough: ${merged.length} from ${all.length} across 10 looks`);
  }
  return merged;
}
