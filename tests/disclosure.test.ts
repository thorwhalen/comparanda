/**
 * Disclosure is orthogonal to presence, and redaction is a projection (#48, ADR-0021).
 *
 * The owner and a restricted reviewer read the same document under two
 * projections. The source is never edited; the projection is a valid analysis;
 * and every analysis result says how many cells were widened for its reader.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, completeness, validateAnalysis } from '../src/core/schema/analysis.js';
import { projectForReader, widenedCellCount, type DisclosureDecision } from '../src/core/schema/disclosure.js';
import { dominance } from '../src/core/analyses/dominance.js';
import { screen } from '../src/core/analyses/screening.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const raw = () => JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8'));
const relocation = () => Analysis.parse(raw());

const owner: DisclosureDecision = () => true;
const reviewer: DisclosureDecision = (s) => s.disclosure?.label !== 'household-finances';

describe('the messy fixture carries a disclosure label', () => {
  it('on two assertions, and still validates', () => {
    const labelled = relocation().cells.flatMap((c) => c.assertions).filter((s) => s.disclosure?.label);
    expect(labelled.map((s) => s.id).sort()).toEqual(['a-rent-tai-ana', 'a-tax-lis']);
    expect(validateAnalysis(raw()).ok).toBe(true);
  });
});

describe('projectForReader', () => {
  it('produces a valid analysis without mutating the source', () => {
    const source = relocation();
    const before = structuredClone(source);
    const { analysis, widenedCells } = projectForReader(source, reviewer);
    expect(source).toEqual(before);
    expect(analysis).not.toBe(source);
    const r = validateAnalysis(analysis);
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(widenedCells).toBe(2);
    expect(widenedCellCount(analysis)).toBe(2);
  });

  it('removes what was said and keeps that someone said it', () => {
    const { analysis } = projectForReader(relocation(), reviewer);
    const s = analysis.cells.flatMap((c) => c.assertions).find((x) => x.id === 'a-tax-lis')!;
    expect(s.value).toBeUndefined();
    expect(s.justification).toBeUndefined();
    expect(s.evidence).toEqual([]);
    expect(s.missing?.code).toBe('withheld');
    expect(s.authorId).toBe('ana');
    expect(s.disclosure).toEqual({ label: 'household-finances', withheldFromReader: true });
    // Nothing of the withheld value survives anywhere in the serialised projection.
    const json = JSON.stringify(analysis);
    const original = relocation().cells.flatMap((c) => c.assertions).find((x) => x.id === 'a-tax-lis')!;
    expect(json).not.toContain(original.justification!);
  });

  it('drops a rendition only projected-out evidence cited, and keeps the rest', () => {
    const { analysis } = projectForReader(relocation(), reviewer);
    expect(analysis.renditions.map((r) => r.id)).toEqual(['r-berlin-rent']);
  });

  it('gives the owner the document unchanged', () => {
    const { analysis, widenedCells } = projectForReader(relocation(), owner);
    expect(analysis).toEqual(relocation());
    expect(widenedCells).toBe(0);
  });

  it('is idempotent: projecting a projection widens nothing further', () => {
    const once = projectForReader(relocation(), reviewer).analysis;
    const twice = projectForReader(once, reviewer);
    expect(twice.analysis).toEqual(once);
    expect(twice.widenedCells).toBe(2);
  });
});

describe('every analysis result says how many cells were widened for its reader', () => {
  it('completeness', () => {
    expect(completeness(relocation(), { measure: 'score' }).widenedByDisclosure).toBe(0);
    const p = projectForReader(relocation(), reviewer).analysis;
    expect(completeness(p, { measure: 'score' }).widenedByDisclosure).toBe(2);
  });

  it('dominance, with the announcement ADR-0021 requires', () => {
    const own = dominance(relocation(), { measure: 'score' });
    expect(own.widenedByDisclosure).toBe(0);
    const p = projectForReader(relocation(), reviewer).analysis;
    const d = dominance(p, { measure: 'score' });
    // Only cells on the comparison basis count toward a dominance result.
    const basisCells = ['a-tax-lis', 'a-rent-tai-ana'].filter((id) => {
      const c = p.cells.find((cc) => cc.assertions.some((s) => s.id === id))!;
      return d.basis.includes(c.criterionId);
    }).length;
    expect(d.widenedByDisclosure).toBe(basisCells);
    expect(basisCells).toBeGreaterThan(0);
    expect(d.notes.join(' ')).toMatch(/withheld from you/);
  });

  it('screening', () => {
    expect(screen(relocation(), 'score').widenedByDisclosure).toBe(0);
    const p = projectForReader(relocation(), reviewer).analysis;
    const s = screen(p, 'score');
    const screened = p.cells.filter((c) => s.screenedOn.includes(c.criterionId) &&
      c.assertions.some((x) => x.disclosure?.withheldFromReader)).length;
    expect(s.widenedByDisclosure).toBe(screened);
  });

  it('owner and reviewer can see different fronts, and the reviewer is told why', () => {
    // A two-alternative case where the withheld value is what decides dominance.
    const doc = Analysis.parse({
      id: 'd', subject: { question: 'q' }, authors: [{ id: 'a', displayName: 'A', kind: 'human' }],
      alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
      criteria: [{ id: 'c', label: 'C', defaultMeasurement: { level: 'ratio', preference: 'increasing', range: { min: 0, max: 10 } } }],
      cells: [
        { alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [{ id: 'sx', authorId: 'a', at: '2026-01-01T00:00:00Z', value: 9, justification: 'j', disclosure: { label: 'secret' } }] },
        { alternativeId: 'y', criterionId: 'c', measure: 'score', assertions: [{ id: 'sy', authorId: 'a', at: '2026-01-01T00:00:00Z', value: 2, justification: 'j' }] },
      ],
    });
    const ownerFront = dominance(doc, { measure: 'score' });
    expect(ownerFront.dominated).toEqual(['y']);
    const p = projectForReader(doc, (s) => s.disclosure?.label !== 'secret').analysis;
    const reviewerFront = dominance(p, { measure: 'score' });
    // The reviewer's front is the conservative one: x's value could be anything in range.
    expect(reviewerFront.dominated).toEqual([]);
    expect(reviewerFront.widenedByDisclosure).toBe(1);
    expect(reviewerFront.notes.join(' ')).toMatch(/computed with 1 cell withheld from you/);
  });

  it('does not count a withheld code the author stored as widened for this reader', () => {
    // Taipei income tax is stored as `withheld` by its author: nobody may store
    // the value. That is not a disclosure projection, and it is not counted.
    expect(completeness(relocation(), { measure: 'score' }).widenedByDisclosure).toBe(0);
    expect(relocation().cells.flatMap((c) => c.assertions).some((s) => s.missing?.code === 'withheld')).toBe(true);
  });
});
