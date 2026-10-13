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
import type { AnchorScope } from './schema/annotations.js';
import { commentTarget } from './threads.js';
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
const NOT_AUTHORISED = 'you are not authorised to do this here.';
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
 * What a document edit is about, for a host that authorises by object rather
 * than by wording. The anchor scopes of ADR-0011, plus a suggestion; `id` is
 * absent for the analysis as a whole.
 */
export interface EditTarget {
  kind: AnchorScope | 'suggestion';
  id?: string;
}

/**
 * A write to the analysis outside any one cell.
 *
 * - `comment` starts, answers, edits, resolves or reopens a thread; `thread` says
 *   which (#194), so a host whose rule is "reviewers comment, only the owner
 *   resolves" can tell them apart. Absent, the question is the general one:
 *   may this reader take part in discussion here at all.
 * - `revise` is every other change to what the analysis says -- its
 *   alternatives, criteria, groups, definitions and declarations.
 * - `change-lock` locks or unlocks the analysis.
 * - `decide-suggestion` accepts or declines a suggestion.
 *
 * `doing` names the edit as a gerund phrase ("renaming a criterion"), for the
 * host and for the refusal; `target` says what it is about, when the caller
 * knows, so a host never has to parse the words.
 */
export interface DocumentEditRequest {
  action: 'comment' | 'revise' | 'change-lock' | 'decide-suggestion';
  doing: string;
  target?: EditTarget;
  /** On `comment` only: which of the five it is. */
  thread?: ThreadAct;
  /** On editing a comment only: which comment, and who wrote it, read from the document and not from the caller, so a host can let only its author edit it (ADR-0012). */
  comment?: { threadId: string; id: string; authorId: string };
  /** On `decide-suggestion` only: which way. */
  decision?: SuggestionDecision;
  /**
   * On accepting a suggestion only: the cell it writes. Accepting is a write to
   * that cell, so a host that authorises cell by cell sees the same coordinates
   * it sees for `assert`.
   */
  cell?: Omit<CellEditRequest, 'action'>;
}

/** The five things a thread write can be. */
export const THREAD_ACTS = ['start', 'reply', 'edit', 'resolve', 'reopen'] as const;
export type ThreadAct = typeof THREAD_ACTS[number];

/** An edit is asked about one comment, and only an edit is: anything else is a mistake in the caller, not a refusal. */
export function requireCommentFor(act: ThreadAct | undefined, ofComment: unknown): void {
  if ((act === 'edit') !== (ofComment !== undefined)) {
    throw new TypeError('an edit is asked about one comment, and only an edit: pass the thread and comment with "edit", and nothing with the other acts.');
  }
}

/** What each act is called to the host (`DocumentEditRequest.doing`) and in a refusal. */
const THREAD_DOING: Readonly<Record<ThreadAct, string>> = {
  start: 'starting a thread', reply: 'answering a thread', edit: 'editing a comment', resolve: 'resolving a thread', reopen: 'reopening a thread',
};

/** The gerund phrase for an act, or the general one when none is named. A word that is not an act throws. */
export function threadDoing(act?: ThreadAct): string {
  if (act === undefined) return 'commenting';
  if (!Object.hasOwn(THREAD_DOING, act)) {
    throw new TypeError(`a thread write is one of ${Object.keys(THREAD_DOING).map((k) => JSON.stringify(k)).join(', ')}, not ${JSON.stringify(act)}.`);
  }
  return THREAD_DOING[act];
}

/** Accepting writes the proposed assertion into its cell; declining writes only the suggestion's status. */
export type SuggestionDecision = 'accept' | 'decline';

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
 * The document's own policy on an edit outside a cell (ADR-0011, amendment of
 * 2026-10-12).
 *
 * `Analysis.locked` means the analysis "accepts direct edits, or only
 * suggestions", so a lock refuses every `revise`. It refuses nothing else:
 *
 * - a `comment` changes nothing the analysis asserts, and ADR-0011 clause 5
 *   exists so that a reviewer can take part in a locked analysis without
 *   mutating it -- a reviewer who could propose but not say why would be half
 *   a reviewer;
 * - `change-lock` is how a lock ends, and a lock that refused its own removal
 *   would be permanent;
 * - `decide-suggestion` is the owner's half of suggestion mode -- "an owner
 *   accepts or declines" -- and a lock that refused it would make every
 *   suggestion on a locked analysis undecidable.
 *
 * Who may do the last two is the host's question (ADR-0012), not the lock's.
 */
export function documentPolicy(
  analysis: Pick<Analysis, 'locked'>,
  action: DocumentEditRequest['action'],
): Affordance {
  if (action === 'revise' && analysis.locked) return refuse(LOCKED);
  return ALLOWED;
}

/** A decision is one of two words; anything else is a caller's mistake, said at once rather than read as a decline. */
export function requireDecision(decision: SuggestionDecision): SuggestionDecision {
  if (decision !== 'accept' && decision !== 'decline') {
    throw new TypeError(`a suggestion is decided with "accept" or "decline", not ${JSON.stringify(decision)}.`);
  }
  return decision;
}

