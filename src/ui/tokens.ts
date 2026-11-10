/**
 * Design tokens v1 (owner: UX agent, see docs/design-system.md).
 * Screens must use these via `useTheme()`; no hard-coded colours, sizes or radii in feature code.
 * Every text/background pair below meets WCAG AA (4.5:1); ratios are listed in the design-system doc.
 */

const light = {
  background: '#FAF8F5', // warm paper; lets garment photos stand out
  surface: '#FFFFFF',
  surfaceSunken: '#F1EEE8', // photo wells, input fields
  border: '#E6E1D8',
  text: '#1C1B19',
  textMuted: '#6B665E',
  accent: '#A4482F', // clay: primary actions only
  onAccent: '#FFFFFF',
  danger: '#B42318',
  success: '#2F7D4F',
  overlay: 'rgba(20, 20, 18, 0.5)',
} as const;

export type ColourTokens = { [K in keyof typeof light]: string };

const dark: ColourTokens = {
  background: '#141412',
  surface: '#1E1D1A',
  surfaceSunken: '#262521',
  border: '#34322D',
  text: '#F2F0EC',
  textMuted: '#A39E95',
  accent: '#E5917A',
  onAccent: '#1C1B19',
  danger: '#F27A6E',
  success: '#6CC28F',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const colours = { light, dark };

/** 4-pt spacing scale. */
export const space = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;

/** Type scale. System fonts for speed; sizes respect the user's dynamic-type setting. */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

export type TypeVariant = keyof typeof type;

/** Minimum touch target (Apple HIG 44pt, Material 48dp; we use 48). */
export const touchTarget = 48;

/** Motion durations in ms. Respect reduce-motion: skip animation entirely when enabled. */
export const motion = { fast: 120, base: 200, slow: 320 } as const;

/** Photo aspect ratios: items are shown 4:5, outfits 3:4. */
export const aspect = { item: 4 / 5, outfit: 3 / 4 } as const;
