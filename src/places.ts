import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { getPhotoFaceCounts } from './faceIndex';
import { dateKey, getLoggedMemories } from './memoryLog';
import { getAllPhotoMeta, setPhotoMetaBatch, type PhotoMeta } from './photoMeta';

// Places — where the user has been, drawn with their own photos.
//
// PRIVACY FIRST, BY DESIGN. Nothing here asks a map company what is at a
// spot. A business directory would give nicer names and stock photos, but
// only by sending it every location the user has ever been. Instead:
//
//   · WHERE comes from the GPS the user's own photos already carry, read on
//     the phone. Photos taken within SAME_PLACE_METERS of each other are one
//     place.
//   · WHAT IT LOOKS LIKE is the user's own best photo from there — a photo
//     with no faces in it first, so the cover is the building, not a selfie.
//     Or one they chose themselves.
//   · WHAT IT IS CALLED comes from the user's own words. "Coffee at Dunkin"
//     logged with a photo names that spot Dunkin, because the user said it
//     about those exact pictures. A spot nobody has named is labelled with
//     its street, from Apple's own on-device-first geocoder (the only thing
//     here that leaves the phone: a coordinate, to Apple, with no account
//     attached — the same service the Maps app uses).
//
// The rule the rest of the app follows holds here too: a guess is never
// presented as a fact. A spot is never given a name the user did not say.
// When the user mentioned a place on a day they were at an unnamed spot,
// the place's profile ASKS ("You mentioned Dunkin that day") and one tap
// answers — nothing is renamed on the app's own say-so.

export type PlaceKind =
  | 'home'
  | 'work'
  | 'school'
  | 'cafe'
  | 'food'
  | 'gym'
  | 'shop'
  | 'outdoors'
  | 'friend'
  | 'health'
  | 'worship'
  | 'travel'
  | 'fun'
  | 'other';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// The icon is what a place without a photo shows; the label is its group in
// the Places filter.
export const PLACE_KINDS: Record<PlaceKind, { icon: IconName; label: string }> = {
  home: { icon: 'home-outline', label: 'Home' },
  work: { icon: 'briefcase-outline', label: 'Work' },
  school: { icon: 'school-outline', label: 'Study' },
  cafe: { icon: 'coffee-outline', label: 'Cafés' },
  food: { icon: 'silverware-fork-knife', label: 'Food' },
  gym: { icon: 'dumbbell', label: 'Fitness' },
  shop: { icon: 'shopping-outline', label: 'Shopping' },
  outdoors: { icon: 'tree-outline', label: 'Outdoors' },
  friend: { icon: 'account-group-outline', label: "Friends' places" },
  health: { icon: 'hospital-box-outline', label: 'Health' },
  worship: { icon: 'star-crescent', label: 'Worship' },
  travel: { icon: 'airplane', label: 'Travel' },
  fun: { icon: 'ticket-outline', label: 'Going out' },
  other: { icon: 'storefront-outline', label: 'Other' },
};

export const PLACE_KIND_LIST = Object.keys(PLACE_KINDS) as PlaceKind[];

export function isPlaceKind(value: unknown): value is PlaceKind {
  return typeof value === 'string' && value in PLACE_KINDS;
}

/** One real place. */
export type Place = {
  id: string;
  /** '' until the street label arrives for a spot nobody has named yet. */
  name: string;
  /** True when the name is the user's own — said in a log, or typed. False
   *  when it is only the street the map gave. */
  named: boolean;
  /** Other ways of writing the name that mean this place ("the college",
   *  "الجامعة"), already normalised with placeKey. */
  aliases: string[];
  kind?: PlaceKind;
  /** Where it is. Only a place the user's photos or phone were actually at
   *  has one — a place only ever mentioned stays without. */
  latitude?: number;
  longitude?: number;
  /** A cover the user chose. Otherwise the best photo taken there is used. */
  coverUri?: string;
  createdAt: string;
};

/** A place as one day shows it. */
export type DayPlace = {
  placeId: string;
  label: string;
  named: boolean;
  kind?: PlaceKind;
  cover?: string;
  latitude?: number;
  longitude?: number;
  /** This day's photos taken there. */
  photoUris: string[];
  /** What happened there that day, in the user's words. */
  moment?: string;
};

