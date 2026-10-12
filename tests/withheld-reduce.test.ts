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
import { reduce, type Assertion, type Cell } from '../src/core/schema/values.js';

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

  it('a "single" cell wholly withheld shows the withheld absence, not a conflict the reader cannot see', () => {
    const r = reduce(cellOf([3, 5], [0, 1], 'single'), opts);
    expect(r.refused).toBeUndefined();
    expect(r.missing?.code).toBe('withheld');
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
  it('completeness counts a partly withheld cell as done, as its owner does, and marks it widened', () => {
    const owner = completeness(relocation, { measure: target.measure });
    const reader = completeness(projected(new Set([first.id])), { measure: target.measure });
    expect(reader.present).toBe(owner.present);
    expect(reader.outstanding).toBe(owner.outstanding);
  });
});
