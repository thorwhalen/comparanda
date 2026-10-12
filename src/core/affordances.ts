/**
 * The affordance layer: what the document allows, asked without a view.
 *
 * ADR-0004: affordances live in the schema rather than in components, so that
 * a second, unrelated view over the same document enforces the same rules
 * without reimplementing them. This module is the queryable surface over those
 * declarations -- what may be edited, which blanks are legal on a criterion,
 * which values a measurement admits, which pairs are structurally inapplicable,
 * which criteria are acceptability screens -- and it answers every refusal
 * with a reason in words, because a control that is present and silently inert
 * is the failure this exists to prevent.
 *
 * **Policy only.** Nothing here can say how anything renders or persists; it
 * reads the analysis and returns plain data. Whether a *backend* accepts writes
 * is the provider's capability report, combined in the store adapter
 * (`cellAffordanceOf`), which reads its document half from `cellPolicy` here.
 *
 * **Never a permission model.** Who may edit is the host's question (ADR-0012).
 * The host passes `authorize`; the answer here is the intersection of the
 * document's policy and the host's, and with no `authorize` it is the
 * document's policy alone. Nothing in core decides a person may not edit.
 */
import type { Analysis } from './schema/analysis.js';
import { vocabularyOf } from './schema/analysis.js';
import { makeInapplicability } from './schema/groups.js';
import { CORE_MISSING_CODES } from './schema/missingness.js';
import { valueRefusal, type Measurement, type Preference } from './schema/measurement.js';
import { measurementFor } from './schema/structure.js';
import type { Cell, ScalarValue } from './schema/values.js';

/** Whether an action is offered, and -- when it is not -- why not, in words. */
export interface Affordance {
  enabled: boolean;
  /** Always present when `enabled` is false. */
  reason?: string;
}

const ALLOWED: Affordance = Object.freeze({ enabled: true });
const refuse = (reason: string): Affordance => ({ enabled: false, reason });
const LOCKED = 'this analysis is locked; propose a suggestion instead of editing it.';

/** A write to one cell. Coordinates are opaque ids. */
export interface CellEditRequest {
  /** `assert` writes an assertion; `suggest` proposes one on a locked or read-only cell. */
  action: 'assert' | 'suggest';
  alternativeId: string;
  criterionId: string;
  measure: string;
}

/**
 * A write to the analysis outside any one cell.
 *
 * `comment` starts or answers a thread; `revise` is every other change to what
 * the analysis says -- its alternatives, criteria, groups, definitions and
 * declarations. `doing` names the edit in words ("renaming a criterion"), for
 * the host and for the refusal.
 */
export interface DocumentEditRequest {
  action: 'comment' | 'revise';
  doing: string;
}

/** What a host is asked to authorise. */
export type EditRequest = CellEditRequest | DocumentEditRequest;

/**
 * The host's authorisation, injected. Returning `false` refuses with a generic
 * reason; returning an `Affordance` lets the host say why.
 */
export type Authorize = (request: EditRequest) => Affordance | boolean;

/**
 * The document's own policy on writing to one cell: `Analysis.locked` and
 * `Cell.readOnly`. The one place their refusal reasons are written; the store's
 * `cellAffordanceOf` composes it with the provider's capability.
 */
export function cellPolicy(
  analysis: Pick<Analysis, 'locked'>,
  cell: Pick<Cell, 'readOnly'> | undefined,
): Affordance {
  if (analysis.locked) return refuse(LOCKED);
  if (cell?.readOnly) return refuse('this cell is declared read-only in the analysis.');
  return ALLOWED;
}

/**
 * The document's own policy on an edit outside a cell.
 *
 * `Analysis.locked` means the analysis "accepts direct edits, or only
 * suggestions", so a lock refuses every `revise`. It does not refuse a
 * `comment`: a thread changes nothing the analysis asserts, and ADR-0011
 * clause 5 exists so that a reviewer can take part in a locked analysis
 * without mutating it -- a reviewer who could propose but not say why would
 * be half a reviewer.
 */
export function documentPolicy(
  analysis: Pick<Analysis, 'locked'>,
  action: DocumentEditRequest['action'],
): Affordance {
  if (action === 'revise' && analysis.locked) return refuse(LOCKED);
  return ALLOWED;
}

/** A legal blank on a criterion, with what it means. */
export interface LegalMissingCode {
  code: string;
  means: string | undefined;
  /** `core`, or declared on the analysis or on this criterion. */
  source: 'core' | 'analysis' | 'criterion';
}

/** A criterion carrying an acceptability floor. */
export interface Screen {
  criterionId: string;
  /** The measure the floor is read on. */
  measure: string;
  threshold: number;
  rationale: string;
  preference: Preference | undefined;
}

export interface Affordances {
  /** Whether an assertion may be written to this cell. */
  assert(alternativeId: string, criterionId: string, measure: string): Affordance;
  /** Whether a suggestion may be proposed here. Offered where `assert` is refused only by lock or read-only. */
  suggest(alternativeId: string, criterionId: string, measure: string): Affordance;
  /** Whether this value is one the measurement admits. */
  value(criterionId: string, measure: string, value: ScalarValue): Affordance;
  /** Every missingness code legal on this criterion. */
  missingCodes(criterionId: string): LegalMissingCode[];
  /** Whether this code may be recorded on this criterion. */
  missingCode(criterionId: string, code: string): Affordance;
  /** Whether the pair is structurally inapplicable (a declared group-pair block). */
  inapplicable(alternativeId: string, criterionId: string): boolean;
  /** Every acceptability screen `screen()` applies for this measure. */
  screens(measure: string): Screen[];
  /** Whether a comment thread may be started or answered. A lock does not refuse it (`documentPolicy`). */
  comment(): Affordance;
  /**
   * Whether the analysis may be revised outside its cells: alternatives,
   * criteria, groups, definitions, declarations. `doing` names the edit in
   * words, and is what the host is asked about.
   */
  revise(doing: string): Affordance;
}

