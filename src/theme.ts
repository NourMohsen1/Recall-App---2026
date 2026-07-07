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
