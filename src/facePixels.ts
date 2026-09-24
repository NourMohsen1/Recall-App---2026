import {
  AlphaType,
  ColorType,
  ImageFormat,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import type { FaceBox } from './faceIndex';

// Photos in, numbers out.
//
// A .tflite model cannot read a JPEG. It wants a flat run of floats, one per
// colour channel per pixel, at exactly the size it was trained on — 128x128
// for the detector, 112x112 for the fingerprinter. Everything in this file
// exists to bridge that gap, and nothing in it knows what a face is.
//
// Skia does the decoding because it is already in the app for drawing, it
// decodes HEIC (which is what an iPhone actually writes), and it resizes on
// the GPU. The alternative — base64 through JavaScript — was tried in other
// projects and is roughly an order of magnitude slower per photo, which
// matters when the job is "read ten thousand photos once".

/** Decode a photo from disk. Null when the file is gone or unreadable —
 *  an iCloud photo that never downloaded looks exactly like this. */
export async function decodePhoto(uri: string): Promise<SkImage | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}

// Pull a square region out of a photo and squash it to `size` x `size`.
//
// `box` is in fractions of the frame (0-1), the same units faceIndex stores,
// so this works the same whether the photo is 4032px wide or 400. Passing
// the whole frame (0,0,1,1) is how the detector gets its input.
export function cropToPixels(
  image: SkImage,
  box: FaceBox,
  size: number,
): Uint8Array | null {
  return cropToImage(image, box, size)?.pixels ?? null;
}

/** The same cut, kept as a picture as well as numbers — so the app can show
 *  a face to the person it is asking about it. */
export function cropToImage(
  image: SkImage,
  box: FaceBox,
  size: number,
): { pixels: Uint8Array; square: SkImage } | null {
  const surface = Skia.Surface.MakeOffscreen(size, size) ?? Skia.Surface.Make(size, size);
  if (!surface) return null;

  const w = image.width();
  const h = image.height();
  const src = Skia.XYWHRect(box.x * w, box.y * h, box.w * w, box.h * h);
  const dst = Skia.XYWHRect(0, 0, size, size);

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  surface.getCanvas().drawImageRect(image, src, dst, paint);
  surface.flush();

  const square = surface.makeImageSnapshot();
  const pixels = square.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });

  // readPixels can hand back a Float32Array for float formats. We asked for
  // 8-bit, so anything else means the request was not honoured and the bytes
  // would be misread rather than merely wrong.
  return pixels instanceof Uint8Array ? { pixels, square } : null;
}

// RGBA bytes (0-255) to the RGB floats a model wants.
//
// Both models here were trained on inputs centred at zero and running from
// -1 to 1, which is (v - 127.5) / 127.5. The alpha channel is dropped: no
// face model has an opinion about transparency.
export function toModelInput(rgba: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4) {
    out[o++] = (rgba[i] - 127.5) / 127.5;
    out[o++] = (rgba[i + 1] - 127.5) / 127.5;
    out[o++] = (rgba[i + 2] - 127.5) / 127.5;
  }
  return out;
}

// Grow a box outwards, clamped to the photo's edges.
//
// The detector returns a tight crop — eyebrows to chin. Fingerprint models
// are trained on a looser crop that includes some forehead, hair and jaw,
// and feeding them the tight box measurably weakens the match. 25% each way
// is the usual figure; it is a starting point, not a measured one.
export function padBox(box: FaceBox, factor: number): FaceBox {
  const dx = (box.w * factor) / 2;
  const dy = (box.h * factor) / 2;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return {
    x,
    y,
    w: Math.min(1 - x, box.w + dx * 2),
    h: Math.min(1 - y, box.h + dy * 2),
  };
}

