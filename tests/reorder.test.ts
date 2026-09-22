/**
 * One `moveTo`, one `describeMove` (#75, ADR-0027, ADR-0008 as amended).
 *
 * The load-bearing test is the third one: the same logical move, asked for by
 * the menu, by grab mode and by a pointer drop, must produce the identical
 * sentence. It can only drift if the routes stop sharing the move, which is the
 * failure ADR-0027 puts a single function in `core` to prevent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState, isDirty, lockRun, pin, snapshotOf, transpose } from '../src/core/view-state.js';
import {
  describeMove, moveByKeyboard, moveByMenu, moveByPointer, moveTo, type MoveReport,
} from '../src/core/reorder.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));
const ANA = { by: 'ana', at: '2026-09-22T00:00:00Z' };

/** The messy fixture's alternatives, in document order. */
const ALTS = ['lisbon', 'berlin', 'taipei', 'seoul', 'montreal'];

const orderOf = (v: ReturnType<typeof initialViewState>) => v.alternativeOrder.order;

describe('moveTo (#75)', () => {
  it('moves one entry and records who moved it', () => {
    const v = initialViewState(relocation());
    expect(orderOf(v)).toEqual(ALTS);
    const { state, report } = moveTo(v, 'alternatives', 1, 3, ANA);
    expect(orderOf(state)).toEqual(['lisbon', 'taipei', 'seoul', 'berlin', 'montreal']);
    expect(state.alternativeOrder.provenance).toEqual({ kind: 'manual', by: 'ana', at: ANA.at });
    expect(report).toMatchObject({ id: 'berlin', from: 1, to: 3, total: 5, before: 'seoul', noOp: false, carried: [] });
    // The input is untouched: view-state operations are pure.
    expect(orderOf(v)).toEqual(ALTS);
  });

  it('clamps a step past either end rather than throwing at a reader holding a key down', () => {
    const v = initialViewState(relocation());
    const last = moveTo(v, 'alternatives', 4, 9, ANA);
    expect(last.report).toMatchObject({ to: 4, noOp: true, clamped: 'range' });
    const first = moveTo(v, 'alternatives', 0, -3, ANA);
    expect(first.report).toMatchObject({ to: 0, noOp: true, clamped: 'range' });
  });

  it('refuses a position the axis does not have, naming the range', () => {
    const v = initialViewState(relocation());
    expect(() => moveTo(v, 'alternatives', 7, 0, ANA)).toThrow(/positions run 0\.\.4/);
  });

  it('a no-op move leaves the order and its provenance alone, so a clean view stays clean', () => {
    const v = initialViewState(relocation());
    const snap = snapshotOf(v);
    const { state, report } = moveTo(v, 'alternatives', 2, 2, ANA);
    expect(report.noOp).toBe(true);
    expect(state.alternativeOrder.provenance).toEqual({ kind: 'authored' });
    expect(isDirty(state, snap)).toBe(false);
  });

  it('leaves pins exactly as set, and reports the ones it left describing somebody else', () => {
    // A pin is an input to the next seriation run (ADR-0025), not a description
    // of the hand arrangement, so a move must not rewrite what it asks for.
    const v = pin(pin(initialViewState(relocation()), 'alternatives', 'berlin', 1), 'alternatives', 'montreal', 4);
    const { state, report } = moveTo(v, 'alternatives', 1, 3, ANA);
    expect(orderOf(state)).toEqual(['lisbon', 'taipei', 'seoul', 'berlin', 'montreal']);
    expect(state.alternativeOrder.constraints.pins).toEqual([
      { id: 'berlin', position: 1 }, { id: 'montreal', position: 4 },
    ]);
    // Berlin's pin now names a position Taipei occupies; Montreal's still holds.
    expect(report.pinsDisplaced).toEqual([{ id: 'berlin', pinnedTo: 1, nowAt: 3 }]);
  });

  it('away and back restores the view, pins included, so it cannot stay dirty for ever (ADR-0007)', () => {
    const v = pin(initialViewState(relocation()), 'alternatives', 'berlin', 4);
    const snap = snapshotOf(v);
    const away = moveTo(v, 'alternatives', 0, 1, ANA).state;
    expect(isDirty(away, snap)).toBe(true);
    const back = moveTo(away, 'alternatives', 1, 0, ANA).state;
    expect(orderOf(back)).toEqual(ALTS);
    expect(back.alternativeOrder.constraints.pins).toEqual([{ id: 'berlin', position: 4 }]);
    expect(isDirty(back, snap)).toBe(false);
  });

  it('says in the announcement when a move displaced a pin', () => {
    const v = pin(initialViewState(relocation()), 'alternatives', 'lisbon', 0);
    const { report } = moveTo(v, 'alternatives', 3, 0, ANA);
    expect(orderOf(moveTo(v, 'alternatives', 3, 0, ANA).state)).toEqual(['seoul', 'lisbon', 'berlin', 'taipei', 'montreal']);
    expect(describeMove(relocation(), report)).toBe(
      'Alternative Seoul moved to row 1 of 5, first. Lisbon is pinned to row 1 and now sits at row 2.',
    );
  });
});

