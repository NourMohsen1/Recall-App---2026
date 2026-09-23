// Works out when two logged names are the same human being.
//
// A memory log collects the same person under whatever the user typed that
// day: "Nayer", "Nair", "ناير" — or "Baba" and "بابا". Left alone, that's
// four profiles for two people, each holding a quarter of the memories, and
// the Ask feature answering "when did I last see Nayer?" from a fraction of
// the truth.
//
// Two things make these names comparable:
//   1. Arabic script is transliterated to Latin, so "بابا" and "Baba" can be
//      compared at all.
//   2. Both are then reduced to a consonant skeleton. Vowels are the
//      unstable part of a transliterated Arabic name — the consonants are
//      what survive. "Nayer", "Nair" and "ناير" all reduce to "nir".
//
// Matches are only ever SUGGESTIONS. Two different people genuinely called
// Ahmed and Ahmad share a skeleton, and silently merging them would destroy
// real memories with no way back. The user confirms every merge.

// Franco-Arabic — Arabic typed in Latin letters, where digits stand in for
// letters with no Latin equivalent. Applied before anything else.
const FRANCO: Record<string, string> = {
  '2': 'a', // ء / أ
  '3': 'a', // ع
  '5': 'kh', // خ
  '6': 't', // ط
  '7': 'h', // ح
  '8': 'gh', // غ
  '9': 'q', // ق
};

// Arabic letters to their usual Latin spelling. Deliberately the COMMON
// spelling rather than a strict academic one — this has to match what
// people actually type, not what a linguist would write.
const ARABIC: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ى: 'a', ة: 'a',
  ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh',
  د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh',
  ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', و: 'w', ي: 'y', ئ: 'y', ؤ: 'w', ء: 'a',
};

// Titles that describe a relationship rather than name a person, so they
// don't drag unrelated people together ("3ammo Tarek" is Tarek).
const TITLES = /\b(mr|mrs|ms|dr|eng|si|3am|3ammo|ammo|khalo|khalto|tante|uncle|aunt|hag|hagg|hagga)\b/g;

export function transliterate(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ARABIC[ch] !== undefined) out += ARABIC[ch];
    else if (FRANCO[ch] !== undefined) out += FRANCO[ch];
    else out += ch;
  }
  return out;
}

// Lowercased, de-accented, punctuation-free, titles removed, Arabic script
// turned into Latin. Two names that are literally the same word in two
// scripts come out identical here.
export function normalizeName(name: string): string {
  return transliterate(
    // Titles are stripped BEFORE transliteration as well as after: "3ammo"
    // becomes "aammo" once the franco digits are mapped, and would no
    // longer match the title list.
    name.toLowerCase().replace(TITLES, ' '),
  )
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(TITLES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The consonant skeleton of one word. Arabic is written without short
// vowels, so every transliteration invents its own — dropping them is what
// makes "Nayer", "Nair" and "ناير" line up. y/i and w/u are treated as the
// same sound, since which one gets written is arbitrary.
function skeleton(word: string): string {
  return (
    word
      .replace(/[yi]+/g, 'i')
      .replace(/[wu]+/g, 'u')
      // ق comes out as "q" from Arabic but people type "k" ("Tarek" /
      // "طارق"), and the two are the same sound for matching purposes.
      .replace(/q/g, 'k')
      .replace(/[aeo]/g, '')
      .replace(/(.)\1+/g, '$1') // doubled letters are a spelling choice
      // A trailing h is usually the ة/ه at the end of a name being written
      // out or left off — "Sara" and "Sarah" are one name.
      .replace(/h$/, '')
  );
}

export function nameSkeleton(name: string): string {
  return normalizeName(name)
    .split(' ')
    .map(skeleton)
    .filter(Boolean)
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export type NameMatch = {
  /** 0-100. 100 is the same string once normalized. */
  score: number;
  reason: string;
};

// How likely two logged names are the same person.
export function compareNames(a: string, b: string): NameMatch {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return { score: 0, reason: '' };
  if (na === nb) {
    // Identical once the script is stripped away — the strongest signal
    // there is, and the case behind "Baba" vs "بابا".
    return { score: 100, reason: 'the same name written two ways' };
  }

  // One is the fuller version of the other: "Nayer" and "Nayer Mohsen".
  if (nb.startsWith(na + ' ') || na.startsWith(nb + ' ')) {
    return { score: 85, reason: 'one is the full name of the other' };
  }

  const sa = nameSkeleton(a);
  const sb = nameSkeleton(b);
  const spellingRatio = ratio(na, nb);

  if (sa && sa === sb) {
    // Same consonants, different vowels — "Nayer" vs "Nair".
    return spellingRatio >= 0.6
      ? { score: 80, reason: 'the same name spelled differently' }
      : { score: 62, reason: 'these could be the same name spelled differently' };
  }

  // Very close spelling without an exact skeleton match — a typo, usually.
  if (spellingRatio >= 0.85) {
    return { score: 70, reason: 'almost the same spelling' };
  }

  // One name is a lone first name, the other has a surname: "Nair" against
  // "Nayer Mohsen". Compare just the first names.
  //
  // Only when one side is a SINGLE word. Two full names that happen to
  // share a first name ("Ahmed Hassan" and "Ahmed Ali") are two different
  // people, and the surnames are there precisely to say so.
  const aWords = na.split(' ');
  const bWords = nb.split(' ');
  if ((aWords.length === 1) !== (bWords.length === 1)) {
    const firstA = skeleton(aWords[0]);
    const firstB = skeleton(bWords[0]);
    if (firstA && firstA === firstB) {
      return { score: 72, reason: 'the same first name, one with a surname' };
    }
  }

  return { score: 0, reason: '' };
}

// Below this, two names are treated as different people and never suggested.
export const MERGE_SUGGESTION_THRESHOLD = 62;

export type DuplicateSuggestion = {
  /** The name to keep — the one the app has the most information about. */
  keep: string;
  /** The name that would be folded into it. */
  merge: string;
  score: number;
  reason: string;
};

// Every pair of existing people that looks like one person logged twice,
// strongest first. `weight` decides which name survives a merge — pass how
// much the app knows about each (days together works well), so the profile
// with the real history is the one that's kept.
export function findDuplicatePeople(
  names: string[],
  weight: (name: string) => number = () => 0,
): DuplicateSuggestion[] {
  const out: DuplicateSuggestion[] = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const { score, reason } = compareNames(names[i], names[j]);
      if (score < MERGE_SUGGESTION_THRESHOLD) continue;
      // Keep whichever the app knows more about; on a tie, the longer name,
      // since "Nayer Mohsen" identifies a person better than "Nayer".
      const [keep, merge] =
        weight(names[i]) !== weight(names[j])
          ? weight(names[i]) > weight(names[j])
            ? [names[i], names[j]]
            : [names[j], names[i]]
          : names[i].length >= names[j].length
            ? [names[i], names[j]]
            : [names[j], names[i]];
      out.push({ keep, merge, score, reason });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}
