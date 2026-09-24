import {
  faceDb,
  MATCH_THRESHOLD,
  normalize,
  packEmbedding,
  similarity,
  unpackEmbedding,
} from './faceIndex';
import { addGuess, forgetCluster } from './guessedPeople';

// Grouping faces into people, before anyone has said who they are.
//
// THE POINT OF DOING IT THIS WAY. The obvious approach is to take a person
// the user already made, fingerprint their profile photo, and go looking
// for them. That only ever finds people the user thought to add, which
// leaves the app waiting to be told things it could have noticed. The goal
// is the opposite: the app reads the library, works out that the same
// stranger appears in forty-seven photos across two years, and asks one
// question — who is this? One answer then fills in every one of those days.
//
// So nothing here knows any names. It knows that these faces belong
// together, which is a question about geometry and can be answered without
// the user. Names arrive later and attach to a group that already exists.
//
// HOW THE GROUPING WORKS, and why not the textbook way. Comparing every
// face to every other face is the accurate method and is quadratic: ten
// thousand faces is fifty million comparisons of 512 numbers each, which a
// phone will not do while someone is holding it. Instead each new face is
// compared to the AVERAGE of each group so far — a few hundred comparisons
// rather than ten thousand — and joins the closest if it is close enough,
// or starts its own group if it is not.
//
// That trades some accuracy for being possible at all. Its failure mode is
// deliberate: it splits one person into two groups more often than it merges
// two people into one. A split is a small annoyance the user can fix by
// naming both groups the same thing. A merge silently files one person's
// memories under another person's name, and the user has no way to see that
// it happened.

// How alike two faces must be to be called the same person HERE.
//
// Deliberately stricter than MATCH_THRESHOLD (0.47), which answers a
// different question. That number was chosen so a threshold sits between
// the worst same-person pair (0.574) and the best stranger pair (0.365)
// when comparing ONE face to ONE face. Grouping compares a face to an
// average of many, and every wrong join corrupts that average for every
// comparison afterwards — one mistake early can pull a whole group off
// course. So this sits nearer the same-person end: 0.55 still sits well
// above the worst stranger score measured, while leaving less room to
// wander.
export const CLUSTER_THRESHOLD = 0.55;

// Groups smaller than this are not worth asking about.
//
// A library is full of people who are in it once: a waiter, a stranger at
// the next table, somebody's cousin at a wedding. Asking the user to name
// all of them would bury the handful of people they actually see. Someone
// who matters shows up more than twice.
export const MIN_CLUSTER_SIZE = 3;

export type Cluster = {
  id: number;
  /** What the user called them, once they have said. */
  name: string | null;
  /** How many faces are in the group. */
  size: number;
  /** Days this person appears on, newest first. */
  days: string[];
  /** A face to show the user, so the question is answerable. */
  sample: { photoUri: string; box: { x: number; y: number; w: number; h: number } } | null;
};

async function ready(): Promise<Awaited<ReturnType<typeof faceDb>>> {
  const handle = await faceDb();
  await handle.execAsync(`
    CREATE TABLE IF NOT EXISTS face_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Null until the user names it. A group is a real thing before it
      -- has a name; naming is what connects it to the rest of the app.
      name TEXT,
      -- The running average of every face in the group, as the same packed
      -- bytes a face uses. Kept so joining a group costs one comparison
      -- rather than one per member.
      centroid TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0
    );
  `);

  // The link from a face to its group. Added separately because the faces
  // table predates clustering and already has rows in it on every device
  // that has run a pass.
  const columns = await handle.getAllAsync<{ name: string }>('PRAGMA table_info(faces)');
  if (!columns.some((c) => c.name === 'cluster_id')) {
    await handle.execAsync('ALTER TABLE faces ADD COLUMN cluster_id INTEGER');
    await handle.execAsync(
      'CREATE INDEX IF NOT EXISTS faces_cluster ON faces (cluster_id)',
    );
  }
  return handle;
}

type Centroid = { id: number; vector: Float32Array; size: number };

async function loadCentroids(
  handle: Awaited<ReturnType<typeof faceDb>>,
): Promise<Centroid[]> {
  const rows = await handle.getAllAsync<{ id: number; centroid: string; size: number }>(
    'SELECT id, centroid, size FROM face_clusters',
  );
  return rows.map((r) => ({
    id: r.id,
    vector: unpackEmbedding(r.centroid),
    size: r.size,
  }));
}

/** Sort faces into groups. Only looks at faces no pass has seen yet, so
 *  running it again after more photos are read is cheap. */
