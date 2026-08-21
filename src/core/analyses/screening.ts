/**
 * Conjunctive screening: flag alternatives that fall below an absolute floor on
 * a criterion marked with an `acceptability` threshold.
 *
 * This is non-compensatory by design -- that is the entire point. "If we cannot
 * reach the buyer, the market size is irrelevant" is how people actually reason,
 * and a weighted total is a poor proxy for it.
 *
 * It **flags, never filters**. The alternative stays in the matrix and stays
 * visible; an analysis that silently drops rows is not auditable, and the reader
 * needs to see the thing that failed in order to argue about the threshold.
 */
import type { Analysis } from '../schema/analysis.js';
import { reducedValue } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';

export interface ScreeningFlag {
  alternativeId: string;
  criterionId: string;
  value?: number;
  threshold: number;
  rationale: string;
  /** True when the cell is blank, so the floor could not be tested at all. */
  untested: boolean;
}

export interface ScreeningResult {
  flagged: ScreeningFlag[];
  /** Alternatives with at least one hard flag (tested and failed). */
  flaggedAlternatives: string[];
  /** Criteria carrying an acceptability floor, so a reader can see the rules. */
  screenedOn: string[];
  notes: string[];
}

export function screen(a: Analysis, measure: string): ScreeningResult {
  const flags: ScreeningFlag[] = [];
  const screenedOn: string[] = [];
  const notes: string[] = [];

  for (const crit of a.criteria) {
    if (crit.tombstoned) continue;
    const acc = crit.acceptability;
    if (!acc) continue;
    const m = measurementFor(crit, measure);
    if (!m) continue;
    screenedOn.push(crit.id);

    for (const alt of a.alternatives) {
      if (alt.tombstoned) continue;
      const r = reducedValue(a, alt.id, crit.id, measure);
      const v = typeof r?.value === 'number' ? r.value : undefined;
      if (v === undefined) {
        flags.push({
          alternativeId: alt.id, criterionId: crit.id, threshold: acc.threshold,
          rationale: acc.rationale, untested: true,
        });
        continue;
      }
      const fails = m.preference === 'decreasing' ? v > acc.threshold : v < acc.threshold;
      if (fails) {
        flags.push({
          alternativeId: alt.id, criterionId: crit.id, value: v,
          threshold: acc.threshold, rationale: acc.rationale, untested: false,
        });
      }
    }
  }

  const hard = flags.filter((f) => !f.untested);
  const untestedCount = flags.length - hard.length;
  if (untestedCount > 0) {
    notes.push(
      `${untestedCount} cell(s) on a screened criterion are blank, so the floor could not be ` +
      'tested there. An untested floor is not a passed floor.',
    );
  }
  if (screenedOn.length === 0) {
    notes.push('no criterion declares an acceptability floor, so nothing was screened.');
  }

  return {
    flagged: flags,
    flaggedAlternatives: [...new Set(hard.map((f) => f.alternativeId))],
    screenedOn,
    notes,
  };
}
