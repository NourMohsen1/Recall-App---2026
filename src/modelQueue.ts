// One model call at a time, app-wide.
//
// A TFLite interpreter holds a single set of working buffers and returns a
// view onto its own output. Two overlapping run() calls share those
// buffers, and the second quietly corrupts the first — no error thrown,
// just a fingerprint that belongs to a different face than the one asked
// about. That is a bug which cannot be seen in the result, only measured:
// it showed up as a stranger and the user scoring identically.
//
// Putting the guard here rather than at each call site means overlap is
// impossible by construction, including from two screens at once.
let queue: Promise<unknown> = Promise.resolve();

export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // The chain must survive a failed call, or every later one rejects with
  // an error that has nothing to do with it.
  queue = next.catch(() => undefined);
  return next;
}
