/**
 * #171: `reduce` reads an assertion withheld from this reader as the
 * projection's gap, never as a recorded absence (ADR-0021).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, completeness, makeCellReader } from '../src/core/schema/analysis.js';
import { projectForReader } from '../src/core/schema/disclosure.js';
import { widenedCells } from '../src/core/analyses/readings.js';
import { dominance } from '../src/core/analyses/dominance.js';
import { isWidenedByDisclosure, reduce, type Assertion, type Cell } from '../src/core/schema/values.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));

/** A live multi-assertion cell with at least two values, and its first assertion. */
const target = relocation.cells.find((c) =>
  c.assertions.filter((s) => !s.supersededBy && s.value !== undefined).length > 1)!;
const first = target.assertions.find((s) => !s.supersededBy && s.value !== undefined)!;
const sameCell = (c: Cell) =>
  c.alternativeId === target.alternativeId && c.criterionId === target.criterionId && c.measure === target.measure;

/** The fixture as a reader who may not see `ids` sees it, through the real projection. */
const projected = (ids: Set<string>) => projectForReader(relocation, (s) => !ids.has(s.id)).analysis;
const read = (a: Analysis) => makeCellReader(a, target.measure).read(target.alternativeId, target.criterionId)!;

describe('reduce over a cell partly withheld from its reader', () => {
  it('does not call it a disagreement about whether a value exists', () => {
    const r = read(projected(new Set([first.id])));
    expect(r.refused).toBeDefined();
    expect(r.refused).not.toMatch(/disagree about whether a value exists/);
    expect(r.refused).toMatch(/^1 of \d+ assertions in this cell is withheld from you/);
    expect(r.withheldFromReader).toBe(1);
    expect(r.value).toBeUndefined();
  });

  it('when everything is withheld, shows the projection\'s absence and counts it, refusing nothing', () => {
    const live = target.assertions.filter((s) => !s.supersededBy);
    const r = read(projected(new Set(live.map((s) => s.id))));
    expect(r.refused).toBeUndefined();
    expect(r.missing?.code).toBe('withheld');
    expect(r.withheldFromReader).toBe(live.length);
    expect(r.disagreement).toBe(false);
  });

  it('leaves an unprojected cell exactly as it was', () => {
    const r = read(relocation);
    expect(r.withheldFromReader).toBeUndefined();
    expect('withheldFromReader' in r).toBe(false);
  });

  it('a flag on an assertion that still holds its value is visible data, not a gap', () => {
    const cell: Cell = structuredClone(target);
    const s = cell.assertions.find((x) => x.id === first.id)!;
    s.disclosure = { ...(s.disclosure ?? {}), withheldFromReader: true };
    const r = reduce(cell, { defaultReduction: relocation.defaultReduction });
    expect(r.withheldFromReader).toBeUndefined();
  });

  it('an owner\'s consensus the reader can see is shown, and still says some was withheld', () => {
    const a = projected(new Set([first.id]));
    const cell = a.cells.find(sameCell)!;
    const chosen = cell.assertions.find((s) => !s.supersededBy && s.value !== undefined && s.id !== first.id)!;
    const r = reduce({ ...cell, reduction: 'consensus', consensusAssertionId: chosen.id }, { defaultReduction: a.defaultReduction });
    expect(r.value).toBe(chosen.value);
    expect(r.withheldFromReader).toBe(1);
  });

  it('names the refusal it is, so a view can tell withheld from conflicted', () => {
    expect(read(projected(new Set([first.id]))).refusedBecause).toBe('withheld-from-reader');
    expect(read(relocation).refusedBecause).toBeUndefined();
  });
});

