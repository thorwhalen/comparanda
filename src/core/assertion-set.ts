/**
 * What a cell's assertion set *is*, before anything draws it: how many, which
 * values, and -- the part a glyph cannot show on its own -- whose.
 *
 * ADR-0024 makes the disagreement encoding a rater dot strip whose text
 * alternative is the exact multiset ("3 raters: 2, 2, 5."), and requires that
 * five draws of one model never read as five raters: below the `independent`
 * rung the cell reads as self-consistency, not as rater disagreement. This
 * module is that requirement, headless. The view renders `reading` and reads
 * `label` aloud; it never decides either, so the dot strip, the range bracket,
 * the detail panel and any export all name the same set the same way.
 *
 * Derived, never stored (ADR-0003): everything here is computed from the
 * assertions, their `independence` rungs and the authors' principals.
 */
import type { Author, AuthorKind, Independence } from './schema/provenance.js';
import { distinctPrincipals } from './schema/provenance.js';
import type { Assertion, Cell, ScalarValue } from './schema/values.js';
import { independenceOf, liveAssertions } from './schema/values.js';

/**
 * How a set of assertions reads.
 *
 * - `single`      one live assertion, or none. Not a set; nothing to agree on.
 * - `raters`      every assertion is a separate, independent head. The only
 *                 reading under which a spread is rater disagreement.
 * - `draws`       every assertion comes from one principal: repeated draws of
 *                 one model, or one person scoring under several personas.
 *                 A spread here is self-consistency, not disagreement.
 * - `correlated`  more than one principal, but the set cannot be read as that
 *                 many independent raters: a rung below `independent`, an
 *                 unrecorded rung, a consensus verdict among them, or one
 *                 principal contributing twice.
 */
export type AssertionSetReading = 'single' | 'raters' | 'draws' | 'correlated';

export interface AssertionSetDescription {
  /** Live assertions in the set, valued or absent. */
  n: number;
  /** Every asserted value, ascending, repeats repeated: the multiset. */
  values: ScalarValue[];
  /** The missingness code of every live assertion that records an absence. */
  absences: string[];
  /** Distinct principals behind the set; two personas of one person count once. */
  principals: number;
  reading: AssertionSetReading;
  /**
   * The set's effective independence (`effectiveIndependence`, personas
   * collapsed). Absent for `single`: one assertion has nothing to be
   * independent of.
   */
  independence?: Independence | 'unknown' | undefined;
  /** For `draws`: what kind of author the one principal is. */
  sourceKind?: AuthorKind | undefined;
  /**
   * The text alternative: the count, what the assertions are, then the
   * multiset in full. Never a range, a mode or "mixed".
   */
  label: string;
}

/**
 * Describe a cell's live assertion set for display.
 *
 * `levels` is the criterion's declared level order (`Measurement.levels`), used
 * to sort the multiset; without it, numbers sort numerically and anything else
 * by its text.
 *
 * `means` reads a missingness code as its declaration's one-line meaning, so
 * the label -- which the detail panel reads aloud -- says what an absence means
 * rather than its code (#209). `absences` keeps the raw codes, for machines.
 * Without it, or for a code it cannot read, the label names the code.
 */
export function describeAssertionSet(
  cell: Pick<Cell, 'assertions'>,
  {
    authors,
    levels,
    means,
  }: {
    authors: readonly Pick<Author, 'id' | 'kind' | 'principalId'>[];
    levels?: readonly ScalarValue[] | undefined;
    means?: ((code: string) => string | undefined) | undefined;
  },
): AssertionSetDescription {
  const set = liveAssertions(cell.assertions);
  const values = sortedValues(set, levels);
  const absences = set.flatMap((a) => (a.value === undefined && a.missing ? [a.missing.code] : []));
  const principals = distinctPrincipals(set, authors);
  const n = set.length;
  const tail = multisetText(values, absences, means);

  if (n < 2) {
    return { n, values, absences, principals, reading: 'single', label: `${n} assertion${n === 1 ? '' : 's'}${tail}` };
  }

  const independence = independenceOf(set, authors)!;
  if (principals === 1) {
    const sourceKind = kindOf(set[0]!, authors);
    return {
      n, values, absences, principals, reading: 'draws', independence: independence.weakest, sourceKind,
      label: `${drawsPhrase(n, sourceKind)}${tail}`,
    };
  }
  if (!independence.flagged) {
    return {
      n, values, absences, principals, reading: 'raters', independence: independence.weakest,
      label: `${n} raters${tail}`,
    };
  }
  return {
    n, values, absences, principals, reading: 'correlated', independence: independence.weakest,
    label: `${correlatedPhrase(n, set, independence.weakest, principals)}${tail}`,
  };
}

function kindOf(
  a: Assertion,
  authors: readonly Pick<Author, 'id' | 'kind' | 'principalId'>[],
): AuthorKind | undefined {
  const author = authors.find((x) => x.id === a.authorId);
  if (!author) return undefined;
  // A persona's kind is its principal's: ADR-0012 forbids a persona changing it.
  const principal = author.principalId ? authors.find((x) => x.id === author.principalId) : undefined;
  return (principal ?? author).kind;
}

function drawsPhrase(n: number, kind: AuthorKind | undefined): string {
  if (kind === 'agent') return `${n} draws of one model`;
  if (kind === 'human') return `${n} assertions by one person`;
  return `${n} assertions from one source`;
}

function correlatedPhrase(
  n: number,
  set: readonly Assertion[],
  weakest: Independence | 'unknown',
  principals: number,
): string {
  if (weakest === 'unknown') return `${n} assertions, independence not recorded`;
  if (set.some((a) => a.independence === 'consensus')) return `${n} assertions, one a consensus verdict`;
  // Checked before the rung: collapsing a repeated principal is what lowered it,
  // and "from 2 sources" says why where "(resampled)" would not.
  if (principals < n) return `${n} assertions from ${principals} sources`;
  return `${n} assertions, not independent (${weakest})`;
}

function multisetText(
  values: readonly ScalarValue[], absences: readonly string[], means: ((code: string) => string | undefined) | undefined,
): string {
  const parts = [values.map(String).join(', '), absences.length ? `${absences.length} absent (${absenceWords(absences, means)})` : '']
    .filter(Boolean);
  return parts.length ? `: ${parts.join('; ')}.` : '.';
}

/** The codes as they are read: raw, or -- given `means` -- each distinct meaning once, quoted, with its count. */
function absenceWords(absences: readonly string[], means: ((code: string) => string | undefined) | undefined): string {
  if (!means) return absences.join(', ');
  const counts = new Map<string, number>();
  for (const code of absences) {
    const words = means(code)?.trim().replace(/\.$/, '');
    const said = words ? `“${words}”` : code;
    counts.set(said, (counts.get(said) ?? 0) + 1);
  }
  return [...counts].map(([said, k]) => (k > 1 ? `${said} ×${k}` : said)).join(', ');
}

function sortedValues(set: readonly Assertion[], levels: readonly ScalarValue[] | undefined): ScalarValue[] {
  const vals = set.flatMap((a) => (a.value === undefined ? [] : [a.value]));
  if (levels && levels.length) {
    const rank = new Map(levels.map((l, i) => [l, i]));
    // An undeclared value sorts after every declared one rather than vanishing:
    // the text alternative is the multiset in full, or it is not the multiset.
    return vals.sort((x, y) => (rank.get(x) ?? levels.length) - (rank.get(y) ?? levels.length));
  }
  return vals.sort((x, y) =>
    typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
}
