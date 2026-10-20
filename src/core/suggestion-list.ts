/**
 * The open suggestions, in words, for a suggestions panel to draw (#256, the
 * view half of #113): what each proposes, on what, by whom, and why.
 *
 * The proposer is named only where the round lets this viewer know who
 * proposed it (ADR-0023, judged on the proposed assertion); otherwise the
 * entry says so and carries no `proposerId`, so a view cannot offer
 * "accept all from" a person it may not name. Kept apart from
 * `suggestions.ts`, whose writes need the revision checks, so a read-only
 * page pays for the words alone.
 *
 * Headless: plain data and sentences, no DOM.
 */
import type { Analysis } from './schema/analysis.js';
import { assertionVisibility, type ViewerContext } from './schema/redaction.js';
import { attributions, type Vouched } from './identity.js';
import { describeAnchor } from './orphans.js';

export interface OpenSuggestion {
  id: string;
  /** Who proposed it, when this viewer may know; absent when a round hides it. */
  proposerId?: string | undefined;
  /** The proposer attributed, or a sentence saying the round hides them. */
  who: string;
  /** What it is on: "the cell Rent, Lisbon". */
  about: string;
  /** What it proposes: the value, or the absence and its code. */
  proposes: string;
  rationale?: string | undefined;
}

export const HIDDEN_PROPOSER = 'a participant the round does not name to you';

/** Every open suggestion, in document order. */
export function describeOpenSuggestions(
  a: Analysis, { viewer, vouched }: { viewer?: ViewerContext | undefined; vouched?: Vouched | undefined } = {},
): OpenSuggestion[] {
  const names = attributions(a.authors, { vouched });
  return a.suggestions.filter((s) => s.status === 'open').map((s) => {
    const named = !viewer || assertionVisibility(a, s.proposed, viewer).author;
    const p = s.proposed;
    return {
      id: s.id,
      ...(named ? { proposerId: s.authorId } : {}),
      who: named ? names.get(s.authorId) ?? s.authorId : HIDDEN_PROPOSER,
      about: describeAnchor(a, s.anchor, { hint: false }),
      proposes: p.value !== undefined ? String(p.value) : p.missing ? `no value (${p.missing.code})` : 'nothing recorded',
      ...(s.rationale === undefined ? {} : { rationale: s.rationale }),
    };
  });
}
