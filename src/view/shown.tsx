/**
 * The sentence an analysis panel says when it lists less than the document
 * holds (#292). Panels list what the matrix shows, in the reader's order
 * (`inShownOrder` and `hiddenOf` in core's layout); hiding is a way of reading,
 * not a change to the analysis, so where a panel computes figures they are
 * still over the whole document, and the note says so.
 */
import type { Aliases } from '../core/schema/structure.js';

/**
 * How many of each axis the reader hid, in the analysis's own words, and,
 * where the panel computes figures over the document (`counted`), that hiding
 * changed none of them. Nothing when nothing is left out.
 */
export function HiddenNote({ alternatives = 0, criteria = 0, words, counted = true }: {
  alternatives?: number; criteria?: number; words: Aliases; counted?: boolean;
}) {
  const parts = [
    alternatives > 0 && `${alternatives} ${alternatives === 1 ? words.alternative : words.alternatives}`,
    criteria > 0 && `${criteria} ${criteria === 1 ? words.criterion : words.criteria}`,
  ].filter((x): x is string => typeof x === 'string');
  if (parts.length === 0) return null;
  return (
    <p class="comparanda-panel-hint" data-hidden-note="">
      {`Hidden in the matrix, so not listed here: ${parts.join(' and ')}.${counted ? ' Hiding them changes none of the figures.' : ''}`}
    </p>
  );
}
