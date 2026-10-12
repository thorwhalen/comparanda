/**
 * The matrix component: a pure function of resolved props, with no
 * subscriptions, effects or timers of its own.
 *
 * Everything that lives over time -- following a source, re-rendering, tearing
 * down -- is `mountMatrix`'s, so that this stays a function a test can call and
 * a destroy has nothing in here to forget.
 *
 * The structure (#89): a real `<table>` inside a scroll container, sticky
 * column and row headers, group bands on either axis (one `<tbody>` per row
 * band, a `colgroup` header row per column band), alternatives as rows or, when
 * the view state says `transposed`, as columns. The layout itself -- order,
 * hiding, banding, orientation -- is `matrixLayout` in core. ADR-0027's grid
 * semantics (roving `tabindex`, `role="grid"`, announced measures) are the
 * accessibility epic's, on top of this; a grid role without its keyboard model
 * would promise an interaction that is not there yet, so it is not set here.
 *
 * Every cell says something: a value as its text, an absence as the
 * vocabulary's `means` (ADR-0009, ADR-0032 clause 1), a refused reduction as
 * its reason. None renders as a bare blank, and the kind of absence is also in
 * `data-state`, which the stylesheet gives a shape, not only a colour.
 *
 * Every write the view could offer is asked of `affordances` (ADR-0006 clause
 * 3). A refused one is shown, disabled, with the affordance's reason beside it.
 * An allowed one is not shown yet: the flows that perform writes (cell
 * editing, threads, suggestion mode) arrive with their own issues, and a
 * control that is present and does nothing is the failure the affordance layer
 * exists to prevent.
 */
import { useId } from 'preact/hooks';