/**
 * The members of `Affordances` that answer "may this be written?". Every other
 * member answers a question about legality or structure, which no provider
 * capability can change. The store's `editAffordances` gates exactly these on
 * the provider, and a test holds this list to the interface.
 */
export const WRITE_AFFORDANCES = ['assert', 'suggest', 'comment', 'revise'] as const satisfies readonly (keyof Affordances)[];
export type WriteAffordance = typeof WRITE_AFFORDANCES[number];

/**
 * The affordances of one analysis. Prepared once; every query is a lookup.
 */
export function makeAffordances(
  a: Analysis,
  { authorize }: { authorize?: Authorize } = {},
): Affordances {
  const alts = new Map(a.alternatives.map((x) => [x.id, x]));
  const crits = new Map(a.criteria.map((x) => [x.id, x]));
  const cells = new Map(a.cells.map((c) => [JSON.stringify([c.alternativeId, c.criterionId, c.measure]), c]));
  const inapplicable = makeInapplicability(a);
  const vocabulary = vocabularyOf(a);
  const core = new Set(Object.keys(CORE_MISSING_CODES));

  /** Refusals that hold whatever the action: the cell does not exist to be written. */
  const structural = (altId: string, critId: string, measure: string): Affordance => {
    const alt = alts.get(altId);
    const crit = crits.get(critId);
    if (!alt) return refuse(`there is no alternative "${altId}" in this analysis.`);
    if (!crit) return refuse(`there is no criterion "${critId}" in this analysis.`);
    if (alt.tombstoned) return refuse(`"${alt.label}" has been deleted; it is kept only so its history stays readable.`);
    if (crit.tombstoned) return refuse(`"${crit.label}" has been deleted; it is kept only so its history stays readable.`);
    if (!measurementFor(crit, measure)) {
      return refuse(`"${crit.label}" declares no measurement for "${measure}", so there is nothing to record here.`);
    }
    if (inapplicable(altId, critId)) {
      return refuse(`"${crit.label}" does not apply to "${alt.label}" (a declared inapplicable block); there is nothing to score.`);
    }
    return ALLOWED;
  };

  const withHost = (request: EditRequest, ownPolicy: Affordance): Affordance => {
    if (!ownPolicy.enabled || !authorize) return ownPolicy;
    const host = authorize(request);
    if (host === true) return ALLOWED;
    if (host === false) return refuse('you are not authorised to do this here.');
    return host.enabled ? ALLOWED : refuse(host.reason ?? 'you are not authorised to do this here.');
  };

  const cellAt = (altId: string, critId: string, measure: string) => cells.get(JSON.stringify([altId, critId, measure]));

  return {
    assert(alternativeId, criterionId, measure) {
      const s = structural(alternativeId, criterionId, measure);
      const own = s.enabled ? cellPolicy(a, cellAt(alternativeId, criterionId, measure)) : s;
      return withHost({ action: 'assert', alternativeId, criterionId, measure }, own);
    },
    suggest(alternativeId, criterionId, measure) {
      return withHost({ action: 'suggest', alternativeId, criterionId, measure }, structural(alternativeId, criterionId, measure));
    },
    value(criterionId, measure, value) {
      const crit = crits.get(criterionId);
      if (!crit) return refuse(`there is no criterion "${criterionId}" in this analysis.`);
      const m = measurementFor(crit, measure);
      if (!m) return refuse(`"${crit.label}" declares no measurement for "${measure}".`);
      return valueAffordance(m, value);
    },
    missingCodes(criterionId) {
      const own = new Set((crits.get(criterionId)?.missingCodes ?? []).map((d) => d.id));
      const declared = vocabulary.declarationsFor(criterionId).map((d) => d.id);
      const codes = [...new Set([...core, ...declared])];
      return codes.map((code) => ({
        code,
        means: vocabulary.means(code, criterionId),
        source: own.has(code) ? 'criterion' : core.has(code) ? 'core' : 'analysis',
      }));
    },
    missingCode(criterionId, code) {
      if (!crits.has(criterionId)) return refuse(`there is no criterion "${criterionId}" in this analysis.`);
      return vocabulary.resolve(code, criterionId).source === 'undeclared'
        ? refuse(`"${code}" is not a missingness code this analysis defines for this criterion.`)
        : ALLOWED;
    },
    inapplicable: (alternativeId, criterionId) => inapplicable(alternativeId, criterionId),
    screens(measure) {
      // The rule `screen()` applies, and only that rule: a live criterion with
      // a criterion-level floor and a measurement for this measure. A view that
      // marks screens from this list marks exactly what screening flags on.
      return a.criteria.flatMap((c): Screen[] => {
        const m = measurementFor(c, measure);
        if (c.tombstoned || !c.acceptability || !m) return [];
        return [{
          criterionId: c.id, measure, threshold: c.acceptability.threshold,
          rationale: c.acceptability.rationale, preference: m.preference,
        }];
      });
    },
    comment() {
      return withHost({ action: 'comment', doing: 'commenting' }, documentPolicy(a, 'comment'));
    },
    revise(doing) {
      return withHost({ action: 'revise', doing }, documentPolicy(a, 'revise'));
    },
  };
}

/**
 * Whether a measurement admits this value. The reason comes from
 * `valueRefusal`, the same function `validateAnalysis` refuses a stored value
 * with, so the two cannot disagree.
 */
export function valueAffordance(m: Measurement, value: ScalarValue): Affordance {
  const reason = valueRefusal(m, value);
  return reason === undefined ? ALLOWED : refuse(reason);
}
