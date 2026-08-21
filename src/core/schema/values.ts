/**
 * Assertions, cells, and the reduction from many assertions to one displayed
 * value.
 *
 * A cell is **not** a value. It is a set of assertions, each with an author, a
 * time, a justification and its evidence, plus a named reduction saying which
 * one -- or what function of them -- is shown. Multi-rater is the Delphi shape
 * and it is a first-class case, not an edge case: the spread between raters is
 * frequently the most decision-relevant thing on the page.
 *
 * This is single-valued-looking from the outside and multi-valued underneath
 * from day one, because ADR-0011 is explicit that retrofitting multi-rater onto
 * single-value cells is a migration through every stored analysis.
 */
import * as z from 'zod/mini';
import { EvidenceRef } from './evidence.js';
import { Missing } from './missingness.js';
import { Independence, Perturbation } from './provenance.js';
import { meanIsLegal, type LevelOfMeasurement } from './measurement.js';

/** A stored datum. Typed by its (criterion, measure) declaration, not here. */
export const ScalarValue = z.union([z.number(), z.string(), z.boolean()]);
export type ScalarValue = z.infer<typeof ScalarValue>;

/**
 * One author's claim about one (alternative, criterion, measure).
 *
 * `value` and `missing` are mutually exclusive and exactly one is required: an
 * assertion that says nothing is not an assertion. That is the "no bare nulls"
 * rule at the level where it actually bites.
 */
export const Assertion = z.object({
  id: z.string(),
  authorId: z.string(),
  at: z.string(),
  value: z.optional(ScalarValue),
  missing: z.optional(Missing),
  /** One line: the "why this score". The most-read field in the document. */
  justification: z.optional(z.string()),
  evidence: z._default(z.array(EvidenceRef), []),
  /**
   * How independent this is of the other assertions in this cell. See
   * `Independence`.
   *
   * **Deliberately optional, with no default.** It defaulted to `independent`,
   * which is the *least* cautious rung on the ladder: an assertion set that
   * recorded nothing rendered as that many separate assessors, and an agreement
   * statistic over it would have been reported as inter-rater agreement. That
   * is the exact failure this field exists to prevent.
   *
   * Absent means **unknown independence**, and everything downstream treats
   * unknown as not-independent. An optimistic default is unrecoverable after
   * the fact -- once five draws of one model are stored as five raters, nothing
   * in the document says otherwise.
   */
  independence: z.optional(Independence),
  perturbation: z.optional(Perturbation),
  /** The round this belongs to, for multi-round elicitation. */
  roundId: z.optional(z.string()),
  /** The procedure that produced it, for agent runs. */
  procedureId: z.optional(z.string()),
  /** The criteria-set version this was scored against. See `Criterion`. */
  criteriaVersion: z.optional(z.string()),
  /** Optimistic-concurrency token. A write against a stale version is rejected. */
  version: z._default(z.number(), 1),
  /** Superseded assertions are retained, never deleted. */
  supersededBy: z.optional(z.string()),
});
export type Assertion = z.infer<typeof Assertion>;

/**
 * How a cell's assertions reduce to one displayed value.
 *
 * Note what is **absent**: a bare `median`. On an even number of ordinal
 * assertions the conventional median averages the two central values, which
 * produces a level no rater could have chosen and is an average of ordinal codes
 * -- exactly the category error the schema exists to prevent. `lower-median` is
 * unambiguous at every parity, and is the reduction an agent that samples
 * repeatedly should declare.
 *
 * - `single`        exactly one assertion is expected; more is a conflict.
 * - `latest`        most recent wins. Fine for view state, weak for analysis.
 * - `lower-median`  the lower of the two central order statistics. Ordinal-safe.
 * - `mode`          the most frequently asserted level. Ties are reported, not broken.
 * - `mean`          arithmetic mean. **Legal only on interval and ratio levels**;
 *                   `reduce` refuses it on ordinal rather than computing it.
 * - `consensus`     an explicitly agreed value that supersedes the rest.
 */
export const Reduction = z.enum(['single', 'latest', 'lower-median', 'mode', 'mean', 'consensus']);
export type Reduction = z.infer<typeof Reduction>;

/** One (alternative, criterion, measure) intersection. */
export const Cell = z.object({
  alternativeId: z.string(),
  criterionId: z.string(),
  measure: z.string(),
  assertions: z._default(z.array(Assertion), []),
  /** Overrides the analysis-level default for this cell only. */
  reduction: z.optional(Reduction),
  /** Set when `reduction` is `consensus`. */
  consensusAssertionId: z.optional(z.string()),
  readOnly: z.optional(z.boolean()),
});
export type Cell = z.infer<typeof Cell>;

/**
 * What a reduction produced, and how much it hid.
 *
 * `value` and `missing` are explicitly `| undefined` rather than merely optional
 * because the package builds under `exactOptionalPropertyTypes`: "absent" and
 * "present but undefined" are different things here, and a reduction genuinely
 * produces the latter.
 */
