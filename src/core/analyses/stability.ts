/**
 * The between-round stability trace: churn (ADR-0023, #112).
 *
 * Stopping a multi-round elicitation is read off a trace, never off a
 * threshold: this module computes, for each step from one round to the next
 * and for each criterion, how many raters changed their answer and whether the
 * cells' spread narrowed or widened -- and gates nothing on it.
 *
 * **Churn is not alpha.** Alpha (`agreement.ts`) is the within-round statistic;
 * churn is between rounds. The result says which it is in its own field,
 * `quantity`, whose values (`churn`, `test-retest`) share nothing with
 * agreement's `labelledAs` (`agreement`, `consistency`), so no reader can show
 * one as the other by reading the same field. A step into a round declared
 * `feedback: 'none'` measures how raters repeat themselves without having seen
 * anyone else -- test-retest, not revision after feedback -- and is labelled so
 * (ADR-0023, 2026-08 amendment).
 *
 * Per criterion, never per matrix, and nothing averaged: spread is counted as
 * narrowed, widened or unchanged, cell by cell.
 *
 * Pure: no DOM.
 */
import type { Analysis } from '../schema/analysis.js';
import { cellIndex, cellKey } from '../schema/analysis.js';
import { measurementFor } from '../schema/structure.js';
import { assertionVisibility, type ViewerContext } from '../schema/redaction.js';
import { isWidenedByDisclosure, type Assertion, type ScalarValue } from '../schema/values.js';
import type { Measurement } from '../schema/measurement.js';
import type { AnalysisResult } from './registry.js';
import { alternativeScope, type AlternativeScopeOptions } from './scope.js';

/** What every result of this analysis rests on, carried with it (#87, ADR-0015). */
export const STABILITY_ASSUMPTIONS: readonly [string, ...string[]] = Object.freeze([
  'Churn is between rounds and alpha is within one; they answer different questions and are never one number (ADR-0023).',
  "A rater's answer in a round is their latest valued assertion in it, personas counted as their principal.",
  'A rater counts toward a step only where they answered the same cell in both rounds.',
  "A step into a round declared feedback: 'none' is test-retest, not churn: nobody had seen anyone else's answer.",
  'Spread is the distance between the lowest and highest answer, in level steps on an ordinal criterion; nothing is averaged and nothing is gated on the trace.',
] as const);

/** What a step measures: revision after feedback, or repetition without it. */
export type StabilityQuantity = 'churn' | 'test-retest';

export interface CriterionStep {
  criterionId: string;
  /** Rater-cells answered in both rounds. */
  compared: number;
  /** Of those, how many changed their answer. */
  changed: number;
  /** `changed / compared`, undefined when nothing was compared. */
  fraction?: number | undefined;
  spread: { narrowed: number; widened: number; unchanged: number };
}

export interface StabilityStep {
  fromRoundId: string;
  toRoundId: string;
  quantity: StabilityQuantity;
  criteria: CriterionStep[];
}

export interface StabilityResult extends AnalysisResult {
  measure: string;
  /** Rounds in index order, each step from one to the next. */
  steps: StabilityStep[];
  /** Assertions left out because the viewer may not see their value (ADR-0023). */
  unseen: number;
}

export interface StabilityOptions extends AlternativeScopeOptions {
  measure: string;
  criterionIds?: readonly string[];
  /** Read as this viewer may see it: an assertion whose value is hidden takes no part, and is counted. */
  viewer?: ViewerContext;
}

/** The trace, round step by round step, criterion by criterion. */
export function stabilityTrace(a: Analysis, opts: StabilityOptions): StabilityResult {
  const { measure, viewer } = opts;
  const rounds = [...a.rounds].sort((x, y) => x.index - y.index);
  const alts = alternativeScope(a, opts);
  const crits = opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);
  const principalOf = new Map(a.authors.map((x) => [x.id, x.principalId ?? x.id]));
  const index = cellIndex(a);
  let unseen = 0;
  let widenedByDisclosure = 0;

  // For each cell: round id -> principal -> that rater's latest valued assertion in the round.
  const answers = new Map<string, Map<string, Map<string, Assertion>>>();
  for (const critId of crits) {
    for (const altId of alts) {
      const cell = index.get(cellKey(altId, critId, measure));
      if (!cell) continue;
      if (isWidenedByDisclosure(cell)) widenedByDisclosure += 1;
      const byRound = new Map<string, Map<string, Assertion>>();
      for (const s of cell.assertions) {
        if (s.roundId === undefined || s.value === undefined || s.independence === 'consensus') continue;
        if (viewer && assertionVisibility(a, s, viewer).value === 'hidden') { unseen += 1; continue; }
        const who = principalOf.get(s.authorId) ?? s.authorId;
        const round = byRound.get(s.roundId) ?? new Map<string, Assertion>();
        const was = round.get(who);
        if (!was || was.at <= s.at) round.set(who, s);
        byRound.set(s.roundId, round);
      }
      answers.set(cellKey(altId, critId, measure), byRound);
    }
  }

  const steps: StabilityStep[] = [];
  for (let k = 1; k < rounds.length; k += 1) {
    const [from, to] = [rounds[k - 1]!, rounds[k]!];
    const criteria: CriterionStep[] = [];
    for (const critId of crits) {
      const crit = a.criteria.find((c) => c.id === critId);
      const m = crit ? measurementFor(crit, measure) : undefined;
      if (!m) continue;
      const step: CriterionStep = { criterionId: critId, compared: 0, changed: 0, spread: { narrowed: 0, widened: 0, unchanged: 0 } };
      for (const altId of alts) {
        const byRound = answers.get(cellKey(altId, critId, measure));
        const before = byRound?.get(from.id);
        const after = byRound?.get(to.id);
        if (!before || !after) continue;
        // Spread over the raters in both rounds: one who dropped out is not a convergence.
        const pairs: [Assertion, Assertion][] = [];
        for (const [who, s] of before) {
          const t = after.get(who);
          if (!t) continue;
          pairs.push([s, t]);
          if (t.value !== s.value) step.changed += 1;
        }
        step.compared += pairs.length;
        const [was, now] = [spreadOf(pairs.map((p) => p[0]), m), spreadOf(pairs.map((p) => p[1]), m)];
        if (was === undefined || now === undefined) continue;
        if (now < was) step.spread.narrowed += 1;
        else if (now > was) step.spread.widened += 1;
        else step.spread.unchanged += 1;
      }
      step.fraction = step.compared === 0 ? undefined : step.changed / step.compared;
      criteria.push(step);
    }
    steps.push({ fromRoundId: from.id, toRoundId: to.id, quantity: (to.feedback ?? 'none') === 'none' ? 'test-retest' : 'churn', criteria });
  }
  return { measure, steps, unseen, widenedByDisclosure, assumptions: STABILITY_ASSUMPTIONS };
}

/** Highest minus lowest answer, in level steps where the measurement declares levels. */
function spreadOf(answers: readonly Assertion[], m: Measurement): number | undefined {
  const at = (v: ScalarValue | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (m.levels && m.levels.length > 0) {
      const i = m.levels.findIndex((l) => l === v);
      return i >= 0 ? i : undefined;
    }
    return typeof v === 'number' ? v : undefined;
  };
  const xs = answers.map((s) => at(s.value)).filter((x): x is number => x !== undefined);
  return xs.length === 0 ? undefined : Math.max(...xs) - Math.min(...xs);
}