// A whole photo, fitted into a square without distorting it.
//
// The detector's input is square; almost no photo is. Squashing a 4:3 photo
// into a square stretches every face in it sideways, which costs detections
// and — worse — hands the fingerprinter a face of the wrong proportions.
// So the photo is scaled to fit and centred, leaving blank bars, exactly as
// MediaPipe does it.
//
// The returned scale and offset are how a box found in the square gets
// translated back to a position in the original photo. Without them every
// box would be shifted by the width of the bars.
export type Letterbox = {
  pixels: Uint8Array;
  /** The square exactly as the model receives it. Kept so a person can
   *  LOOK at it: a blank, rotated or squashed square explains a bad
   *  detection instantly, where raw numbers only hint at one. */
  square: SkImage;
  /** Pixels of the original per pixel of the square. */
  scale: number;
  /** Where the photo starts inside the square, in square-pixels. */
  dx: number;
  dy: number;
  /** Where this region starts in the whole photo, in photo pixels. Zero
   *  for a whole-photo letterbox; the tile's corner otherwise. */
  originX: number;
  originY: number;
};

export function letterboxToPixels(image: SkImage, size: number): Letterbox | null {
  return letterboxRegion(image, { x: 0, y: 0, w: 1, h: 1 }, size);
}

// The same, for one piece of a photo.
//
// A detector shrinks whatever it is given to a fixed square, so a face
// that is 2% of a photo's height arrives about four pixels tall and cannot
// be found by anything. Handing it a quarter of the photo instead makes
// that same face four times bigger. `region` is in fractions of the photo,
// and the returned scale and offset map a detection back to the whole
// picture — so a caller never has to think in tile coordinates.
export function letterboxRegion(
  image: SkImage,
  region: FaceBox,
  size: number,
): Letterbox | null {
  const surface = Skia.Surface.MakeOffscreen(size, size) ?? Skia.Surface.Make(size, size);
  if (!surface) return null;

  const imgW = image.width();
  const imgH = image.height();
  const srcX = region.x * imgW;
  const srcY = region.y * imgH;
  const w = region.w * imgW;
  const h = region.h * imgH;
  const scale = size / Math.max(w, h);
  const drawnW = w * scale;
  const drawnH = h * scale;
  const dx = (size - drawnW) / 2;
  const dy = (size - drawnH) / 2;

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('black'));
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImageRect(
    image,
    Skia.XYWHRect(srcX, srcY, w, h),
    Skia.XYWHRect(dx, dy, drawnW, drawnH),
    paint,
  );
  surface.flush();

  const square = surface.makeImageSnapshot();
  const pixels = square.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(pixels instanceof Uint8Array)) return null;

  return { pixels, square, scale, dx, dy, originX: srcX, originY: srcY };
}

// A face, levelled.
//
// This is the step that was missing. A recognition model is trained on
// faces that have all been rotated so the eyes are horizontal and sitting
// at the same spot in the frame — so the only thing left varying between
// two crops is the face itself. Feed it a head tilted twenty degrees and a
// large part of what it measures is the tilt.
//
// The destination eye positions below are the ArcFace 112x112 template, the
// one this family of models is trained against, scaled to whatever input
// size the model actually asks for.
const TEMPLATE_SIZE = 112;
const LEFT_EYE = { x: 38.2946, y: 51.6963 };
const RIGHT_EYE = { x: 73.5318, y: 51.5014 };

export function alignedCrop(
  image: SkImage,
  eyeA: { x: number; y: number },
  eyeB: { x: number; y: number },
  size: number,
): Uint8Array | null {
  return alignedCropWithImage(image, eyeA, eyeB, size)?.pixels ?? null;
}

