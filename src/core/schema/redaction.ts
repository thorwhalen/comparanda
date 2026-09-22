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

/** Whether a round has closed by `now`. Unclosed rounds are open. */
export function roundClosed(round: Round, now: string): boolean {
  return round.closedAt !== undefined && Date.parse(round.closedAt) <= Date.parse(now);
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