/** Everything the Places page and a place's profile need. */
export type PlaceSummary = Place & {
  label: string;
  /** Every day the user was there, oldest first. */
  days: string[];
  /** Photos taken there, newest first. */
  photos: string[];
  cover?: string;
  /** Day → what happened there that day. */
  moments: Record<string, string>;
  /** For a spot nobody has named: places the user MENTIONED on days they
   *  were at it. Offered as a question, never applied on their own. */
  maybeNames: { id: string; name: string }[];
  /** For a place with no location: photos from the days the user was there.
   *  Shown as "from days you were here" — they are not claimed to have been
   *  taken AT the place. */
  dayPhotos: string[];
  /** Photo → the day it is on, for photos and dayPhotos. */
  photoDay: Record<string, string>;
};

// What a day's raw list holds. Written by the intake (a place the user
// named), by logging (where the phone was at the time) and, before places
// had ids, by photo import — old entries are filed by the sweep below.
type DayEntry = {
  label?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  moment?: string;
  kind?: PlaceKind;
};

const PLACES_KEY = 'places';
const DAY_PLACES_KEY = 'dayPlaces';
const GEOCODE_CACHE_KEY = 'geocodeCache';

/** Photos closer than this are the same place. Wide enough for GPS indoors,
 *  which drifts by tens of metres; narrow enough that the café across the
 *  road from the college is usually its own place. */
export const SAME_PLACE_METERS = 70;

const UNNAMED = 'Unnamed place';

// ── Storage ────────────────────────────────────────────────────────────────

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

const readPlaces = () => readJSON<Record<string, Place>>(PLACES_KEY, {});
const writePlaces = (p: Record<string, Place>) => AsyncStorage.setItem(PLACES_KEY, JSON.stringify(p));
const readDays = () => readJSON<Record<string, DayEntry[]>>(DAY_PLACES_KEY, {});
const writeDays = (d: Record<string, DayEntry[]>) =>
  AsyncStorage.setItem(DAY_PLACES_KEY, JSON.stringify(d));

// Every read-modify-write of places and day places goes through here, one at
// a time. The sweep, a log being filed and the user renaming a place can all
// happen at once, and two overlapping writes of the same key silently lose
// one of them.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const listeners = new Set<() => void>();
let cached: { at: number; world: Promise<World> } | null = null;

function changed() {
  cached = null;
  for (const fn of listeners) fn();
}

/** Called whenever places change — a sweep finished, a name was given. */
export function onPlacesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Names and distances ───────────────────────────────────────────────────

