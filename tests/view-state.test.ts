/**
 * View state: its shape (#53) and its runtime with structural dirty state (#70).
 * ADR-0006, ADR-0007 (as amended), ADR-0008, ADR-0025, ADR-0027.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, SCHEMA_VERSION } from '../src/core/schema/analysis.js';
import {
  DIMENSIONS, VIEW_STATE_FIELD_CLASSES, VIEW_STATE_VERSION, ViewState,
  applyOrder, dirtyDimensions, initialViewState, isDirty, lockRun, parseViewState, pin,
  revertAll, revertDimension, serializeViewState, setEncoding, setFilter, setFocus, setGrouping,
  setSelection, setSort, snapshotOf, transpose, unlockRun, unpin, viewStateMigrations,
  type OrderProvenance,
} from '../src/core/view-state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = () => JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8'));
const relocation = () => Analysis.parse(raw());

const seriated = (at: string, pathLength = 1.25): OrderProvenance => ({
  kind: 'seriated', method: 'olo-hierarchical', linkage: 'average', measure: 'score',
  distance: 'gower', missingPolicy: 'skip-contingent', minOverlap: 2, pathLength,
  parked: [], params: { sizeLimit: 200 }, at,
});

describe('the shape (#53)', () => {
  it('records the algorithm and its parameters for a computed order, and the user for a manual one', () => {
    const v = initialViewState(relocation());
    const s = applyOrder(v, 'alternatives', ['berlin', 'lisbon', 'taipei', 'seoul', 'montreal'], seriated('t1'));
    expect(s.alternativeOrder.provenance).toMatchObject({ kind: 'seriated', method: 'olo-hierarchical', linkage: 'average', params: { sizeLimit: 200 } });
    const m = applyOrder(v, 'criteria', v.criterionOrder.order.slice().reverse(), { kind: 'manual', by: 'ana' });
    expect(m.criterionOrder.provenance).toEqual({ kind: 'manual', by: 'ana' });
    // A manual order with nobody named does not validate.
    expect(ViewState.safeParse({ ...m, criterionOrder: { ...m.criterionOrder, provenance: { kind: 'manual' } } }).success).toBe(false);
  });

  it('holds pins and locked runs beside the order, as inputs, and they survive a re-run', () => {
    let v = initialViewState(relocation());
    v = pin(v, 'alternatives', 'lisbon', 0);
    v = lockRun(v, 'alternatives', ['berlin', 'taipei']);
    const rerun = applyOrder(v, 'alternatives', ['lisbon', 'berlin', 'taipei', 'montreal', 'seoul'], seriated('t2'));
    expect(rerun.alternativeOrder.constraints).toEqual({ pins: [{ id: 'lisbon', position: 0 }], lockedRuns: [['berlin', 'taipei']] });
    // Not inside provenance: a different method would keep them.
    expect(JSON.stringify(rerun.alternativeOrder.provenance)).not.toContain('lisbon');
    const released = unlockRun(unpin(rerun, 'alternatives', 'lisbon'), 'alternatives', ['berlin', 'taipei']);
    expect(released.alternativeOrder.constraints).toEqual({ pins: [], lockedRuns: [] });
  });

  it('keeps selection here and has no place for it in the analysis document', () => {
    expect(Object.keys(ViewState.shape)).toContain('selection');
    const parsed = Analysis.parse({ ...raw(), selection: { alternatives: ['lisbon'] } });
    expect(Object.keys(parsed)).not.toContain('selection');
  });

  it('is versioned and migrated on its own chain, apart from the document', () => {
    expect(ViewState.shape.schemaVersion).toBeDefined();
    expect(viewStateMigrations.currentVersion).toBe(VIEW_STATE_VERSION);
    expect(viewStateMigrations.registered()).toEqual([]);
    const { migration } = parseViewState(serializeViewState(initialViewState(relocation())));
    expect(migration.path).toEqual([VIEW_STATE_VERSION]);
    // A future view state is refused by its own chain, whatever the document version is.
    const future = JSON.stringify({ ...initialViewState(relocation()), schemaVersion: VIEW_STATE_VERSION + 1 });
    expect(() => parseViewState(future)).toThrow();
    expect(SCHEMA_VERSION).toBe(1); // the two numbers are separate facts, not one
  });

  it('classifies every field, and refuses one nobody classified', () => {
    const keys = Object.keys(ViewState.shape).filter((k) => k !== 'schemaVersion').sort();
    expect(Object.keys(VIEW_STATE_FIELD_CLASSES).sort()).toEqual(keys);
    expect(DIMENSIONS).not.toContain('session');
    const v = initialViewState(relocation());
    expect(ViewState.safeParse({ ...v, scrollOffset: 40 }).success).toBe(false);
  });
});

describe('the runtime and dirty state (#70)', () => {
  it('clears dirty when a change is undone back to the original', () => {
    const loaded = initialViewState(relocation());
    const snap = snapshotOf(loaded);
    const original = loaded.alternativeOrder.order;
    const moved = applyOrder(loaded, 'alternatives', [...original].reverse(), { kind: 'manual', by: 'ana' });
    expect(dirtyDimensions(moved, snap)).toEqual(['alternativeOrder']);
    const undone = applyOrder(moved, 'alternatives', original, { kind: 'manual', by: 'ana' });
    // Provenance now says "manual", the snapshot says "authored" -- still clean.
    expect(isDirty(undone, snap)).toBe(false);
  });

  it('does not mark a view modified when a re-seriation lands on the identical order', () => {
    const base = applyOrder(initialViewState(relocation()), 'alternatives', ['berlin', 'lisbon', 'taipei', 'seoul', 'montreal'], seriated('monday'));
    const snap = snapshotOf(base);
    const rerun = applyOrder(base, 'alternatives', ['berlin', 'lisbon', 'taipei', 'seoul', 'montreal'], seriated('tuesday', 1.2500001));
    expect(isDirty(rerun, snap)).toBe(false);
    // ...while provenance is still saved and restored.
    expect(snapshotOf(rerun).alternativeOrder.provenance).toMatchObject({ at: 'tuesday' });
  });

  it('reports each dimension that differs, keyed by schema field, and reverts them one at a time', () => {
    const loaded = initialViewState(relocation());
    const snap = snapshotOf(loaded);
    let v = setGrouping(loaded, 'alternatives', ['g-eu']);
    v = setEncoding(v, 'value');
    v = transpose(v);
    v = setSort(v, { axis: 'alternatives', criterionId: 'rent', measure: 'score', direction: 'best-first' });
    v = setFilter(v, { hiddenCriteria: ['climate-type'] });
    expect(dirtyDimensions(v, snap).sort()).toEqual(['encoding', 'filter', 'grouping', 'sort', 'transposed']);
    const back = revertDimension(v, snap, 'grouping');
    expect(dirtyDimensions(back, snap)).not.toContain('grouping');
    expect(dirtyDimensions(back, snap)).toContain('encoding');
    expect(isDirty(revertAll(v, snap), snap)).toBe(false);
    expect(isDirty(setSort(setSort(loaded, { axis: 'criteria', criterionId: 'rent', measure: 'score', direction: 'worst-first' }), undefined), snap)).toBe(false);
  });

  it('changes selection in view state only, never in the analysis document', () => {
    const a = relocation();
    const before = structuredClone(a);
    const loaded = initialViewState(a);
    const v = setSelection(loaded, { alternatives: ['lisbon', 'berlin'], cells: [{ alternativeId: 'seoul', criterionId: 'rent' }] });
    expect(v.selection.alternatives).toEqual(['lisbon', 'berlin']);
    expect(a).toEqual(before);
    expect(loaded.selection.alternatives).toEqual([]); // operations do not mutate their input either
    expect(dirtyDimensions(v, snapshotOf(loaded))).toEqual(['selection']);
  });

  it('round-trips the roving tabindex position through persistence, without ever marking the view modified', () => {
    const loaded = initialViewState(relocation());
    const snap = snapshotOf(loaded);
    const focused = setFocus(loaded, { alternativeId: 'taipei', criterionId: 'rent' });
    expect(isDirty(focused, snap)).toBe(false);
    const { state } = parseViewState(serializeViewState(focused));
    expect(state.session.focus).toEqual({ alternativeId: 'taipei', criterionId: 'rent' });
    expect(state).toEqual(focused);
    // A saved view never carries it.
    expect(Object.keys(snapshotOf(focused))).not.toContain('session');
    // Kept by id, so a reorder leaves the cursor on the same cell.
    const reordered = applyOrder(focused, 'alternatives', [...focused.alternativeOrder.order].reverse(), { kind: 'manual', by: 'ana' });
    expect(reordered.session.focus).toEqual({ alternativeId: 'taipei', criterionId: 'rent' });
    expect(setFocus(focused, undefined).session.focus).toBeUndefined();
  });

  it('starts from the document order, leaving tombstoned entities out', () => {
    const doc = raw();
    doc.alternatives[1].tombstoned = true;
    const v = initialViewState(Analysis.parse(doc));
    expect(v.alternativeOrder.order).not.toContain(doc.alternatives[1].id);
    expect(v.alternativeOrder.provenance).toEqual({ kind: 'authored' });
    expect(v.encoding).toBe('text-only');
    expect(v.transposed).toBe(false);
  });

  it('refuses a malformed persisted state with the problems named, rather than half-reading it', () => {
    expect(() => parseViewState(JSON.stringify({ schemaVersion: 1, alternativeOrder: { order: 'nope' } }))).toThrow(/not a valid view state/);
  });
});