describe('locked runs are constraints, not decoration', () => {
  const locked = () => lockRun(initialViewState(relocation()), 'alternatives', ['berlin', 'taipei']);

  it('moving a member moves the whole run, contiguous and in its declared order', () => {
    // The handle lands exactly where it was asked to; the run follows it.
    const { state, report } = moveTo(locked(), 'alternatives', 1, 3, ANA);
    expect(orderOf(state)).toEqual(['lisbon', 'seoul', 'montreal', 'berlin', 'taipei']);
    expect(report).toMatchObject({ id: 'berlin', to: 3, carried: ['taipei'] });
  });

  it('says so when the run itself is what kept the handle from the position asked for', () => {
    // taipei cannot be first while berlin is locked in front of it.
    const { state, report } = moveTo(locked(), 'alternatives', 2, 0, ANA);
    expect(orderOf(state)).toEqual(['berlin', 'taipei', 'lisbon', 'seoul', 'montreal']);
    expect(report).toMatchObject({ id: 'taipei', to: 1, clamped: 'locked-run-block', carried: ['berlin'] });
  });

  it('stops at a locked run\'s edge rather than splitting it', () => {
    const v = lockRun(initialViewState(relocation()), 'alternatives', ['taipei', 'seoul']);
    // Asking to land between taipei and seoul: the run cannot be opened, and a
    // tie between its two edges goes to the earlier one.
    const { state, report } = moveTo(v, 'alternatives', 0, 2, ANA);
    expect(report.clamped).toBe('locked-run-split');
    expect(orderOf(state)).toEqual(['berlin', 'lisbon', 'taipei', 'seoul', 'montreal']);
    const runIndexes = ['taipei', 'seoul'].map((id) => orderOf(state).indexOf(id));
    expect(runIndexes[1]! - runIndexes[0]!).toBe(1);
  });

  it('does not silently re-form a run a hand arrangement has already broken', () => {
    const v = lockRun(initialViewState(relocation()), 'alternatives', ['berlin', 'montreal']);
    const { report, state } = moveTo(v, 'alternatives', 1, 3, ANA);
    expect(report.brokenRun).toEqual(['berlin', 'montreal']);
    expect(report.carried).toEqual([]);
    expect(orderOf(state)).toEqual(['lisbon', 'taipei', 'seoul', 'berlin', 'montreal']);
  });
});

