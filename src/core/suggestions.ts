/**
 * Suggestion mode's writes (#113, ADR-0011 point 5): accept or decline a
 * proposal, one at a time or in bulk.
 *
 * A reviewer without write access, or facing a locked analysis, proposes an
 * assertion instead of writing it (`Suggestion`). Nothing here applies a
 * proposal unless a caller asks for that one by id: accepting writes its
 * assertion into its cell, as its proposer's, and records who decided and
 * when; declining records only the decision. Either way the suggestion stays,
 * because what was proposed and what became of it is the record.
 *
 * **Bulk decisions are individually undoable** before anything is written:
 * `decideSuggestions` returns one step per decision, each the document after
 * it and every one before it, so a caller undoes the last *k* by keeping
 * `steps[n - k - 1]` (or the input, for all of them). Once written, a decision
 * stands (`annotationHistoryProblems` refuses re-deciding), as a decision should.
 *
 * The document's refusals are the affordance layer's reasons (`decideSuggestion`),
 * so a button and the write it makes cannot disagree; an accepted write is also
 * held to `revisionProblems`, the check the store runs, so what is staged here
 * is never refused later (an off-scale value, a second assertion without its
 * `independence`). Whether the *host* lets this
 * person decide is `authorize`'s, asked by whoever calls this. Ids and times are
 * the caller's; core mints nothing and owns no clock.
 */
import type { Analysis } from './schema/analysis.js';
import type { Author } from './schema/provenance.js';
import { makeAffordances, type SuggestionDecision } from './affordances.js';
import { withAuthor } from './author-record.js';
import { revisionProblems } from './revision.js';

/** Who decides, when, and optionally why. */
export interface SuggestionDecider {
  by: Author;
  at: string;
  note?: string;
}

/** Accept or decline one open suggestion. Throws, with the reason, when the document refuses it. */
export function decideSuggestion(
  a: Analysis, suggestionId: string, decision: SuggestionDecision, { by, at, note }: SuggestionDecider,
): Analysis {
  const may = makeAffordances(a).decideSuggestion(suggestionId, decision);
  if (!may.enabled) throw new Error(`suggestion "${suggestionId}" cannot be ${decision === 'accept' ? 'accepted' : 'declined'}: ${may.reason}`);
  const s = a.suggestions.find((x) => x.id === suggestionId)!;
  if (decision === 'accept' && s.proposed.authorId !== s.authorId) {
    throw new Error(`suggestion "${suggestionId}" was made by "${s.authorId}" but proposes an assertion by "${s.proposed.authorId}"; accepting it would write under someone else's name.`);
  }
  const decided = withAuthor(a, by);
  const suggestions = decided.suggestions.map((x) => (x === s
    ? { ...x, status: decision === 'accept' ? 'accepted' as const : 'declined' as const, decidedBy: by.id, decidedAt: at, ...(note === undefined ? {} : { decisionNote: note }) }
    : x));
  if (decision === 'decline') return { ...decided, suggestions };
  // The affordance checked the anchor names a cell and its measure.
  const { alternativeId, criterionId, measure } = s.anchor as Required<Pick<typeof s.anchor, 'alternativeId' | 'criterionId' | 'measure'>>;
  const index = decided.cells.findIndex((c) => c.alternativeId === alternativeId && c.criterionId === criterionId && c.measure === measure);
  const cell = index < 0 ? { alternativeId, criterionId, measure, assertions: [] } : decided.cells[index]!;
  if (cell.assertions.some((x) => x.id === s.proposed.id)) {
    throw new Error(`the cell already holds an assertion "${s.proposed.id}"; accepting suggestion "${suggestionId}" would write a second one under that id.`);
  }
  const written = { ...cell, assertions: [...cell.assertions, s.proposed] };
  const cells = index < 0 ? [...decided.cells, written] : decided.cells.map((c, i) => (i === index ? written : c));
  const result = { ...decided, cells: cells as Analysis['cells'], suggestions };
  // The store would refuse it anyway; refusing here says so before anything is staged.
  const problems = revisionProblems(a, result);
  if (problems.length > 0) {
    throw new Error(`accepting suggestion "${suggestionId}" would write what the document refuses: ${problems.map((p) => p.message).join('; ')}`);
  }
  return result;
}

/** One decision of a bulk action, and the document as it stands after it. */
export interface SuggestionStep {
  suggestionId: string;
  decision: SuggestionDecision;
  analysis: Analysis;
}

/**
 * Decide several suggestions in order, each on the document the one before it
 * left. Stops at the first refusal and throws, naming it and how many were
 * decided before it, so no bulk action is partly and silently applied.
 */
export function decideSuggestions(
  a: Analysis, decisions: readonly { suggestionId: string; decision: SuggestionDecision }[], decider: SuggestionDecider,
): { analysis: Analysis; steps: SuggestionStep[] } {
  const steps: SuggestionStep[] = [];
  let doc = a;
  for (const { suggestionId, decision } of decisions) {
    try {
      doc = decideSuggestion(doc, suggestionId, decision, decider);
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)} (after ${steps.length} of ${decisions.length} decided; nothing was written).`);
    }
    steps.push({ suggestionId, decision, analysis: doc });
  }
  return { analysis: doc, steps };
}

/** The open suggestions one person proposed: what "accept all from …" acts on. */
export function openSuggestionsBy(a: Analysis, authorId: string): string[] {
  return a.suggestions.filter((s) => s.status === 'open' && s.authorId === authorId).map((s) => s.id);
}
