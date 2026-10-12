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
 * hiding, banding, orientation -- is `matrixLayout` in core.
 *
 * The grid (#99, ADR-0027): the real `<table>` carries `role="grid"`, and the
 * whole matrix is one tab stop. Navigation is a roving `tabindex` (never
 * `aria-activedescendant`) over a logical grid of the header row, the header
 * column and the cells; group bands are labels, not stops. The position is the
 * view state's `session.focus`, by id, so a reorder or a transpose keeps the
 * cursor on the same cell and a reload lands where the reader left. This
 * component only reports where focus went (`onFocusChange`); `mountMatrix`
 * keeps it and re-renders, so this stays pure. Each cell announces its measures
 * through visually-hidden text inside it, never an `aria-label`, so a screen
 * reader says what a sighted colleague reads, plus the context they can see.
 *
 * No virtualisation: ADR-0002 caps an analysis at tens to low hundreds of
 * alternatives. The trigger to revisit is roughly 500 rows (ADR-0027), and the
 * one rule if it ever comes is that DOM order stays visual order.
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
import { makeCellReader, unknownMeasure, type Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import type { Measurement } from '../core/schema/measurement.js';
import { NOT_APPLICABLE, NOT_ASSESSED, type MissingnessVocabulary } from '../core/schema/missingness.js';
import { aliasesOf } from '../core/schema/structure.js';
import type { Reduced } from '../core/schema/values.js';
import type { Session, ViewState } from '../core/view-state.js';
import { textOnly } from './encodings/shipped.js';
import {
  describeTexture, type EncodingDefinition, type EncodingRegistry, type Legend as LegendData, type PreparedEncoding,
} from './encodings/registry.js';
import { MATRIX_CSS } from './matrix-css.js';

/** The default encoding, and the fallback when the chosen one cannot draw (ADR-0032 clause 1). */
export const TEXT_ONLY = textOnly.id;

/** What the component renders from: `MatrixProps` resolved, plus the edits the source allows. */
export interface MatrixViewProps {
  analysis: Analysis;
  measure: string;
  vocabulary: MissingnessVocabulary;
  /** The chosen encoding's id, looked up in `encodings`. */
  encoding: string;
  /** The encodings this view was composed with (ADR-0010 clause 8). */
  encodings: EncodingRegistry;
  /** The reader's arrangement: order, hiding, grouping, orientation. */
  view: ViewState;
  standing?: (check: CitationCheck | undefined) => CheckStanding;
  /** `editAffordances` over the source: the only place a view may learn what it can offer. */
  affordances: Affordances;
  /**
   * Focus moved to another grid position (by id; `undefined` is the corner).
   * The roving `tabindex` follows `view.session.focus`, so whoever renders this
   * moves it there; without this, focus moves and the tab stop stays put.
   */
  onFocusChange?: (focus: Session['focus']) => void;
}

/** The measure a cell's announcement adds beside the shown one, when the analysis has it. */
const CONFIDENCE = 'confidence';

/**
 * What a cell is saying, as a word a stylesheet and a test can select on.
 * `value` is a recorded value; `missing` a recorded absence; `not-applicable`
 * and `not-assessed` the two unrecorded ones, which mean opposite things about
 * whether work remains; `refused` a reduction that would not give one value.
 */
export type CellState = 'value' | 'missing' | 'not-applicable' | 'not-assessed' | 'refused';

export function Matrix({ analysis, measure, vocabulary, encoding, encodings, view, affordances, onFocusChange }: MatrixViewProps) {
  const reader = makeCellReader(analysis, measure);
  const reads = new Map<string, ReturnType<typeof reader.read>>();
  const read = (alt: string, crit: string) => {
    const key = `${alt}\u0000${crit}`;
    if (!reads.has(key)) reads.set(key, reader.read(alt, crit));
    return reads.get(key);
  };
  const confidence = measure !== CONFIDENCE && unknownMeasure(analysis, CONFIDENCE) === undefined
    ? makeCellReader(analysis, CONFIDENCE) : undefined;
  const helpId = useId();
  const words = aliasesOf(analysis);
  const layout = matrixLayout(analysis, view);
  const { rows, columns, transposed } = layout;
  const groupLabel = new Map(analysis.groups.map((g) => [g.id, g.label]));
  const rowWord = transposed ? words.criterion : words.alternative;
  const plural = (axis: AxisLayout) => (axis.axis === 'alternatives' ? words.alternatives : words.criteria);
  const hiddenAxis = [rows, columns].find((axis) => axis.entries.length === 0);
  // An axis with nothing shown leaves a table of headers and no cells; say why.
  const empty = hiddenAxis && `No ${plural(hiddenAxis)} are shown: every one is hidden in this view, or there are none.`;

  const [alternatives, criteria] = transposed ? [columns.entries, rows.entries] : [rows.entries, columns.entries];
  const { active, prepared, fallback } = chooseEncoding(encodings, encoding, {
    analysis, measure, vocabulary, read, inapplicable: affordances.inapplicable,
    alternatives: alternatives.map((e) => e.id), criteria: criteria.map((e) => e.id),
  });

  const grid = gridOf(rows.entries, columns.entries, transposed);
  const at = grid.positionOf(view.session.focus);
  /** The roving `tabindex` and the address the keyboard handler moves by. */
  const stop = (r: number, c: number) => ({
    'data-cell': `${r}:${c}`,
    tabIndex: r === at.r && c === at.c ? 0 : -1,
  });
  const rowLabel = new Map(rows.entries.map((e) => [e.id, e.label]));
  const columnLabel = new Map(columns.entries.map((e) => [e.id, e.label]));

  const cell = (rowId: string, columnId: string, r: number, c: number) => {
    const [altId, critId] = transposed ? [columnId, rowId] : [rowId, columnId];
    const reduced = read(altId, critId);
    const mark = prepared.mark(altId, critId);
    const { state, text } = cellContent(reduced, affordances.inapplicable(altId, critId), vocabulary, critId);
    const [altLabel, critLabel] = transposed
      ? [columnLabel.get(columnId), rowLabel.get(rowId)]
      : [rowLabel.get(rowId), columnLabel.get(columnId)];
    const sure = state === 'value' ? confidence?.read(altId, critId)?.value : undefined;
    const after = state === 'value'
      ? `${reduced?.withheldFromReader ? '' : outOf(reduced?.value, reader.measurementOf(critId))}${sure !== undefined ? `, ${CONFIDENCE} ${String(sure)}` : ''}`
      : '';
    const said = `${after}${mark.said ?? ''}`;
    // Visually hidden, inside the cell: "Memory safety, Rust, 5 of 5, confidence low" (ADR-0027).
    // The encoding's badge is seen; its meaning, in `said`, is what is heard.
    return (
      <td
        key={columnId} data-state={state} {...stop(r, c)}
        data-swatch={mark.swatch} data-hatch={mark.hatch} data-glyph={mark.glyph}
      >
        <span class="comparanda-sr">{`${critLabel}, ${altLabel}, `}</span>
        <span class="comparanda-shown">{text}</span>
        {mark.badge && <span class="comparanda-badge" aria-hidden="true">{mark.badge}</span>}
        {said && <span class="comparanda-sr">{said}</span>}
      </td>
    );
  };
  const header = (e: LayoutEntry, scope: 'row' | 'col', r: number, c: number) => (
    <th scope={scope} key={e.id} {...stop(r, c)}>
      {e.label}
      {e.alsoIn.length > 0 && (
        <span class="comparanda-also">{` (also in ${e.alsoIn.map((g) => groupLabel.get(g) ?? g).join(', ')})`}</span>
      )}
    </th>
  );
  const rowIndex = new Map(rows.entries.map((e, i) => [e.id, i + 1]));
  const row = (e: LayoutEntry) => {
    const r = rowIndex.get(e.id)!;
    return (
      <tr key={e.id}>
        {header(e, 'row', r, 0)}
        {columns.entries.map((c, i) => cell(e.id, c.id, r, i + 1))}
      </tr>
    );
  };

  /** Arrow keys, Home/End within a row, Ctrl+Home/End to the corners (APG grid). */
  const onKeyDown = (event: KeyboardEvent) => {
    // Alt+Arrow is browser Back/Forward and Meta is the platform's: never ours.
    if (event.altKey || event.metaKey) return;
    const from = (event.target as Element | null)?.closest?.('[data-cell]');
    const table = event.currentTarget as HTMLTableElement;
    if (!from || !table.contains(from)) return;
    const [r, c] = from.getAttribute('data-cell')!.split(':').map(Number) as [number, number];
    const rtl = getComputedStyle(table).direction === 'rtl';
    const to = grid.step(r, c, event.key, { ctrl: event.ctrlKey, rtl });
    if (!to) return;
    event.preventDefault();
    table.querySelector<HTMLElement>(`[data-cell="${to.r}:${to.c}"]`)?.focus();
  };
  /** Wherever focus lands in the grid -- key, click or script -- that is the reader's position. */
  const onFocusCapture = (event: FocusEvent) => {
    const into = (event.target as Element | null)?.closest?.('[data-cell]');
    if (!into || !onFocusChange) return;
    const [r, c] = into.getAttribute('data-cell')!.split(':').map(Number) as [number, number];
    if (r !== at.r || c !== at.c) onFocusChange(grid.focusAt(r, c));
  };

  return (
    <div
      class="comparanda-matrix"
      data-encoding={active.id}
      data-orientation={transposed ? 'transposed' : 'standard'}
    >
      <style>{MATRIX_CSS}</style>
      {fallback && <p class="comparanda-degraded" role="note">{fallback}</p>}
      <RefusedEdits
        analysis={analysis} measure={measure} affordances={affordances}
        rows={rows.entries} columns={columns.entries} transposed={transposed}
      />
      {empty && <p class="comparanda-empty" role="note">{empty}</p>}
      <p class="comparanda-keys" id={helpId}>
        Arrow keys move between cells; Home and End go to the start and end of a row; Ctrl+Home to the top-left corner and Ctrl+End to the last cell.
      </p>
      <Legend definition={active} legend={prepared.legend} />
      {/* Not itself a tab stop: focusing a cell scrolls it, and the grid is the matrix's one stop. */}
      <div class="comparanda-scroll" role="region" aria-label={analysis.subject.question}>
        <table role="grid" aria-describedby={helpId} onKeyDown={onKeyDown} onFocusCapture={onFocusCapture}>
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
                <th scope="col" rowSpan={2} class="comparanda-corner" {...stop(0, 0)}>{capitalise(rowWord)}</th>
                {columns.bands.map((b) => (
                  <th scope="colgroup" colSpan={b.entries.length} key={bandKey(b)}>{bandLabel(b, columns)}</th>
                ))}
              </tr>
            )}
            <tr>
              {!columns.bands && <th scope="col" class="comparanda-corner" {...stop(0, 0)}>{capitalise(rowWord)}</th>}
              {columns.entries.map((c, i) => header(c, 'col', 0, i + 1))}
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
 * when refused and always with the reason.
 *
 * About the matrix as shown: a cell write (a value, a suggestion) is asked of
 * the shown cells, and is not refused if one of them accepts it -- the first
 * that does ends the search. A cell that is structurally inapplicable has
 * nothing to record whatever the reader may do, so it is not asked; and the
 * reason given is the one most cells share (a lock, a read-only source), never
 * a list of every cell's own.
 */
function RefusedEdits({ analysis, measure, affordances, rows, columns, transposed }: Pick<MatrixViewProps, 'analysis' | 'measure' | 'affordances'> & {
  rows: LayoutEntry[]; columns: LayoutEntry[]; transposed: boolean;
}) {
  const id = useId();
  /** Over the shown, applicable cells: `undefined` if one allows it, else the commonest reason. */
  const overCells = (ask: (alt: string, crit: string) => Affordance): string | undefined | null => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const c of columns) {
        const [alt, crit] = transposed ? [c.id, r.id] : [r.id, c.id];
        if (affordances.inapplicable(alt, crit)) continue;
        const answer = ask(alt, crit);
        if (answer.enabled) return undefined;
        const reason = answer.reason ?? '';
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    if (counts.size === 0) return null; // no cell to ask: nothing to offer, nothing refused
    return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]![0];
  };
  const overAll = (answers: Affordance[]): string | undefined | null =>
    answers.length === 0 ? null : answers.some((x) => x.enabled) ? undefined : answers[0]!.reason ?? '';
  const open = (analysis.suggestions ?? []).filter((s) => s.status === 'open');
  const controls: { key: string; label: string; refused: string | undefined | null }[] = [
    { key: 'assert', label: 'Record a value', refused: overCells((a, c) => affordances.assert(a, c, measure)) },
    { key: 'suggest', label: 'Suggest a value', refused: overCells((a, c) => affordances.suggest(a, c, measure)) },
    { key: 'comment', label: 'Comment', refused: overAll([affordances.comment()]) },
    { key: 'revise', label: 'Revise the analysis', refused: overAll([affordances.revise('revising the analysis')]) },
    { key: 'change-lock', label: 'Lock or unlock the analysis', refused: overAll([affordances.changeLock()]) },
    {
      key: 'decide-suggestion',
      label: `Accept or decline ${open.length === 1 ? 'the open suggestion' : `the ${open.length} open suggestions`}`,
      refused: overAll(open.flatMap((s) => [affordances.decideSuggestion(s.id, 'accept'), affordances.decideSuggestion(s.id, 'decline')])),
    },
  ];
  const refused = controls.filter((c): c is typeof c & { refused: string } => typeof c.refused === 'string');
  if (refused.length === 0) return null;
  return (
    <ul class="comparanda-edits" aria-label="Edits not available here">
      {refused.map((c) => (
        <li key={c.key} data-edit={c.key}>
          <button type="button" aria-disabled="true" aria-describedby={`${id}-${c.key}`}>{c.label}</button>
          {' '}
          <span class="comparanda-reason" id={`${id}-${c.key}`}>{capitalise(c.refused || 'not possible here.')}</span>
        </li>
      ))}
    </ul>
  );
}