describe('every route goes through the same move (#75, ADR-0027)', () => {
  const v = () => initialViewState(relocation());
  const a = relocation();
  /** The same report from three gestures, bar the gesture itself. */
  const logical = (r: MoveReport) => ({ ...r, route: undefined });

  it('to the end: menu, grab mode and pointer drop agree, and say one thing', () => {
    const menu = moveByMenu(v(), 'alternatives', 1, { kind: 'to-end' }, ANA);
    const keys = moveByKeyboard(v(), 'alternatives', 1, 'to-end', ANA);
    const drag = moveByPointer(v(), 'alternatives', 1, 4, ANA);

    expect(orderOf(keys.state)).toEqual(['lisbon', 'taipei', 'seoul', 'montreal', 'berlin']);
    expect(orderOf(menu.state)).toEqual(orderOf(keys.state));
    expect(orderOf(drag.state)).toEqual(orderOf(keys.state));
    expect(logical(menu.report)).toEqual(logical(keys.report));
    expect(logical(drag.report)).toEqual(logical(keys.report));

    const said = [menu, keys, drag].map((o) => describeMove(a, o.report));
    expect(new Set(said).size).toBe(1);
    expect(said[0]).toBe('Alternative Berlin moved to row 5 of 5, after Montreal.');
    // The gesture is not in the sentence, though it is in the report.
    expect([menu, keys, drag].map((o) => o.report.route)).toEqual(['menu', 'keyboard', 'pointer']);
  });

  it('one step earlier: the same three agree again', () => {
    const menu = moveByMenu(v(), 'alternatives', 3, { kind: 'earlier' }, ANA);
    const keys = moveByKeyboard(v(), 'alternatives', 3, 'earlier', ANA);
    const drag = moveByPointer(v(), 'alternatives', 3, 2, ANA);
    const said = [menu, keys, drag].map((o) => describeMove(a, o.report));
    expect(new Set(said).size).toBe(1);
    expect(said[0]).toBe('Alternative Seoul moved to row 3 of 5, after Berlin.');
    expect(orderOf(menu.state)).toEqual(['lisbon', 'berlin', 'seoul', 'taipei', 'montreal']);
  });

  it('the menu\'s "before" and "after" entries land where they say, in both directions', () => {
    const before = moveByMenu(v(), 'alternatives', 0, { kind: 'before', id: 'seoul' }, ANA);
    expect(orderOf(before.state)).toEqual(['berlin', 'taipei', 'lisbon', 'seoul', 'montreal']);
    const after = moveByMenu(v(), 'alternatives', 4, { kind: 'after', id: 'lisbon' }, ANA);
    expect(orderOf(after.state)).toEqual(['lisbon', 'montreal', 'berlin', 'taipei', 'seoul']);
    expect(() => moveByMenu(v(), 'alternatives', 0, { kind: 'before', id: 'nowhere' }, ANA)).toThrow(/nowhere/);
  });
});

describe('the routes agree on an axis that carries constraints (review finding)', () => {
  const a = relocation();
  const locked = () => lockRun(initialViewState(a), 'alternatives', ['lisbon', 'berlin']);
  const logical = (r: MoveReport) => ({ ...r, route: undefined });

  it('"before" puts the whole run before the anchor, whatever route asked', () => {
    // Two entries leave the order, so a fixed +/-1 anchor nudge lands on the
    // wrong side of Montreal -- and the sentence would then contradict the menu.
    const menu = moveByMenu(locked(), 'alternatives', 0, { kind: 'before', id: 'montreal' }, ANA);
    const order = orderOf(menu.state);
    expect(order).toEqual(['taipei', 'seoul', 'lisbon', 'berlin', 'montreal']);
    expect(order.indexOf('lisbon')).toBeLessThan(order.indexOf('montreal'));
    const said = describeMove(a, menu.report);
    expect(said).toBe('Alternative Lisbon moved to row 3 of 5, after Seoul, with Berlin kept beside it.');
    // The same landing asked for as a drop and as a keyboard jump says the same.
    const drag = moveByPointer(locked(), 'alternatives', 0, 2, ANA);
    const keys = moveByKeyboard(moveByKeyboard(locked(), 'alternatives', 0, 'later', ANA).state, 'alternatives', 1, 'later', ANA);
    expect(orderOf(drag.state)).toEqual(order);
    expect(orderOf(keys.state)).toEqual(order);
    expect(logical(drag.report)).toEqual(logical(menu.report));
    expect(describeMove(a, drag.report)).toBe(said);
    expect(describeMove(a, keys.report)).toBe(said);
  });

  it('"after" puts it immediately after the anchor, not after the anchor\'s neighbour', () => {
    const menu = moveByMenu(locked(), 'alternatives', 0, { kind: 'after', id: 'taipei' }, ANA);
    expect(orderOf(menu.state)).toEqual(['taipei', 'lisbon', 'berlin', 'seoul', 'montreal']);
    expect(describeMove(a, menu.report)).toContain('after Taipei');
    const drag = moveByPointer(locked(), 'alternatives', 0, 1, ANA);
    expect(describeMove(a, drag.report)).toBe(describeMove(a, menu.report));
  });

  it('refuses to move something before an entry locked to it', () => {
    expect(() => moveByMenu(locked(), 'alternatives', 0, { kind: 'before', id: 'berlin' }, ANA))
      .toThrow(/locked together/);
  });
});