/** The form two names are compared in: "The Dunkin'" and "dunkin" match. */
export function placeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[.,!?;:()"\-_/\\&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function nearest(places: Record<string, Place>, lat: number, lng: number): Place | null {
  let best: Place | null = null;
  let bestDistance = SAME_PLACE_METERS;
  for (const p of Object.values(places)) {
    if (p.latitude == null || p.longitude == null) continue;
    const d = metersBetween(lat, lng, p.latitude, p.longitude);
    if (d <= bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/** A place the user has named with these words, if there is one. Only the
 *  user's own names count: a spot the map calls "Broadway" is not the
 *  Broadway the user meant. */
function findByName(places: Record<string, Place>, name: string): Place | undefined {
  const key = placeKey(name);
  if (!key) return undefined;
  return Object.values(places).find(
    (p) => p.named && (placeKey(p.name) === key || p.aliases.includes(key)),
  );
}

function createSpot(lat: number, lng: number): Place {
  return {
    id: newId(),
    name: '',
    named: false,
    aliases: [],
    latitude: lat,
    longitude: lng,
    createdAt: new Date().toISOString(),
  };
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

// Folds one place into another: its names, days and photos all move over.
// Used when the user says an unnamed spot is a place they had mentioned, and
// when a rename lands on a name that already exists.
function mergeInto(
  places: Record<string, Place>,
  days: Record<string, DayEntry[]>,
  meta: Record<string, PhotoMeta>,
  metaUpdates: [string, Partial<PhotoMeta>][],
  fromId: string,
  toId: string,
) {
  const from = places[fromId];
  const to = places[toId];
  if (!from || !to || fromId === toId) return;
  if (!to.named && from.named) {
    to.name = from.name;
    to.named = true;
  }
  to.aliases = uniq([...to.aliases, ...from.aliases, from.named ? placeKey(from.name) : ''].filter(Boolean));
  to.kind = to.kind ?? from.kind;
  to.coverUri = to.coverUri ?? from.coverUri;
  if (to.latitude == null && from.latitude != null) {
    to.latitude = from.latitude;
    to.longitude = from.longitude;
  }
  for (const list of Object.values(days)) {
    for (const e of list) {
      if (e.placeId === fromId) {
        e.placeId = toId;
        e.label = to.name;
      }
    }
  }
  for (const [uri, m] of Object.entries(meta)) {
    const patch: Partial<PhotoMeta> = {};
    if (m.placeId === fromId) patch.placeId = toId;
    if (m.saidPlaceId === fromId) patch.saidPlaceId = toId;
    if (Object.keys(patch).length > 0) {
      Object.assign(m, patch);
      metaUpdates.push([uri, patch]);
    }
  }
  delete places[fromId];
  dedupeDays(days);
}

// One entry per place per day — merges leave duplicates behind otherwise.
function dedupeDays(days: Record<string, DayEntry[]>) {
  for (const [day, list] of Object.entries(days)) {
    const seen = new Map<string, DayEntry>();
    const kept: DayEntry[] = [];
    for (const e of list) {
      if (!e.placeId) {
        kept.push(e);
        continue;
      }
      const first = seen.get(e.placeId);
      if (!first) {
        seen.set(e.placeId, e);
        kept.push(e);
      } else {
        first.moment = first.moment ?? e.moment;
        first.kind = first.kind ?? e.kind;
      }
    }
    days[day] = kept;
  }
}

// ── Street labels (Apple) ─────────────────────────────────────────────────

function coordKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// A name for a spot nobody has named: a landmark when Apple knows one
// ("New York City College of Technology"), else the street — without the
// house number, because "21st Ave" is a place and "18-21 21st Ave" is an
// address, and an address is exactly what this card is meant to replace.
async function streetLabel(lat: number, lng: number): Promise<string | null> {
  const cache = await readJSON<Record<string, string>>(GEOCODE_CACHE_KEY, {});
  const key = coordKey(lat, lng);
  if (cache[key]) return cache[key];
  const hit = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }))[0];
  if (!hit) return null;
  const landmark = hit.name && !/^\d/.test(hit.name) && hit.name !== hit.street ? hit.name : null;
  const label = landmark || hit.street || hit.district || hit.subregion || hit.city || null;
  if (label) {
    cache[key] = label;
    await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  }
  return label;
}

// ── Recording ─────────────────────────────────────────────────────────────

/** A place the user said they were at, from a log. Returns its id. */
export function recordNamedPlaceForDay(
  dayKey: string,
  said: { name: string; kind?: PlaceKind; moment?: string },
): Promise<string | null> {
  return locked(async () => {
    const name = said.name.trim();
    if (!name) return null;
    const [places, days] = await Promise.all([readPlaces(), readDays()]);
    let place = findByName(places, name);
    if (!place) {
      place = {
        id: newId(),
        name,
        named: true,
        aliases: [placeKey(name)],
        kind: said.kind,
        createdAt: new Date().toISOString(),
      };
      places[place.id] = place;
    } else if (!place.kind && said.kind) {
      place.kind = said.kind;
    }
    const id = place.id;
    const list = days[dayKey] ?? [];
    const existing = list.find(
      (e) =>
        e.placeId === id ||
        (!e.placeId && e.latitude == null && !!e.label && placeKey(e.label) === placeKey(name)),
    );
    if (existing) {
      existing.placeId = id;
      existing.label = place.name;
      existing.moment = existing.moment ?? (said.moment || undefined);
      existing.kind = existing.kind ?? said.kind;
    } else {
      list.push({ label: place.name, placeId: id, moment: said.moment || undefined, kind: said.kind });
    }
    days[dayKey] = list;
    await Promise.all([writePlaces(places), writeDays(days)]);
    changed();
    return id;
  });
}

/** The photos that came with a log naming a place are pictures of it. */
export async function linkPhotosToSaidPlace(uris: string[], placeId: string): Promise<void> {
  if (uris.length === 0) return;
  let merged = false;
  await locked(async () => {
    const [places, days, meta] = await Promise.all([readPlaces(), readDays(), getAllPhotoMeta()]);
    const updates: [string, Partial<PhotoMeta>][] = uris.map((u) => [u, { saidPlaceId: placeId }]);
    for (const u of uris) if (meta[u]) meta[u].saidPlaceId = placeId;
    // Usually the photos are filed under a spot later, by the sweep, which
    // reads saidPlaceId then. But the caption is read by the AI and can
    // finish AFTER the sweep has already filed them — so the same rule is
    // applied here, for photos that already have a spot.
    const said = places[placeId];
    const spotId = uris.map((u) => meta[u]?.placeId).find((id) => !!id && !!places[id!]);
    if (said && said.latitude == null && spotId && !places[spotId].named) {
      mergeInto(places, days, meta, updates, placeId, spotId);
      merged = true;
    }
    await Promise.all([
      setPhotoMetaBatch(updates),
      merged ? writePlaces(places) : Promise.resolve(),
      merged ? writeDays(days) : Promise.resolve(),
    ]);
  });
  if (merged) console.log('[places] a spot was named from what you said with its photos');
  changed();
  startPlaceIndexing();
}

/** Where photos were taken, when the caller already knows. */
export async function notePhotoLocations(
  entries: [string, { latitude: number; longitude: number } | null | undefined][],
): Promise<void> {
  if (entries.length === 0) return;
  await setPhotoMetaBatch(
    entries.map(([uri, loc]) => {
      const where = toLocation(loc);
      return [uri, where ? { ...where, locationRead: true } : { locationRead: true }];
    }),
  );
  startPlaceIndexing();
}

/** A location as real numbers, or null. The photo library hands its
 *  coordinates over as STRINGS on iOS — "40.6955" — which look right in a
 *  log and then break every sum done with them. Measured: the first sweep
 *  filed places correctly and then failed to name any of them. */
export function toLocation(
  loc: { latitude?: unknown; longitude?: unknown } | null | undefined,
): { latitude: number; longitude: number } | null {
  if (!loc) return null;
  const latitude = Number(loc.latitude);
  const longitude = Number(loc.longitude);
  if (loc.latitude == null || loc.longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // 0,0 is what a camera without a fix sometimes writes. Nobody took it in
  // the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export async function requestLocationPermission(): Promise<boolean> {
  const perm = await Location.requestForegroundPermissionsAsync();
  return perm.granted;
}

/** Where the phone is now, or null. Never throws. */
export async function whereAmI(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    if (!(await requestLocationPermission())) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (e) {
    console.warn('[places] could not get the current location:', e);
    return null;
  }
}

/** The user is logging something right now: they were here today. */
export async function recordCurrentLocationForDay(dayKey: string): Promise<void> {
  const here = await whereAmI();
  if (!here) return;
  await locked(async () => {
    const [places, days] = await Promise.all([readPlaces(), readDays()]);
    let place = nearest(places, here.latitude, here.longitude);
    if (!place) {
      place = createSpot(here.latitude, here.longitude);
      places[place.id] = place;
    }
    const list = days[dayKey] ?? [];
    if (!list.some((e) => e.placeId === place!.id)) {
      list.push({ placeId: place.id, latitude: here.latitude, longitude: here.longitude });
      days[dayKey] = list;
    }
    await Promise.all([writePlaces(places), writeDays(days)]);
  });
  changed();
  startPlaceIndexing();
}

// ── The sweep ─────────────────────────────────────────────────────────────
//
// Quietly, in the background: read the GPS of photos imported before places
// existed, file every located photo under a place, and give unnamed spots
// their street label. Each step commits as it goes, so stopping is free.

let running = false;
let again = false;
// Photos the OS would not describe this session. Not marked as read — a
// photo marked read is never looked at again, and "it failed once" is not
// "it has no location" — just skipped until the next launch.
const unreadable = new Set<string>();

export function startPlaceIndexing(): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  (async () => {
    do {
      again = false;
      await sweepPass();
    } while (again);
  })()
    .catch((e) => console.warn('[places] sweep failed:', e))
    .finally(() => {
      running = false;
    });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readPhotoLocations(): Promise<void> {
  const meta = await getAllPhotoMeta();
  const nothingToRead: [string, Partial<PhotoMeta>][] = [];
  const toRead: [string, string][] = [];
  for (const [uri, m] of Object.entries(meta)) {
    if (m.locationRead || unreadable.has(uri)) continue;
    // A screenshot has no location, and a photo from before asset ids were
    // kept has no way to ask for one.
    if (m.source === 'screenshot' || !m.assetId) nothingToRead.push([uri, { locationRead: true }]);
    else toRead.push([uri, m.assetId]);
  }
  if (nothingToRead.length > 0) await setPhotoMetaBatch(nothingToRead);
  if (toRead.length === 0) return;

  const perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) {
    console.warn(`[places] ${toRead.length} photos are waiting for photo access to be read`);
    return;
  }

  let found = 0;
  let failed = 0;
  // Committed a page at a time, so a big library that is interrupted keeps
  // what it already read.
  for (let i = 0; i < toRead.length; i += 60) {
    const page = toRead.slice(i, i + 60);
    const out: [string, Partial<PhotoMeta>][] = [];
    for (let j = 0; j < page.length; j += 6) {
      await Promise.all(
        page.slice(j, j + 6).map(async ([uri, assetId]) => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(assetId, {
              shouldDownloadFromNetwork: false,
            });
            const where = toLocation(info.location);
            if (where) {
              out.push([uri, { ...where, locationRead: true }]);
              found += 1;
            } else {
              out.push([uri, { locationRead: true }]);
            }
          } catch (e) {
            unreadable.add(uri);
            failed += 1;
            if (failed <= 3) console.warn('[places] could not read where a photo was taken:', e);
          }
        }),
      );
    }
    await setPhotoMetaBatch(out);
  }
  console.log(
    `[places] read ${toRead.length - failed} photo locations, ${found} had GPS` +
      (failed > 0 ? `, ${failed} UNREADABLE (retried next launch)` : ''),
  );
}

