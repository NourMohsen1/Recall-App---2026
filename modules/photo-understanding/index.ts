import { requireOptionalNativeModule } from 'expo';

// Understands photos on the phone — see ios/PhotoUnderstandingModule.swift.
// Optional so a build without it keeps working (the JS reaches a phone over
// Wi-Fi before the native build that contains this does).

export type VisionLabel = { id: string; confidence: number };

export type PhotoUnderstanding = {
  /** Apple Vision's built-in scene labels, most sure first. */
  labels: VisionLabel[];
  /** SigLIP 2 image embedding: 768 numbers, normalised. */
  embedding: number[];
  ms: { fetch: number; vision: number; clip: number };
};

type Native = {
  prepare(): Promise<{ ms: number }>;
  analyze(assetId: string): Promise<PhotoUnderstanding>;
};

const native = requireOptionalNativeModule<Native>('PhotoUnderstanding');

export const photoUnderstandingAvailable = native != null;

export function preparePhotoModel(): Promise<{ ms: number }> {
  if (!native) throw new Error('This build of Recall cannot read photos on the phone yet — it needs the app update.');
  return native.prepare();
}

export function analyzePhoto(assetId: string): Promise<PhotoUnderstanding> {
  if (!native) throw new Error('This build of Recall cannot read photos on the phone yet — it needs the app update.');
  return native.analyze(assetId);
}
