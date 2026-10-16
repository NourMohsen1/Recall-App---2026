// Recall design tokens — from the brand guide (FINAL-PRESENTATION - RECALL)
export const colors = {
  // Monochromatic teal scale, darkest → lightest
  black: '#000000',
  ink: '#081112',
  deep: '#102224',
  dark: '#183236',
  primary: '#29545A',
  teal: '#336970',
  slate: '#5C878D',
  muted: '#85A5A9',
  soft: '#ADC3C6',
  pale: '#D6E1E2',
  white: '#FFFFFF',
  // CTA aqua from the onboarding buttons
  accent: '#63BCC6',
} as const;

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

// Type scale — floor is 12 (secondary/meta text only, e.g. timestamps, chip
// labels). Nothing that's meant to be read as a sentence should go below
// `body` (14). This scale is the reference point for the future adjustable
// text-size setting: everything should scale from here rather than using
// one-off literals.
export const type = {
  caption: 12, // timestamps, tiny badges — floor, use sparingly
  label: 13, // chip/tag text, small metadata
  body: 14, // default reading text, descriptions, list items
  bodyLg: 15, // emphasized body text, chat bubbles, buttons
  subtitle: 16, // card/section headings
  heading: 18, // larger section headings
  title: 22, // page titles (secondary)
  titleLg: 24, // page titles (primary)
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

// ── Light and dark, designed as one ─────────────────────────────────────
//
// Screens take their colours from a palette by role ("the page", "a card",
// "secondary text"), never by value, so each mode can pick what that role
// should look like rather than flipping a colour (Nour, Oct 2026).
//
// Light is the app as it always was. Dark is Recall at night:
// - Never pure black. The page is a very dark teal-grey (the brand's own
//   ink, lifted), so it reads as Recall and stays calm on OLED.
// - Depth comes from light, not shadow. A card is a step lighter than the
//   page, a sheet a step lighter again; shadows, which turn into glows on
//   dark, are off, and raised things get a faint edge instead.
// - Softer text. Headings are off-white with a little teal (#E3EBEB), body
//   text a step dimmer; pure white only on the teal buttons.
// - Teal you read (titles, icons, links) is lifted to a light aqua so it
//   holds its contrast; teal you press (tiles, buttons) stays deep brand
//   teal, a touch brighter than the page around it.
// - The screens that were always dark (Ask, live voice, setup) stay as
//   they are in both modes.

export type Scheme = 'light' | 'dark';

const light = {
  scheme: 'light' as Scheme,
  /** The page. */
  bg: '#FFFFFF',
  /** A grouped page (Profile): cards sit on it. */
  bgGrouped: colors.pale,
  /** A softer grouped page (Tasks, the task editor). */
  bgSoft: '#EFF3F3',
  /** Cards and rows on the page. */
  surface: '#FFFFFF',
  /** Sheets, menus and pop-ups, a step above cards. */
  raised: '#FFFFFF',
  /** Quiet fills: search fields, empty photo boxes, inactive pills. */
  fill: '#EEF3F3',
  /** An even quieter fill, for big areas. */
  fillSoft: '#F6F8F8',
  /** The pale teal chips and circles (week strip, place chips). */
  chip: colors.pale,
  /** Text on a chip. */
  onChip: colors.primary,
  /** Card outlines. */
  border: '#C9CDCE',
  /** Lines between rows. */
  divider: '#E8ECEC',
  /** A raised thing's edge: nothing in light (it has a shadow). */
  edge: 'transparent',
  /** The handle at the top of a sheet. */
  grabber: '#DDE3E3',

  /** Headings. */
  ink: colors.ink,
  /** Main text. */
  text: '#1B1B1B',
  /** Body text in lists and rows. */
  textBody: '#2B2B2B',
  /** Secondary text. */
  textSoft: '#4A5253',
  /** Descriptions, hints. */
  textMuted: '#5B6364',
  /** Timestamps, meta, chevrons. */
  textFaint: '#8B9394',
  /** Placeholders, disabled. */
  textGhost: '#A3ABAC',

  /** Brand teal you read: titles, icons, links on the page. */
  brand: colors.primary,
  /** The lighter brand teal for icons and lines. */
  brandSoft: colors.teal,
  /** Brand teal you press: tiles, buttons, today's circle. */
  tile: colors.primary,
  /** The second tile teal. */
  tileAlt: colors.teal,
  /** Text and icons on a tile. */
  onTile: colors.white,
  /** Quieter teal text: hints, "unconfirmed" labels. */
  brandMuted: colors.slate,
  /** Faint teal: chevrons and empty-state icons, dashed outlines. */
  brandFaint: colors.soft,
  /** Teal-grey outlines and lines. */
  brandLine: colors.muted,
  accent: colors.accent,
  /** A tinted wash of the accent, for selected rows. */
  accentWash: 'rgba(99,188,198,0.14)',
  success: '#A9D3B6',
  danger: '#B24545',
  dangerWash: '#F6E3E3',
  /** "Needs a date" and other gentle warnings. */
  warn: '#8A6D3B',
  warnWash: '#F5EEDC',
  /** A switch's track, on and off. */
  toggleOn: colors.pale,
  toggleOff: '#E4E6E6',
  knobOff: '#AEB6B7',

  /** Behind a menu or the + bubbles. */
  scrim: 'rgba(8,17,18,0.45)',
  /** Behind a bottom sheet. */
  backdrop: 'rgba(0,0,0,0.35)',
  /** Shadows only exist in light. */
  shadow: '#081112',
  /** The Timeline's dotted canvas. */
  canvasDot: '#C9CDCE',
  /** The Timeline's teal-grey header band. */
  band: colors.muted,
  /** The Timeline canvas, and the cards laid on it. In light a shadow
   *  lifts the cards; in dark the canvas sits a step below the page and
   *  the cards two steps above it, with a faint edge (Nour: "dark on
   *  dark"). */
  canvas: '#FFFFFF',
  canvasCard: '#FFFFFF',
  canvasEdge: 'transparent',
};

// Every role is a colour string (the brand constants above are literal
// types; a palette only promises "a colour").
export type Palette = { [K in keyof typeof light]: K extends 'scheme' ? Scheme : (typeof light)[K] extends string ? string : (typeof light)[K] };

const dark: Palette = {
  scheme: 'dark',
  bg: '#0E1718',
  bgGrouped: '#0B1314',
  bgSoft: '#0B1314',
  surface: '#152123',
  raised: '#1B2A2C',
  fill: '#1D2C2E',
  fillSoft: '#121D1E',
  chip: '#203437',
  onChip: '#A9CDD1',
  border: '#263A3D',
  divider: '#1F3033',
  edge: 'rgba(227,235,235,0.07)',
  grabber: '#3A4E51',

  ink: '#E3EBEB',
  text: '#DDE6E6',
  textBody: '#CAD5D5',
  textSoft: '#AEBBBC',
  textMuted: '#97A6A7',
  textFaint: '#7A8B8D',
  textGhost: '#5A6B6D',

  brand: '#8EC6CC',
  brandSoft: '#76AEB5',
  brandMuted: '#7FA5AA',
  brandFaint: '#4A676B',
  brandLine: '#3B5659',
  tile: '#245A61',
  tileAlt: '#28626A',
  onTile: '#EEF5F5',
  accent: colors.accent,
  accentWash: 'rgba(99,188,198,0.16)',
  success: '#7DB892',
  danger: '#E5827E',
  dangerWash: '#3A2224',
  warn: '#E0C27E',
  warnWash: '#352E1E',
  toggleOn: 'rgba(99,188,198,0.30)',
  toggleOff: '#2A3A3C',
  knobOff: '#6F8082',

  scrim: 'rgba(0,0,0,0.62)',
  backdrop: 'rgba(0,0,0,0.6)',
  shadow: 'transparent',
  canvasDot: '#22353A',
  band: '#1A2E31',
  canvas: '#0A1213',
  canvasCard: '#1E2F31',
  canvasEdge: 'rgba(227,235,235,0.10)',
};

export const palettes: Record<Scheme, Palette> = { light, dark };