async function filePhotos(): Promise<void> {
  let created = 0;
  let merged = 0;
  let filed = 0;
  await locked(async () => {
    const [places, days, meta] = await Promise.all([readPlaces(), readDays(), getAllPhotoMeta()]);
    const metaUpdates: [string, Partial<PhotoMeta>][] = [];

    // Coordinates saved as text by the first version of this sweep (see
    // toLocation) are repaired in place, once.
    let repaired = 0;
    for (const p of Object.values(places)) {
      if (p.latitude == null) continue;
      if (typeof p.latitude === 'number' && typeof p.longitude === 'number') continue;
      const where = toLocation(p);
      if (where) Object.assign(p, where);
      else {
        delete p.latitude;
        delete p.longitude;
      }
      repaired += 1;
    }
    for (const [uri, m] of Object.entries(meta)) {
      if (m.latitude == null || (typeof m.latitude === 'number' && typeof m.longitude === 'number')) continue;
      const where = toLocation(m);
      const patch: Partial<PhotoMeta> = where ?? { latitude: undefined, longitude: undefined };
      Object.assign(m, patch);
      metaUpdates.push([uri, patch]);
      repaired += 1;
    }
    if (repaired > 0) console.log(`[places] repaired ${repaired} locations stored as text`);

    const toFile = Object.entries(meta)
      .filter(([, m]) => m.latitude != null && m.longitude != null && !m.placeId)
      .sort((a, b) => (a[1].takenAt ?? 0) - (b[1].takenAt ?? 0));

    for (const [uri, m] of toFile) {
      const lat = m.latitude!;
      const lng = m.longitude!;
      let place = nearest(places, lat, lng);
      const said = m.saidPlaceId ? places[m.saidPlaceId] : undefined;
      // The user named the place these photos show. A place they named that
      // has no location yet gets this one; a spot nobody had named takes
      // their name. A spot they already named something else is left alone.
      if (said && said.latitude == null) {
        if (!place) {
          said.latitude = lat;
          said.longitude = lng;
          place = said;
        } else if (!place.named) {
          mergeInto(places, days, meta, metaUpdates, said.id, place.id);
          merged += 1;
        }
      }
      if (!place) {
        place = createSpot(lat, lng);
        places[place.id] = place;
        created += 1;
      }
      m.placeId = place.id;
      metaUpdates.push([uri, { placeId: place.id }]);
      filed += 1;
    }

    // Where the phone was when something was logged.
    for (const list of Object.values(days)) {
      for (const e of list) {
        if (e.placeId || e.latitude == null || e.longitude == null) continue;
        const where = toLocation(e);
        if (!where) continue;
        e.latitude = where.latitude;
        e.longitude = where.longitude;
        let place = nearest(places, where.latitude, where.longitude);
        if (!place) {
          place = createSpot(where.latitude, where.longitude);
          places[place.id] = place;
          created += 1;
        }
        e.placeId = place.id;
        filed += 1;
      }
    }

    // Places the user named before places had ids.
    for (const list of Object.values(days)) {
      for (const e of list) {
        if (e.placeId || !e.label?.trim()) continue;
        let place = findByName(places, e.label);
        if (!place) {
          place = {
            id: newId(),
            name: e.label.trim(),
            named: true,
            aliases: [placeKey(e.label)],
            kind: e.kind,
            createdAt: new Date().toISOString(),
          };
          places[place.id] = place;
          created += 1;
        }
        e.placeId = place.id;
        filed += 1;
      }
    }

    if (filed === 0 && merged === 0 && repaired === 0) return;
    dedupeDays(days);
    await Promise.all([writePlaces(places), writeDays(days), setPhotoMetaBatch(metaUpdates)]);
  });
  if (filed > 0 || merged > 0) {
    console.log(`[places] filed ${filed}, ${created} new places, ${merged} named from what you said`);
    changed();
  }
}

