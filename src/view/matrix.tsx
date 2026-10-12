/**
 * The matrix component: a pure function of resolved props, with no state, no
 * effects and no subscriptions of its own.
 *
 * Everything that lives over time -- following a source, re-rendering, tearing
 * down -- is `mountMatrix`'s, so that this stays a function a test can call and
 * a destroy has nothing in here to forget. #89 grows it into the grid (cells,
 * sticky headers, group bands, orientation) and the accessibility epic puts
 * ADR-0027's semantics on top; the shape of its props is what stays.
 *
 * Every cell says something: a value as its text, an absence as the
 * vocabulary's `means` (ADR-0009, ADR-0032 clause 1), a refused reduction as
 * its reason. None renders as a bare blank.
 */
import type { Affordances } from '../core/affordances.js';
import { makeCellReader, type Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import { NOT_APPLICABLE, NOT_ASSESSED, type MissingnessVocabulary } from '../core/schema/missingness.js';
import { aliasesOf } from '../core/schema/structure.js';
import type { Reduced } from '../core/schema/values.js';

/** The one encoding v1 registers (ADR-0032 clause 1). #90 replaces this with the registry. */
export const TEXT_ONLY = 'text-only';

/** What the component renders from: `MatrixProps` resolved, plus the edits the source allows. */
export interface MatrixViewProps {
  analysis: Analysis;
  measure: string;
  vocabulary: MissingnessVocabulary;
  encoding: string;
  standing?: (check: CitationCheck | undefined) => CheckStanding;
  /** `editAffordances` over the source: the only place a view may learn what it can offer. */
  affordances: Affordances;
}

export function Matrix({ analysis, measure, vocabulary, encoding, affordances }: MatrixViewProps) {
  const reader = makeCellReader(analysis, measure);
  const words = aliasesOf(analysis);
  return (
    <div class="comparanda-matrix" data-encoding={TEXT_ONLY}>
      {encoding !== TEXT_ONLY && (
        <p class="comparanda-degraded" role="note">
          {`The "${encoding}" encoding is not available in this build; showing values as text.`}
        </p>
      )}
      <table>
        <caption>{analysis.subject.question}</caption>
        <thead>
          <tr>
            <th scope="col">{capitalise(words.alternative)}</th>
            {analysis.criteria.map((c) => <th scope="col" key={c.id}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {analysis.alternatives.map((alt) => (
            <tr key={alt.id}>
              <th scope="row">{alt.label}</th>
              {analysis.criteria.map((c) => (
                <td key={c.id}>
                  {cellText(reader.read(alt.id, c.id), affordances.inapplicable(alt.id, c.id), vocabulary, c.id)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A cell as text. Never empty: an absence is read through the vocabulary, a refusal states its reason. */
function cellText(
  reduced: Reduced | undefined,
  inapplicable: boolean,
  vocabulary: MissingnessVocabulary,
  criterionId: string,
): string {
  const means = (code: string) => vocabulary.means(code, criterionId) ?? code;
  if (reduced?.refused !== undefined) return `Not shown: ${reduced.refused}`;
  if (reduced?.value !== undefined) return String(reduced.value);
  if (reduced?.missing !== undefined) return means(reduced.missing.code);
  // No value and no recorded absence: a declared block says why; otherwise nobody has looked.
  return means(inapplicable ? NOT_APPLICABLE : NOT_ASSESSED);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