import type { Affordance, Affordances } from '../core/affordances.js';
import { matrixLayout, type AxisLayout, type Band, type LayoutEntry } from '../core/layout.js';
import { cellIndex, cellKey, makeCellReader, type Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import { NOT_APPLICABLE, NOT_ASSESSED, type MissingnessVocabulary } from '../core/schema/missingness.js';
import { aliasesOf } from '../core/schema/structure.js';
import { isWidenedByDisclosure, type Cell, type Reduced } from '../core/schema/values.js';
import type { ViewState } from '../core/view-state.js';
import { MATRIX_CSS } from './matrix-css.js';

/** The one encoding v1 registers (ADR-0032 clause 1). #90 replaces this with the registry. */
export const TEXT_ONLY = 'text-only';

/** What the component renders from: `MatrixProps` resolved, plus the edits the source allows. */
export interface MatrixViewProps {
  analysis: Analysis;
  measure: string;
  vocabulary: MissingnessVocabulary;
  encoding: string;
  /** The reader's arrangement: order, hiding, grouping, orientation. */
  view: ViewState;
  standing?: (check: CitationCheck | undefined) => CheckStanding;
  /** `editAffordances` over the source: the only place a view may learn what it can offer. */
  affordances: Affordances;
}

/**
 * What a cell is saying, as a word a stylesheet and a test can select on.
 * `value` is a recorded value; `missing` a recorded absence; `not-applicable`
 * and `not-assessed` the two unrecorded ones, which mean opposite things about
 * whether work remains; `refused` a reduction that would not give one value.
 */
export type CellState = 'value' | 'missing' | 'not-applicable' | 'not-assessed' | 'refused';

export function Matrix({ analysis, measure, vocabulary, encoding, view, affordances }: MatrixViewProps) {
  const reader = makeCellReader(analysis, measure);
  const cells = cellIndex(analysis);
  const words = aliasesOf(analysis);
  const layout = matrixLayout(analysis, view);
  const { rows, columns, transposed } = layout;
  const groupLabel = new Map(analysis.groups.map((g) => [g.id, g.label]));
  const rowWord = transposed ? words.criterion : words.alternative;

  const cell = (rowId: string, columnId: string) => {
    const [altId, critId] = transposed ? [columnId, rowId] : [rowId, columnId];
    const { state, text } = cellContent(
      reader.read(altId, critId), cells.get(cellKey(altId, critId, measure)),
      affordances.inapplicable(altId, critId), vocabulary, critId,
    );
    return <td key={columnId} data-state={state}>{text}</td>;
  };
  const header = (e: LayoutEntry, scope: 'row' | 'col') => (
    <th scope={scope} key={e.id}>
      {e.label}
      {e.alsoIn.length > 0 && (
        <span class="comparanda-also">{` (also in ${e.alsoIn.map((g) => groupLabel.get(g) ?? g).join(', ')})`}</span>
      )}
    </th>
  );
  const row = (e: LayoutEntry) => (
    <tr key={e.id}>
      {header(e, 'row')}
      {columns.entries.map((c) => cell(e.id, c.id))}
    </tr>
  );

  return (
    <div
      class="comparanda-matrix"
      data-encoding={TEXT_ONLY}
      data-orientation={transposed ? 'transposed' : 'standard'}
    >
      <style>{MATRIX_CSS}</style>
      {encoding !== TEXT_ONLY && (
        <p class="comparanda-degraded" role="note">
          {`The "${encoding}" encoding is not available in this build; showing values as text.`}
        </p>
      )}
      <RefusedEdits analysis={analysis} measure={measure} affordances={affordances} />
      {/* Focusable so a keyboard can scroll it before the grid's own focus model arrives (#99). */}
      <div class="comparanda-scroll" role="region" aria-label={analysis.subject.question} tabIndex={0}>
        <table>
          <caption>{analysis.subject.question}</caption>
          {columns.bands && (
            <>
              <colgroup span={1} />
              {columns.bands.map((b) => <colgroup key={bandKey(b)} span={b.entries.length} />)}
            </>
          )}
          <thead>
            {columns.bands && (
              <tr class="comparanda-band">
                <th scope="col" rowSpan={2} class="comparanda-corner">{capitalise(rowWord)}</th>
                {columns.bands.map((b) => (
                  <th scope="colgroup" colSpan={b.entries.length} key={bandKey(b)}>{bandLabel(b, columns)}</th>
                ))}
              </tr>
            )}
            <tr>
              {!columns.bands && <th scope="col" class="comparanda-corner">{capitalise(rowWord)}</th>}
              {columns.entries.map((c) => header(c, 'col'))}
            </tr>
          </thead>
          {rows.bands
            ? rows.bands.map((b) => (
              <tbody key={bandKey(b)} data-group={b.groupId}>
                <tr class="comparanda-band">
                  <th scope="rowgroup" colSpan={columns.entries.length + 1}>{bandLabel(b, rows)}</th>
                </tr>
                {b.entries.map(row)}
              </tbody>
            ))
            : <tbody>{rows.entries.map(row)}</tbody>}
        </table>
      </div>
    </div>
  );
}

/**
 * The writes this view would offer, each asked of `affordances`, shown only
 * when refused and always with the reason. A write offered somewhere (one cell
 * that accepts a value) is not refused, so it is not listed.
 */
function RefusedEdits({ analysis, measure, affordances }: Pick<MatrixViewProps, 'analysis' | 'measure' | 'affordances'>) {
  const id = useId();
  const live = <T extends { tombstoned?: boolean | undefined }>(xs: readonly T[]) => xs.filter((x) => !x.tombstoned);
  const pairs = live(analysis.alternatives).flatMap((alt) =>
    live(analysis.criteria).map((crit) => [alt.id, crit.id] as const));
  const open = (analysis.suggestions ?? []).filter((s) => s.status === 'open');
  const controls: { key: string; label: string; answers: Affordance[] }[] = [
    { key: 'assert', label: 'Record a value', answers: pairs.map(([a, c]) => affordances.assert(a, c, measure)) },
    { key: 'suggest', label: 'Suggest a value', answers: pairs.map(([a, c]) => affordances.suggest(a, c, measure)) },
    { key: 'comment', label: 'Comment', answers: [affordances.comment()] },
    { key: 'revise', label: 'Revise the analysis', answers: [affordances.revise('revising the analysis')] },
    { key: 'change-lock', label: analysis.locked ? 'Unlock the analysis' : 'Lock the analysis', answers: [affordances.changeLock()] },
    {
      key: 'decide-suggestion',
      label: `Accept or decline ${open.length === 1 ? 'the open suggestion' : `the ${open.length} open suggestions`}`,
      answers: open.flatMap((s) => [affordances.decideSuggestion(s.id, 'accept'), affordances.decideSuggestion(s.id, 'decline')]),
    },
  ];
  const refused = controls
    .filter((c) => c.answers.length > 0 && c.answers.every((x) => !x.enabled))
    .map((c) => ({ ...c, reasons: [...new Set(c.answers.map((x) => x.reason ?? 'not possible here.'))] }));
  if (refused.length === 0) return null;
  return (
    <ul class="comparanda-edits" aria-label="Edits not available here">
      {refused.map((c) => (
        <li key={c.key} data-edit={c.key}>
          <button type="button" aria-disabled="true" aria-describedby={`${id}-${c.key}`}>{c.label}</button>
          {' '}
          <span class="comparanda-reason" id={`${id}-${c.key}`}>
            {c.reasons.map(capitalise).join(' ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A cell as text and the state it is in. Never empty: an absence is read through the vocabulary, a refusal states its reason. */
function cellContent(
  reduced: Reduced | undefined,
  cell: Cell | undefined,
  inapplicable: boolean,
  vocabulary: MissingnessVocabulary,
  criterionId: string,
): { state: CellState; text: string } {
  const means = (code: string) => vocabulary.means(code, criterionId) ?? code;
  if (reduced?.refused !== undefined) {
    // A reduction refused over a cell this reader sees only part of is not the
    // raters' disagreement; it is the projection's gap (ADR-0021). Say that.
    return {
      state: 'refused',
      text: cell && isWidenedByDisclosure(cell)
        ? 'Partly withheld from you; what you can see does not settle this cell.'
        : `Not shown: ${reduced.refused}`,
    };
  }
  if (reduced?.value !== undefined) return { state: 'value', text: String(reduced.value) };
  if (reduced?.missing !== undefined) {
    const code = reduced.missing.code;
    const state = code === NOT_APPLICABLE ? 'not-applicable' : code === NOT_ASSESSED ? 'not-assessed' : 'missing';
    return { state, text: means(code) };
  }
  // No value and no recorded absence: a declared block says why; otherwise nobody has looked.
  return inapplicable
    ? { state: 'not-applicable', text: means(NOT_APPLICABLE) }
    : { state: 'not-assessed', text: means(NOT_ASSESSED) };
}

function bandKey(b: Band): string {
  return b.groupId ?? '';
}

/** A band's label; the remainder is worded rather than left blank. */
function bandLabel(b: Band, axis: AxisLayout): string {
  if (b.label !== undefined) return b.label;
  const named = (axis.bands ?? []).flatMap((x) => (x.label === undefined ? [] : [x.label]));
  return named.length === 0 ? 'In none of the chosen groups' : `Not in ${named.join(' or ')}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
