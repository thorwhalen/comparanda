/**
 * Write `src/view/encodings/vsup-palette.ts`: the value-suppressing palette,
 * derived by `vsup-derive.ts` and checked in, so the render path reads a table
 * and does no colour maths (ADR-0010 clause 6).
 *
 * Run after changing `VSUP_SPEC`, a theme token, or the derivation:
 * `npx tsx scripts/emit-vsup-palette.ts`. `tests/vsup.test.ts` fails while the
 * file and the derivation disagree, and fails if any entry is illegible.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderVsupPaletteModule } from '../src/view/encodings/vsup-derive.js';

const target = fileURLToPath(new URL('../src/view/encodings/vsup-palette.ts', import.meta.url));
writeFileSync(target, renderVsupPaletteModule());
console.log(`wrote ${target}`);
