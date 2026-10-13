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
import { useId, useRef, useState } from 'preact/hooks';

import type { Affordance, Affordances } from '../core/affordances.js';
import { matrixLayout, type AxisLayout, type Band, type LayoutEntry } from '../core/layout.js';
import { makeCellReader, unknownMeasure, type Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import type { Measurement } from '../core/schema/measurement.js';
import {
  absenceStanding, coreReasonOf, NOT_APPLICABLE, NOT_ASSESSED, type AbsenceStanding, type MissingnessVocabulary,
} from '../core/schema/missingness.js';
import { aliasesOf } from '../core/schema/structure.js';
import type { Reduced } from '../core/schema/values.js';
import type { Session, ViewState } from '../core/view-state.js';
import { textOnly } from './encodings/shipped.js';
import {
  describeTexture, type CellMark, type EncodingDefinition, type EncodingRegistry, type Legend as LegendData, type PreparedEncoding,
} from './encodings/registry.js';
import { Glyph, GLYPH_KEYS, glyphName, Hatch, isHatchLevel, type GlyphKey, type HatchLevel } from './channels.js';
import { derivedPaletteCss, MATRIX_CSS } from './matrix-css.js';
import { PALETTE } from './encodings/palette.js';
import { revealClear } from './sticky.js';
import { capitalise, outOf, STANDING_SAID } from './words.js';
import { DetailPanel } from './detail-panel.js';
import type { ThreadWrites } from './threads.js';
import { commitMove, MoveMenu, type ReorderContext, type Step } from './reorder.js';
import { startPointerDrag } from './pointer-reorder.js';
import { describeOrder, describePlace } from '../core/reorder.js';
import type { Axis } from '../core/schema/groups.js';
import { resolveAnchor } from '../core/schema/anchors.js';

const anonymous = () => 'anonymous';

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
  /**
   * The detail panel opened or closed (`session.detailPanelOpen`, #94). `into`:
   * the reader asked by keyboard, so focus goes into the panel once it renders.
   * The panel is drawn only with this, since without it nothing could close it.
   */
  onPanelChange?: (open: boolean, options?: { into?: boolean }) => void;
  /** Start, answer and resolve threads (#106); absent, the panel offers none. `mountMatrix` writes them through the source. */
  threadWrites?: ThreadWrites;
  /**
   * The reader rearranged an axis (#92): the new view state, and the sentence
   * to announce. Without it the matrix offers no reordering.
   */
  onReorder?: (state: ViewState, said: string) => void;
  /** The latest sentence for the polite live region: a move, a seriation, a refusal. */
  announcement?: string;
  /** Who is moving things, recorded in the order's provenance, read when a move is made. Default: `anonymous`. */
  actor?: () => string;
  /**
   * Seriation as an action ("arrange to reveal structure", ADR-0025), when the
   * composition root registered it: core's `arrangeToRevealStructure`, or a
   * host's own. Absent, each axis still says how its order came about.
   */
  arrange?: (analysis: Analysis, view: ViewState, axis: Axis, measure: string) => { state: ViewState; said: string };
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

/**
 * What an absent cell says about the work, beside its code's meaning: read from
 * the code's flags (`absenceStanding`), so a deployment's extension is heard the
 * same way as the core code it refines (#101). `not-applicable` is correctly
 * nothing; `not-assessed` is a gap. `undeclared` is a code this analysis does
 * not define, and nothing about it may be guessed.
 */
export type CellAbsence = AbsenceStanding | 'undeclared';

export function Matrix({ analysis, measure, vocabulary, encoding, encodings, view, standing, affordances, onFocusChange, onPanelChange, threadWrites, onReorder, announcement, actor = anonymous, arrange }: MatrixViewProps) {
  const reader = makeCellReader(analysis, measure);
  const reads = new Map<string, ReturnType<typeof reader.read>>();
  const read = (alt: string, crit: string) => {
    const key = `${alt}\u0000${crit}`;
    if (!reads.has(key)) reads.set(key, reader.read(alt, crit));
    return reads.get(key);
  };
  const confidence = measure !== CONFIDENCE && unknownMeasure(analysis, CONFIDENCE) === undefined
    ? makeCellReader(analysis, CONFIDENCE) : undefined;
  // Another measure's reading of the same cell, for an encoding that crosses two (value by confidence).
  const others = new Map<string, ReturnType<typeof makeCellReader> | null>();
  const readMeasure = (other: string, alt: string, crit: string) => {
    if (other === measure) return read(alt, crit);
    if (!others.has(other)) others.set(other, unknownMeasure(analysis, other) === undefined ? makeCellReader(analysis, other) : null);
    return others.get(other)?.read(alt, crit);
  };
  const helpId = useId();
  /**
   * What a pointer last pressed, until the focus it gives (or a key) uses it up:
   * the focus that lands there is the pointer's. One-shot, because a touch's
   * focus comes after its pointerup, and a drag can end outside the grid.
   */
  const pressed = useRef<Element | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelOpen = view.session.detailPanelOpen === true;
  /** Keyboard grab mode (ADR-0027): what is held, and the view it was picked up from, for Escape. */
  const [grab, setGrab] = useState<{ axis: Axis; id: string; original: ViewState } | undefined>(undefined);
  /** Whose move menu is open, as `axis:id`. */
  const [menu, setMenu] = useState<string | undefined>(undefined);
  /** The menu focus-out just closed, so the click on its own handle that caused it does not reopen it. */
  const closedBy = useRef<string | undefined>(undefined);
  const words = aliasesOf(analysis);
  const layout = matrixLayout(analysis, view);
  const { rows, columns, transposed } = layout;
  const groupLabel = new Map(analysis.groups.map((g) => [g.id, g.label]));
  const openHere = openThreadCounts(analysis);
  const rowWord = transposed ? words.criterion : words.alternative;
  const plural = (axis: AxisLayout) => (axis.axis === 'alternatives' ? words.alternatives : words.criteria);
  const hiddenAxis = [rows, columns].find((axis) => axis.entries.length === 0);
  // An axis with nothing shown leaves a table of headers and no cells; say why.
  const empty = hiddenAxis && `No ${plural(hiddenAxis)} are shown: every one is hidden in this view, or there are none.`;

  const [alternatives, criteria] = transposed ? [columns.entries, rows.entries] : [rows.entries, columns.entries];
  const { active, prepared, fallback } = chooseEncoding(encodings, encoding, {
    analysis, measure, vocabulary, read, readMeasure, inapplicable: affordances.inapplicable,
    alternatives: alternatives.map((e) => e.id), criteria: criteria.map((e) => e.id),
  });

  // The foreground channels (ADR-0028): a glyph on every missing cell, whatever the
  // encoding; a hatch only where the active encoding declares one, at a level it declares.
  const hatchCeiling = active.texture.channel === 'hatch' ? active.texture.levels : 0;
  const contents = new Map<string, ReturnType<typeof cellContent> & { hatch?: HatchLevel }>();
  const contentOf = (altId: string, critId: string) => {
    const key = `${altId}\u0000${critId}`;
    if (!contents.has(key)) {
      const content = cellContent(read(altId, critId), affordances.inapplicable(altId, critId), vocabulary, critId);
      const hatch = prepared.mark(altId, critId).hatch;
      contents.set(key, content.state === 'value' && isHatchLevel(hatch, hatchCeiling) ? { ...content, hatch } : content);
    }
    return contents.get(key)!;
  };
  for (const alt of alternatives) for (const crit of criteria) contentOf(alt.id, crit.id);
  const shownGlyphs = new Set([...contents.values()].flatMap((c) => (c.glyph ? [c.glyph] : [])));
  const shownHatches = new Set([...contents.values()].flatMap((c) => (c.hatch ? [c.hatch] : [])));

  const grid = gridOf(rows.entries, columns.entries, transposed);
  const at = grid.positionOf(view.session.focus);
  /** The roving `tabindex` and the address the keyboard handler moves by. */
  const stop = (r: number, c: number) => ({
    'data-cell': `${r}:${c}`,
    tabIndex: r === at.r && c === at.c ? 0 : -1,
  });
  const rowLabel = new Map(rows.entries.map((e) => [e.id, e.label]));
  const columnLabel = new Map(columns.entries.map((e) => [e.id, e.label]));
  const reorder: ReorderContext | undefined = onReorder && { analysis, view, actor, onReorder };
  // The drop of a drag started before a host update must act on the view as it is now, not as it was.
  const latest = useRef(reorder);
  latest.current = reorder;
  /**
   * What a header moves among: its axis as shown, or on a banded axis its own
   * band, since a move across bands changes nothing a reader can see there.
   */
  const scopeOf = (axis: Axis, id: string): string[] => {
    const layout = rows.axis === axis ? rows : columns;
    const band = layout.bands?.find((b) => b.entries.some((e) => e.id === id));
    return [...new Set((band ? band.entries : layout.entries).map((e) => e.id))];
  };
  const labelOf = (axis: Axis) => (id: string) =>
    (axis === 'alternatives' ? analysis.alternatives : analysis.criteria).find((x) => x.id === id)?.label ?? id;

  const cell = (rowId: string, columnId: string, r: number, c: number) => {
    const [altId, critId] = transposed ? [columnId, rowId] : [rowId, columnId];
    const reduced = read(altId, critId);
    const mark = prepared.mark(altId, critId);
    const { state, text, absence, terminal, glyph, hatch } = contentOf(altId, critId);
    const [altLabel, critLabel] = transposed
      ? [columnLabel.get(columnId), rowLabel.get(rowId)]
      : [rowLabel.get(rowId), columnLabel.get(columnId)];
    const sure = state === 'value' ? confidence?.read(altId, critId)?.value : undefined;
    const after = state === 'value'
      ? `${reduced?.withheldFromReader ? '' : outOf(reduced?.value, reader.measurementOf(critId))}${sure !== undefined ? `, ${CONFIDENCE} ${String(sure)}` : ''}`
      : '';
    // After a value, the encoding's words continue the phrase. After an absence or
    // a refusal -- a sentence -- they are a sentence of their own, and an absence's
    // standing comes last. A declared meaning without a full stop is given one.
    const extra = state === 'value' ? '' : asSentence(mark.said ?? '');
    const said = state === 'value'
      ? `${after}${mark.said ?? ''}`
      : `${/[.!?\u2026)\]"\u201d\u2019]$/.test(text) ? '' : '.'}${extra && ` ${extra}`}${absence ? ` ${STANDING_SAID[absence]}` : ''}`;
    // Visually hidden, inside the cell: "Memory safety, Rust, 5 of 5, confidence low" (ADR-0027).
    // The encoding's badge is seen; its meaning, in `said`, is what is heard.
    return (
      <td
        key={columnId} data-state={state} data-absence={absence} data-terminal={terminal === undefined ? undefined : String(terminal)} {...stop(r, c)}
        data-swatch={mark.swatch} data-hatch={hatch} data-glyph={glyph}
      >
        <span class="comparanda-sr">{`${critLabel}, ${altLabel}, `}</span>
        {glyph && <Glyph reason={glyph} />}
        <span class="comparanda-shown">{text}</span>
        {hatch && <Hatch level={hatch} />}
        {mark.badge && <span class="comparanda-badge" aria-hidden="true">{mark.badge}</span>}
        {said && <span class="comparanda-sr">{said}</span>}
        <ThreadMark count={openHere.get(`${altId}\u0000${critId}`)} />
      </td>
    );
  };
  const header = (e: LayoutEntry, scope: 'row' | 'col', r: number, c: number) => {
    const axis = (scope === 'row' ? rows : columns).axis;
    const menuKey = `${axis}:${e.id}`;
    return (
    <th
      scope={scope} key={e.id} {...stop(r, c)} data-axis={axis} data-entry={e.id}
      data-grabbed={grab?.axis === axis && grab.id === e.id ? 'true' : undefined}
    >
      {reorder && (
        <button
          type="button" tabIndex={-1} class="comparanda-handle" aria-haspopup="menu"
          // Named "Move <label>" from words already on the page: no text of its own in the header.
          aria-labelledby={`${helpId}-move ${helpId}-l-${r}-${c}`}
          aria-expanded={menu === menuKey ? 'true' : 'false'}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            // A press on the handle of an open menu closed it already (focus left it); do not reopen it.
            if (closedBy.current === menuKey) { closedBy.current = undefined; return; }
            setMenu(menu === menuKey ? undefined : menuKey);
          }}
          onPointerDown={(event: PointerEvent) => startPointerDrag(event, {
            scroller: root.current!.querySelector<HTMLElement>('.comparanda-scroll')!, axis, id: e.id,
            direction: scope === 'row' ? 'vertical' : 'horizontal',
            onDrop: ({ targetId, edge }) => {
              const scope = scopeOf(axis, e.id);
              if (targetId !== e.id && latest.current && scope.includes(targetId)) {
                commitMove(latest.current, axis, e.id, { kind: edge, id: targetId }, 'pointer', scope);
              }
            },
          })}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" class="comparanda-thread-icon" fill="currentColor" stroke="none">
            <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" /><circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" />
          </svg>
        </button>
      )}
      {reorder ? <span id={`${helpId}-l-${r}-${c}`}>{e.label}</span> : e.label}
      {e.alsoIn.length > 0 && (
        <span class="comparanda-also">{` (also in ${e.alsoIn.map((g) => groupLabel.get(g) ?? g).join(', ')})`}</span>
      )}
      <ThreadMark count={openHere.get(`${axis === 'alternatives' ? 'a' : 'c'}:${e.id}`)} />
      {reorder && menu === menuKey && (
        <MoveMenu
          ctx={reorder} axis={axis} id={e.id} scope={scopeOf(axis, e.id)} label={labelOf(axis)}
          labelledBy={`${helpId}-move ${helpId}-l-${r}-${c}`}
          onClose={(refocus) => {
            setMenu(undefined);
            if (refocus) root.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus();
            else {
              closedBy.current = menuKey;
              setTimeout(() => { if (closedBy.current === menuKey) closedBy.current = undefined; }, 0);
            }
          }}
        />
      )}
    </th>
    );
  };
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
    pressed.current = null;
    if (!from || !table.contains(from)) return;
    // A reader who clicked a half-covered cell and now uses the keyboard sees it uncovered first.
    revealClear(from);
    const [r, c] = from.getAttribute('data-cell')!.split(':').map(Number) as [number, number];
    // A header is a move handle (ADR-0027): Space or Enter picks it up; held, the keys move it.
    const onHeader = event.target === from && (r === 0) !== (c === 0) && reorder !== undefined;
    if (onHeader && reorder) {
      const axis = from.getAttribute('data-axis') as Axis;
      const id = from.getAttribute('data-entry')!;
      const along = r === 0
        ? (getComputedStyle(table).direction === 'rtl' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'])
        : ['ArrowUp', 'ArrowDown'];
      const held = grab?.axis === axis && grab.id === id;
      const step: Step | undefined = !held ? undefined
        : event.key === along[0] || (event.key === 'Tab' && event.shiftKey) ? 'earlier'
          : event.key === along[1] || (event.key === 'Tab' && !event.shiftKey) ? 'later'
            : event.key === 'Home' ? 'to-start' : event.key === 'End' ? 'to-end' : undefined;
      if (step) {
        event.preventDefault();
        commitMove(reorder, axis, id, step, 'keyboard', scopeOf(axis, id));
        return;
      }
      if (held && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setGrab(undefined);
        onReorder!(view, `Put down: ${describePlace(analysis, view, axis, id)}.`);
        return;
      }
      if (held && event.key === 'Escape') {
        event.preventDefault();
        setGrab(undefined);
        // Only the axis that was held: anything else that changed meanwhile was not this move.
        const key = axis === 'alternatives' ? 'alternativeOrder' : 'criterionOrder';
        const back = { ...view, [key]: grab.original[key] };
        onReorder!(back, `Move cancelled: ${describePlace(analysis, back, axis, id)}, where it was.`);
        return;
      }
      // Held, the grid does not move: the other arrows would leave the item in the air.
      if (held && event.key.startsWith('Arrow')) {
        event.preventDefault();
        return;
      }
      if (!held && (event.key === ' ' || event.key === 'Enter') && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        setGrab({ axis, id, original: view });
        const keys = r === 0 ? 'Left and Right arrows' : 'Up and Down arrows';
        onReorder!(view, `Picked up ${describePlace(analysis, view, axis, id)}. ${keys} or Tab move it, Home and End to the ends; Space or Enter puts it down; Escape puts it back.`);
        return;
      }
      if (!held && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
        event.preventDefault();
        setMenu(`${axis}:${id}`);
        return;
      }
    }
    // Enter opens the details of this position and goes into them; Escape closes them (#94).
    // On the grid position itself only: a control inside it (a reorder handle) keeps its own Enter.
    if (event.key === 'Enter' && event.target === from && !event.ctrlKey && !event.shiftKey && onPanelChange) {
      event.preventDefault();
      onPanelChange(true, { into: true });
      return;
    }
    if (event.key === 'Escape' && panelOpen && onPanelChange) {
      event.preventDefault();
      onPanelChange(false);
      return;
    }
    const rtl = getComputedStyle(table).direction === 'rtl';
    const to = grid.step(r, c, event.key, { ctrl: event.ctrlKey, rtl });
    if (!to) return;
    event.preventDefault();
    table.querySelector<HTMLElement>(`[data-cell="${to.r}:${to.c}"]`)?.focus();
  };
  /**
   * Wherever focus lands in the grid -- key, click or script -- that is the
   * reader's position, and it is brought clear of the sticky headers (#103).
   * A focus scrolls only a cell outside the scrollport, so one inside it but
   * under the sticky header column would stay covered: `revealClear` does it.
   * Not for the focus a pointer press gives the cell it presses: that cell is
   * under the pointer already, and scrolling it away is the jump to avoid. Any
   * other focus -- a key, a host, a script, even after a click -- is revealed.
   * The measured padding it reads is `mountMatrix`'s; rendered bare, the cell is
   * only brought inside the scrollport.
   */
  const onFocusCapture = (event: FocusEvent) => {
    const into = (event.target as Element | null)?.closest?.('[data-cell]');
    if (!into) return;
    const byPointer = pressed.current !== null && into.contains(pressed.current);
    // Leaving a held header puts it down where it is.
    if (grab && !(into.getAttribute('data-axis') === grab.axis && into.getAttribute('data-entry') === grab.id)) setGrab(undefined);
    pressed.current = null;
    if (!byPointer) revealClear(into);
    if (!onFocusChange) return;
    const [r, c] = into.getAttribute('data-cell')!.split(':').map(Number) as [number, number];
    if (r !== at.r || c !== at.c) onFocusChange(grid.focusAt(r, c));
  };

  return (
    <div
      class="comparanda-matrix" ref={root}
      data-encoding={active.id}
      // Every encoding this view was composed with, so a host -- or the build's zero-network check -- can
      // know what the page can draw without importing its registry.
      data-encodings={encodings.ids.join(' ')}
      data-orientation={transposed ? 'transposed' : 'standard'}
    >
      <style>{MATRIX_CSS}</style>
      {/* After MATRIX_CSS: its swatch rules tie the muted-ink rules on specificity, and win by order. */}
      {prepared.palette && <style>{derivedPaletteCss(prepared.palette)}</style>}
      {fallback && <p class="comparanda-degraded" role="note">{fallback}</p>}
      <RefusedEdits
        analysis={analysis} measure={measure} affordances={affordances}
        rows={rows.entries} columns={columns.entries} transposed={transposed}
      />
      {empty && <p class="comparanda-empty" role="note">{empty}</p>}
      <p class="comparanda-keys" id={helpId}>
        Arrow keys move between cells; Home and End go to the start and end of a row; Ctrl+Home to the top-left corner and Ctrl+End to the last cell.
        {onPanelChange && ' Enter on a cell opens its details, which follow you onto the headers; Escape closes them.'}
        {onReorder && ' On a header, Space or Enter picks it up to move it with the arrows or Tab, and Shift+F10 opens a move menu.'}
      </p>
      {reorder && (
        <div class="comparanda-arrange">
          {(['alternatives', 'criteria'] as const).map((axis) => (
            <p key={axis} data-order={axis}>
              {describeOrder(analysis, view, axis)}
              {arrange && ' '}
              {arrange && (
              <button
                type="button"
                onClick={() => {
                  try {
                    const { state, said } = arrange(analysis, view, axis, measure);
                    reorder.onReorder(state, said);
                  } catch (error) {
                    reorder.onReorder(view, `Not arranged: ${error instanceof Error ? error.message : String(error)}`);
                  }
                }}
              >
                {`Arrange ${axis === 'alternatives' ? words.alternatives : words.criteria} to reveal structure`}
              </button>
              )}
            </p>
          ))}
        </div>
      )}
      {onReorder && <span id={`${helpId}-move`} hidden>Move</span>}
      {/* Polite, and present before anything is said into it, so the first sentence is heard. */}
      {onReorder && <p class="comparanda-sr" role="status" aria-live="polite" data-announce="">{announcement ?? ''}</p>}
      <Legend definition={active} legend={prepared.legend} glyphs={shownGlyphs} hatches={shownHatches} />
      {openHere.size > 0 && (
        <p class="comparanda-legend-note"><ThreadMark count={1} quiet />{' A speech bubble and a number: open discussion threads anchored on that cell or header, or at the corner on the analysis. Threads on groups and blocks are listed in the details of their members.'}</p>
      )}
      <div class="comparanda-body">
      {/* Not itself a tab stop: focusing a cell scrolls it, and the grid is the matrix's one stop. */}
      <div class="comparanda-scroll" role="region" aria-label={analysis.subject.question}>
        <table
          role="grid" aria-describedby={helpId} onKeyDown={onKeyDown} onFocusCapture={onFocusCapture}
          onPointerDownCapture={(event: PointerEvent) => { pressed.current = event.target as Element | null; }}
          // A mouse focuses on press, before this; a touch focuses after it, so keeps the press.
          onPointerUpCapture={(event: PointerEvent) => { if (event.pointerType !== 'touch') pressed.current = null; }}
          onPointerCancelCapture={() => { pressed.current = null; }}
          // Focus leaving the grid puts a held header down where it is: it is never left in the air.
          // Checked a tick later: moving a header moves its node, which blurs it until the stop is refocused.
          onFocusOut={(event: FocusEvent) => {
            if (!grab) return;
            const table = event.currentTarget as HTMLElement;
            setTimeout(() => { if (!table.contains(table.ownerDocument.activeElement)) setGrab(undefined); }, 0);
          }}
          // A click opens the details (the reference behaviour) and leaves focus where it landed.
          onClick={(event: MouseEvent) => {
            const on = event.target as Element | null;
            if (on?.closest?.('.comparanda-handle, [role="menu"]')) return;
            if (!panelOpen && onPanelChange && on?.closest?.('[data-cell]')) onPanelChange(true);
          }}
        >
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
                <th scope="col" rowSpan={2} class="comparanda-corner" {...stop(0, 0)}>{capitalise(rowWord)}<ThreadMark count={openHere.get('')} /></th>
                {columns.bands.map((b) => (
                  <th scope="colgroup" colSpan={b.entries.length} key={bandKey(b)}>{bandLabel(b, columns)}</th>
                ))}
              </tr>
            )}
            <tr>
              {!columns.bands && <th scope="col" class="comparanda-corner" {...stop(0, 0)}>{capitalise(rowWord)}<ThreadMark count={openHere.get('')} /></th>}
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
      {panelOpen && onPanelChange && (
        <DetailPanel
          analysis={analysis} measure={measure} vocabulary={vocabulary} standing={standing}
          // Where the grid's stop actually is: a hidden or removed id has fallen back to its header.
          focus={grid.focusAt(at.r, at.c)}
          headingId={`${helpId}-panel`} affordances={affordances} writes={threadWrites}
          onClose={() => onPanelChange(false)}
          onReturn={() => root.current?.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')?.focus()}
        />
      )}
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

/**
 * A cell as text and the state it is in. Never empty: an absence is read
 * through the vocabulary -- its code's own `means`, and its standing from the
 * code's flags -- and a refusal states its reason.
 */
function cellContent(
  reduced: Reduced | undefined,
  inapplicable: boolean,
  vocabulary: MissingnessVocabulary,
  criterionId: string,
): { state: CellState; text: string; absence?: CellAbsence; terminal?: boolean; glyph?: GlyphKey } {
  const absent = (code: string, state: CellState) => {
    const facts = vocabulary.resolve(code, criterionId).facts;
    // Keyed on the core reason the code refines, never on the code itself (ADR-0028).
    const glyph: GlyphKey = (facts && coreReasonOf(vocabulary, code, criterionId)) ?? 'undeclared';
    // An undeclared code has no meaning to show, and a declared one may have an
    // empty one: either way its id is worded, never shown bare or left blank.
    const means = facts?.means.trim();
    const worded = `Absent for a reason this analysis does not ${facts ? 'describe' : 'define'} (\u201c${code}\u201d).`;
    return facts
      // `terminal` is its own channel (border style, ADR-0028), read from the flag itself: a
      // structural code declared non-terminal is still work outstanding. Undeclared counts as open.
      ? { state, text: means || worded, absence: absenceStanding(facts), terminal: facts.terminal, glyph }
      : { state, text: worded, absence: 'undeclared' as const, terminal: false, glyph };
  };
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
    return absent(code, code === NOT_APPLICABLE ? 'not-applicable' : code === NOT_ASSESSED ? 'not-assessed' : 'missing');
  }
  // No value and no recorded absence: a declared block says why; otherwise nobody has looked.
  return inapplicable ? absent(NOT_APPLICABLE, 'not-applicable') : absent(NOT_ASSESSED, 'not-assessed');
}

