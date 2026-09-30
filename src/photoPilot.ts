import * as FileSystem from 'expo-file-system/legacy';
import {
  analyzePhoto,
  photoUnderstandingAvailable,
  preparePhotoModel,
} from '../modules/photo-understanding';
import vocab from '../assets/models/siglip-vocab.json';
import { getAllAssumedMemories } from './assumedMemory';
import { getGuessesForDay } from './guessedPeople';
import { getMemoriesByDay } from './memoryLog';
import { getPeopleForDay } from './peopleTags';
import { getAllPhotoMeta } from './photoMeta';
import { getPlacesForDay } from './places';

// THE TEST, not the feature. Reads a sample of the user's real days with
// photos entirely on the phone and puts what it found beside what DeepSeek
// wrote for the same day, so the quality gap is measured rather than
// guessed. Read-only: it changes nothing the app already has.

export { photoUnderstandingAvailable };

type Concept = { id: string; label: string; group: 'place' | 'activity' | 'event' | 'thing'; e: number[] };
const CONCEPTS = (vocab as { concepts: Concept[] }).concepts;
const SCALE = (vocab as { logit_scale: number }).logit_scale;
const BIAS = (vocab as { logit_bias: number }).logit_bias;

export type PilotTag = { id: string; label: string; group: Concept['group']; score: number };

export type PilotDay = {
  day: string;
  photos: number;
  analyzed: number;
  deepseek?: string;
  tags: PilotTag[];
  vision: { id: string; count: number }[];
  places: string[];
  people: string[];
  guessed: string[];
  from?: number;
  to?: number;
  draft: string;
  msPerPhoto: { fetch: number; vision: number; clip: number };
  failed: number;
};

export type PilotReport = {
  ranAt: string;
  modelLoadMs: number;
  totalMs: number;
  days: PilotDay[];
};

// How sure the model is that a photo shows a concept, 0..1. SigLIP's own
// calibration: cautious, so a clear match can read 0.1–0.4. The test's job
// is partly to find the threshold that works on real photos.
function scores(embedding: number[]): number[] {
  return CONCEPTS.map((c) => {
    let dot = 0;
    for (let i = 0; i < embedding.length; i++) dot += embedding[i] * c.e[i];
    return 1 / (1 + Math.exp(-(dot * SCALE + BIAS)));
  });
}

