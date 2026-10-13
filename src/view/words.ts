/**
 * The phrases the matrix and its detail panel share, so a value or an absence
 * is worded the same in a cell, in its announcement and in the panel.
 */
import type { Measurement } from '../core/schema/measurement.js';
import type { AbsenceStanding } from '../core/schema/missingness.js';

/** What an absence says about the work, after its code's meaning; `undeclared` is a code nothing here defines. */
export const STANDING_SAID: Readonly<Record<AbsenceStanding | 'undeclared', string>> = {
  structural: 'Nothing to record here.',
  outstanding: 'Still to be done.',
  answered: 'Settled: not work outstanding.',
  // As completeness counts it: the safe direction is to treat it as work remaining.
  undeclared: 'Counted as still to be done.',
};

/**
 * What a number is out of, for the ear: a rating says its top ("5 of 5"), a
 * quantity its unit ("1900 USD/month"). A ratio's `max` is the range's bound,
 * not a ceiling the value is scored against, so it is never read as "of".
 */
export function outOf(value: unknown, m: Measurement | undefined): string {
  if (typeof value !== 'number' || !m?.range) return '';
  if (m.level === 'ordinal') return ` of ${m.range.max}`;
  return m.range.unit ? ` ${m.range.unit}` : '';
}

export function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
