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
import {
  Independence, Perturbation, effectiveIndependence, weakestIndependence,
} from './provenance.js';
import { meanIsLegal, type LevelOfMeasurement } from './measurement.js';
import {
  declarationFields, resolveDeclaration, degradationOf,
  type Degradation, type Resolution,
} from './declarations.js';

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
export const CoreReduction = z.enum(['single', 'latest', 'lower-median', 'mode', 'mean', 'consensus']);
export type CoreReduction = z.infer<typeof CoreReduction>;

/**
 * What a reduction does, as facts a consumer can check without knowing which
 * reduction it is.
 */
export interface ReductionFacts {
  /** One line, shown to a reader whose build could not run this reduction. */
  means: string;
  /**
   * True when the reduction can produce a value **nobody asserted**.
   *
   * A mean can. `lower-median` deliberately cannot -- that is the entire reason
   * it exists in place of a bare median, which averages the two central values
   * at even parity and invents a level no rater could have chosen.
   *
   * Arithmetic reductions are illegal on nominal and ordinal levels. Stating it
   * as a *fact about the reduction* rather than a special case for `mean` is
   * what makes the rule survive extension: a declared `trimmed-mean` naming
   * `mean` as its parent inherits the refusal without anyone remembering to add
   * it.
   */
  arithmetic: boolean;
}

export const CORE_REDUCTIONS: Readonly<Record<CoreReduction, ReductionFacts>> = Object.freeze({
  single: { means: 'Exactly one assertion is expected; more is a conflict.', arithmetic: false },
  latest: { means: 'The most recent assertion wins.', arithmetic: false },
  'lower-median': { means: 'The lower of the two central order statistics.', arithmetic: false },
  mode: { means: 'The most frequently asserted level; ties are reported, not broken.', arithmetic: false },
  mean: { means: 'The arithmetic mean.', arithmetic: true },
  consensus: { means: 'An explicitly agreed value that supersedes the rest.', arithmetic: false },
});

/**
 * A reduction a deployment defines, named in the document so a foreign reader
 * knows what it was asked to compute.
 */
export const ReductionDeclaration = z.object(declarationFields(CoreReduction));
export type ReductionDeclaration = z.infer<typeof ReductionDeclaration>;

/**
 * A reduction name: a core member, or a declared extension.
 *
 * Open at the point of use, exactly like a missingness code.
 */
export const Reduction = z.string();
export type Reduction = string;

/**
 * Resolve a reduction name through the one resolver.
 *
 * **A declared reduction this build cannot run is never substituted, and this is
 * a deliberate departure from how missingness degrades.** The `broader` contract
 * says "fall back to the parent", and for a *classification* that is safe: a
 * paywalled blank classified as its parent is still correctly a terminal,
 * non-informative absence, and nothing about the analysis changes.
 *
 * A reduction is not a classification. It is a computation whose output is a
 * number a reader will act on. Running a mean where the author asked for a
 * trimmed mean produces a different number, presents it as the author's, and
 * discloses the substitution only in a degradation record beside the document --
 * which is precisely the "plausible number instead of an honest blank" this
 * package exists to refuse.
 *
 * So `reduce` refuses on a reduction it cannot run, and says which one and why.
 * `Reduced.refused` already exists and is already rendered; a refusal costs a
 * reader one sentence and costs them nothing false.
 */
export function resolveReduction(
  name: string,
  declarations: readonly ReductionDeclaration[] = [],
): Resolution<ReductionFacts> {
  return resolveDeclaration<ReductionFacts>(
    name,
    CORE_REDUCTIONS,
    declarations as readonly { id: string; broader: string; means: string }[],
    // v1 implements no reduction beyond the core six, so every declared
    // extension resolves as `degraded` -- which `reduce` turns into a refusal
    // rather than a substitution. Implementing one later means returning facts
    // here and adding one branch to the switch; no call site changes.
    () => undefined,
  );
}

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
  /**
   * How independent the contributing assertions are, when there are two or
   * more of them (#76, #64). Absent for zero or one: a single assertion is not
   * a set, and there is nothing to be independent of.
   *
   * `flagged` is true unless every contributing assertion records
   * `independent` (and, when `authors` were passed to `reduce`, no principal
   * contributes twice). An unrecorded rung counts as unknown, never as
   * independent -- the same cautious reading `weakestIndependence` takes.
   * The value is still computed: the flag qualifies it, it does not withhold it.
   */
  independence?: ReductionIndependence | undefined;
}