describe('describeMove is the only source of the sentence, and needs no DOM (#75)', () => {
  const a = relocation();

  it('runs where there is no document or window at all', () => {
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
    const { report } = moveTo(initialViewState(a), 'alternatives', 2, 0, ANA);
    expect(describeMove(a, report)).toBe('Alternative Taipei moved to row 1 of 5, first.');
  });

  it('says position of total, and what it is now after', () => {
    const { report } = moveTo(initialViewState(a), 'criteria', 0, 2, ANA);
    expect(describeMove(a, report)).toMatch(/^Criterion .+ moved to column 3 of 8, after .+\.$/);
  });

  it('reads rows and columns off the orientation, not off a convention', () => {
    const v = transpose(initialViewState(a));
    const alts = moveTo(v, 'alternatives', 1, 0, ANA);
    expect(describeMove(a, alts.report)).toContain('column 1 of 5');
    const crits = moveTo(v, 'criteria', 0, 1, ANA);
    expect(describeMove(a, crits.report)).toContain('row 2 of 8');
  });

  it('speaks the analysis\'s own vocabulary, never "items" or "features"', () => {
    const aliased = Analysis.parse({
      ...JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')),
      aliases: { alternative: 'option', alternatives: 'options', criterion: 'factor', criteria: 'factors' },
    });
    const { report } = moveTo(initialViewState(aliased), 'alternatives', 0, 1, ANA);
    const said = describeMove(aliased, report);
    expect(said.startsWith('Option Lisbon moved to row 2 of 5')).toBe(true);
    expect(said).not.toMatch(/item|feature/i);
  });

  it('names what travelled with it, and why it stopped where it did', () => {
    const v = lockRun(initialViewState(a), 'alternatives', ['berlin', 'taipei']);
    const { report } = moveTo(v, 'alternatives', 1, 3, ANA);
    expect(describeMove(a, report)).toBe('Alternative Berlin moved to row 4 of 5, after Montreal, with Taipei kept beside it.');

    const blocked = moveTo(lockRun(initialViewState(a), 'alternatives', ['taipei', 'seoul']), 'alternatives', 0, 2, ANA);
    expect(describeMove(a, blocked.report)).toMatch(/It stopped there: a locked run cannot be split\.$/);
  });

  it('says so when nothing moved, rather than announcing a move that did not happen', () => {
    const { report } = moveTo(initialViewState(a), 'alternatives', 4, 4, ANA);
    expect(describeMove(a, report)).toBe('Alternative Montreal is already row 5 of 5.');
  });

  it('a refused move explains itself rather than reading as a reader\'s own no-op', () => {
    const run = lockRun(initialViewState(a), 'alternatives', ['seoul', 'montreal']);
    const { report } = moveTo(run, 'alternatives', 3, 4, ANA);
    expect(report).toMatchObject({ noOp: true, clamped: 'locked-run-block' });
    expect(describeMove(a, report)).toBe(
      'Alternative Seoul did not move: the alternatives locked to it come with it. It is still row 4 of 5.',
    );
  });

  it('counts what travelled in the analysis\'s plural, never a bare numeral', () => {
    const run = lockRun(initialViewState(a), 'alternatives', ['berlin', 'taipei', 'seoul', 'montreal']);
    const { report } = moveTo(run, 'alternatives', 1, 0, ANA);
    expect(describeMove(a, report)).toBe(
      'Alternative Berlin moved to row 1 of 5, first, with 3 more alternatives kept beside it.',
    );
  });

  it('falls back to the id for an entry the document no longer lists', () => {
    const { report } = moveTo(initialViewState(a), 'alternatives', 0, 1, ANA);
    const without = { ...a, alternatives: a.alternatives.filter((x) => x.id !== 'lisbon') };
    expect(describeMove(without, report)).toContain('Alternative lisbon moved to row 2 of 5');
  });
});
