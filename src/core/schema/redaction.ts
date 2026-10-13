/**
 * What a viewer may see of each assertion, given its round's policies.
 *
 * ADR-0023 (#49): **the author is always stored; the view redacts until the
 * round closes**, and redaction is a property of the read path in core, applied
 * once -- not a rule each view component remembers. This module is that one
 * place. It never edits the analysis: it answers "may this viewer see this", and
 * a view renders accordingly.
 *
 * The policies, as the schema names them (`Round` in provenance.ts; the ADR's
 * `blind-until-close` is the schema's `anonymous`, and its `distribution` /
 * `distribution-and-rationales` are `anonymous-summary` / `full`):
 *
 * - `attribution: 'anonymous'` hides who wrote an assertion from other
 *   participants while the round is open. `attributed` (the default) shows it.
 * - `feedback` governs what others' assertions reveal while the round is open:
 *   `none` (the default for a declared round) hides values and rationales;
 *   `anonymous-summary` shows values only as part of the distribution, never
 *   as one rater's answer, and no rationales; `full` shows both.
 *
 * Three things always see everything: a closed round, the viewer's own
 * assertions (including under another persona of the same principal), and an
 * assertion in no round -- the implicit single round of an analysis that never
 * declared one, which behaves exactly as analyses always have.
 *
 * **A presentation policy, not a security boundary** (ADR-0023). Everything is
 * in the document; anyone holding it can read every author. This decides what a
 * cooperating view shows. It covers the author, the value and the justification
 * of each assertion, and nothing else, so a view must also not render, for an
 * assertion whose author is hidden:
 *
 * - the assertion's **id** -- producers often mint ids from the author
 *   (the messy fixture's `a-rent-ber-ben` names Ben);
 * - `procedureId`, which identifies the agent or pipeline that produced it;
 * - its evidence and `supersededBy` chain, when values are hidden;
 * - suggestions whose `proposed` assertion carries an author or a round.
 *
 * The map `visibilityFor` returns is keyed by assertion id for lookup only; a
 * view must never display those keys.
 */
import type { Analysis } from './analysis.js';
import type { Assertion } from './values.js';
import type { Round } from './provenance.js';

export interface AssertionVisibility {
  /** Whether the author may be shown. */
  author: boolean;
  /**
   * `shown`: as this rater's answer. `distribution-only`: may contribute to an
   * anonymous summary of the round, but must not be shown against a rater.
   * `hidden`: not at all.
   */
  value: 'shown' | 'distribution-only' | 'hidden';
  /** Whether the justification may be shown. */
  justification: boolean;
  /** Why, in one phrase, for a tooltip or a test message. */
  because: 'no-round' | 'own-assertion' | 'round-closed' | 'round-open';
}

export interface ViewerContext {
  /** The viewer's author id, if they are a participant. Absent: an outside reader. */
  viewerId?: string | undefined;
  /** The moment of viewing, ISO 8601. A round is closed when `closedAt <= now`. */
  now: string;
}

const EVERYTHING = (because: AssertionVisibility['because']): AssertionVisibility =>
  ({ author: true, value: 'shown', justification: true, because });

/**
 * A moment as milliseconds. A date-time with no zone is read as UTC, not as the
 * reader's local time: the same round must be closed, or open, for every reader
 * (the schema's times are bare strings; `Date.parse` would take the host's zone).
 */
function instant(iso: string): number {
  return Date.parse(/T\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(iso) ? `${iso}Z` : iso);
}

/** Whether a round has closed by `now`. Unclosed rounds are open. */
export function roundClosed(round: Round, now: string): boolean {
  return round.closedAt !== undefined && instant(round.closedAt) <= instant(now);
}

/**
 * The visibility of one assertion to one viewer. The whole redaction rule.
 *
 * An assertion naming a round the document does not declare is treated as in
 * an open round with the most cautious policies: a reference nobody can resolve
 * is not a licence to show more.
 */
export function assertionVisibility(
  a: Analysis, assertion: Assertion, viewer: ViewerContext,
): AssertionVisibility {
  const roundId = assertion.roundId;
  if (roundId === undefined) return EVERYTHING('no-round');

  const principalOf = (id: string) => a.authors.find((x) => x.id === id)?.principalId ?? id;
  if (viewer.viewerId !== undefined && principalOf(viewer.viewerId) === principalOf(assertion.authorId)) {
    return EVERYTHING('own-assertion');
  }

  const round: Round = a.rounds.find((r) => r.id === roundId)
    ?? { id: roundId, index: -1, attribution: 'anonymous', feedback: 'none' };
  if (roundClosed(round, viewer.now)) return EVERYTHING('round-closed');

  const feedback = round.feedback ?? 'none';
  return {
    author: (round.attribution ?? 'attributed') === 'attributed',
    value: feedback === 'full' ? 'shown' : feedback === 'anonymous-summary' ? 'distribution-only' : 'hidden',
    justification: feedback === 'full',
    because: 'round-open',
  };
}

/** Visibility of every assertion in the analysis, keyed by assertion id. */
export function visibilityFor(a: Analysis, viewer: ViewerContext): Map<string, AssertionVisibility> {
  const out = new Map<string, AssertionVisibility>();
  for (const cell of a.cells) {
    for (const s of cell.assertions) out.set(s.id, assertionVisibility(a, s, viewer));
  }
  return out;
}

/**
 * An assertion as a viewer who may not see its author may be shown it: the
 * author, the procedure that names the agent behind it, and the id (producers
 * mint ids from the author) are taken out, and `shownId` stands in for the id.
 * Nothing else changes; what the viewer may see of the value and the
 * justification is `redactForViewer`'s.
 *
 * The one place an assertion is made safe to name. `cellDetail` and
 * `activityRecord` both go through here, so a surface built on either cannot
 * show an author the round hides without bypassing core.
 */
export function withoutAuthor(s: Assertion, shownId: string): Assertion {
  // The procedure names the agent; a perturbation's seed and detail are free text from the same run.
  const { procedureId: _procedure, perturbation: _perturbation, ...rest } = s;
  // Evidence ids are minted by the same producers, so they stand in too.
  return { ...rest, id: shownId, authorId: '', evidence: s.evidence.map((e, i) => ({ ...e, id: `${shownId}:evidence-${i + 1}` })) };
}

/**
 * What a round's policies let this viewer see of an assertion: `withoutAuthor`
 * when the author is hidden, then the value and any recorded absence removed
 * unless the value is `shown`, and the justification and the evidence that
 * backs it removed unless the justification may be.
 */
export function redactForViewer(s: Assertion, v: AssertionVisibility, shownId: string): Assertion {
  const out: Assertion = { ...(v.author ? s : withoutAuthor(s, shownId)) };
  if (v.value !== 'shown') {
    delete out.value;
    delete out.missing;
  }
  if (!v.justification) {
    delete out.justification;
    out.evidence = [];
  }
  return out;
}
