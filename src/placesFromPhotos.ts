import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

// Real "Places" for a day, derived from where photos were actually taken
// (their embedded GPS, for photos imported from the library) or from the
// user's live location at the moment they log something manually. No
// placeholder places — a day only has the places it can actually prove.

// A place attached to a day. GPS-detected places carry coordinates; places
// the user *mentioned* in a logging ("I went to the gym") have a label only.
export type DetectedPlace = { label: string; latitude?: number; longitude?: number };

const GEOCODE_CACHE_KEY = 'geocodeCache'; // Record<"lat,lng" rounded, label>
const DAY_PLACES_KEY = 'dayPlaces'; // Record<dateKey, DetectedPlace[]>

// Round to ~11m so nearby shots at the same spot share one cache entry/place
// instead of geocoding (and listing) near-duplicates.
function coordKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

async function labelForCoords(lat: number, lng: number): Promise<string | null> {
  const cache = await readJSON<Record<string, string>>(GEOCODE_CACHE_KEY, {});
  const key = coordKey(lat, lng);
  if (cache[key]) return cache[key];

  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const hit = results[0];
    if (!hit) return null;
    const label = hit.name || hit.street || hit.city || null;
    if (label) {
      cache[key] = label;
      await AsyncStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
    }
    return label;
  } catch {
    return null;
  }
}

export async function getPlacesForDay(dayKey: string): Promise<DetectedPlace[]> {
  const byDay = await readJSON<Record<string, DetectedPlace[]>>(DAY_PLACES_KEY, {});
  return byDay[dayKey] ?? [];
}

export async function getAllDayPlaces(): Promise<Record<string, DetectedPlace[]>> {
  return readJSON<Record<string, DetectedPlace[]>>(DAY_PLACES_KEY, {});
}

// Records that a photo/moment on `dayKey` happened at (lat, lng) — resolves
// the label (cached) and merges it into that day's place list, deduped by
// location so the same coffee shop doesn't show up three times.
export async function recordLocationForDay(
  dayKey: string,
  lat: number,
  lng: number,
): Promise<void> {
  const label = await labelForCoords(lat, lng);
  if (!label) return;

  const byDay = await readJSON<Record<string, DetectedPlace[]>>(DAY_PLACES_KEY, {});
  const existing = byDay[dayKey] ?? [];
  const key = coordKey(lat, lng);
  if (
    existing.some(
      (p) => p.latitude != null && p.longitude != null && coordKey(p.latitude, p.longitude) === key,
    )
  ) {
    return;
  }
  // A mentioned place with the same name gains coordinates instead of duping.
  const named = existing.find(
    (p) => p.latitude == null && p.label.toLowerCase() === label.toLowerCase(),
  );
  if (named) {
    named.latitude = lat;
    named.longitude = lng;
    byDay[dayKey] = existing;
  } else {
    byDay[dayKey] = [...existing, { label, latitude: lat, longitude: lng }];
  }
  await AsyncStorage.setItem(DAY_PLACES_KEY, JSON.stringify(byDay));
}

// Records a place the user *named* in a logging ("I went to the gym") — no
// coordinates, deduped by label so retelling the same day doesn't stack up.
export async function recordNamedPlaceForDay(dayKey: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const byDay = await readJSON<Record<string, DetectedPlace[]>>(DAY_PLACES_KEY, {});
  const existing = byDay[dayKey] ?? [];
  if (existing.some((p) => p.label.toLowerCase() === trimmed.toLowerCase())) return;
  byDay[dayKey] = [...existing, { label: trimmed }];
  await AsyncStorage.setItem(DAY_PLACES_KEY, JSON.stringify(byDay));
}

export async function requestLocationPermission(): Promise<boolean> {
  const perm = await Location.requestForegroundPermissionsAsync();
  return perm.granted;
}

// Tags "right now, where the user is" against a day — used when manually
// logging a memory (text/voice/photo taken in the moment), as opposed to
// bulk-importing old photos which already carry their own GPS.
export async function recordCurrentLocationForDay(dayKey: string): Promise<void> {
  try {
    const granted = await requestLocationPermission();
    if (!granted) return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    await recordLocationForDay(dayKey, pos.coords.latitude, pos.coords.longitude);
  } catch {
    // Location isn't essential to saving the memory — fail silently.
  }
}