/** See `Reduced.independence`. */
export interface ReductionIndependence {
  /** The weakest rung among the contributing assertions, or `unknown`. */
  weakest: Independence | 'unknown';
  /** True when the set cannot be read as that many independent raters. */
  flagged: boolean;
  /** Why it was flagged, in words a reader can act on. Set only when flagged. */
  reason?: string | undefined;
}

/**
 * The independence reading of a multi-assertion set, for `reduce`.
 *
 * Uses `effectiveIndependence` when the authors are known, so two personas of
 * one principal cannot pass as two raters; otherwise the recorded rungs alone.
 */
function independenceOf(
  contributing: readonly Assertion[],
  authors: readonly { id: string; principalId?: string | undefined }[] | undefined,
): ReductionIndependence | undefined {
  if (contributing.length < 2) return undefined;
  const weakest = authors
    ? effectiveIndependence(contributing, authors)
    : weakestIndependence(contributing);
  if (weakest === 'independent') return { weakest, flagged: false };
  const n = contributing.length;
  const reason = weakest === 'unknown'
    ? `${n} assertions, and at least one records no independence; unknown is not independent, ` +
      `so these cannot be read as ${n} raters.`
    : `${n} assertions, the weakest at "${weakest}"; these are not ${n} independent raters, and ` +
      'any spread or agreement across them overstates how many heads produced it.';
  return { weakest, flagged: true, reason };
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
  opts: {
    /**
     * The document's authors. When given, personas that share a principal are
     * collapsed before judging independence (see `effectiveIndependence`).
     */
    authors?: readonly { id: string; principalId?: string | undefined }[];
    defaultReduction: Reduction;
    level?: LevelOfMeasurement;
    /** The document's reduction declarations, for resolving a non-core name. */
    reductions?: readonly ReductionDeclaration[];
    /** Appended to when the reduction name could not be resolved. */
    degradations?: Degradation[];
  },
): Reduced {
  const reduced = reduceValue(cell, opts);
  const independence = independenceOf(reduced.contributing, opts.authors);
  return independence ? { ...reduced, independence } : reduced;
}

/** `reduce` without the independence reading; the value logic, unchanged. */
function reduceValue(
  cell: Cell,
  opts: Parameters<typeof reduce>[1],
): Reduced {
  const contributing = live(cell.assertions);
  const named = cell.reduction ?? opts.defaultReduction;

  const resolved = resolveReduction(named, opts.reductions ?? []);
  if (opts.degradations) {
    const d = degradationOf(resolved, 'reduction', `cells.${cell.alternativeId}/${cell.criterionId}.reduction`);
    if (d) opts.degradations.push(d);
  }

  if (contributing.length === 0) {
    return { contributing, disagreement: false, spread: [] };
  }

  if (!resolved.known) {
    return {
      contributing,
      disagreement: false,
      spread: [],
      refused:
        resolved.source === 'degraded'
          ? `this build cannot compute the reduction "${named}" (${resolved.because}). ` +
            `Running its parent "${resolved.broader}" instead would produce a different number and ` +
            'present it as the author\'s, so nothing is shown.'
          : `unknown reduction "${named}", and the document declares no such name`,
    };
  }

  // Past this point the name resolved to a core algorithm.
  const mode = named as CoreReduction;

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

  // The arithmetic rule, stated once over the reduction's facts rather than as a
  // case for `mean`. A declared reduction that inherits `arithmetic: true` is
  // refused here without anyone having remembered to add it.
  if (resolved.facts.arithmetic && opts.level && !meanIsLegal(opts.level)) {
    return {
      contributing, disagreement, spread,
      refused: `"${named}" produces a value nobody asserted, which is not legal on an ` +
        `${opts.level} level; use lower-median. Averaging ordinal codes produces a value no ` +
        'rater could have chosen.',
    };
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
      const nums = valued.map((a) => a.value).filter(isNumeric);
      if (nums.length !== valued.length) {
        return { contributing, disagreement, spread, refused: 'mean needs numeric values' };
      }
      return { value: nums.reduce((s, n) => s + n, 0) / nums.length, contributing, disagreement, spread };
    }
  }
}
