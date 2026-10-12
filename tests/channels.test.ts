/**
 * The cheap half of ADR-0028's gate (#102), in plain Node: the stylesheets the
 * matrix ships contain no background image at all, so no meaning can ride on
 * one; and the glyph table gives every core reason a shape of its own. The
 * browser suite (`tests/browser/channels.test.ts`) checks the rendered result
 * under forced colors and print.
 */
import { describe, expect, it } from 'vitest';

import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';
import { GLYPH_KEYS, glyphName } from '../src/view/channels.js';
import { VSUP_PALETTE } from '../src/view/encodings/vsup-palette.js';
import { derivedPaletteCss, MATRIX_CSS } from '../src/view/matrix-css.js';

/** What would put an image behind a cell: the property, its shorthand with an image, or an image function. */
const BACKGROUND_IMAGE = /background-image|gradient\(|url\(|image-set\(|element\(|cross-fade\(/i;

describe('no background image in the shipped stylesheets (ADR-0028)', () => {
  it('the matrix stylesheet has none', () => {
    expect(MATRIX_CSS).not.toMatch(BACKGROUND_IMAGE);
  });

  it('an encoding\'s derived palette stylesheet has none', () => {
    expect(derivedPaletteCss(VSUP_PALETTE)).not.toMatch(BACKGROUND_IMAGE);
  });

  it('the forced-colors block restores border width and colour, never style', () => {
    const block = MATRIX_CSS.slice(MATRIX_CSS.indexOf('@media (forced-colors: active)'));
    const forced = block.slice(0, block.indexOf('\n}\n'));
    expect(forced).toMatch(/border-width/);
    expect(forced).not.toMatch(/border(-[a-z]+)?-style|border:\s/);
  });
});

describe('the glyphs', () => {
  it('cover every core reason and an undeclared one, each a distinct shape', () => {
    expect(new Set(GLYPH_KEYS)).toEqual(new Set([...Object.keys(CORE_MISSING_CODES), 'undeclared']));
    expect(new Set(GLYPH_KEYS.map(glyphName)).size).toBe(GLYPH_KEYS.length);
  });
});