function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}${d.getMinutes() ? `:${String(d.getMinutes()).padStart(2, '0')}` : ''} ${suffix}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Option A: the app writes the line itself, from facts. What the photos
// suggest is said as "looks like"; people recognised but not confirmed
// keep their question mark — the same rule as everywhere else.
const TAG_FLOOR = 0.02;
function draftSentence(d: Omit<PilotDay, 'draft'>): string {
  const parts: string[] = [];
  if (d.from != null && d.to != null) {
    parts.push(
      Math.abs(d.to - d.from) < 45 * 60000 ? `Around ${clock(d.from)}` : `Between ${clock(d.from)} and ${clock(d.to)}`,
    );
  }
  const place = d.tags.find((t) => t.group === 'place' && t.score >= TAG_FLOOR);
  const doing = d.tags.filter((t) => t.group !== 'place' && t.score >= TAG_FLOOR).slice(0, 2);
  const seen = [place?.label, ...doing.map((t) => t.label)].filter((x): x is string => !!x);
  if (seen.length > 0) parts.push(`looks like ${list(seen)}`);
  if (d.places.length > 0) parts.push(`at ${list(d.places.slice(0, 2))}`);
  const who = [...d.people, ...d.guessed.map((g) => `${g}?`)];
  if (who.length > 0) parts.push(`with ${list(who.slice(0, 3))}`);
  if (parts.length === 0) return 'Nothing clear enough in these photos to say.';
  const s = parts.join(' — ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export async function runPhotoPilot(opts: {
  days?: number;
  perDay?: number;
  onProgress?: (p: { day: number; days: number; photo: number; photos: number }) => void;
}): Promise<PilotReport> {
  const started = Date.now();
  const DAYS = opts.days ?? 20;
  const PER_DAY = opts.perDay ?? 12;
  const { ms: modelLoadMs } = await preparePhotoModel();
  console.log(`[pilot] photo model ready in ${Math.round(modelLoadMs)}ms`);

  const [byDay, meta, deepseek] = await Promise.all([getMemoriesByDay(), getAllPhotoMeta(), getAllAssumedMemories()]);

  // Days with real photos (not screenshots, and from the library so they
  // have an asset id). Days DeepSeek has already described come first —
  // those are the ones that can be compared.
  const candidates = [...byDay.entries()]
    .map(([day, memories]) => {
      const photos = memories
        .filter((m) => m.kind === 'photo')
        .flatMap((m) => m.photoUris ?? [])
        .filter((uri) => meta[uri]?.assetId && meta[uri]?.source !== 'screenshot');
      return { day, photos };
    })
    .filter((d) => d.photos.length > 0)
    .sort((a, b) => Number(!!deepseek[b.day]) - Number(!!deepseek[a.day]) || b.day.localeCompare(a.day))
    .slice(0, DAYS);

  const report: PilotDay[] = [];
  for (let di = 0; di < candidates.length; di++) {
    const { day, photos } = candidates[di];
    // Spread across the day, not just its first photos.
    const step = Math.max(1, Math.floor(photos.length / PER_DAY));
    const sample = photos.filter((_, i) => i % step === 0).slice(0, PER_DAY);

    const best = new Array(CONCEPTS.length).fill(0);
    const vision = new Map<string, number>();
    const ms = { fetch: 0, vision: 0, clip: 0 };
    let analyzed = 0;
    let failed = 0;
    const times: number[] = [];
    for (let pi = 0; pi < sample.length; pi++) {
      opts.onProgress?.({ day: di + 1, days: candidates.length, photo: pi + 1, photos: sample.length });
      const m = meta[sample[pi]];
      try {
        const r = await analyzePhoto(m.assetId!);
        const s = scores(r.embedding);
        for (let i = 0; i < s.length; i++) best[i] = Math.max(best[i], s[i]);
        for (const l of r.labels) vision.set(l.id, (vision.get(l.id) ?? 0) + 1);
        ms.fetch += r.ms.fetch;
        ms.vision += r.ms.vision;
        ms.clip += r.ms.clip;
        if (m.takenAt) times.push(m.takenAt);
        analyzed += 1;
      } catch (e) {
        failed += 1;
        if (failed <= 2) console.warn(`[pilot] could not read a photo on ${day}:`, e);
      }
    }

    const tags = CONCEPTS.map((c, i) => ({ id: c.id, label: c.label, group: c.group, score: best[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((t) => ({ ...t, score: Math.round(t.score * 1000) / 1000 }));
    const [places, people, guesses] = await Promise.all([
      getPlacesForDay(day),
      getPeopleForDay(day),
      getGuessesForDay(day),
    ]);
    const n = Math.max(1, analyzed);
    const base = {
      day,
      photos: photos.length,
      analyzed,
      deepseek: deepseek[day]?.summary,
      tags,
      vision: [...vision.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => ({ id, count })),
      places: places.filter((p) => p.named).map((p) => p.label),
      people,
      guessed: guesses.map((g) => g.name).filter((g) => !people.includes(g)),
      from: times.length ? Math.min(...times) : undefined,
      to: times.length ? Math.max(...times) : undefined,
      msPerPhoto: { fetch: Math.round(ms.fetch / n), vision: Math.round(ms.vision / n), clip: Math.round(ms.clip / n) },
      failed,
    };
    report.push({ ...base, draft: draftSentence(base) });
    console.log(
      `[pilot] ${day}: ${analyzed}/${sample.length} photos, ${base.msPerPhoto.clip}ms model + ${base.msPerPhoto.vision}ms labels each — top: ${tags
        .slice(0, 3)
        .map((t) => `${t.label} ${t.score}`)
        .join(', ')}`,
    );
  }

  const result: PilotReport = {
    ranAt: new Date().toISOString(),
    modelLoadMs: Math.round(modelLoadMs),
    totalMs: Date.now() - started,
    days: report,
  };
  // Kept on the phone. Copied off by cable for the comparison, never sent.
  await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}photo-pilot.json`, JSON.stringify(result, null, 1));
  console.log(`[pilot] done: ${report.length} days in ${Math.round(result.totalMs / 1000)}s`);
  return result;
}