async function nameSpots(): Promise<void> {
  const [places, meta] = await Promise.all([readPlaces(), getAllPhotoMeta()]);
  const photos = new Map<string, number>();
  for (const m of Object.values(meta)) {
    if (m.placeId) photos.set(m.placeId, (photos.get(m.placeId) ?? 0) + 1);
  }
  // Most photographed first: those are the places the user will look at.
  const unnamed = Object.values(places)
    .filter((p) => !p.named && !p.name && p.latitude != null)
    .sort((a, b) => (photos.get(b.id) ?? 0) - (photos.get(a.id) ?? 0));
  if (unnamed.length === 0) return;

  const BATCH = 40;
  let named = 0;
  let failed = 0;
  for (const p of unnamed.slice(0, BATCH)) {
    try {
      const label = await streetLabel(p.latitude!, p.longitude!);
      if (label) {
        await locked(async () => {
          const all = await readPlaces();
          const current = all[p.id];
          if (current && !current.named && !current.name) {
            current.name = label;
            await writePlaces(all);
          }
        });
        named += 1;
      }
    } catch (e) {
      failed += 1;
      if (failed === 1) {
        console.warn('[places] street label failed:', e, e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : '');
      }
    }
    // Apple's geocoder refuses bursts. One a second is well inside it.
    await pause(1100);
  }
  if (named > 0) changed();
  console.log(
    `[places] gave ${named} places a street name` +
      (failed > 0 ? `, ${failed} FAILED (retried later)` : '') +
      `, ${Math.max(0, unnamed.length - BATCH)} still waiting`,
  );
  // Only keep going while it is working — an offline phone would otherwise
  // spin here forever.
  if (named > 0 && unnamed.length > BATCH) again = true;
}