export interface Reduced {
  /** The displayed value, if the cell resolves to one. */
  value?: ScalarValue | undefined;
  /** The displayed absence, if it does not. */
  missing?: Missing | undefined;
  /** Assertions that fed the reduction (excludes superseded ones). */
  contributing: Assertion[];
  /** True when contributing assertions disagree. Often the finding itself. */
  disagreement: boolean;
  /** Distinct asserted values, in ascending order where ordered. */
  spread: ScalarValue[];
  /** Set when the reduction refused to run, with the reason. */
  refused?: string;
}

function live(assertions: readonly Assertion[]): Assertion[] {
  return assertions.filter((a) => !a.supersededBy);
}

function isNumeric(v: ScalarValue | undefined): v is number {
  return typeof v === 'number';
}

/**
 * Reduce a cell's assertions to what should be displayed.
 *
 * Refuses rather than guesses in three cases, each of which is a real failure
 * some tool ships silently:
 *
 *   - `mean` over ordinal data. Returns `refused`, not a number.
 *   - `single` with several live assertions. That is a conflict, and hiding it
 *     behind "the first one" loses an edit.
 *   - a cell whose assertions disagree about whether there *is* a value. Mixing
 *     "3" and "not-evidenced" has no defensible reduction; show both.
 */
export function reduce(
  cell: Cell,
  opts: { defaultReduction: Reduction; level?: LevelOfMeasurement },
): Reduced {
  const contributing = live(cell.assertions);
  const mode = cell.reduction ?? opts.defaultReduction;

  if (contributing.length === 0) {
    return { contributing, disagreement: false, spread: [] };
  }

  const valued = contributing.filter((a) => a.value !== undefined);
  const absent = contributing.filter((a) => a.value === undefined && a.missing);
  const spread = [...new Set(valued.map((a) => a.value as ScalarValue))].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );
  const disagreement = spread.length > 1 || (valued.length > 0 && absent.length > 0);

  if (mode === 'consensus') {
    const chosen = contributing.find((a) => a.id === cell.consensusAssertionId);
    if (!chosen) {
      return { contributing, disagreement, spread, refused: 'reduction is "consensus" but consensusAssertionId names no live assertion' };
    }
    return { value: chosen.value, missing: chosen.missing, contributing, disagreement, spread };
  }

  if (mode === 'single' && contributing.length > 1) {
    return {
      contributing, disagreement, spread,
      refused: `reduction is "single" but ${contributing.length} live assertions exist; resolve the conflict rather than hiding it`,
    };
  }

  if (valued.length > 0 && absent.length > 0) {
    return {
      contributing, disagreement: true, spread,
      refused: 'assertions disagree about whether a value exists; no reduction over a mix of values and absences is defensible',
    };
  }

  if (valued.length === 0) {
    // All absent. Show the most recent absence, which is the current answer.
    const latest = [...absent].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    return { missing: latest?.missing, contributing, disagreement, spread };
  }

  switch (mode) {
    case 'single':
    case 'latest': {
      const latest = [...valued].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
      return { value: latest.value, contributing, disagreement, spread };
    }
    case 'lower-median': {
      const nums = valued.map((a) => a.value).filter(isNumeric).sort((a, b) => a - b);
      if (nums.length !== valued.length) {
        return { contributing, disagreement, spread, refused: 'lower-median needs numeric values' };
      }
      // Lower central order statistic: index (n-1)>>1. At n=4 this is index 1,
      // i.e. the lower of the two central values -- a level a rater could have
      // chosen, which the conventional median is not.
      return { value: nums[(nums.length - 1) >> 1], contributing, disagreement, spread };
    }
    case 'mode': {
      const counts = new Map<ScalarValue, number>();
      for (const a of valued) counts.set(a.value!, (counts.get(a.value!) ?? 0) + 1);
      const top = Math.max(...counts.values());
      const winners = [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v);
      if (winners.length > 1) {
        return { contributing, disagreement: true, spread, refused: `modal value is tied between ${winners.length} levels` };
      }
      return { value: winners[0], contributing, disagreement, spread };
    }
    case 'mean': {
      if (opts.level && !meanIsLegal(opts.level)) {
        return {
          contributing, disagreement, spread,
          refused: `a mean is not legal on an ${opts.level} level; use lower-median. ` +
            'Averaging ordinal codes produces a value no rater could have chosen.',
        };
      }
      const nums = valued.map((a) => a.value).filter(isNumeric);
      if (nums.length !== valued.length) {
        return { contributing, disagreement, spread, refused: 'mean needs numeric values' };
      }
      return { value: nums.reduce((s, n) => s + n, 0) / nums.length, contributing, disagreement, spread };
    }
  }
}
