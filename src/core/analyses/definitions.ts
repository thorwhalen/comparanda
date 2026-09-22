/**
 * The shipped analyses, described for a composition root to pick from (#87).
 *
 * Descriptions only: importing this module registers nothing. An app builds its
 * registry from the ones it ships, e.g.
 * `createAnalysisRegistry([dominanceAnalysis, screeningAnalysis])`.
 */
import { defineAnalysis } from './registry.js';
import { dominance, type DominanceOptions } from './dominance.js';
import { screen } from './screening.js';
import { pughTally, type PughOptions } from './pugh.js';
import { findNonDiscriminatingCriteria, type NonDiscriminatingOptions } from './non-discriminating.js';
import { agreement, type AgreementOptions } from './agreement.js';

export const dominanceAnalysis = defineAnalysis({
  id: 'dominance', label: 'Dominance',
  run: (a, o: DominanceOptions) => dominance(a, o),
});
export const screeningAnalysis = defineAnalysis({
  id: 'screening', label: 'Acceptability screening',
  run: (a, o: { measure: string }) => screen(a, o.measure),
});
export const pughAnalysis = defineAnalysis({
  id: 'pugh', label: 'Datum-relative tally',
  run: (a, o: PughOptions) => pughTally(a, o),
});
export const nonDiscriminatingAnalysis = defineAnalysis({
  id: 'non-discriminating', label: 'Criteria doing no work',
  run: (a, o: NonDiscriminatingOptions) => findNonDiscriminatingCriteria(a, o),
});
export const agreementAnalysis = defineAnalysis({
  id: 'agreement', label: 'Agreement',
  run: (a, o: AgreementOptions) => agreement(a, o),
});
