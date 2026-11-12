import { describe, expect, it } from 'vitest';
import { colours } from './tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Every foreground/background pair the UI is allowed to use. WCAG AA for normal text = 4.5:1.
const PAIRS = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceSunken'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceSunken'],
  ['accent', 'background'],
  ['onAccent', 'accent'],
  ['onAccent', 'danger'],
  ['danger', 'background'],
  ['success', 'background'],
] as const;

// Non-text UI that must be visible (outlines of inputs and secondary buttons): WCAG 1.4.11 = 3:1.
const OUTLINES = [
  ['borderStrong', 'background'],
  ['borderStrong', 'surface'],
] as const;

describe('colour tokens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${scheme}: ${fg} on ${bg} meets AA`, () => {
        expect(contrast(colours[scheme][fg], colours[scheme][bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [fg, bg] of OUTLINES) {
      it(`${scheme}: ${fg} on ${bg} meets 3:1`, () => {
        expect(contrast(colours[scheme][fg], colours[scheme][bg])).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
