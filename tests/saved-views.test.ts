/**
 * Saved views and view sequences (#71, ADR-0007 as amended): no autosave and
 * no nagging, three modes with the lock enforced and the host deciding who,
 * per-dimension revert, a sequence that is a list of view ids, and fragments
 * that address a view or a step.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import {
  createView, LockedViewError, loadView, lockView, parseViewFragment, stepsOf, unlockView, updateView, viewAffordances,
  viewFragment, viewMarker, ViewSequence, type AuthorizeView,
} from '../src/core/saved-views.js';
import {
  applyOrder, DIMENSIONS, dirtyDimensions, initialViewState, revertDimension, setEncoding, setFilter, setFocus,
  setGrouping, setSelection, setSort, transpose, lockRun, type Dimension, type ViewState,
} from '../src/core/view-state.js';
import { savedViewStore } from '../src/store/index.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
const base = initialViewState(relocation);
const ana = { by: 'ana', at: '2026-10-27T10:00:00Z' };
const ben = { by: 'ben', at: '2026-10-27T11:00:00Z' };
const view = (mode: 'personal' | 'shared' | 'locked' = 'shared') =>
  createView(base, { id: 'v1', analysisId: relocation.id, name: 'Cost first', mode, ...ana });

/** One change per arrangement dimension, touching that dimension only. */
const CHANGE: Record<Dimension, (v: ViewState) => ViewState> = {
  alternativeOrder: (v) => applyOrder(v, 'alternatives', [...v.alternativeOrder.order].reverse(), { kind: 'manual', by: 'ana' }),
  criterionOrder: (v) => lockRun(v, 'criteria', v.criterionOrder.order.slice(0, 2)),
  grouping: (v) => setGrouping(v, 'alternatives', ['g-asia']),
  selection: (v) => setSelection(v, { alternatives: ['lisbon'] }),
  encoding: (v) => setEncoding(v, 'missingness'),
  sort: (v) => setSort(v, { axis: 'alternatives', by: { kind: 'criterion', criterionId: 'rent' }, direction: 'ascending' } as never),
  filter: (v) => setFilter(v, { hiddenCriteria: ['rent'] }),
  transposed: (v) => transpose(v),
};

describe('the working state needs nothing saved (ADR-0007)', () => {
  it('is never marked modified with no view loaded, and a reader who never saves is never asked to', () => {
    const arranged = CHANGE.grouping(CHANGE.alternativeOrder(base));
    expect(viewMarker(arranged, undefined)).toEqual({ modified: false, dimensions: [] });
  });

  it('marks a loaded view modified by dimension, never by session or derivation', () => {
    const v = view();
    const loaded = loadView(v, setFocus(base, { alternativeId: 'berlin' }));
    // The reader's place is kept on load, and is never part of what was saved.
    expect(loaded.session.focus).toEqual({ alternativeId: 'berlin' });
    expect('session' in v.snapshot).toBe(false);
    expect(viewMarker(setFocus(loaded, { alternativeId: 'seoul' }), v).modified).toBe(false);
    // The same order arrived at another way is not a change.
    const reseriated = applyOrder(loaded, 'alternatives', loaded.alternativeOrder.order, { kind: 'manual', by: 'ben' });
    expect(viewMarker(reseriated, v).modified).toBe(false);
    expect(viewMarker(CHANGE.selection(loaded), v)).toEqual({ modified: true, dimensions: ['selection'] });
  });
});

describe('per-dimension revert, dimension by dimension (ADR-0007 clause 2)', () => {
  it('covers every arrangement dimension the schema declares', () => {
    expect(Object.keys(CHANGE).sort()).toEqual([...DIMENSIONS].sort());
  });

  for (const d of DIMENSIONS) {
    it(`${d}: a change marks ${d} alone, and its revert clears it and keeps every other change`, () => {
      const v = view();
      const changed = CHANGE[d](loadView(v));
      expect(dirtyDimensions(changed, v.snapshot)).toEqual([d]);
      expect(dirtyDimensions(revertDimension(changed, v.snapshot, d), v.snapshot)).toEqual([]);
      // With another dimension changed too, reverting this one keeps that one.
      const other = DIMENSIONS.find((x) => x !== d)!;
      const both = CHANGE[other](changed);
      expect(dirtyDimensions(revertDimension(both, v.snapshot, d), v.snapshot)).toEqual([other]);
    });
  }
});

