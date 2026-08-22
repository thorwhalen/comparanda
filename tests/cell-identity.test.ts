/**
 * Two readers of the same coordinates must not disagree.
 *
 * `getCell` scanned `cells` and returned the **first** match; `cellIndex` builds
 * a `Map` and keeps the **last**. On a document carrying two cells with the same
 * identity, a single lookup and a matrix walk therefore showed different values,
 * with nothing anywhere saying so.
 *
 * That was harmless while one author wrote one file. It stops being harmless the
 * moment contributions from several people are merged into one document, which
 * is what v1 does -- so the duplicate is now rejected, and the two readers agree
 * even on a document nobody validated.
 *
 * The first test in each block fails against the previous implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  Analysis, cellIndex, cellKey, getCell, validateAnalysis, makeCellReader,
} from '../src/core/schema/analysis.js';
import type { Cell } from '../src/core/schema/values.js';

const cell = (value: number, id: string): Cell => ({
  alternativeId: 'alt-1',
  criterionId: 'crit-1',
  measure: 'score',
  assertions: [{
    id, authorId: 'ana', at: '2026-08-22T00:00:00Z', value,
    justification: 'the filing states it', evidence: [], version: 1,
  }],
});

/** A minimal analysis carrying whatever cells the test needs. */
const analysisWith = (cells: Cell[]) =>
  Analysis.parse({
    id: 'a1',
    schemaVersion: 1,
    subject: { question: 'which one?' },
    authors: [{ id: 'ana', displayName: 'Ana', kind: 'human' }],
    alternatives: [{ id: 'alt-1', label: 'A' }],
    criteria: [{
      id: 'crit-1',
      label: 'C',
      defaultMeasurement: {
        level: 'ordinal', preference: 'increasing',
        range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5],
      },
    }],
    cells,
  });

describe('the two readers agree', () => {
  const duplicated = analysisWith([cell(2, 'first'), cell(5, 'second')]);

  it('returns the same cell from a lookup as from the index', () => {
    const direct = getCell(duplicated, 'alt-1', 'crit-1', 'score');
    const indexed = cellIndex(duplicated).get(cellKey('alt-1', 'crit-1', 'score'));
    expect(direct).toBe(indexed);
    // Previously: `direct` was the 2 and `indexed` was the 5.
    expect(direct?.assertions[0]?.value).toBe(5);
  });

  it('agrees with what a matrix walk reads', () => {
    const reader = makeCellReader(duplicated, 'score');
    expect(reader.read('alt-1', 'crit-1')?.value).toBe(
      getCell(duplicated, 'alt-1', 'crit-1', 'score')?.assertions[0]?.value,
    );
  });

  it('returns undefined for coordinates that do not exist, from both', () => {
    expect(getCell(duplicated, 'nope', 'crit-1', 'score')).toBeUndefined();
    expect(cellIndex(duplicated).get(cellKey('nope', 'crit-1', 'score'))).toBeUndefined();
  });
});

describe('a duplicate identity is rejected', () => {
  it('is an error, naming both positions', () => {
    const { ok, problems } = validateAnalysis(analysisWith([cell(2, 'first'), cell(5, 'second')]));
    expect(ok).toBe(false);
    const dup = problems.find((p) => p.message.includes('duplicates the identity'));
    expect(dup).toBeDefined();
    expect(dup!.path).toBe('cells[1]');
    expect(dup!.message).toContain('cells[0]');
    expect(dup!.ruleId).toBe('cells-unique');
    // And it says what to do, because "duplicate" without a fix is a puzzle.
    expect(dup!.fix).toContain('Merge their assertions into one cell');
  });

  it('accepts the same coordinates under a different measure', () => {
    // (alt, crit, score) and (alt, crit, confidence) are different cells, and a
    // criterion routinely carries both.
    const a = analysisWith([cell(2, 'first'), { ...cell(5, 'second'), measure: 'confidence' }]);
    expect(validateAnalysis(a).problems.some((p) => p.message.includes('duplicates'))).toBe(false);
  });

  it('accepts a document with no duplicates', () => {
    expect(validateAnalysis(analysisWith([cell(2, 'only')])).ok).toBe(true);
  });
});

describe('the cell key', () => {
  it('is computed in exactly one place', () => {
    expect(cellKey('a', 'b', 'c')).toBe(JSON.stringify(['a', 'b', 'c']));
  });

  it('cannot be forged by an id containing a separator character', () => {
    // This assertion failed against the previous NUL-joined key, which was not
    // injective: two genuinely different cells produced one key, one was
    // silently lost from the index, and the duplicate check flagged a pair that
    // was not a duplicate. A document is untrusted input, so the key does not
    // get to assume what ids contain.
    expect(cellKey('a\u0000b', 'c', 'd')).not.toBe(cellKey('a', 'b\u0000c', 'd'));
    expect(cellKey('a"b', 'c', 'd')).not.toBe(cellKey('a', 'b"c', 'd'));
    expect(cellKey('a,b', 'c', 'd')).not.toBe(cellKey('a', 'b,c', 'd'));
    expect(cellKey('', 'a', 'b')).not.toBe(cellKey('a', '', 'b'));
  });
});
