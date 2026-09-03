import { colors } from './theme';

// Labels the *provenance* of an imported photo — a screenshot, or saved from
// a known app — so a re-shared/duplicated image never gets confused with
// when it was actually, natively taken. Detection is best-effort and only
// as honest as the metadata the OS actually hands us:
//   · iOS flags real screenshots via PHAsset mediaSubtypes — reliable.
//   · Android has no such flag, but its own Screenshot app names files
//     "Screenshot_...", which is reliable too.
//   · There is no OS-level "which app saved this" field. WhatsApp is the
//     one exception with a near-universal filename convention
//     (IMG-YYYYMMDD-WAxxxx). Instagram/ChatGPT are detected from filename
//     patterns those apps are known to use, with EXIF Software/UserComment
//     as a fallback signal — when neither matches, we show no label rather
//     than guess.

// Auto-detectable from real metadata (see detectPhotoSource below). The
// rest — Snapchat, TikTok, Facebook, Telegram, X — have no reliable public
// signal on iOS at all (Apple keeps "which app saved this" as a private,
// OS-only record; no third-party app, including this one, can read it).
// Those exist only as manual, user-set labels — see photoMeta.ts.
export type SourceKey = 'screenshot' | 'whatsapp' | 'instagram' | 'chatgpt';
export type ManualOnlySourceKey = 'snapchat' | 'tiktok' | 'facebook' | 'telegram' | 'twitter';
export type AnySourceKey = SourceKey | ManualOnlySourceKey;

export type SourceLabel = { key: SourceKey; text: string; bg: string; fg: string };

// The single source of truth for each label's copy + brand color — reused
// by the detector below, the manual picker sheet, and the photo viewer's pill.
export const SOURCE_LABEL_STYLES: Record<AnySourceKey, { text: string; bg: string; fg: string }> = {
  // Pale teal — Recall's own accent, since a screenshot isn't "from" any
  // external app; it's a native OS action.
  screenshot: { text: 'Screen Shot', bg: colors.accent, fg: colors.ink },
  whatsapp: { text: 'Saved from WhatsApp', bg: '#25D366', fg: '#FFFFFF' },
  instagram: { text: 'Saved from Instagram', bg: '#E4405F', fg: '#FFFFFF' },
  chatgpt: { text: 'Saved from ChatGPT', bg: '#FFFFFF', fg: '#111111' },
  snapchat: { text: 'Saved from Snapchat', bg: '#FFFC00', fg: '#111111' },
  tiktok: { text: 'Saved from TikTok', bg: '#111111', fg: '#FFFFFF' },
  facebook: { text: 'Saved from Facebook', bg: '#1877F2', fg: '#FFFFFF' },
  telegram: { text: 'Saved from Telegram', bg: '#26A5E4', fg: '#FFFFFF' },
  twitter: { text: 'Saved from X', bg: '#000000', fg: '#FFFFFF' },
};

// Options offered in the manual "tag this photo" picker, in display order.
export const MANUAL_SOURCE_OPTIONS: AnySourceKey[] = [
  'screenshot',
  'whatsapp',
  'instagram',
  'snapchat',
  'tiktok',
  'facebook',
  'telegram',
  'twitter',
  'chatgpt',
];

function readSoftwareTag(exif: unknown): string {
  if (!exif || typeof exif !== 'object') return '';
  const e = exif as Record<string, any>;
  return String(e.Software ?? e.UserComment ?? e['{TIFF}']?.Software ?? e['{Exif}']?.UserComment ?? '');
}

export function detectPhotoSource(input: {
  filename?: string | null;
  // iOS-only PHAsset classification (expo-media-library `Asset.mediaSubtypes`).
  mediaSubtypes?: string[] | null;
  exif?: unknown;
}): SourceLabel | null {
  const filename = input.filename ?? '';
  const software = readSoftwareTag(input.exif);

  if (
    input.mediaSubtypes?.includes('screenshot') ||
    /^screenshot[_\s-]/i.test(filename) ||
    /^screen\s?shot/i.test(filename)
  ) {
    return { key: 'screenshot', ...SOURCE_LABEL_STYLES.screenshot };
  }
  if (/-wa\d{3,4}/i.test(filename) || /^img-\d{8}-wa/i.test(filename) || /whatsapp/i.test(software)) {
    return { key: 'whatsapp', ...SOURCE_LABEL_STYLES.whatsapp };
  }
  if (/^chatgpt[\s_-]?image/i.test(filename) || /chatgpt/i.test(software)) {
    return { key: 'chatgpt', ...SOURCE_LABEL_STYLES.chatgpt };
  }
  if (/instagram/i.test(filename) || /instagram/i.test(software)) {
    return { key: 'instagram', ...SOURCE_LABEL_STYLES.instagram };
  }
  return null;
}