/** `doing` is read by people. An empty one is a caller's mistake, and says so at once. */
export function requireDoing(doing: string): string {
  if (typeof doing !== 'string' || doing.trim() === '') {
    throw new TypeError('name the edit as a gerund phrase, e.g. revise("renaming a criterion"); it is what the host and the refusal read.');
  }
  return doing.trim();
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
  /**
   * Whether a thread may be started, answered, edited, resolved or reopened here, or --
   * with no `act` -- whether discussion is open to this reader at all. The host
   * is asked with the act named (#194). A lock does not refuse any of them
   * (`documentPolicy`).
   */
  comment(target?: EditTarget, act?: ThreadAct, ofComment?: { threadId: string; commentId: string }): Affordance;
  /**
   * Whether the analysis may be revised outside its cells: alternatives,
   * criteria, groups, definitions, declarations. `doing` names the edit as a
   * gerund phrase ("renaming a criterion"); an empty one throws.
   */
  revise(doing: string, target?: EditTarget): Affordance;
  /** Whether the analysis may be locked or unlocked. A lock never refuses its own removal. */
  changeLock(): Affordance;
  /**
   * Whether this suggestion may be accepted or declined. Either way it must
   * exist and still be open. Accepting writes its assertion into the anchored
   * cell, so that cell must exist to be written and must not be read-only; a
   * lock does not refuse it (`documentPolicy`).
   */
  decideSuggestion(suggestionId: string, decision: SuggestionDecision): Affordance;
}

/**
 * The members of `Affordances` that answer "may this be written?". Every other
 * member answers a question about legality or structure, which no provider
 * capability can change. The store's `editAffordances` gates exactly these on
 * the provider, and a test holds this list to the interface.
 */
export const WRITE_AFFORDANCES = [
  'assert', 'suggest', 'comment', 'revise', 'changeLock', 'decideSuggestion',
] as const satisfies readonly (keyof Affordances)[];
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
    // The intersection fails closed: only an explicit yes from the host allows.
    // A host that throws, or answers anything but `true` or an enabled
    // `Affordance`, has not said yes -- and is never overruled into one.
    try {
      const host: unknown = authorize(request);
      if (host instanceof Promise) return refuse('the host answered later than asked: `authorize` must answer at once, with true, false or an Affordance.');
      if (host === true) return ALLOWED;
      const { enabled, reason } = ((typeof host === 'object' && host) || {}) as Partial<Affordance>;
      return enabled === true ? ALLOWED : refuse(typeof reason === 'string' && reason ? reason : NOT_AUTHORISED);
    } catch (error) {
      return refuse(`the host could not decide whether you may do this (${error instanceof Error ? error.message : String(error)}).`);
    }
  };

  const documentRequest = (
    action: DocumentEditRequest['action'], doing: string, target: EditTarget | undefined, thread?: ThreadAct, comment?: DocumentEditRequest['comment'],
  ): DocumentEditRequest => ({
    action, doing, ...(target === undefined ? {} : { target }), ...(thread === undefined ? {} : { thread }), ...(comment === undefined ? {} : { comment }),
  });

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
    comment(target, act, ofComment) {
      const doing = threadDoing(act);
      requireCommentFor(act, ofComment);
      if (ofComment === undefined) return withHost(documentRequest('comment', doing, target, act), documentPolicy(a, 'comment'));
      // Everything the host is told is read from the document: the target is the thread's own anchor, whatever the caller passed.
      const thread = a.threads.find((t) => t.id === ofComment.threadId);
      const was = thread?.comments.find((c) => c.id === ofComment.commentId);
      if (!thread || !was) return refuse(`there is no comment "${ofComment.commentId}" in the thread "${ofComment.threadId}" in this analysis.`);
      if (thread.resolved) return refuse(`the thread "${thread.id}" is resolved; its comments are kept as they were unless it is reopened.`);
      const own = commentTarget(thread.anchor);
      return withHost(documentRequest('comment', doing, own, act, { threadId: thread.id, id: was.id, authorId: was.authorId }), documentPolicy(a, 'comment'));
    },
    revise(doing, target) {
      return withHost(documentRequest('revise', requireDoing(doing), target), documentPolicy(a, 'revise'));
    },
    changeLock() {
      const doing = a.locked ? 'unlocking the analysis' : 'locking the analysis';
      return withHost(documentRequest('change-lock', doing, { kind: 'analysis' }), documentPolicy(a, 'change-lock'));
    },
    decideSuggestion(suggestionId, decision) {
      requireDecision(decision);
      const s = a.suggestions.find((x) => x.id === suggestionId);
      const own = (): Affordance => {
        if (!s) return refuse(`there is no suggestion "${suggestionId}" in this analysis.`);
        if (s.status !== 'open') return refuse(`this suggestion has already been ${s.status}; it cannot be decided again.`);
        if (decision === 'accept') {
          const { scope, alternativeId: alt, criterionId: crit, measure } = s.anchor;
          if (scope !== 'cell' || alt === undefined || crit === undefined) {
            return refuse('this suggestion is not anchored to one cell, so accepting it has nowhere to write; decline it instead.');
          }
          if (measure === undefined) {
            return refuse('this suggestion names its cell but not the measure it scores, so accepting it has nowhere to write; decline it instead.');
          }
          const st = structural(alt, crit, measure);
          if (!st.enabled) return st;
          if (cellAt(alt, crit, measure)?.readOnly) return refuse('the cell this suggestion targets is declared read-only in the analysis; decline it instead.');
        }
        return documentPolicy(a, 'decide-suggestion');
      };
      const request = documentRequest('decide-suggestion', `${decision === 'accept' ? 'accepting' : 'declining'} a suggestion`,
        { kind: 'suggestion', id: suggestionId });
      const { scope, alternativeId, criterionId, measure } = s?.anchor ?? {};
      const cell = decision === 'accept' && scope === 'cell' && alternativeId !== undefined &&
        criterionId !== undefined && measure !== undefined ? { cell: { alternativeId, criterionId, measure } } : {};
      return withHost({ ...request, decision, ...cell }, own());
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
