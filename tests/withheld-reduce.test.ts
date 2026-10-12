/**
 * #171: `reduce` reads an assertion withheld from this reader as the
 * projection's gap, never as a recorded absence (ADR-0021).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, makeCellReader } from '../src/core/schema/analysis.js';
import { projectForReader } from '../src/core/schema/disclosure.js';
import { reduce, type Cell } from '../src/core/schema/values.js';

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

  it('judges disagreement and spread over what the reader can see', () => {
    const a = projected(new Set([first.id]));
    const cell = a.cells.find(sameCell)!;
    const visibleValues = cell.assertions.filter((s) => !s.supersededBy && s.value !== undefined).map((s) => s.value);
    const r = read(a);
    expect(r.spread).toEqual([...new Set(visibleValues)].sort((x, y) => Number(x) - Number(y)));
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
});
