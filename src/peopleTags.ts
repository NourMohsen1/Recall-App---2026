import AsyncStorage from '@react-native-async-storage/async-storage';

// Real face recognition needs either a paid cloud vision API or ejecting out
// of Expo Go for on-device ML — both are bigger asks than this feature
// warrants right now. Instead people are tagged manually per day: the user
// types who they were with once, and that becomes the day's real "People"
// data. Names are stored per day so a wrongly-tagged person is one tap to
// remove (the requested filtering mechanism) without touching anyone else.

const DAY_PEOPLE_KEY = 'dayPeople';

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

export async function getPeopleForDay(dayKey: string): Promise<string[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  return byDay[dayKey] ?? [];
}

export async function getAllTaggedPeople(): Promise<string[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const names = new Set<string>();
  Object.values(byDay).forEach((list) => list.forEach((n) => names.add(n)));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export async function addPersonForDay(dayKey: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const existing = byDay[dayKey] ?? [];
  if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
  byDay[dayKey] = [...existing, trimmed];
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
}

export async function removePersonForDay(dayKey: string, name: string): Promise<void> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const existing = byDay[dayKey] ?? [];
  byDay[dayKey] = existing.filter((n) => n !== name);
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
}

// Everything the app knows about one person, derived purely from which days
// they were tagged on — the source of truth for the People page.
export type PersonSummary = {
  name: string;
  // Undefined for a person the user added by hand who hasn't been tagged on
  // any day yet. They're still a real person the app knows — you can give
  // them a face and a description before they ever appear in a memory — so
  // every screen has to cope with having no days rather than assuming one.
  //
  // `lastSeenDay` is the most recent day that has ALREADY HAPPENED. A day in
  // the future is a plan, not a memory: putting it here made the profile
  // claim it had last seen someone on a date that hasn't arrived.
  lastSeenDay?: string; // YYYY-MM-DD
  firstSeenDay?: string;
  /** The nearest day still ahead, when one is tagged. */
  upcomingDay?: string;
  days: string[]; // every day together, newest first
};

export async function getPeopleSummaries(): Promise<PersonSummary[]> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  const perPerson = new Map<string, string[]>();
  for (const [day, names] of Object.entries(byDay)) {
    for (const name of names) {
      const days = perPerson.get(name);
      if (days) days.push(day);
      else perPerson.set(name, [day]);
    }
  }
  // People added by hand exist in personMeta before they're on any day, so
  // the list is the union of both — otherwise someone you just created
  // wouldn't appear until they happened to turn up in a memory.
  for (const name of Object.keys(await getAllPersonMeta())) {
    if (!perPerson.has(name)) perPerson.set(name, []);
  }

  return Array.from(perPerson.entries())
    .map(([name, days]) => {
      // Newest first, and split at today so "last seen" can never be a date
      // that hasn't happened yet.
      const sorted = [...new Set(days)].sort((a, b) => b.localeCompare(a));
      const past = sorted.filter((d) => !isFutureDay(d));
      const future = sorted.filter((d) => isFutureDay(d));
      return {
        name,
        days: sorted,
        lastSeenDay: past[0],
        firstSeenDay: past[past.length - 1] ?? sorted[sorted.length - 1],
        // Nearest one ahead — the end of the future list, since it's sorted
        // newest first.
        upcomingDay: future[future.length - 1],
      };
    })
    // Most recently seen people first — the ones freshest in memory. Someone
    // with no days yet sorts to the end rather than the top.
    .sort((a, b) => (b.lastSeenDay ?? '').localeCompare(a.lastSeenDay ?? ''));
}

// Creates a person the user knows before they've appeared in any memory.
// Returns the name they ended up under — typing someone who already exists
// just opens that person rather than making a second copy of them.
export async function createPerson(name: string, descriptor?: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const existing = await resolvePersonName(trimmed);
  const canonical = existing ?? trimmed;

  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[canonical] ?? { verified: true, mentions: [] };
  // A person the user typed themselves is trusted — the "New — review"
  // prompt is for names the AI pulled out of a log, not this.
  meta.verified = true;
  if (descriptor?.trim()) meta.descriptor = descriptor.trim();
  all[canonical] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
  return canonical;
}

