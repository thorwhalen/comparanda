/**
 * `cellWords` (#97): the one wording a cell's reading is given, by the matrix
 * and by its panels alike.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, vocabularyOf } from '../src/core/schema/analysis.js';
import { cellWords } from '../src/core/cell-words.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
const vocabulary = vocabularyOf(relocation);
const say = (reduced: Parameters<typeof cellWords>[0], inapplicable = false) => cellWords(reduced, { inapplicable, vocabulary, criterionId: 'rent' });

describe('cellWords', () => {
  it('says a value, labelled when assertions beside it are withheld', () => {
    expect(say({ value: 3, contributing: [] } as never)).toEqual({ text: '3' });
    expect(say({ value: 3, withheldFromReader: 1, contributing: [] } as never)).toEqual({ text: '3 (1 withheld from you)' });
  });

  it('says an absence by its meaning, and a code with none by its id', () => {
    expect(say({ missing: { code: 'not-assessed' }, contributing: [] } as never)).toEqual({ text: 'Nobody has looked yet.', absentCode: 'not-assessed' });
    expect(say({ missing: { code: 'made-up' }, contributing: [] } as never)).toEqual({ text: 'Absent for a reason this analysis does not define (“made-up”).', absentCode: 'made-up' });
  });

  it('reads a cell with no reading as not applicable in a declared block, and not assessed otherwise', () => {
    expect(say(undefined, true).absentCode).toBe('not-applicable');
    expect(say(undefined).text).toBe('Nobody has looked yet.');
  });

  it('states a refusal, and a partly withheld cell as such', () => {
    expect(say({ refused: 'the raters disagree', contributing: [] } as never)).toEqual({ refused: true, text: 'Not shown: the raters disagree' });
    expect(say({ refused: 'x', refusedBecause: 'withheld-from-reader', contributing: [] } as never).text).toBe('Partly withheld from you; what you can see does not settle this cell.');
  });
});
