/**
 * The shipped analyses, described for a composition root to pick from (#87).
 *
 * Descriptions only: importing this module registers nothing. Each call is
 * marked `@__PURE__` so a bundler drops the definitions -- and the analyses they
 * reference -- that a consumer never imports; without it, pulling any analysis
 * from the root barrel kept every one (review finding). An app builds its
 * registry from the ones it ships, e.g.
 * `createAnalysisRegistry([dominanceAnalysis, screeningAnalysis])`.
 */
import { defineAnalysis } from './registry.js';
import { dominance, type DominanceOptions } from './dominance.js';
import { screen } from './screening.js';
import { pughTally, type PughOptions } from './pugh.js';
import { findNonDiscriminatingCriteria, type NonDiscriminatingOptions } from './non-discriminating.js';
import { agreement, type AgreementOptions } from './agreement.js';

export const dominanceAnalysis = /* @__PURE__ */ defineAnalysis({
  id: 'dominance', label: 'Dominance',
  run: (a, o: DominanceOptions) => dominance(a, o),
});
export const screeningAnalysis = /* @__PURE__ */ defineAnalysis({
  id: 'screening', label: 'Acceptability screening',
  run: (a, o: { measure: string }) => screen(a, o.measure),
});
export const pughAnalysis = /* @__PURE__ */ defineAnalysis({
  id: 'pugh', label: 'Datum-relative tally',
  run: (a, o: PughOptions) => pughTally(a, o),
});
export const nonDiscriminatingAnalysis = /* @__PURE__ */ defineAnalysis({
  id: 'non-discriminating', label: 'Criteria doing no work',
  run: (a, o: NonDiscriminatingOptions) => findNonDiscriminatingCriteria(a, o),
});
export const agreementAnalysis = /* @__PURE__ */ defineAnalysis({
  id: 'agreement', label: 'Agreement',
  run: (a, o: AgreementOptions) => agreement(a, o),
});
