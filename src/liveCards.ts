import { getAllAssumedMemories } from './assumedMemory';
import { MONTHS_SHORT, WEEKDAYS } from './data';
import { getMemoriesByDay, memoryDisplayText } from './memoryLog';
import { getAllPersonMeta } from './peopleTags';
import { getAllPhotoSources } from './photoMeta';
import { getPlace, type PlaceKind } from './places';

// What live voice puts on screen while it talks: the days, the place or the
// person it just looked up, as cards the user can tap (app/live.tsx).
//
// Built from the lookups the model already makes (src/realtimeTools.ts), so
// showing them costs no extra round trip and the cards are up before the
// answer is spoken. One to three per question: the best of what was found,
// never a list.

export type LiveCard =
  | { kind: 'day'; key: string; date: string; title: string; line?: string; photo?: string }
  | { kind: 'place'; key: string; id: string; title: string; line?: string; photo?: string; placeKind?: PlaceKind }
  | { kind: 'person'; key: string; name: string; title: string; line?: string; photo?: string };

const MAX_CARDS = 3;

function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(y, m - 1, d);
  const month = MONTHS_SHORT[m - 1];
  return `${WEEKDAYS[when.getDay()].slice(0, 3)} ${d} ${month.charAt(0)}${month.slice(1).toLowerCase()}`;
}

async function dayCard(date: string): Promise<LiveCard | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [byDay, sources, stories] = await Promise.all([
    getMemoriesByDay(),
    getAllPhotoSources(),
    getAllAssumedMemories(),
  ]);
  const list = byDay.get(date) ?? [];
  // The day's first real photo: never a screenshot or a saved image.
  const photo = list
    .filter((m) => m.kind === 'photo')
    .flatMap((m) => m.photoUris ?? [])
    .find((u) => !sources[u]);
  const words = list.map(memoryDisplayText).find((t): t is string => !!t);
  const story = stories[date]?.summary;
  if (!photo && !words && !story) return null;
  return { kind: 'day', key: `day:${date}`, date, title: dayTitle(date), line: words ?? story, photo };
}

async function placeCard(name: string): Promise<LiveCard | null> {
  const place = await getPlace(name);
  if (!place) return null;
  const n = place.days.length;
  return {
    kind: 'place',
    key: `place:${place.id}`,
    id: place.id,
    title: place.label,
    line: n === 1 ? '1 day there' : `${n} days there`,
    photo: place.cover,
    placeKind: place.kind,
  };
}

async function personCard(name: string, line?: string): Promise<LiveCard | null> {
  const meta = (await getAllPersonMeta())[name];
  return { kind: 'person', key: `person:${name}`, name, title: name, line: line ?? meta?.descriptor, photo: meta?.photoUri };
}

type Output = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The cards a finished lookup is worth, best first. Empty when none. */
export async function cardsFromLookup(tool: string, output: unknown): Promise<LiveCard[]> {
  if (!output || typeof output !== 'object') return [];
  const o = output as Output;
  const out: (LiveCard | null)[] = [];
  try {
    if (tool === 'get_day' && !o.empty) {
      out.push(await dayCard(str(o.date) ?? ''));
    } else if (tool === 'search_memories' && Array.isArray(o.days)) {
      for (const d of (o.days as Output[]).slice(0, 2)) out.push(await dayCard(str(d.date) ?? ''));
    } else if (tool === 'find_place' && o.found) {
      out.push(await placeCard(str(o.name) ?? ''));
      const last = (o.last_visit as Output | undefined)?.date;
      if (typeof last === 'string') out.push(await dayCard(last));
    } else if ((tool === 'find_person' || tool === 'days_with_person') && o.found) {
      const name = str(o.name) ?? '';
      const last = (o.last_seen as Output | null)?.date;
      out.push(await personCard(name, typeof last === 'string' ? `Last seen ${dayTitle(last)}` : undefined));
      if (typeof last === 'string') out.push(await dayCard(last));
    }
  } catch (e) {
    console.warn(`[live] no cards for ${tool}:`, e);
  }
  return out.filter((c): c is LiveCard => !!c).slice(0, MAX_CARDS);
}
