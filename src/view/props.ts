/**
 * The matrix's props contract (ADR-0032 clause 3), and what `mountMatrix` adds.
 *
 * `MatrixProps` is a plain data shape: an analysis, a measure name, and what to
 * read it with. It names no provider, no `fetch`, no store, so a consumer that
 * renders its own table in the meantime renders it against the same contract
 * `mountMatrix` takes -- and deletes it, rather than refactors it, when the
 * matrix arrives.
 *
 * `MountMatrixProps` is the connected half: an optional `source` the view
 * follows and gates every edit on (ADR-0006 clause 3, through `editAffordances`),
 * and the host's `authorize`. Without a source the matrix is read-only, and
 * says so with a reason wherever it would have offered a write.
 *
 * ADR-0032 listed `onEdit?: (patch) => void`; it is not here. Edits go through
 * the source (amendment of 2026-10-12): a host that wants a callback hands
 * over a source whose `update` is that callback.
 */
import type { Authorize } from '../core/affordances.js';
import type { Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import type { MissingnessVocabulary } from '../core/schema/missingness.js';
import type { AnalysisSource } from '../store/index.js';

/** What the matrix renders. The contract ADR-0032 publishes before the matrix. */
export interface MatrixProps {
  /** The analysis, as of mount. With a `source`, the view follows its writes from then on. */
  analysis: Analysis;
  /** Which measure the cells show: `score`, `confidence`, or a declared one. */
  measure: string;
  /** How a blank is read. Default: the analysis's own vocabulary (`vocabularyOf`). */
  vocabulary?: MissingnessVocabulary;
  /** The registered encoding's id. Default and, in v1, only: `text-only` (ADR-0032). */
  encoding?: string;
  /**
   * The standing of a citation check, injected so the view owns no clock and no
   * policy (ADR-0032 clause 4). Typically `(c) => checkStanding(c, { currentCheckerVersion, now })`.
   */
  standing?: (check: CitationCheck | undefined) => CheckStanding;
}

/** What `mountMatrix` takes: the props contract, plus the ports it follows and edits through. */
export interface MountMatrixProps extends MatrixProps {
  /**
   * Where the analysis lives. The view subscribes to it, re-renders on each
   * write to this analysis, and offers an edit only where `editAffordances`
   * over it says so. Absent: read-only, with a stated reason.
   */
  source?: AnalysisSource;
  /** The host's authorisation of each edit, consulted after the source and the document. */
  authorize?: Authorize;
}

/**
 * What `update` takes: any subset of the props. An optional prop given as
 * `undefined` is cleared; a required one (`analysis`, `measure`) cannot be.
 */
export type MatrixPropsUpdate = { [K in keyof MountMatrixProps]?: MountMatrixProps[K] | undefined };
