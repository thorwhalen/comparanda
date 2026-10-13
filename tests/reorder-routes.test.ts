/**
 * Reorder's view-independent pieces (#92): the order's provenance in words,
 * seriation as an action, a place in words; and the pointer path's
 * deletability, held as a fact about the source rather than a promise.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Analysis } from '../src/core/schema/analysis.js';
import { arrangeToRevealStructure, describeOrder, describePlace, moveTo } from '../src/core/reorder.js';
import { initialViewState } from '../src/core/view-state.js';
import relocationJson from '../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);

describe('describeOrder', () => {
  it('says how each kind of order came about, in the analysis\'s words', () => {
    const v = initialViewState(relocation);
    expect(describeOrder(relocation, v, 'alternatives')).toMatch(/in the order the analysis gives them/);
    const moved = moveTo(v, 'criteria', 0, 2, { by: 'dana', at: '2026-10-13' }).state;
    expect(describeOrder(relocation, moved, 'criteria')).toMatch(/arranged by hand, by dana, 2026-10-13\./);
  });
});

describe('arrangeToRevealStructure', () => {
  it('records the seriation provenance, keeps every id, and says so', () => {
    const v = initialViewState(relocation);
    const { state, said } = arrangeToRevealStructure(relocation, v, 'alternatives', 'score', { at: '2026-10-13' });
    expect(state.alternativeOrder.provenance.kind).toBe('seriated');
    expect([...state.alternativeOrder.order].sort()).toEqual([...v.alternativeOrder.order].sort());
    expect(said).toMatch(/arranged to reveal structure/);
    expect(said).toMatch(/linkage/);
  });
});

describe('describePlace', () => {
  it('names the entry and its place in the geometry of the moment', () => {
    const v = initialViewState(relocation);
    expect(describePlace(relocation, v, 'criteria', relocation.criteria[1]!.id)).toMatch(/, column 2 of \d+$/);
    expect(describePlace(relocation, { ...v, transposed: true }, 'criteria', relocation.criteria[1]!.id)).toMatch(/, row 2 of/);
  });
});

describe('the pointer path is deletable (ADR-0008)', () => {
  const view = join(import.meta.dirname, '..', 'src', 'view');
  const importers = readdirSync(view).filter((f) => /\.tsx?$/.test(f) && f !== 'pointer-reorder.ts')
    .filter((f) => readFileSync(join(view, f), 'utf8').includes('pointer-reorder'));
  it('only the matrix imports it, and only to start a drag', () => {
    expect(importers).toEqual(['matrix.tsx']);
    const matrix = readFileSync(join(view, 'matrix.tsx'), 'utf8');
    expect(matrix.match(/startPointerDrag/g)).toHaveLength(2); // the import and the one call
  });
  it('the menu and grab mode do not depend on it', () => {
    expect(readFileSync(join(view, 'reorder.tsx'), 'utf8')).not.toContain('pointer-reorder');
  });
});
