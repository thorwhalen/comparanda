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
  Independence, Perturbation, effectiveIndependence,
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
 * Who may see an assertion is not the same fact as whether it exists (ADR-0021).
 *
 * Presence lives in `value` / `missing`; disclosure lives here, beside it, the
 * way SDMX keeps confidentiality status beside observation status. Redaction is
 * therefore a **projection** (`projectForReader`), never an edit: the owner's
 * document and a reviewer's are the same document under two projections.
 *
 * `comparanda` invents no permission model. `label` is the host's own
 * classification, opaque here, and the host's disclosure decision is supplied at
 * projection time; the schema only carries what the decision needs and what the
 * projection leaves behind.
 */
export const Disclosure = z.strictObject({
  /** The host's confidentiality label for this assertion, e.g. "confidential". Opaque here. */
  label: z.optional(z.string()),
  /**
   * Set by `projectForReader`, never by an author: this assertion's content was
   * projected out for the reader of this document. Its value, justification and
   * evidence are gone and it carries the `withheld` missingness code; this flag
   * is what lets every analysis over the projection count the cells it widened.
   *
   * It is **not** a request to withhold -- that is the host's decision, passed
   * to the projection. `validateAnalysis` rejects it on an assertion that still
   * carries a value, a justification or evidence, and the projection ignores it
   * on one (rule `disclosure-flag-is-projection-only`).
   */
  withheldFromReader: z.optional(z.boolean()),
});
export type Disclosure = z.infer<typeof Disclosure>;

/**
 * One author's claim about one (alternative, criterion, measure).
 *
 * `value` and `missing` are mutually exclusive and exactly one is required: an
 * assertion that says nothing is not an assertion. That is the "no bare nulls"
 * rule at the level where it actually bites.
 */
export const Assertion = z.strictObject({
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
  /**
   * The id of the assertion in this cell that replaced this one. Superseded
   * assertions are retained, never deleted. Non-empty: an empty string would be
   * read as live by every `if (s.supersededBy)` and as a reference by the
   * validator (#165).
   */
  supersededBy: z.optional(z.string().check(z.minLength(1))),
  /** Disclosure, orthogonal to presence. Absent means no restriction declared. See `Disclosure`. */
  disclosure: z.optional(Disclosure),
});
export type Assertion = z.infer<typeof Assertion>;

/**
 * Whether a disclosure projection widened this cell for its reader: some live
 * assertion in it was projected out (ADR-0021).
 *
 * Reads the flag the projection writes, never the `withheld` code: an author may
 * legitimately store `withheld` when nobody may store the value, and that cell
 * was not widened by *this reader's* access.
 */
export function isWidenedByDisclosure(cell: { assertions: readonly Assertion[] }): boolean {
  return cell.assertions.some((s) => !s.supersededBy && isWithheldFromReader(s));
}

function arithmeticRefusal(named: string, level: LevelOfMeasurement): string {
  return `"${named}" produces a value nobody asserted, which is not legal on an ` +
    `${level} level; use lower-median. Averaging ordinal codes produces a value no ` +
    'rater could have chosen.';
}

/**
 * Whether this reader is missing an assertion's value: flagged by a
 * projection, and holding no value. The definition `reduce`,
 * `isWidenedByDisclosure` and completeness read (#171).
 *
 * Deliberately looser than `isProjectedOut`: a flagged, valueless assertion
 * that kept a note or evidence (a hand-rolled projection, an invalid document)
 * still hides a value from this reader, and reading it as an authored absence
 * would turn the gap into a disagreement. A flagged assertion that still
 * holds its value hides nothing, and is visible data.
 *
 * Assumes what `projectForReader` guarantees: only a *value* is ever withheld
 * (an absence keeps its own code and is not flagged), so a withheld assertion
 * stands for a value. A host projector that flags a withheld absence breaks
 * that, and `reduce`'s `latest` exception and completeness would over-read it.
 */
export function isWithheldFromReader(s: Assertion): boolean {
  return s.disclosure?.withheldFromReader === true && s.value === undefined;
}

/**
 * Whether an assertion is already the *output* of a projection: flagged, and
 * carrying nothing but its identity and an absence. What `projectForReader`
 * passes through untouched; anything less empty it projects again.
 *
 * The flag alone is not enough. A producer that sets `withheldFromReader` on an
 * assertion with its value still in it -- the field name reads like a request --
 * would otherwise be passed through with the value intact. (Review finding.)
 */
