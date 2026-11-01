/**
 * What the reader shows, for the analysis panels (#292): the alternatives and
 * criteria the matrix draws, in the reader's order, without the ones they hid.
 *
 * A panel lists in this order and leaves out what is hidden, so it reads in
 * step with the grid above it. Hiding is a way of reading, not a change to
 * the analysis, so a panel's figures are still computed over the whole
 * document, and the panel says so whenever it has left something out: a
 * figure that silently changed with a filter would be a different analysis
 * under the same caption.
 */
import type { Analysis } from '../core/schema/analysis.js';
import type { Aliases } from '../core/schema/structure.js';

/** The ids the reader shows, each axis in the reader's order (`matrixLayout`'s entries). */
export interface Shown {
  alternatives: readonly string[];
  criteria: readonly string[];
}

/**
 * `items` as the reader arranged them: in `order`, without the ones it does
 * not hold, and how many were left out. Absent `order` (a host that gives no
 * arrangement), every item, as given.
 */
export function inShownOrder<T>(items: readonly T[], idOf: (item: T) => string, order: readonly string[] | undefined): { listed: T[]; hidden: number } {
  if (order === undefined) return { listed: [...items], hidden: 0 };
  const rank = new Map(order.map((id, i) => [id, i]));
  const listed = items.filter((x) => rank.has(idOf(x))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  return { listed, hidden: items.length - listed.length };
}

/** How many live alternatives and criteria the reader hid: none, without an arrangement. */
export function hiddenOf(a: Pick<Analysis, 'alternatives' | 'criteria'>, shown: Shown | undefined): { alternatives: number; criteria: number } {
  const count = (xs: readonly { id: string; tombstoned?: boolean | undefined }[], order: readonly string[] | undefined) =>
    inShownOrder(xs.filter((x) => !x.tombstoned), (x) => x.id, order).hidden;
  return { alternatives: count(a.alternatives, shown?.alternatives), criteria: count(a.criteria, shown?.criteria) };
}

/**
 * The sentence a panel says when it lists less than the document holds: how
 * many of each axis the reader hid, in the analysis's own words, and, where
 * the panel computes figures over the document (`counted`), that the hidden
 * ones are still in them. Nothing when nothing is left out.
 */
export function HiddenNote({ alternatives = 0, criteria = 0, words, counted = true }: {
  alternatives?: number; criteria?: number; words: Aliases; counted?: boolean;
}) {
  const parts = [
    alternatives > 0 && `${alternatives} ${alternatives === 1 ? words.alternative : words.alternatives}`,
    criteria > 0 && `${criteria} ${criteria === 1 ? words.criterion : words.criteria}`,
  ].filter((x): x is string => typeof x === 'string');
  if (parts.length === 0) return null;
  const n = alternatives + criteria;
  return (
    <p class="comparanda-panel-hint" data-hidden-note="">
      {`Hidden in the matrix, so not listed here: ${parts.join(' and ')}.${counted ? ` ${n === 1 ? 'It is' : 'They are'} still counted in every figure.` : ''}`}
    </p>
  );
}
