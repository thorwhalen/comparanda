/**
 * The two themes' colour tokens: the one place a surface or an ink is written.
 *
 * The stylesheet declares them as `--cmp-*` custom properties, and the palette
 * builders read them, so a palette suppressed toward "the surface" is
 * suppressed toward the colour the cell actually paints (ADR-0010 clause 3),
 * not a copy of it that can drift.
 */
export type Theme = 'light' | 'dark';

export interface ThemeTokens {
  readonly surface: string;
  readonly ink: string;
  /** The ink that clears contrast where `ink` does not: on the darker fills of a light theme, the lighter of a dark one. */
  readonly inkInverse: string;
  readonly muted: string;
  readonly header: string;
  readonly band: string;
  readonly rule: string;
  readonly focus: string;
}

export const THEMES: Readonly<Record<Theme, ThemeTokens>> = /* @__PURE__ */ Object.freeze({
  light: Object.freeze({
    surface: '#ffffff', ink: '#1b1d21', inkInverse: '#ffffff', muted: '#4b5058',
    header: '#eef0f3', band: '#dfe3e8', rule: '#c4c9d0', focus: '#1d4ed8',
  }),
  dark: Object.freeze({
    surface: '#15171b', ink: '#e6e8eb', inkInverse: '#15171b', muted: '#b4bac3',
    header: '#23262c', band: '#2e323a', rule: '#464c55', focus: '#8ab4ff',
  }),
});