async function sweepPass(): Promise<void> {
  await readPhotoLocations();
  await filePhotos();
  await nameSpots();
}

// ── Reading ───────────────────────────────────────────────────────────────

type World = {
  summaries: Map<string, PlaceSummary>;
  byDay: Map<string, DayPlace[]>;
};

async function world(): Promise<World> {
  // Several parts of a screen ask at once; one build serves them all.
  if (cached && Date.now() - cached.at < 3000) return cached.world;
  const built = buildWorld();
  cached = { at: Date.now(), world: built };
  built.catch(() => {
    cached = null;
  });
  return built;
}

async function buildWorld(): Promise<World> {
  const [places, days, meta, memories, faces] = await Promise.all([
    readPlaces(),
    readDays(),
    getAllPhotoMeta(),
    getLoggedMemories(),
    getPhotoFaceCounts().catch((e) => {
      console.warn('[places] face counts unavailable, covers may show people:', e);
      return new Map<string, number>();
    }),
  ]);

  // Only photos that are still on a day count. The day is the memory's day,
  // the same one the Timeline files the photo under.
  const photoDay = new Map<string, string>();
  const photosOnDay = new Map<string, string[]>();
  for (const m of memories) {
    if (!m.photoUris?.length) continue;
    const day = dateKey(new Date(m.takenAt));
    for (const uri of m.photoUris) {
      photoDay.set(uri, day);
      if (meta[uri]?.source !== 'screenshot') {
        photosOnDay.set(day, [...(photosOnDay.get(day) ?? []), uri]);
      }
    }
  }

  type Acc = { days: Set<string>; photos: { uri: string; t: number }[]; moments: Record<string, string> };
  const acc = new Map<string, Acc>();
  const accFor = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { days: new Set(), photos: [], moments: {} };
      acc.set(id, a);
    }
    return a;
  };
  const dayMaps = new Map<string, Map<string, DayPlace & { t: number }>>();
  const dayPlace = (day: string, place: Place) => {
    let map = dayMaps.get(day);
    if (!map) {
      map = new Map();
      dayMaps.set(day, map);
    }
    let dp = map.get(place.id);
    if (!dp) {
      dp = {
        placeId: place.id,
        label: place.name || UNNAMED,
        named: place.named,
        kind: place.kind,
        latitude: place.latitude,
        longitude: place.longitude,
        photoUris: [],
        t: Number.MAX_SAFE_INTEGER,
      };
      map.set(place.id, dp);
    }
    return dp;
  };

  for (const [uri, day] of photoDay) {
    const m = meta[uri];
    if (!m) continue;
    for (const id of uniq([m.placeId, m.saidPlaceId].filter((x): x is string => !!x))) {
      const place = places[id];
      if (!place) continue;
      const t = m.takenAt ?? 0;
      const a = accFor(id);
      a.days.add(day);
      a.photos.push({ uri, t });
      const dp = dayPlace(day, place);
      dp.photoUris.push(uri);
      dp.t = Math.min(dp.t, t);
    }
  }
  for (const [day, list] of Object.entries(days)) {
    for (const e of list) {
      const place = e.placeId ? places[e.placeId] : undefined;
      if (!place) continue;
      const a = accFor(place.id);
      a.days.add(day);
      if (e.moment && !a.moments[day]) a.moments[day] = e.moment;
      const dp = dayPlace(day, place);
      if (e.moment && !dp.moment) dp.moment = e.moment;
    }
  }

  // The cover: the user's choice, else the best photo taken there — one
  // with nobody in it, then one not read for faces yet, then anything;
  // newest first within each.
  const coverFor = (place: Place, photos: { uri: string; t: number }[]): string | undefined => {
    if (place.coverUri) return place.coverUri;
    let best: { uri: string; score: number; t: number } | null = null;
    for (const p of photos) {
      const n = faces.get(p.uri);
      const score = n === 0 ? 2 : n == null ? 1 : 0;
      if (!best || score > best.score || (score === best.score && p.t > best.t)) {
        best = { uri: p.uri, score, t: p.t };
      }
    }
    return best?.uri;
  };

  const summaries = new Map<string, PlaceSummary>();
  for (const place of Object.values(places)) {
    const a = acc.get(place.id);
    if (!a || a.days.size === 0) continue;
    const photos = [...a.photos].sort((x, y) => y.t - x.t);
    const sortedDays = [...a.days].sort();
    const dayPhotos =
      place.latitude == null
        ? uniq(sortedDays.slice().reverse().flatMap((d) => photosOnDay.get(d) ?? [])).slice(0, 30)
        : [];
    const photoUris = uniq(photos.map((p) => p.uri));
    summaries.set(place.id, {
      ...place,
      label: place.name || UNNAMED,
      days: sortedDays,
      photos: photoUris,
      cover: coverFor(place, photos),
      moments: a.moments,
      maybeNames: [],
      dayPhotos,
      photoDay: Object.fromEntries(
        [...photoUris, ...dayPhotos].map((u) => [u, photoDay.get(u) ?? ''] as const),
      ),
    });
  }

  // A spot nobody has named, and a place the user mentioned on the same day
  // that has no location of its own: probably the same place. Offered as a
  // question on the spot's profile — see the note at the top of this file.
  for (const s of summaries.values()) {
    if (s.named) continue;
    const offered = new Map<string, string>();
    for (const day of s.days) {
      for (const e of days[day] ?? []) {
        const other = e.placeId ? places[e.placeId] : undefined;
        if (other && other.named && other.latitude == null) offered.set(other.id, other.name);
      }
    }
    s.maybeNames = [...offered].slice(0, 4).map(([id, name]) => ({ id, name }));
  }

  const byDay = new Map<string, DayPlace[]>();
  for (const [day, map] of dayMaps) {
    const list = [...map.values()]
      .filter((dp) => summaries.has(dp.placeId))
      .sort((a, b) => a.t - b.t)
      .map(({ t: _t, ...dp }) => ({ ...dp, cover: summaries.get(dp.placeId)?.cover }));
    if (list.length > 0) byDay.set(day, list);
  }

  return { summaries, byDay };
}