export function isProjectedOut(s: Assertion): boolean {
  // Not keyed on the `withheld` code itself: core never branches on a reason
  // code (#44). Emptiness is the property that matters.
  return s.disclosure?.withheldFromReader === true && s.value === undefined && s.missing !== undefined &&
    !s.missing.note && !s.justification?.trim() && s.evidence.length === 0;
}

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
export const ReductionDeclaration = z.strictObject(declarationFields(CoreReduction));
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

/**
 * One (alternative, criterion, measure) intersection.
 *
 * Every claim lives on an **assertion**, so a second rater costs a second
 * assertion and nothing else (#45). The three fields below are the only ones at
 * cell level, and each is here because it is *about the set* of assertions, not
 * any one of them.
 */
export const Cell = z.strictObject({
  alternativeId: z.string(),
  criterionId: z.string(),
  measure: z.string(),
  assertions: z._default(z.array(Assertion), []),
  /**
   * Overrides the analysis-level default for this cell only. Cell-level because
   * a reduction is a policy *over* the assertions; stored as a named policy,
   * never as its result.
   */
  reduction: z.optional(Reduction),
  /**
   * Set when `reduction` is `consensus`: which assertion the panel agreed is the
   * cell's answer. A pointer into the set, so it cannot live inside one member.
   */
  consensusAssertionId: z.optional(z.string()),
  /**
   * A policy declaration about the cell ("this cell is read-only"), which the
   * schema-change rules place in the schema rather than in an adapter. It
   * constrains edits to the whole set, so it is not per assertion.
   */
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
  /** True when contributing assertions this reader can see disagree. Often the finding itself. */
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
  /**
   * How many contributing assertions a disclosure projection withheld from
   * this reader (ADR-0021), when any were. A withheld assertion is not a
   * recorded absence: it takes no part in `disagreement` or `spread`, and a
   * reduction over the rest is refused rather than shown as the cell's value,
   * because an aggregate over part of a cell is never returned bare.
   */
  withheldFromReader?: number | undefined;
  /**
   * Why `refused` was set, where a consumer must tell it apart from a conflict:
   * `withheld-from-reader` when the reduction was refused only because part of
   * the cell is withheld from this reader. Absent for every other refusal.
   */
  refusedBecause?: 'withheld-from-reader' | undefined;
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
 * The independence reading of a multi-assertion set: what `reduce` attaches as
 * `Reduced.independence`, and what `describeAssertionSet` labels by.
 *
 * Always uses `effectiveIndependence`, so two personas of one principal (or
 * two assertions under one author id, when no authors are passed) cannot pass
 * as two raters. Flagged unless every member records `independent`. Pass the
 * live set (`liveAssertions`); a superseded assertion is history, not a rater.
 */
export function independenceOf(
  contributing: readonly Assertion[],
  authors: readonly { id: string; principalId?: string | undefined }[] | undefined,
): ReductionIndependence | undefined {
  if (contributing.length < 2) return undefined;
  // Always collapse personas. Without `authors`, two assertions under one
  // author id still collapse (an unknown author is its own principal); the
  // less cautious reading is never the default.
  const weakest = effectiveIndependence(contributing, authors ?? []);
  const n = contributing.length;
  // `consensus` ranks above `independent` on the ladder, so a mixed set's
  // weakest rung can read `independent` while one member is a group verdict,
  // not a rater. Flag on every member, not on the weakest rung alone.
  const consensus = contributing.some((a) => a.independence === 'consensus');
  if (weakest === 'independent' && !consensus) return { weakest, flagged: false };
  const reason = weakest === 'unknown'
    ? `${n} assertions, and at least one records no independence; unknown is not independent, ` +
      `so these cannot be read as ${n} raters.`
    : weakest === 'independent' || weakest === 'consensus'
      ? `${n} assertions, and at least one is a consensus verdict; a group's agreed answer is not ` +
        'one more independent rater.'
      : `${n} assertions, the weakest at "${weakest}"; these are not ${n} independent raters, and ` +
        'any spread or agreement across them overstates how many heads produced it.';
  return { weakest, flagged: true, reason };
}

/**
 * The assertions a cell currently holds: everything not superseded.
 *
 * The one definition of "the set" that the reduction, the independence reading
 * and the honesty rule on unrecorded independence all count over, so that none
 * of them can disagree with the others about how many assertions a cell has.
 */
export function liveAssertions(assertions: readonly Assertion[]): Assertion[] {
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
  const withheld = reduced.contributing.filter(isWithheldFromReader).length;
  return {
    ...reduced,
    ...(independence ? { independence } : {}),
    ...(withheld > 0 ? { withheldFromReader: withheld } : {}),
  };
}


/** `reduce` without the independence reading; the value logic, unchanged. */
function reduceValue(
  cell: Cell,
  opts: Parameters<typeof reduce>[1],
): Reduced {
  const contributing = liveAssertions(cell.assertions);
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

  // What this reader can see. A withheld assertion is the projection's gap, not
  // an author's recorded absence, so it never counts as one (#171).
  const visible = contributing.filter((a) => !isWithheldFromReader(a));
  const valued = visible.filter((a) => a.value !== undefined);
  const absent = visible.filter((a) => a.value === undefined && a.missing);
  const spread = [...new Set(valued.map((a) => a.value as ScalarValue))].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );
  const disagreement = spread.length > 1 || (valued.length > 0 && absent.length > 0);

  if (mode === 'consensus') {
    // The owner's recorded choice, not an aggregate: shown even when other
    // assertions are withheld from this reader, and `withheldFromReader` says so.
    const chosen = contributing.find((a) => a.id === cell.consensusAssertionId);
    if (!chosen) {
      return { contributing, disagreement, spread, refused: 'reduction is "consensus" but consensusAssertionId names no live assertion' };
    }
    return { value: chosen.value, missing: chosen.missing, contributing, disagreement, spread };
  }

  // Conflicts the reader can see are conflicts whatever else is withheld, and
  // they are the owner's too: say that, not that something is hidden. A
  // projection keeps every assertion's identity, so "more than one live
  // assertion" under `single` is visible even when their values are not.
  if (mode === 'single' && contributing.length > 1) {
    return {
      contributing, disagreement, spread,
      refused: `reduction is "single" but ${contributing.length} live assertions exist; resolve the conflict rather than hiding it`,
    };
  }
  // A withheld assertion always stands for a value (`isWithheldFromReader`),
  // so a visible absence beside one is a mix the owner sees too.
  const withheld = contributing.filter(isWithheldFromReader);
  if ((valued.length > 0 || withheld.length > 0) && absent.length > 0) {
    return {
      contributing, disagreement: true, spread,
      refused: 'assertions disagree about whether a value exists; no reduction over a mix of values and absences is defensible',
    };
  }

  // Refusals that depend only on the level or on the values the reader can
  // see are the owner's too, so they are reported as themselves.
  const arithmeticIllegal = resolved.facts.arithmetic && opts.level !== undefined && !meanIsLegal(opts.level);
  if (arithmeticIllegal && valued.length > 0) {
    return { contributing, disagreement, spread, refused: arithmeticRefusal(named, opts.level!) };
  }
  if ((mode === 'lower-median' || mode === 'mean') && valued.some((a) => !isNumeric(a.value))) {
    return { contributing, disagreement, spread, refused: `${mode} needs numeric values` };
  }

  // Some withheld, some visible: a reduction over the visible ones would
  // present part of the cell as all of it (ADR-0021: aggregates over partially
  // disclosed data are labelled or suppressed, never returned bare). One
  // exception is provable: `latest`, when the newest assertion is one the
  // reader can see and holds a value. A projection keeps every `at`, and only
  // ever withholds values, so the owner's `latest` is that same assertion.
  if (withheld.length > 0 && visible.length > 0) {
    if (mode === 'latest' && absent.length === 0) {
      const newest = [...valued].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
      if (withheld.every((w) => w.at.localeCompare(newest.at) < 0)) {
        return { value: newest.value, contributing, disagreement, spread };
      }
    }
    return {
      contributing, disagreement, spread,
      refusedBecause: 'withheld-from-reader',
      refused: `${withheld.length} of ${contributing.length} assertions in this cell ${withheld.length === 1 ? 'is' : 'are'} withheld from you; ` +
        `a "${named}" over the ${visible.length} you can see would present part of the cell as all of it, so nothing is shown`,
    };
  }

  if (valued.length === 0) {
    // All absent, or all withheld from this reader. Show the most recent
    // absence, which is the current answer; when every assertion is withheld,
    // that is the projection's `withheld`, which is what this reader can know.
    const latest = [...(visible.length > 0 ? absent : contributing)].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    return { missing: latest?.missing, contributing, disagreement, spread };
  }

  // The arithmetic rule, stated once over the reduction's facts rather than as a
  // case for `mean`. A declared reduction that inherits `arithmetic: true` is
  // refused here without anyone having remembered to add it.
  if (arithmeticIllegal) {
    return { contributing, disagreement, spread, refused: arithmeticRefusal(named, opts.level!) };
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
