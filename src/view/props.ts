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
import type { Vouched } from '../core/identity.js';
import type { Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import type { MissingnessVocabulary } from '../core/schema/missingness.js';
import type { ViewerContext } from '../core/schema/redaction.js';
import type { ViewState } from '../core/view-state.js';
import type { AnalysisSource, IdentityProvider } from '../store/index.js';

/** What the matrix renders. The contract ADR-0032 publishes before the matrix. */
export interface MatrixProps {
  /** The analysis, as of mount. With a `source`, the view follows its writes from then on. */
  analysis: Analysis;
  /** Which measure the cells show: `score`, `confidence`, or a declared one. */
  measure: string;
  /** How a blank is read. Default: the analysis's own vocabulary (`vocabularyOf`). */
  vocabulary?: MissingnessVocabulary;
  /** The registered encoding's id. Default: the view state's, else `text-only` (ADR-0032). */
  encoding?: string;
  /**
   * The reader's arrangement (ADR-0006): order, hidden alternatives and
   * criteria, grouping into bands, and `transposed`. Per-user, never part of
   * the analysis. Default: `initialViewState(analysis)`, the document's order.
   * An id the view state does not know is shown after the ordered ones.
   */
  view?: ViewState;
  /**
   * The standing of a citation check, injected so the view owns no clock and no
   * policy (ADR-0032 clause 4). Typically `(c) => checkStanding(c, { currentCheckerVersion, now })`.
   */
  standing?: (check: CitationCheck | undefined) => CheckStanding;
  /**
   * Who is looking, and when, injected so the view owns no clock (ADR-0032
   * clause 4). With it, an author an open `anonymous` round hides from this
   * viewer is not shown (ADR-0023). `mountMatrix` supplies one from its identity
   * and clock when the caller gives none; a pure `Matrix` given none hides nothing.
   */
  viewer?: ViewerContext;
  /**
   * Which authors' attestations the host itself performed (a sign-in this host
   * ran), injected because the document cannot vouch for itself (#263). Those
   * read as attested; every other attestation reads as a claim. Default: none.
   * It is asked per author id: vouching for a persona says the host ran that
   * record's check, not that the principal is acting as the persona.
   */
  vouched?: Vouched;
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
  /**
   * Called with the whole view state each time the matrix changes it -- so far,
   * the reader's position in the grid (`session.focus`, #99). The view state
   * stays the host's to keep (ADR-0006): persist this one and pass it back as
   * `view`, and a reload lands in the cell the reader left. Without it the
   * matrix still tracks the position for as long as it is mounted. Pass it
   * back synchronously and unthrottled: a stale one moves the reader back.
   */
  onViewChange?: (view: ViewState) => void;
  /**
   * Who is acting, for the threads the reader starts, answers and resolves
   * (#106, ADR-0012). Default: `anonymousIdentity()`, which says it is
   * unverified. Only consulted with a `source`; without one nothing is written.
   */
  identity?: IdentityProvider;
  /** A message the reader must acknowledge before it goes away (#224); see `MatrixViewProps.notice`. */
  notice?: { message: string; onAcknowledge: () => void };
}

/**
 * What `update` takes: any subset of the props. An optional prop given as
 * `undefined` is cleared; a required one (`analysis`, `measure`) cannot be.
 */
export type MatrixPropsUpdate = { [K in keyof MountMatrixProps]?: MountMatrixProps[K] | undefined };
