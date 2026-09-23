import { DetectedFace } from './faceIndex';

// The one piece that needs a real build, kept behind a door.
//
// Finding faces in a photo and turning each into a fingerprint is the only
// part of recognition that needs native code: a detector and an embedding
// model, both running on the phone. Everything else — storing fingerprints,
// searching them, showing the results, tracking progress — is ordinary
// JavaScript and works today.
//
// So the model is not imported anywhere. It REGISTERS itself at startup, and
// until it does, the rest of the app reads faceEmbedderAvailable() as false
// and simply doesn't index. That means:
//   · the app keeps running in Expo Go, where the model cannot exist
//   · dropping the model in later is one call, not a rewrite
//   · a test can register a fake embedder and exercise the entire pipeline
//     without a device, which is how all of this is verified now
//
// The contract is deliberately narrow. Give it a photo, get back every face
// in it with a box and a fingerprint. Nothing about models, tensors or
// pixels leaks past this line.
export type FaceEmbedder = {
  /** For logging, and to notice when the model has changed. */
  readonly name: string;
  /** Length of the fingerprints it produces. Fingerprints from different
   *  models are not comparable, so a change here invalidates the index. */
  readonly dimensions: number;
  detectAndEmbed(photoUri: string): Promise<DetectedFace[]>;
};

let embedder: FaceEmbedder | null = null;

export function registerFaceEmbedder(next: FaceEmbedder | null): void {
  embedder = next;
}

export function faceEmbedderAvailable(): boolean {
  return embedder !== null;
}

export function getFaceEmbedder(): FaceEmbedder | null {
  return embedder;
}

// What the app tells the user when there is no model. Not an error — the
// feature is simply not switched on in this build.
export const NO_EMBEDDER_REASON =
  'Face recognition needs the installed version of Recall, not Expo Go.';