describe('the three modes, and the lock', () => {
  it('refuses any in-place write to a locked view, and always offers save as new', () => {
    const locked = lockView(view('shared'), ana);
    expect(() => updateView(locked, CHANGE.encoding(base), ana)).toThrow(LockedViewError);
    const may = viewAffordances(locked, { actorId: 'ana' });
    expect([may.update.enabled, may.rename.enabled, may.delete.enabled, may.saveAsNew.enabled]).toEqual([false, false, false, true]);
    expect(may.update.reason).toMatch(/locked; save as a new view/);
  });

  it('leaves who may unlock to the host, and records the unlock, attributed', () => {
    const locked = lockView(view('shared'), ana);
    const onlyAna: AuthorizeView = ({ act, actorId }) => act !== 'unlock' || actorId === 'ana' || 'only the analysis owner unlocks.';
    expect(viewAffordances(locked, { actorId: 'ben', authorize: onlyAna }).unlock).toEqual({ enabled: false, reason: 'only the analysis owner unlocks.' });
    expect(viewAffordances(locked, { actorId: 'ana', authorize: onlyAna }).unlock.enabled).toBe(true);
    const open = unlockView(locked, ana);
    expect(open.mode).toBe('shared');
    expect(open.events.map((e) => [e.act, e.by])).toEqual([['created', 'ana'], ['locked', 'ana'], ['unlocked', 'ana']]);
  });

  it('keeps a personal view to its owner', () => {
    const mine = view('personal');
    expect(viewAffordances(mine, { actorId: 'ben' }).update).toEqual({ enabled: false, reason: 'it is someone else\'s personal view.' });
    expect(() => lockView(mine, ana)).toThrow(/only a shared view/);
  });
});

describe('the store', () => {
  it('lists a personal view to its owner only, and every shared one to everybody', async () => {
    const store = savedViewStore({ newId: (() => { let n = 0; return () => `id-${(n += 1)}`; })() });
    await store.create(base, { analysisId: relocation.id, name: 'Mine', mode: 'personal', ...ana });
    await store.create(base, { analysisId: relocation.id, name: 'Ours', mode: 'shared', ...ana });
    expect((await store.list(relocation.id, 'ana')).map((v) => v.name)).toEqual(['Mine', 'Ours']);
    expect((await store.list(relocation.id, 'ben')).map((v) => v.name)).toEqual(['Ours']);
  });

  it('refuses, with the reason, a write to a locked view by anyone, until the host lets someone unlock it', async () => {
    const onlyAna: AuthorizeView = ({ act, actorId }) => act !== 'unlock' || actorId === 'ana' || 'only the analysis owner unlocks.';
    const store = savedViewStore({ authorize: onlyAna });
    const v = await store.create(base, { analysisId: relocation.id, name: 'The argument', mode: 'shared', ...ana });
    await store.lock(v.id, ana);
    for (const who of [ana, ben]) await expect(store.update(v.id, CHANGE.encoding(base), who)).rejects.toThrow(/is locked/);
    await expect(store.unlock(v.id, ben)).rejects.toThrow(/only the analysis owner unlocks/);
    expect((await store.get(v.id))!.mode).toBe('locked');
    await store.unlock(v.id, ana);
    const saved = await store.update(v.id, CHANGE.encoding(base), ben);
    expect(saved.snapshot.encoding).toBe('missingness');
    expect(saved.events.map((e) => [e.act, e.by])).toEqual([['created', 'ana'], ['locked', 'ana'], ['unlocked', 'ana'], ['updated', 'ben']]);
  });
});

describe('a view sequence is an ordered list of view ids, nothing more (ADR-0007 clause 4)', () => {
  it('holds view ids and optional captions, and refuses anything else in a step', () => {
    const s = ViewSequence.parse({ id: 's', analysisId: relocation.id, name: 'The walk', steps: [{ viewId: 'v1', caption: 'Cost first' }, { viewId: 'v2' }] });
    expect(s.steps.map((x) => x.viewId)).toEqual(['v1', 'v2']);
    expect(() => ViewSequence.parse({ ...s, steps: [{ viewId: 'v1', snapshot: base }] })).toThrow();
  });

  it('shows a step whose view is gone as a broken step that names it, in its place', () => {
    const s = ViewSequence.parse({ id: 's', analysisId: relocation.id, name: 'The walk', steps: [{ viewId: 'v1' }, { viewId: 'gone' }] });
    const steps = stepsOf(s, [view()]);
    expect('view' in steps[0]! && steps[0].view.id).toBe('v1');
    expect('broken' in steps[1]! && steps[1].broken).toBe('step 2 names the view "gone", which no longer exists.');
  });
});

describe('addressable (ADR-0007)', () => {
  it('writes and reads a fragment for a view and for a sequence\'s step', () => {
    for (const a of [{ viewId: 'cost first/v1' }, { sequenceId: 's 1', step: 3 }] as const) {
      expect(parseViewFragment(viewFragment(a))).toEqual(a);
    }
    expect(viewFragment({ viewId: 'v1' })).toBe('#view=v1');
    for (const bad of ['', '#', '#sequence=s&step=0', '#sequence=s&step=x', '#focus=a']) expect(parseViewFragment(bad)).toBeUndefined();
  });
});
