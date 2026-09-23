import * as Contacts from 'expo-contacts';

// Finds a person in the phone's contacts so their profile photo and name can
// fill themselves in.
//
// The manual alternative is asking someone to scroll a library of tens of
// thousands of photos to find one of their own brother. Their contacts
// already have that photo, already picked by them, already named — so when
// there's a match this turns the whole job into one tap.
//
// Two rules this module holds to:
//   · It only ever reads contacts when the user asked for a photo. There is
//     no background scan, no import of the address book, and nothing is
//     stored except the one image the user picks.
//   · A match is only ever a SUGGESTION. Names in a memory log are casual
//     ("Mama Nadia", "Tarek") and will happily half-match the wrong contact,
//     so the user always confirms by tapping the face they recognise.

export type ContactMatch = {
  id: string;
  name: string;
  imageUri: string;
};

// Loose enough to survive how people actually get named in a log, strict
// enough not to match everyone: case and accents ignored, punctuation and
// the honorifics an Egyptian user would type dropped.
const HONORIFICS = /\b(mr|mrs|ms|dr|eng|mama|baba|3am|3ammo|khalo|tante|uncle|aunt)\b/g;

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(HONORIFICS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// How well a contact's name matches the name in the memory log, 0 = no match.
// Deliberately conservative: a shared first name alone is a weak signal, an
// exact full-name match is a strong one.
function score(personName: string, contactName: string): number {
  const a = normalize(personName);
  const b = normalize(contactName);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const aParts = a.split(' ').filter((p) => p.length > 1);
  const bParts = b.split(' ').filter((p) => p.length > 1);
  if (aParts.length === 0 || bParts.length === 0) return 0;

  // One name fully contained in the other ("Nayer" vs "Nayer Mohsen").
  if (b.startsWith(a + ' ') || a.startsWith(b + ' ')) return 80;

  const shared = aParts.filter((p) => bParts.includes(p));
  if (shared.length === 0) return 0;
  // Every word matched, just in a different order.
  if (shared.length === aParts.length) return 70;
  // First names agree — worth showing, but ranked below a fuller match.
  if (shared.includes(aParts[0]) && bParts[0] === aParts[0]) return 45;
  return 25;
}

// Only suggest a contact when the name genuinely looks like the same person.
const MIN_SCORE = 45;

export function contactsAvailable(): boolean {
  // The module is a no-op shim on web, where there is no address book.
  return typeof Contacts.getContactsAsync === 'function';
}

// Asks for contacts access. Returns false when the user says no — which is a
// perfectly normal answer here, and every caller must carry on without it.
export async function requestContactsAccess(): Promise<boolean> {
  try {
    const { granted } = await Contacts.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

// Contacts whose name looks like this person, best match first, and only
// those that actually have a photo — a match with no image can't help here.
export async function findContactPhotos(personName: string, limit = 6): Promise<ContactMatch[]> {
  if (!personName.trim() || !contactsAvailable()) return [];
  try {
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.Image, Contacts.Fields.ImageAvailable],
    });

    return data
      .map((c) => ({ contact: c, score: score(personName, c.name ?? '') }))
      .filter((m) => m.score >= MIN_SCORE && !!m.contact.image?.uri)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ contact }) => ({
        id: contact.id ?? contact.name ?? '',
        name: contact.name ?? '',
        imageUri: contact.image!.uri!,
      }));
  } catch {
    // Permission revoked mid-flight, or no address book on this platform.
    return [];
  }
}