// "today" / "yesterday" / "5 days ago" / "Jun 12" — how a friend would say it.
// How far a day is from today, in words.
//
// This used to collapse every future date to "today" (`diff <= 0`), so
// tagging somebody on a day next month made their profile read "Last seen
// today". A memory app has to be able to say when something is still ahead.
export function lastSeenLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff === -1) return 'tomorrow';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff < -1 && diff > -7) return `in ${-diff} days`;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const withYear = target.getFullYear() !== today.getFullYear();
  return `${MONTHS[target.getMonth()]} ${target.getDate()}${withYear ? `, ${target.getFullYear()}` : ''}`;
}

export function isFutureDay(dayKey: string): boolean {
  const [y, m, d] = dayKey.split('-').map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(y, m - 1, d).getTime() > today.getTime();
}

// A stable avatar tint per person, drawn from the app palette.
const AVATAR_TINTS = ['#336970', '#5C878D', '#4A7C83', '#85A5A9', '#29545A', '#B98A8A'];

export function avatarTint(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

// ---------------------------------------------------------------------------
// Person metadata — what the app has learned about each person from the
// user's loggings. People the AI creates start unverified so the user can
// confirm them; people the user adds by hand are trusted from the start.

export type PersonMention = { day: string; text: string };

export type PersonMeta = {
  descriptor?: string; // "Your neighbor", "Coworker" — only if the user said it
  verified: boolean;
  mentions: PersonMention[]; // what happened with them, one line per logging
  // Other spellings of this person's name that have been folded in — the
  // franco-Arabic, the Arabic script, the typo. Once "Nair" is an alias of
  // "Nayer", a future log saying "Nair" lands on the same profile instead
  // of quietly starting a second one.
  aliases?: string[];
  // The person's face, set once by the user.
  //
  // This is not decoration. It's the REFERENCE the app is meant to match
  // against later: the user points at a face once, and from then on that
  // person can be recognised in new photos and their days filled in
  // automatically. So it's stored per person as a stable anchor, not
  // derived from whatever photo happens to be on a shared day.
  photoUri?: string;
  // The same face, cut down to just the face, worked out once by the app.
  //
  // photoUri is what the user sees; this is what the matcher compares. They
  // are separate because a good avatar and a good reference are different
  // pictures: an avatar wants the person, a reference wants only the parts
  // that identify them. Built on first use and thrown away whenever
  // photoUri changes, since a crop of the old photo means nothing.
  faceUri?: string;
};

const PERSON_META_KEY = 'personMeta';

export async function getAllPersonMeta(): Promise<Record<string, PersonMeta>> {
  return readJSON<Record<string, PersonMeta>>(PERSON_META_KEY, {});
}

export async function getPersonMeta(name: string): Promise<PersonMeta | null> {
  const all = await getAllPersonMeta();
  return all[name] ?? null;
}

export async function verifyPerson(name: string): Promise<void> {
  const all = await getAllPersonMeta();
  all[name] = { ...(all[name] ?? { mentions: [] }), verified: true };
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Sets (or clears) the person's reference face. Copied into the app's own
// storage by the caller before it gets here — a URI straight out of the
// image picker points at a temporary file the OS will clean up.
export async function setPersonPhoto(name: string, uri: string | undefined): Promise<void> {
  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[name] ?? { verified: true, mentions: [] };
  if (uri) meta.photoUri = uri;
  else delete meta.photoUri;
  // The crop belonged to the photo being replaced. Keeping it would leave
  // the app matching against a face the user has just moved away from.
  delete meta.faceUri;
  all[name] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Stores the face crop the app worked out for this person. Kept apart from
// setPersonPhoto because it is the app's own derivation, not a choice the
// user made — and because writing it must not disturb the photo it came
// from.
export async function setPersonFace(name: string, uri: string | undefined): Promise<void> {
  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[name] ?? { verified: true, mentions: [] };
  if (uri) meta.faceUri = uri;
  else delete meta.faceUri;
  all[name] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Removes a person everywhere — for when the AI caught a name that isn't
// actually someone the user knows.
export async function removePersonEverywhere(name: string): Promise<void> {
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  for (const day of Object.keys(byDay)) {
    byDay[day] = byDay[day].filter((n) => n !== name);
    if (byDay[day].length === 0) delete byDay[day];
  }
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));
  const all = await getAllPersonMeta();
  delete all[name];
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Which existing person a newly-logged name belongs to, or null when it's
// someone new. Checked in order of certainty: the exact name, the same name
// in different case, then a spelling already folded in as an alias.
//
// Only settled facts are used here — never the fuzzy matching in
// personIdentity.ts. Guessing at intake time would silently file a memory
// under the wrong person, which is far worse than showing the user a merge
// suggestion they can accept once.
export async function resolvePersonName(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const known = await getAllTaggedPeople();
  const exact = known.find((n) => n === trimmed);
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const sameCase = known.find((n) => n.toLowerCase() === lower);
  if (sameCase) return sameCase;

  const meta = await getAllPersonMeta();
  for (const [canonical, m] of Object.entries(meta)) {
    if (m.aliases?.some((a) => a.toLowerCase() === lower)) return canonical;
  }
  return null;
}

// Folds one person into another: every day, every note, and the name itself
// as an alias so it routes correctly from now on. The kept person's own
// details win — they're the profile the user has been building.
export async function mergePeople(mergeName: string, keepName: string): Promise<void> {
  if (mergeName === keepName) return;

  // 1 — every day tagged with the old name is now a day with the kept one.
  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  for (const day of Object.keys(byDay)) {
    if (!byDay[day].includes(mergeName)) continue;
    const others = byDay[day].filter((n) => n !== mergeName);
    byDay[day] = others.includes(keepName) ? others : [...others, keepName];
    if (byDay[day].length === 0) delete byDay[day];
  }
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));

  // 2 — merge what's known about them.
  const all = await getAllPersonMeta();
  const from = all[mergeName];
  const into: PersonMeta = all[keepName] ?? { verified: true, mentions: [] };

  const mentions = [...into.mentions, ...(from?.mentions ?? [])]
    .filter(
      (m, i, arr) => arr.findIndex((o) => o.day === m.day && o.text === m.text) === i,
    )
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 50);

  all[keepName] = {
    ...into,
    mentions,
    // Anything the kept profile is missing, take from the one being folded in.
    descriptor: into.descriptor ?? from?.descriptor,
    photoUri: into.photoUri ?? from?.photoUri,
    // The crop travels with the photo it was cut from, never on its own.
    faceUri: into.photoUri ? into.faceUri : from?.faceUri,
    verified: into.verified || !!from?.verified,
    aliases: [
      ...new Set([
        ...(into.aliases ?? []),
        ...(from?.aliases ?? []),
        mergeName,
      ]),
    ].filter((a) => a !== keepName),
  };
  delete all[mergeName];
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Renames a person everywhere.
//
// The name IS the key this whole feature is filed under — every tagged day
// points at the string — so a rename has to move all of it at once or the
// person's history splits in half. When the new name is one that already
// exists, this is really a merge, and mergePeople is the thing that knows
// how to combine two histories without losing either.
//
// Returns the name the person now lives under, which is not always what was
// typed: merging into an existing person keeps that person's spelling.
export async function renamePerson(oldName: string, newName: string): Promise<string> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return oldName;

  // Typing the name of somebody who already exists means "these are the
  // same person" — which is exactly a merge.
  const existing = await resolvePersonName(trimmed);
  if (existing && existing !== oldName) {
    await mergePeople(oldName, existing);
    return existing;
  }

  const byDay = await readJSON<Record<string, string[]>>(DAY_PEOPLE_KEY, {});
  for (const day of Object.keys(byDay)) {
    if (!byDay[day].includes(oldName)) continue;
    const others = byDay[day].filter((n) => n !== oldName);
    byDay[day] = others.includes(trimmed) ? others : [...others, trimmed];
  }
  await AsyncStorage.setItem(DAY_PEOPLE_KEY, JSON.stringify(byDay));

  const all = await getAllPersonMeta();
  const meta = all[oldName];
  if (meta) {
    delete all[oldName];
    all[trimmed] = {
      ...meta,
      // The old spelling is kept as an alias, so a memory logged under it
      // later still finds its way to this person.
      aliases: [...new Set([...(meta.aliases ?? []), oldName])].filter((a) => a !== trimmed),
    };
    await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
  }
  return trimmed;
}