export function alignedCropWithImage(
  image: SkImage,
  eyeA: { x: number; y: number },
  eyeB: { x: number; y: number },
  size: number,
): { pixels: Uint8Array; square: SkImage } | null {
  const surface = Skia.Surface.MakeOffscreen(size, size) ?? Skia.Surface.Make(size, size);
  if (!surface) return null;

  const w = image.width();
  const h = image.height();

  // Keypoints arrive as fractions of the photo; the maths below is in
  // pixels. Which eye is which is decided by position, not by the order
  // the detector happened to return them in.
  const eyes = [eyeA, eyeB]
    .map((e) => ({ x: e.x * w, y: e.y * h }))
    .sort((p, q) => p.x - q.x);
  const [src0, src1] = eyes;

  const k = size / TEMPLATE_SIZE;
  const dst0 = { x: LEFT_EYE.x * k, y: LEFT_EYE.y * k };
  const dst1 = { x: RIGHT_EYE.x * k, y: RIGHT_EYE.y * k };

  const srcSpan = Math.hypot(src1.x - src0.x, src1.y - src0.y);
  if (srcSpan < 1) return null; // eyes on top of each other — a bad detection

  const dstSpan = Math.hypot(dst1.x - dst0.x, dst1.y - dst0.y);
  const scale = dstSpan / srcSpan;
  const angle =
    Math.atan2(dst1.y - dst0.y, dst1.x - dst0.x) -
    Math.atan2(src1.y - src0.y, src1.x - src0.x);

  // Rotate about the left eye, scale, then move that eye onto its mark.
  // Everything else follows from those two points.
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('black'));
  canvas.translate(dst0.x, dst0.y);
  canvas.rotate((angle * 180) / Math.PI, 0, 0);
  canvas.scale(scale, scale);
  canvas.translate(-src0.x, -src0.y);

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  canvas.drawImage(image, 0, 0, paint);
  surface.flush();

  const square = surface.makeImageSnapshot();
  const pixels = square.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  return pixels instanceof Uint8Array ? { pixels, square } : null;
}

/** For looking at, not for measuring. */
export function asDataUri(image: SkImage): string {
  return `data:image/png;base64,${image.encodeToBase64(ImageFormat.PNG, 100)}`;
}

// The other two things a model can be fussy about.
//
// Nothing in a .tflite file says whether it wants red-first or blue-first,
// or numbers from -1 to 1 rather than 0 to 1. Guessing wrong does not throw
// an error — it quietly weakens every comparison, which is exactly the
// symptom we are chasing. So both are options, and the test measures them
// rather than assuming.
export type PixelOptions = {
  /** 'rgb' or 'bgr'. */
  order?: 'rgb' | 'bgr';
  /** 'signed'   = -1..1, the usual for models of this family.
   *  'unit'     = 0..1.
   *  'standard' = each crop shifted and scaled by its OWN brightness and
   *               contrast, which is what FaceNet is documented to expect.
   *               It also throws away lighting differences before the model
   *               ever sees them, which is half of why two photos of the
   *               same person look different. */
  range?: 'signed' | 'unit' | 'standard';
};

export function toModelInputWith(
  rgba: Uint8Array,
  size: number,
  { order = 'rgb', range = 'signed' }: PixelOptions = {},
): Float32Array {
  const out = new Float32Array(size * size * 3);

  // Copy the three channels out in the requested order first; the scaling
  // that follows may need to see all of them before it can decide anything.
  const a = order === 'rgb' ? 0 : 2;
  const c = order === 'rgb' ? 2 : 0;
  for (let i = 0, o = 0; i < rgba.length; i += 4) {
    out[o++] = rgba[i + a];
    out[o++] = rgba[i + 1];
    out[o++] = rgba[i + c];
  }

  if (range === 'standard') {
    // Mean and standard deviation of this crop alone. The guard on the
    // divisor matters: a completely flat crop — a face lost in shadow, or
    // a blown-out one — has no variation at all, and dividing by it would
    // turn every pixel into NaN and the fingerprint into nonsense.
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    const mean = sum / out.length;
    let variance = 0;
    for (let i = 0; i < out.length; i++) variance += (out[i] - mean) ** 2;
    const std = Math.max(Math.sqrt(variance / out.length), 1 / Math.sqrt(out.length));
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / std;
    return out;
  }

  const shift = range === 'signed' ? 127.5 : 0;
  const divisor = range === 'signed' ? 127.5 : 255;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - shift) / divisor;
  return out;
}