export async function clusterFaces(): Promise<{ grouped: number; groups: number }> {
  const handle = await ready();

  const pending = await handle.getAllAsync<{ id: number; embedding: string }>(
    // Oldest first, so the groups a user has already been asked about keep
    // their identity as the library grows rather than being renumbered.
    'SELECT id, embedding FROM faces WHERE cluster_id IS NULL ORDER BY id ASC',
  );
  if (pending.length === 0) {
    const [{ n }] = await handle.getAllAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM face_clusters',
    );
    return { grouped: 0, groups: n };
  }

  const centroids = await loadCentroids(handle);
  let grouped = 0;

  for (const face of pending) {
    const vector = unpackEmbedding(face.embedding);

    let best: Centroid | null = null;
    let bestScore = -1;
    for (const c of centroids) {
      const score = similarity(vector, c.vector);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best && bestScore >= CLUSTER_THRESHOLD) {
      // The average moves towards the new face by one member's worth. A
      // group of fifty barely shifts; a group of two shifts a lot, which is
      // what should happen — a young group is still deciding what it is.
      const next = new Float32Array(vector.length);
      for (let i = 0; i < vector.length; i++) {
        next[i] = (best.vector[i] * best.size + vector[i]) / (best.size + 1);
      }
      best.vector = normalize(next);
      best.size += 1;

      await handle.runAsync('UPDATE faces SET cluster_id = ? WHERE id = ?', best.id, face.id);
      await handle.runAsync(
        'UPDATE face_clusters SET centroid = ?, size = ? WHERE id = ?',
        packEmbedding(best.vector),
        best.size,
        best.id,
      );
    } else {
      const result = await handle.runAsync(
        'INSERT INTO face_clusters (name, centroid, size) VALUES (NULL, ?, 1)',
        packEmbedding(vector),
      );
      const id = result.lastInsertRowId;
      await handle.runAsync('UPDATE faces SET cluster_id = ? WHERE id = ?', id, face.id);
      centroids.push({ id, vector, size: 1 });
    }
    grouped += 1;
  }

  // Anything new that looks like somebody already named becomes them,
  // without asking again.
  await inheritNames(handle);

  return { grouped, groups: centroids.length };
}

// Groups that match a group the user has already named inherit that name.
//
// WHY THIS EXISTS. Grouping deliberately errs towards splitting one person
// into several groups rather than merging two people into one, because a
// split is a nuisance and a merge is a lie. The cost of that choice is
// exactly what happened on the first real run: the user was asked who he
// was twice, about two groups that were both him.
//
// This pays that cost back. Once a group has a name, any later group that
// looks like the same person takes the name without asking — so a person is
// named once, not once per group, and photos that arrive next month attach
// themselves to people who already exist.
//
// The comparison is between two AVERAGES of many faces rather than between
// two single faces, which is a cleaner signal than the one MATCH_THRESHOLD
// was measured for — so using that same 0.47 here is the cautious choice,
// not a loose one.
async function inheritNames(
  handle: Awaited<ReturnType<typeof faceDb>>,
): Promise<number> {
  const rows = await handle.getAllAsync<{ id: number; name: string | null; centroid: string }>(
    'SELECT id, name, centroid FROM face_clusters WHERE size >= ?',
    MIN_CLUSTER_SIZE,
  );
  const named = rows.filter((r) => r.name !== null && r.name !== DISMISSED);
  const unnamed = rows.filter((r) => r.name === null);
  if (named.length === 0 || unnamed.length === 0) return 0;

  let linked = 0;
  for (const group of unnamed) {
    const vector = unpackEmbedding(group.centroid);
    let best: { name: string; score: number } | null = null;
    for (const other of named) {
      const score = similarity(vector, unpackEmbedding(other.centroid));
      if (!best || score > best.score) best = { name: other.name as string, score };
    }
    if (best && best.score >= MATCH_THRESHOLD) {
      await nameCluster(group.id, best.name);
      linked += 1;
    }
  }
  return linked;
}

/** Where the grouping has got to. Shown to the user rather than kept for
 *  debugging: "no people found yet" and "no people found because only 40
 *  photos have been read so far" are very different messages, and only one
 *  of them tells someone to come back later. */
export async function clusterStats(): Promise<{
  faces: number;
  grouped: number;
  groups: number;
  needNames: number;
}> {
  const handle = await ready();
  const [counts] = await handle.getAllAsync<{ faces: number; grouped: number }>(
    'SELECT COUNT(*) AS faces, COUNT(cluster_id) AS grouped FROM faces',
  );
  const [groups] = await handle.getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM face_clusters WHERE size >= ?',
    MIN_CLUSTER_SIZE,
  );
  const [unnamed] = await handle.getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM face_clusters WHERE name IS NULL AND size >= ?',
    MIN_CLUSTER_SIZE,
  );
  return {
    faces: counts?.faces ?? 0,
    grouped: counts?.grouped ?? 0,
    groups: groups?.n ?? 0,
    needNames: unnamed?.n ?? 0,
  };
}