/**
 * The encoding to draw with, prepared over the matrix as shown. One the build
 * does not register, or one that cannot draw this analysis, falls back to
 * `text-only` and says why: a reader is never shown a different encoding from
 * the one they chose without being told. An encoding that throws -- `defineEncoding`
 * is public, so a third party's may -- falls back the same way rather than
 * blanking the matrix: every shown cell is marked here, inside the guard.
 */
function chooseEncoding(
  encodings: EncodingRegistry, id: string, context: Parameters<EncodingDefinition['prepare']>[0],
): { active: EncodingDefinition; prepared: PreparedEncoding; fallback?: string } {
  const plain = () => textOnly.prepare(context) as PreparedEncoding;
  const chosen = encodings.get(id);
  if (!chosen) {
    return { active: textOnly, prepared: plain(), fallback: `The "${id}" encoding is not available in this build; showing values as text.` };
  }
  const cannot = (why: string) => ({
    active: textOnly, prepared: plain(),
    fallback: `The "${chosen.label}" encoding cannot be shown here: ${why} Showing values as text.`,
  });
  try {
    const prepared = chosen.prepare(context);
    if ('unavailable' in prepared) return cannot(prepared.unavailable);
    const marks = new Map<string, CellMark>();
    for (const alt of context.alternatives) {
      for (const crit of context.criteria) marks.set(`${alt}\u0000${crit}`, prepared.mark(alt, crit));
    }
    const legend = prepared.legend;
    // The legend renders outside this guard, so its shape is checked inside it.
    // Every entry needs words: a sample with no label would be colour alone.
    const entryOk = (e: unknown) => e !== null && typeof e === 'object' && typeof (e as { label?: unknown }).label === 'string';
    if (typeof legend?.title !== 'string' || !Array.isArray(legend.entries) || !Array.isArray(legend.notes) ||
      !legend.entries.every(entryOk) || !legend.notes.every((n) => typeof n === 'string')) {
      return cannot('its legend is not a { title, entries: { label }[], notes: string[] }.');
    }
    // The palette becomes a stylesheet: ids and colours are checked for shape, so nothing else reaches it.
    const { palette } = prepared;
    if (palette !== undefined && !paletteOk(palette)) {
      return cannot('its palette is not a table of swatch ids to #rrggbb light and dark [fill, ink] pairs.');
    }
    return {
      active: chosen,
      prepared: { legend, ...(palette && { palette }), mark: (alt, crit) => marks.get(`${alt}\u0000${crit}`) ?? {} },
    };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, '');
    return cannot(`it failed (${message}).`);
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const pairOk = (pair: unknown) => Array.isArray(pair) && pair.length === 2 && pair.every((c) => typeof c === 'string' && HEX.test(c));
function paletteOk(palette: unknown): boolean {
  return palette !== null && typeof palette === 'object' && Object.entries(palette).every(([id, swatch]) =>
    // Never a static swatch's id: its stylesheet is page-wide, and would repaint a tested swatch in every matrix.
    /^[a-z0-9-]+$/i.test(id) && !Object.prototype.hasOwnProperty.call(PALETTE, id) && swatch !== null && typeof swatch === 'object' &&
    pairOk((swatch as { light?: unknown }).light) && pairOk((swatch as { dark?: unknown }).dark));
}

/** The words for each hatch density, by what the hatch carries: denser is less settled. */
const HATCH_SAID: Readonly<Record<'confidence' | 'disagreement', Readonly<Record<HatchLevel, string>>>> = {
  confidence: { 1: 'somewhat less confident', 2: 'less confident', 3: 'least confident' },
  disagreement: { 1: 'some disagreement', 2: 'more disagreement', 3: 'most disagreement' },
};
const HATCH_WORD: Readonly<Record<HatchLevel, string>> = { 1: 'Sparse', 2: 'Medium', 3: 'Dense' };

/**
 * The active encoding's legend: samples with their meaning in words, counts,
 * notes, its texture, and a key to the glyphs and hatches shown -- each a
 * shape with its meaning in words, so the key survives forced colors and
 * print as the cells do (ADR-0028).
 */
function Legend({ definition, legend, glyphs, hatches }: {
  definition: EncodingDefinition; legend: LegendData; glyphs: ReadonlySet<GlyphKey>; hatches: ReadonlySet<HatchLevel>;
}) {
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
      {/* Shown only when the display has replaced the colours: the samples above then stand for nothing in the cells. */}
      {legend.entries.some((e) => e.swatch) && (
        <p class="comparanda-legend-note comparanda-forced-only">
          Your display has replaced this view's colours with its own, so the cells are not coloured; every cell still says its value or its reason in words, and the shapes keyed here are drawn as before.
        </p>
      )}
      {legend.entries.some((e) => e.swatch) && (
        <p class="comparanda-legend-note comparanda-print-only">
          Printed without the cells' colours: every cell says its value or its reason in words, and the shapes keyed here are drawn as on screen.
        </p>
      )}
      {definition.texture.channel === 'hatch' && hatches.size > 0 && (
        <ul class="comparanda-key" aria-label="Hatch key">
          {([1, 2, 3] as const).filter((l) => hatches.has(l)).map((l) => (
            <li key={l}><Hatch level={l} />{` ${HATCH_WORD[l]} hatch: ${HATCH_SAID[(definition.texture as { carries: 'confidence' | 'disagreement' }).carries][l]}`}</li>
          ))}
        </ul>
      )}
      {glyphs.size > 0 && (
        <ul class="comparanda-key" aria-label="Why cells are empty: shapes">
          {GLYPH_KEYS.filter((k) => glyphs.has(k)).map((k) => (
            <li key={k} data-glyph-key={k}>
              <Glyph reason={k} />
              {` ${capitalise(k === 'undeclared' ? 'a reason this analysis does not define' : k.replace(/-/g, ' '))} (${glyphName(k)})`}
            </li>
          ))}
        </ul>
      )}
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

function bandKey(b: Band): string {
  return b.groupId ?? '';
}

/** A band's label; the remainder is worded rather than left blank. */
function bandLabel(b: Band, axis: AxisLayout): string {
  if (b.label !== undefined) return b.label;
  const named = (axis.bands ?? []).flatMap((x) => (x.label === undefined ? [] : [x.label]));
  return named.length === 0 ? 'In none of the chosen groups' : `Not in ${named.join(' or ')}`;
}

/** A trailing phrase (", the datum") as a sentence of its own ("The datum."); nothing if it has no words. */
function asSentence(phrase: string): string {
  const bare = phrase.replace(/^[\s,;.]+/, '').replace(/[\s,;.]+$/, '');
  return bare ? `${capitalise(bare)}.` : '';
}

/**
 * Open threads anchored exactly on each position, keyed `alt\0crit` for a cell,
 * `a:id` and `c:id` for headers, and `''` for the analysis. Live anchors only:
 * an orphan is the orphan tray's.
 */
function openThreadCounts(analysis: Analysis): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of analysis.threads) {
    if (t.resolved || resolveAnchor(analysis, t.anchor).status !== 'live') continue;
    const { scope, alternativeId, criterionId } = t.anchor;
    const key = scope === 'cell' ? `${alternativeId}\u0000${criterionId}`
      : scope === 'alternative' ? `a:${alternativeId}` : scope === 'criterion' ? `c:${criterionId}` : scope === 'analysis' ? '' : undefined;
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The open-thread mark: a bubble and a count for the eye, the count in words for the ear. */
function ThreadMark({ count, quiet = false }: { count: number | undefined; quiet?: boolean }) {
  if (!count) return null;
  return (
    <>
      <span class="comparanda-thread-mark" aria-hidden="true">
        <svg viewBox="0 0 12 12" class="comparanda-thread-icon" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 2h9v6h-5l-2.5 2.5V8h-1.5z" /></svg>
        {!quiet && String(count)}
      </span>
      {!quiet && <span class="comparanda-sr">{` ${count} open discussion thread${count === 1 ? '' : 's'}.`}</span>}
    </>
  );
}
