/**
 * A cell in words: the one wording every view gives a cell's reading (ADR-0009,
 * ADR-0021), so the matrix and its panels never say the same cell two ways.
 *
 * Never empty. An absence is its code's own meaning, read through the
 * vocabulary, or, for a code with no meaning to show, its id worded; a refusal
 * states its reason; a value shown beside withheld assertions says so, never
 * bare. A cell with no reading is not-applicable inside a declared block and
 * not-assessed otherwise. Codes are passed through, never branched on.
 */
import type { MissingnessVocabulary } from './schema/missingness.js';
import { NOT_APPLICABLE, NOT_ASSESSED } from './schema/missingness.js';
import type { Reduced } from './schema/values.js';

export interface CellWords {
  text: string;
  /** The absence's code, when the cell is an absence: what a view reads its glyph and standing from. */
  absentCode?: string;
  /** Set when the reduction refused: the reader sees only part of the cell, or the raters do not settle it. */
  refused?: true;
}

/** What `cellWords` reads of a reading: a full `Reduced`, or just an absence's code. */
export type ReadingWords = Partial<Pick<Reduced, 'value' | 'missing' | 'refused' | 'refusedBecause' | 'withheldFromReader'>>;

export function cellWords(
  reduced: ReadingWords | undefined,
  { inapplicable, vocabulary, criterionId }: { inapplicable: boolean; vocabulary: MissingnessVocabulary; criterionId: string },
): CellWords {
  if (reduced?.refused !== undefined) {
    // A cell this reader sees only part of: the projection's gap (ADR-0021), which core reports as such (#171).
    return {
      refused: true,
      text: reduced.refusedBecause === 'withheld-from-reader'
        ? 'Partly withheld from you; what you can see does not settle this cell.'
        : `Not shown: ${reduced.refused}`,
    };
  }
  if (reduced?.value !== undefined) {
    const withheld = reduced.withheldFromReader;
    return { text: withheld ? `${String(reduced.value)} (${withheld} withheld from you)` : String(reduced.value) };
  }
  const code = reduced?.missing?.code ?? (inapplicable ? NOT_APPLICABLE : NOT_ASSESSED);
  const facts = vocabulary.resolve(code, criterionId).facts;
  // An undeclared code has no meaning to show, and a declared one may have an empty one: either way its id is worded.
  const worded = `Absent for a reason this analysis does not ${facts ? 'describe' : 'define'} (“${code}”).`;
  return { text: facts?.means.trim() || worded, absentCode: code };
}
