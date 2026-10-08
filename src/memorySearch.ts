// Finding the days a question is about — the one search Ask and live voice
// both use.
//
// It used to be a plain "does the text contain this word" check, and that
// lost real days in three ways:
//   - The planner turns every question into English words ("museum"), but
//     notes are written in Arabic script ("رحت المتحف المصري الكبير"). An
//     English word never appears inside Arabic text, so a user's own notes
//     were invisible to search.
//   - "pyramids" is not inside "pyramid", "museums" not inside "museum".
//   - A day only had a 2-4 sentence photo story; whatever it left out (the
//     pyramids in the background) could not be found at all.
//
// So every day is searched across its fields — the user's words, places,
// people, the photo story, and its search tags ("anchors": everything in
// the photos and notes, in English and Arabic, written by
// assumedMemory.ts and dayTags.ts) — with words reduced to a common form
// in both languages. A rare word ("pyramid") counts for more than a common
// one ("home"), and a hit in the user's own words or a tag counts for more
// than one in the photo story. The best days come back with the words that
// matched, so the answer can say why it picked them.

/** One day, as the search sees it. Weight is how much a hit in that field
 *  is worth. */
export type SearchDoc = { key: string; fields: { text: string; weight: number }[] };

export type SearchHit = { key: string; score: number; matched: string[] };

// Arabic letters that are written several ways for the same sound, and the
// marks that sit on top of them.
function foldArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizeText(s: string): string {
  return foldArabic(s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase());
}

const ARABIC = /[؀-ۿ]/;
// "the", "with the", "and the" … in front of an Arabic word: المتحف, بالمتحف,
// والمتحف are all متحف.
const AR_PREFIXES = ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال'];

/** A word in the form both sides of a comparison agree on. */
export function stem(word: string): string {
  if (ARABIC.test(word)) {
    let w = word;
    for (const p of AR_PREFIXES) {
      if (w.startsWith(p) && w.length - p.length >= 2) {
        w = w.slice(p.length);
        break;
      }
    }
    // Plurals: اهرامات → اهرام, متاحف stays (a broken plural — the planner
    // gives both forms).
    if (w.length > 4 && w.endsWith('ات')) w = w.slice(0, -2);
    return w;
  }
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  return word;
}

export function wordsOf(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .map(stem);
}

// Words that say nothing about which day it was.
const STOP = new Set(
  [
    'the', 'and', 'with', 'for', 'was', 'were', 'did', 'went', 'go', 'when', 'what', 'where', 'who', 'day',
    'my', 'me', 'you', 'your', 'at', 'in', 'on', 'of', 'to', 'a', 'an', 'it', 'is', 'that', 'this',
    'في', 'من', 'علي', 'على', 'مع', 'كان', 'كنت', 'امتي', 'فين', 'ايه', 'اللي', 'ده', 'دي', 'يوم',
  ].map((w) => stem(normalizeText(w))),
);

type Prepared = { key: string; fields: { words: Set<string>; list: string[]; weight: number }[] };

function prepare(docs: SearchDoc[]): Prepared[] {
  return docs.map((d) => ({
    key: d.key,
    fields: d.fields
      .filter((f) => f.text)
      .map((f) => {
        const list = wordsOf(f.text);
        return { words: new Set(list), list, weight: f.weight };
      }),
  }));
}

/** How well one search term (one word or a phrase) hits one field, 0..1. */
function hitQuality(term: string[], field: { words: Set<string>; list: string[] }): number {
  let found = 0;
  for (const w of term) {
    if (field.words.has(w)) {
      found += 1;
      continue;
    }
    // The start of a longer word — "egypt" in "egyptian", "مصر" in "مصري".
    if (w.length >= 3 && field.list.some((f) => f.length > w.length && f.startsWith(w))) found += 0.7;
  }
  if (found === 0) return 0;
  // A phrase counts fully only when all of it is there.
  return term.length === 1 ? Math.min(1, found) : (found / term.length) ** 1.5;
}

/** The days that best match the search terms, best first. */
export function searchDays(docs: SearchDoc[], queries: string[], limit = 8): SearchHit[] {
  const prepared = prepare(docs);
  const terms = [
    ...new Map(
      queries
        .map((q) => ({ q: q.trim(), words: wordsOf(q).filter((w) => !STOP.has(w)) }))
        .filter((t) => t.q && t.words.length > 0)
        .map((t) => [t.words.join(' '), t] as const),
    ).values(),
  ];
  if (terms.length === 0 || prepared.length === 0) return [];

  // Per term: how good each day's best field is.
  const quality = terms.map((t) =>
    prepared.map((doc) => {
      let best = 0;
      for (const f of doc.fields) best = Math.max(best, hitQuality(t.words, f) * f.weight);
      return best;
    }),
  );
  // A word on few days says far more about which day was meant.
  const n = prepared.length;
  const idf = quality.map((row) => {
    const df = row.filter((v) => v > 0).length;
    return Math.log(1 + n / (1 + df));
  });

  const hits: SearchHit[] = [];
  prepared.forEach((doc, i) => {
    let score = 0;
    const matched: string[] = [];
    terms.forEach((t, j) => {
      const q = quality[j][i];
      if (q <= 0) return;
      score += q * idf[j];
      matched.push(t.q);
    });
    if (score > 0) hits.push({ key: doc.key, score: Math.round(score * 100) / 100, matched });
  });
  return hits.sort((a, b) => b.score - a.score || b.key.localeCompare(a.key)).slice(0, limit);
}