describe('ordering against the other refusals (review of #173)', () => {
  /** A cell of `values` at increasing times, with the ones at `hidden` indices projected out. */
  const cellOf = (values: number[], hidden: number[], reduction?: string): Cell => {
    const base = structuredClone(target);
    const template = base.assertions.find((s) => s.id === first.id)!;
    base.assertions = values.map((v, i): Assertion => {
      const s: Assertion = { ...structuredClone(template), id: `a${i}`, at: `2026-01-0${i + 1}T00:00:00Z`, value: v, evidence: [] };
      delete s.supersededBy;
      delete s.justification;
      if (!hidden.includes(i)) return s;
      delete s.value;
      return { ...s, missing: { code: 'withheld' }, disclosure: { withheldFromReader: true } };
    });
    if (reduction) base.reduction = reduction;
    else delete base.reduction;
    delete base.consensusAssertionId;
    return base;
  };
  const opts = { defaultReduction: relocation.defaultReduction };

  it('an unknown reduction is refused for that, not blamed on disclosure', () => {
    const r = reduce(cellOf([3, 4], [0], 'bogus'), opts);
    expect(r.refused).toMatch(/unknown reduction "bogus"/);
    expect(r.refusedBecause).toBeUndefined();
  });

  it('a visible "single" conflict is reported as a conflict', () => {
    const r = reduce(cellOf([3, 5, 4], [2], 'single'), opts);
    expect(r.refused).toMatch(/resolve the conflict/);
    expect(r.refusedBecause).toBeUndefined();
  });

  it('"single" over several live assertions is a conflict even when their values are withheld: the owner refuses it too', () => {
    for (const hidden of [[0], [0, 1]]) {
      const r = reduce(cellOf([3, 5], hidden, 'single'), opts);
      expect(r.refused).toMatch(/resolve the conflict/);
      expect(r.refusedBecause).toBeUndefined();
    }
  });

  it('a visible value beside a visible absence is a disagreement, whatever else is withheld', () => {
    const cell = cellOf([3, 4, 5], [2]);
    const absent = cell.assertions[1]!;
    delete absent.value;
    absent.missing = { code: 'not-evidenced' };
    const r = reduce(cell, opts);
    expect(r.refused).toMatch(/disagree about whether a value exists/);
    expect(r.refusedBecause).toBeUndefined();
  });

  it('a visible absence beside a withheld value is the owner\'s disagreement, not a disclosure gap', () => {
    const cell = cellOf([3, 4], [0], 'latest');
    delete cell.assertions[1]!.value;
    cell.assertions[1]!.missing = { code: 'not-assessed' };
    const r = reduce(cell, opts);
    expect(r.refused).toMatch(/disagree about whether a value exists/);
    expect(r.disagreement).toBe(true);
    expect(r.refusedBecause).toBeUndefined();
  });

  it('an illegal mean on an ordinal level is refused as that, whatever is withheld', () => {
    const r = reduce(cellOf([3, 5], [0], 'mean'), { ...opts, level: 'ordinal' });
    expect(r.refused).toMatch(/not legal on an ordinal level/);
    expect(r.refusedBecause).toBeUndefined();
  });

  it('a flagged, valueless assertion that kept its justification still hides a value: not an authored absence', () => {
    const cell = cellOf([3, 5], [0]);
    cell.assertions[0]!.justification = 'left behind by a hand-rolled projection';
    const r = reduce(cell, opts);
    expect(r.refused).not.toMatch(/disagree about whether a value exists/);
    expect(r.refusedBecause).toBe('withheld-from-reader');
    expect(isWidenedByDisclosure(cell)).toBe(true);
  });

  it('"latest" is answered when the newest assertion is visible, and refused when it is withheld', () => {
    const seen = reduce(cellOf([3, 5], [0], 'latest'), opts);
    expect(seen.value).toBe(5);
    expect(seen.withheldFromReader).toBe(1);
    const unseen = reduce(cellOf([3, 5], [1], 'latest'), opts);
    expect(unseen.value).toBeUndefined();
    expect(unseen.refusedBecause).toBe('withheld-from-reader');
  });

  it('a consensus whose chosen assertion is withheld shows the withheld absence', () => {
    const cell = { ...cellOf([3, 5], [1], 'consensus'), consensusAssertionId: 'a1' };
    const r = reduce(cell, opts);
    expect(r.value).toBeUndefined();
    expect(r.missing?.code).toBe('withheld');
  });
});

describe('consumers', () => {
  it('completeness: a partly withheld cell whose visible values disagree is still done', () => {
    const cell = relocation.cells.find((c) => {
      const values = new Set(c.assertions.filter((s) => !s.supersededBy && s.value !== undefined).map((s) => s.value));
      return values.size > 1 && c.assertions.filter((s) => !s.supersededBy && s.value !== undefined).length > 2;
    })!;
    const values = cell.assertions.filter((s) => !s.supersededBy && s.value !== undefined);
    // Withhold one of the repeated values, so the visible ones still disagree.
    const repeated = values.find((s, i) => values.some((t, j) => j !== i && t.value === s.value))!;
    const scope = { measure: cell.measure, alternativeIds: [cell.alternativeId], criterionIds: [cell.criterionId] };
    const owner = completeness(relocation, scope);
    const reader = completeness(projectForReader(relocation, (s) => s.id !== repeated.id).analysis, scope);
    expect(reader.present).toBe(owner.present);
    expect(reader.outstanding).toBe(owner.outstanding);
  });

  it('completeness under "single": one visible value beside one withheld, agreeing, is done as the owner sees it', () => {
    const doc = structuredClone(relocation);
    const cell = doc.cells.find(sameCell)!;
    const live = cell.assertions.filter((s) => !s.supersededBy && s.value !== undefined).slice(0, 2);
    cell.assertions = live.map((s) => ({ ...s, value: live[0]!.value }));
    cell.reduction = 'single';
    delete cell.consensusAssertionId;
    const scope = { measure: cell.measure, alternativeIds: [cell.alternativeId], criterionIds: [cell.criterionId] };
    const owner = completeness(doc, scope);
    const reader = completeness(projectForReader(doc, (s) => s.id !== live[0]!.id).analysis, scope);
    expect(reader.present).toBe(owner.present);
  });

  it('widenedCells does not count a cell whose value core could still prove', () => {
    const doc = projected(new Set([first.id]));
    const cell = doc.cells.find(sameCell)!;
    const visible = cell.assertions.filter((s) => !s.supersededBy && s.value !== undefined);
    // The newest assertion visible: a `latest` is provable, so no blank was read.
    for (const s of cell.assertions) if (s.id === first.id) s.at = '2000-01-01T00:00:00Z';
    cell.reduction = 'latest';
    expect(makeCellReader(doc, target.measure).read(target.alternativeId, target.criterionId)!.value).toBeDefined();
    expect(visible.length).toBeGreaterThan(0);
    expect(widenedCells(doc, [target.alternativeId], [target.criterionId], target.measure)).toBe(0);
    // Dominance counts the same thing for the same projection.
    const only = { ...doc, cells: doc.cells.filter((c) => c === cell || !isWidenedByDisclosure(c)) };
    expect(dominance(only, { measure: target.measure }).widenedByDisclosure).toBe(0);
  });

  it('completeness counts a partly withheld cell as done, as its owner does, and marks it widened', () => {
    const owner = completeness(relocation, { measure: target.measure });
    const reader = completeness(projected(new Set([first.id])), { measure: target.measure });
    expect(reader.present).toBe(owner.present);
    expect(reader.outstanding).toBe(owner.outstanding);
  });
});