/** A cell as text and the state it is in. Never empty: an absence is read through the vocabulary, a refusal states its reason. */
function cellContent(
  reduced: Reduced | undefined,
  inapplicable: boolean,
  vocabulary: MissingnessVocabulary,
  criterionId: string,
): { state: CellState; text: string } {
  const means = (code: string) => vocabulary.means(code, criterionId) ?? code;
  if (reduced?.refused !== undefined) {
    // A cell this reader sees only part of: the projection's gap (ADR-0021),
    // which core reports as such (#171), not the raters' disagreement.
    return {
      state: 'refused',
      text: reduced.refusedBecause === 'withheld-from-reader'
        ? 'Partly withheld from you; what you can see does not settle this cell.'
        : `Not shown: ${reduced.refused}`,
    };
  }
  if (reduced?.value !== undefined) {
    // A value shown beside withheld assertions (an owner's consensus, a provable
    // `latest`) is labelled, never bare (ADR-0021).
    const withheld = reduced.withheldFromReader;
    return { state: 'value', text: withheld ? `${String(reduced.value)} (${withheld} withheld from you)` : String(reduced.value) };
  }
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

/**
 * The encoding to draw with, prepared over the matrix as shown. One the build
 * does not register, or one that cannot draw this analysis, falls back to
 * `text-only` and says why: a reader is never shown a different encoding from
 * the one they chose without being told.
 */
function chooseEncoding(
  encodings: EncodingRegistry, id: string, context: Parameters<EncodingDefinition['prepare']>[0],
): { active: EncodingDefinition; prepared: PreparedEncoding; fallback?: string } {
  const plain = () => textOnly.prepare(context) as PreparedEncoding;
  const chosen = encodings.get(id);
  if (!chosen) {
    return { active: textOnly, prepared: plain(), fallback: `The "${id}" encoding is not available in this build; showing values as text.` };
  }
  const prepared = chosen.prepare(context);
  if ('unavailable' in prepared) {
    return {
      active: textOnly, prepared: plain(),
      fallback: `The "${chosen.label}" encoding cannot be shown here: ${prepared.unavailable} Showing values as text.`,
    };
  }
  return { active: chosen, prepared };
}

/** The active encoding's legend: samples with their meaning in words, counts, notes, and its texture. */
function Legend({ definition, legend }: { definition: EncodingDefinition; legend: LegendData }) {
  const titleId = useId();
  return (
    <section class="comparanda-legend" aria-labelledby={titleId} data-legend={definition.id}>
      <p class="comparanda-legend-title" id={titleId}>{`${definition.label}: ${legend.title}`}</p>
      {legend.entries.length > 0 && (
        <ul>
          {legend.entries.map((e) => (
            <li key={e.label}>
              <span class="comparanda-swatch" data-swatch={e.swatch} aria-hidden="true">{e.badge ?? '\u00a0'}</span>
              {' '}{e.label}{e.count !== undefined && <span class="comparanda-count">{` (${e.count})`}</span>}
            </li>
          ))}
        </ul>
      )}
      {legend.notes.map((n) => <p key={n} class="comparanda-legend-note">{n}</p>)}
      <p class="comparanda-legend-note">{describeTexture(definition.texture)}</p>
    </section>
  );
}

/**
 * The navigable grid: row 0 is the header row, column 0 the header column, so
 * (0, 0) is the corner. Positions are indices within one render; what persists
 * is `focusAt`'s ids, which survive a reorder.
 */
function gridOf(rows: LayoutEntry[], columns: LayoutEntry[], transposed: boolean) {
  const height = rows.length + 1;
  const width = columns.length + 1;
  const focusAt = (r: number, c: number): Session['focus'] => {
    const rowId = r > 0 ? rows[r - 1]?.id : undefined;
    const columnId = c > 0 ? columns[c - 1]?.id : undefined;
    const [alternativeId, criterionId] = transposed ? [columnId, rowId] : [rowId, columnId];
    if (alternativeId === undefined && criterionId === undefined) return undefined;
    return {
      ...(alternativeId !== undefined ? { alternativeId } : {}),
      ...(criterionId !== undefined ? { criterionId } : {}),
    };
  };
  /** Where a focus lands; an id this render does not show falls back to that axis's header. */
  const positionOf = (focus: Session['focus']) => {
    const [rowId, columnId] = transposed
      ? [focus?.criterionId, focus?.alternativeId]
      : [focus?.alternativeId, focus?.criterionId];
    return {
      r: rowId === undefined ? 0 : rows.findIndex((e) => e.id === rowId) + 1,
      c: columnId === undefined ? 0 : columns.findIndex((e) => e.id === columnId) + 1,
    };
  };
  const step = (r: number, c: number, key: string, { ctrl, rtl }: { ctrl: boolean; rtl: boolean }) => {
    const [back, forth] = rtl ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
    // At an edge the key still lands (on the same cell), so the page does not scroll under the reader.
    if (key === 'Home') return ctrl ? { r: 0, c: 0 } : { r, c: 0 };
    if (key === 'End') return ctrl ? { r: height - 1, c: width - 1 } : { r, c: width - 1 };
    if (ctrl) return undefined; // Ctrl+Arrow belongs to the screen reader and the browser.
    if (key === 'ArrowUp') return { r: Math.max(0, r - 1), c };
    if (key === 'ArrowDown') return { r: Math.min(height - 1, r + 1), c };
    if (key === back) return { r, c: Math.max(0, c - 1) };
    if (key === forth) return { r, c: Math.min(width - 1, c + 1) };
    return undefined;
  };
  return { focusAt, positionOf, step };
}

/**
 * What a number is out of, for the ear: a rating says its top ("5 of 5"), a
 * quantity its unit ("1900 USD/month"). A ratio's `max` is the range's bound,
 * not a ceiling the value is scored against, so it is never read as "of".
 */
function outOf(value: unknown, m: Measurement | undefined): string {
  if (typeof value !== 'number' || !m?.range) return '';
  if (m.level === 'ordinal') return ` of ${m.range.max}`;
  return m.range.unit ? ` ${m.range.unit}` : '';
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