/** Every place, most recently visited first. */
export async function getPlaces(): Promise<PlaceSummary[]> {
  const { summaries } = await world();
  return [...summaries.values()].sort(
    (a, b) => (b.days[b.days.length - 1] ?? '').localeCompare(a.days[a.days.length - 1] ?? '') ||
      b.days.length - a.days.length,
  );
}

/** One place, by id — or by name, for links that only know what the user
 *  called it (a chat answer, a person's profile). */
export async function getPlace(idOrName: string): Promise<PlaceSummary | null> {
  const { summaries } = await world();
  const byId = summaries.get(idOrName);
  if (byId) return byId;
  const key = placeKey(idOrName);
  if (!key) return null;
  for (const s of summaries.values()) {
    if (placeKey(s.label) === key || s.aliases.includes(key)) return s;
  }
  return null;
}

export async function getPlacesForDay(dayKey: string): Promise<DayPlace[]> {
  return (await world()).byDay.get(dayKey) ?? [];
}

export async function getAllDayPlaces(): Promise<Record<string, DayPlace[]>> {
  return Object.fromEntries((await world()).byDay);
}

/** The names the user has given places, most visited first — so the intake
 *  can spell a place the way it is already known. */
export async function knownPlaceNames(limit = 40): Promise<string[]> {
  const all = await getPlaces();
  return all
    .filter((p) => p.named)
    .sort((a, b) => b.days.length - a.days.length)
    .slice(0, limit)
    .map((p) => p.label);
}