// The one-line "who is this to me" under the name — how the user knows them.
export async function setPersonDescriptor(
  name: string,
  descriptor: string | undefined,
): Promise<void> {
  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[name] ?? { verified: true, mentions: [] };
  const trimmed = descriptor?.trim();
  if (trimmed) meta.descriptor = trimmed;
  else delete meta.descriptor;
  all[name] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Records that two people are NOT the same, so the app stops offering the
// merge. "Ahmed" and "Ahmad" really can be two different friends.
const NOT_DUPLICATES_KEY = 'notDuplicatePeople';

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(' ');
}

export async function getRejectedMerges(): Promise<Set<string>> {
  const list = await readJSON<string[]>(NOT_DUPLICATES_KEY, []);
  return new Set(list);
}

export async function rejectMerge(a: string, b: string): Promise<void> {
  const list = await readJSON<string[]>(NOT_DUPLICATES_KEY, []);
  const key = pairKey(a, b);
  if (list.includes(key)) return;
  await AsyncStorage.setItem(NOT_DUPLICATES_KEY, JSON.stringify([...list, key]));
}

export function isRejectedMerge(rejected: Set<string>, a: string, b: string): boolean {
  return rejected.has(pairKey(a, b));
}

// The intake pipeline found this person in a logging: tag them on the day,
// remember what happened with them, and keep/learn who they are. New names
// are created unverified; existing people keep their verification state.
export async function addPersonMention(
  dayKey: string,
  name: string,
  descriptor?: string,
  note?: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  // Route to an existing person when this is a name they're already known
  // by — including a spelling the user has previously merged in.
  const resolved = await resolvePersonName(trimmed);
  const canonical = resolved ?? trimmed;
  const isKnown = resolved !== null;

  await addPersonForDay(dayKey, canonical);

  const all = await getAllPersonMeta();
  const meta: PersonMeta = all[canonical] ?? { verified: isKnown, mentions: [] };
  if (descriptor && !meta.descriptor) meta.descriptor = descriptor;
  if (note && !meta.mentions.some((m) => m.day === dayKey && m.text === note)) {
    meta.mentions = [{ day: dayKey, text: note }, ...meta.mentions].slice(0, 50);
  }
  all[canonical] = meta;
  await AsyncStorage.setItem(PERSON_META_KEY, JSON.stringify(all));
}

// Compact list of who the user already knows, fed to the intake prompt so
// the AI can match "Jeff" back to an existing "Jeff" instead of duplicating.
export async function getKnownPeopleForPrompt(): Promise<string> {
  const names = await getAllTaggedPeople();
  if (names.length === 0) return '';
  const meta = await getAllPersonMeta();
  return names
    .map((n) => {
      const who = meta[n]?.descriptor ? ` (${meta[n].descriptor})` : '';
      // Alias spellings go into the prompt too, so the model returns the
      // canonical name when the user writes one of the other versions.
      const aliases = meta[n]?.aliases?.length
        ? ` — also written: ${meta[n].aliases!.join(', ')}`
        : '';
      return `- ${n}${who}${aliases}`;
    })
    .join('\n');
}