/** Groups worth showing someone, biggest first. */
export async function getClusters(options?: {
  named?: boolean;
  minSize?: number;
}): Promise<Cluster[]> {
  const handle = await ready();
  const minSize = options?.minSize ?? MIN_CLUSTER_SIZE;

  const where =
    options?.named === true
      ? `WHERE name IS NOT NULL AND name != '${DISMISSED}'`
      : options?.named === false
        ? `WHERE name IS NULL`
        : `WHERE name IS NULL OR name != '${DISMISSED}'`;

  const rows = await handle.getAllAsync<{ id: number; name: string | null; size: number }>(
    `SELECT id, name, size FROM face_clusters ${where} ORDER BY size DESC`,
  );

  const out: Cluster[] = [];
  for (const row of rows) {
    if (row.size < minSize) continue;

    const days = await handle.getAllAsync<{ day: string }>(
      'SELECT DISTINCT day FROM faces WHERE cluster_id = ? ORDER BY day DESC',
      row.id,
    );
    // The biggest face in the group is the clearest one to show.
    const [sample] = await handle.getAllAsync<{
      photo_uri: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>(
      'SELECT photo_uri, x, y, w, h FROM faces WHERE cluster_id = ? ORDER BY w * h DESC LIMIT 1',
      row.id,
    );

    out.push({
      id: row.id,
      name: row.name,
      size: row.size,
      days: days.map((d) => d.day),
      sample: sample
        ? {
            photoUri: sample.photo_uri,
            box: { x: sample.x, y: sample.y, w: sample.w, h: sample.h },
          }
        : null,
    });
  }
  return out;
}

/** Say who a group is, and let that answer do its work.
 *
 *  This is the moment the whole feature turns on. One answer about one face
 *  becomes that person appearing on every day the group covers — which is
 *  the difference between an app that has to be told things and one that
 *  notices them.
 *
 *  Those days arrive as GUESSES, not facts: shown straight away, marked as
 *  the app's opinion until the user agrees. See src/guessedPeople.ts.
 *
 *  Naming two groups the same thing is allowed and expected — it is how a
 *  user repairs a person who got split in two, and the days simply add up.
 */
export async function nameCluster(id: number, name: string): Promise<number> {
  const handle = await ready();
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    await handle.runAsync('UPDATE face_clusters SET name = NULL WHERE id = ?', id);
    return 0;
  }

  await handle.runAsync('UPDATE face_clusters SET name = ? WHERE id = ?', trimmed, id);

  // One face per day, the biggest, so the user is shown the clearest
  // example of what the app is claiming rather than a name on its own.
  const days = await handle.getAllAsync<{
    day: string;
    photo_uri: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>(
    `SELECT day, photo_uri, x, y, w, h FROM faces f
      WHERE cluster_id = ?
        AND w * h = (SELECT MAX(w * h) FROM faces WHERE cluster_id = f.cluster_id AND day = f.day)
      GROUP BY day`,
    id,
  );
  for (const d of days) {
    await addGuess(d.day, trimmed, id, {
      photoUri: d.photo_uri,
      box: { x: d.x, y: d.y, w: d.w, h: d.h },
    });
  }
  return days.length;
}

/** Not a person worth keeping — a stranger in the background, a face on a
 *  poster. Hidden rather than deleted: the faces stay grouped, so a later
 *  pass does not offer them again as something new. */
export async function dismissCluster(id: number): Promise<void> {
  const handle = await ready();
  await handle.runAsync('UPDATE face_clusters SET name = ? WHERE id = ?', DISMISSED, id);
  await forgetCluster(id);
}

/** A name no person can have, so a dismissed group is distinguishable from
 *  one nobody has looked at yet without needing another column. A plain
 *  sentinel rather than anything clever: this string is interpolated into
 *  SQL below, and a null byte or a quote there is a bug waiting to happen. */
export const DISMISSED = '__dismissed__';

/** Wipe the grouping without touching the faces themselves. For when the
 *  threshold changes, or a user wants to start the questions again. */
export async function clearClusters(): Promise<void> {
  const handle = await ready();
  await handle.execAsync('UPDATE faces SET cluster_id = NULL; DELETE FROM face_clusters;');
}
