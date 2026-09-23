import { backfillAssumedMemories } from './assumedMemory';
import { startBackgroundFaceScan } from './faceMatching';

// Owns WHEN the photo analysis runs, so no screen has to.
//
// The rule: analysis is the app's own background job, not something the
// user waits on or triggers. It starts as soon as the app opens and again
// right after a photo sync, and it just keeps going quietly. By the time
// anyone opens Ask, the data is already there — Ask never kicks off work
// of its own, so nothing competes with a question being asked.
//
// It's deliberately fire-and-forget and never surfaces errors: a day that
// fails (offline, rate-limited) simply isn't cached, so the next run picks
// it up again.

let started = false;

// Called once when the app boots. Safe to call again — the underlying pass
// guards against overlapping runs, and days already analyzed cost nothing.
export function startPhotoAnalysis(): void {
  if (started) return;
  started = true;
  // Photo analysis first, then a small slice of face matching — the way the
  // Photos app quietly fills in People in the background. It takes a few
  // batches per person and stops, remembers how far back it got, and stands
  // aside the moment the user runs a scan themselves. The earlier version of
  // this was unbounded and blocked manual scans; see faceMatching.ts.
  backfillAssumedMemories()
    .then(() => startBackgroundFaceScan())
    .catch(() => {});
}

// Called right after a photo sync brings in new days. Bypasses the
// once-per-launch guard, since there's genuinely new work to do.
export function runPhotoAnalysisNow(): void {
  backfillAssumedMemories().catch(() => {});
}
