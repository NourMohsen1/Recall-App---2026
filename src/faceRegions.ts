import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
import { getPhotoMeta } from './photoMeta';
import { resolvePhotoUri } from './photoUri';

// Reads the face rectangles iOS already wrote into a photo's own metadata.
//
// Apple's Photos app detects faces on device and stores where they are —
// position, size, angle, confidence and a local face id — in the image's
// metadata (the Metadata Working Group "Regions" block, which tools flatten
// to RegionAreaX / RegionAreaY / RegionExtensionsFaceID and friends). The
// PERSON's name is never in there, and the People album itself is off limits
// to third-party apps entirely. But the rectangles alone are worth having:
// they turn "scroll your whole library to find a photo of your brother" into
// "here are the faces from the days you were together, tap the right one".
//
// IMPORTANT: whether these keys survive into what expo-media-library returns
// is not documented and may well differ by device, photo format and whether
// the original is still on the phone. So every part of this is written to
// return nothing rather than to fail, and every caller must work fine with
// an empty result. `probeFaceRegions` below exists to find out the truth on
// a real device instead of guessing.

export type FaceRegion = {
  // Fractions of the image, 0-1, measured from the top-left. The centre of
  // the face is (x, y) and the box is w by h — that's the MWG convention.
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
};

// The same values show up under several spellings depending on who wrote the
// file and who parsed it, so each field lists every name worth trying.
const KEYS = {
  x: ['RegionAreaX', 'AreaX', 'regionAreaX', 'x'],
  y: ['RegionAreaY', 'AreaY', 'regionAreaY', 'y'],
  w: ['RegionAreaW', 'AreaW', 'regionAreaW', 'w'],
  h: ['RegionAreaH', 'AreaH', 'regionAreaH', 'h'],
  confidence: ['RegionExtensionsConfidenceLevel', 'ConfidenceLevel', 'confidence'],
  type: ['RegionType', 'Type', 'type'],
};

function firstNumber(source: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const value = source[name];
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

// Metadata dictionaries nest differently on every path through the system,
// so rather than guess one shape this walks the whole object looking for
// anything that has the four numbers a face rectangle needs.
function collectRegions(node: unknown, out: FaceRegion[], depth = 0): void {
  if (!node || depth > 6 || out.length >= 32) return;

  if (Array.isArray(node)) {
    for (const item of node) collectRegions(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  const x = firstNumber(obj, KEYS.x);
  const y = firstNumber(obj, KEYS.y);
  const w = firstNumber(obj, KEYS.w);
  const h = firstNumber(obj, KEYS.h);

  if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
    // Regions also mark pets and barcodes; only faces are useful here. When
    // no type is stated at all, assume a face — Apple's are.
    const type = KEYS.type.map((k) => obj[k]).find((v) => typeof v === 'string') as string | undefined;
    if (!type || /face/i.test(type)) {
      // Some writers store percentages rather than fractions.
      const scale = w > 1 || h > 1 ? 0.01 : 1;
      out.push({
        x: x * scale,
        y: y * scale,
        w: w * scale,
        h: h * scale,
        confidence: firstNumber(obj, KEYS.confidence),
      });
    }
  }

  // Flattened dictionaries put several faces in parallel arrays under one
  // key, so keep walking even after a hit at this level.
  for (const value of Object.values(obj)) collectRegions(value, out, depth + 1);
}

// The face rectangles in one photo, or an empty array — including whenever
// the metadata simply isn't there, which may be most of the time.
export async function faceRegionsFor(uri: string): Promise<FaceRegion[]> {
  try {
    const meta = await getPhotoMeta(uri);
    if (!meta?.assetId) return [];
    const info = await MediaLibrary.getAssetInfoAsync(meta.assetId, {
      shouldDownloadFromNetwork: false,
    });
    if (!info?.exif) return [];
    const out: FaceRegion[] = [];
    collectRegions(info.exif, out);
    // Same face found under two spellings — collapse near-duplicates.
    return out.filter(
      (r, i) =>
        r.w > 0 &&
        r.h > 0 &&
        out.findIndex((o) => Math.abs(o.x - r.x) < 0.01 && Math.abs(o.y - r.y) < 0.01) === i,
    );
  } catch {
    return [];
  }
}

// How much wider than the detected box to cut, so the crop is a portrait
// rather than a tight rectangle of features — face boxes stop at the chin
// and hairline, which looks wrong as a profile picture.
const CROP_PADDING = 1.9;

// Crops a photo down to the biggest face in it. Returns null when the photo
// has no face metadata, which is the caller's cue to use the whole image.
//
// This is the payoff for all of the above: the user taps a group photo from
// a day they were together and gets a portrait, instead of having to find
// and crop one themselves.
export async function cropToFace(uri: string): Promise<string | null> {
  try {
    const meta = await getPhotoMeta(uri);
    if (!meta?.assetId) return null;
    const info = await MediaLibrary.getAssetInfoAsync(meta.assetId, {
      shouldDownloadFromNetwork: false,
    });
    if (!info?.exif || !info.width || !info.height) return null;

    const regions: FaceRegion[] = [];
    collectRegions(info.exif, regions);
    if (regions.length === 0) return null;

    // The largest face is the likeliest subject of the photo.
    const face = regions.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    const local = await resolvePhotoUri(info.localUri ?? uri);
    if (!local) return null;

    // MWG regions give the CENTRE of the face, not a corner.
    const side = Math.min(
      Math.max(face.w * info.width, face.h * info.height) * CROP_PADDING,
      Math.min(info.width, info.height),
    );
    const originX = Math.round(
      Math.min(Math.max(face.x * info.width - side / 2, 0), info.width - side),
    );
    const originY = Math.round(
      Math.min(Math.max(face.y * info.height - side / 2, 0), info.height - side),
    );

    const result = await manipulateAsync(
      local,
      [{ crop: { originX, originY, width: Math.round(side), height: Math.round(side) } }],
      { compress: 0.9, format: SaveFormat.JPEG },
    );
    return result.uri;
  } catch {
    return null;
  }
}

// Answers the one question the docs won't: does any of this actually come
// through on a real device? Reads a handful of real photos and reports what
// was found, including the metadata's top-level keys so the shape can be
// seen even when no faces are recognised. Used by the diagnostic in
// Profile; costs nothing and touches no network.
export type FaceProbe = {
  checked: number;
  withExif: number;
  withRegions: number;
  totalFaces: number;
  sampleKeys: string[];
};

export async function probeFaceRegions(uris: string[], limit = 8): Promise<FaceProbe> {
  const probe: FaceProbe = {
    checked: 0,
    withExif: 0,
    withRegions: 0,
    totalFaces: 0,
    sampleKeys: [],
  };

  for (const uri of uris.slice(0, limit)) {
    try {
      const meta = await getPhotoMeta(uri);
      if (!meta?.assetId) continue;
      probe.checked += 1;
      const info = await MediaLibrary.getAssetInfoAsync(meta.assetId, {
        shouldDownloadFromNetwork: false,
      });
      if (!info?.exif) continue;
      probe.withExif += 1;
      if (probe.sampleKeys.length === 0) {
        probe.sampleKeys = Object.keys(info.exif as Record<string, unknown>).slice(0, 25);
      }
      const found: FaceRegion[] = [];
      collectRegions(info.exif, found);
      if (found.length > 0) {
        probe.withRegions += 1;
        probe.totalFaces += found.length;
      }
    } catch {
      // A photo that can't be read tells us nothing; move on.
    }
  }

  return probe;
}