// ── Changing ──────────────────────────────────────────────────────────────

/** The user names a place. If they give a name another place already has,
 *  the two become one. Returns the id of the place that remains. */
export function renamePlace(id: string, newName: string): Promise<string> {
  return locked(async () => {
    const name = newName.trim();
    const [places, days, meta] = await Promise.all([readPlaces(), readDays(), getAllPhotoMeta()]);
    if (!name || !places[id]) return id;
    const metaUpdates: [string, Partial<PhotoMeta>][] = [];
    let survivor = id;
    const other = findByName(places, name);
    if (other && other.id !== id) {
      // The one that knows where it is survives.
      const keepThis = places[id].latitude != null || other.latitude == null;
      const [from, to] = keepThis ? [other.id, id] : [id, other.id];
      mergeInto(places, days, meta, metaUpdates, from, to);
      survivor = to;
    }
    const place = places[survivor];
    place.name = name;
    place.named = true;
    place.aliases = uniq([...place.aliases, placeKey(name)]);
    for (const list of Object.values(days)) {
      for (const e of list) if (e.placeId === survivor) e.label = name;
    }
    await Promise.all([writePlaces(places), writeDays(days), setPhotoMetaBatch(metaUpdates)]);
    changed();
    return survivor;
  });
}

/** "This spot is Dunkin" — the answer to a place's question. */
export async function nameSpotAs(spotId: string, namedPlaceId: string): Promise<string> {
  const places = await readPlaces();
  const named = places[namedPlaceId];
  if (!named) return spotId;
  return renamePlace(spotId, named.name);
}

export function setPlaceCover(id: string, uri: string | null): Promise<void> {
  return locked(async () => {
    const places = await readPlaces();
    if (!places[id]) return;
    if (uri) places[id].coverUri = uri;
    else delete places[id].coverUri;
    await writePlaces(places);
    changed();
  });
}

export function setPlaceKind(id: string, kind: PlaceKind): Promise<void> {
  return locked(async () => {
    const places = await readPlaces();
    if (!places[id]) return;
    places[id].kind = kind;
    await writePlaces(places);
    changed();
  });
}

// ── Words ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** How many days from today — what /day/[offset] takes. */
export function offsetOfDay(day: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dayDate(day).getTime() - today.getTime()) / 86400000);
}

/** "today", "yesterday", "on Monday", "on 3 March", "on 3 March 2025". */
export function relativeDay(day: string, now = new Date()): string {
  const then = dayDate(day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - then.getTime()) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff > 1 && diff < 7) return `on ${WEEKDAYS[then.getDay()]}`;
  const base = `on ${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear() ? base : `${base} ${then.getFullYear()}`;
}

/** The weekday most visits fall on, when there clearly is one. Two Mondays
 *  out of four visits read as "usually on Mondays" in the first test, which
 *  is a pattern invented from a coincidence — so it takes at least three
 *  visits on that day, and most of them. */
export function usualWeekday(days: string[]): string | null {
  if (days.length < 5) return null;
  const counts = new Array(7).fill(0);
  for (const d of days) counts[dayDate(d).getDay()] += 1;
  const top = counts.indexOf(Math.max(...counts));
  return counts[top] >= 3 && counts[top] / days.length > 0.5 ? WEEKDAYS[top] : null;
}

/** How often, in a sentence: "You go there often · usually on Mondays". */
export function describeFrequency(days: string[], now = new Date()): string {
  const cutoff = dateKey(new Date(now.getTime() - 30 * 86400000));
  const recent = days.filter((d) => d >= cutoff).length;
  let line: string;
  if (recent >= 12) line = "You're there most days";
  else if (recent >= 4) line = 'You go there frequently';
  else if (days.length === 1) line = "You've been here once";
  else line = `You've been here ${days.length} times`;
  const weekday = usualWeekday(days);
  return weekday ? `${line} · usually on ${weekday}s` : line;
}
