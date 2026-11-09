/**
 * The matrix's layout: which alternatives and criteria are shown, in what
 * order, on which axis, and in which group bands -- read from the analysis and
 * the reader's view state, with no DOM (ADR-0005), so that every view lays the
 * matrix out the same way and a test can check it in plain Node.
 *
 * Three rules a renderer would otherwise each get slightly wrong:
 *
 * - **A view state never hides what it has not heard of.** View state is the
 *   reader's and outlives document edits; an alternative added after the view
 *   was saved is shown, after the ordered ones, in document order. Ids the
 *   document no longer has, or has tombstoned, are dropped.
 * - **Hiding is a filter, not a deletion** (`ViewState.filter`), and a hidden
 *   entity is simply absent from the layout.
 * - **Groups are tags, not a partition** (ADR-0008), but a table row can stand
 *   in one place. Banding by several groups puts each entity in the band of
 *   the first chosen group it belongs to (in the order chosen), says which
 *   other chosen groups it is also in, and keeps the axis order inside a band.
 *   Entities in none of the chosen groups form a last, unlabelled band. One
 *   nesting level is rendered; a sub-group's members count as its parent's.
 *
 * And one for both axes banded: **a block with nothing in it to show is
 * omitted** (`omittedBlocks`, #93). A band-by-band block of two cells or more
 * whose every cell is declared structurally inapplicable, and shows nothing
 * else, is drawn as one cell saying so, never as a rectangle of the same blank
 * repeated.
 */
import type { Analysis } from './schema/analysis.js';
import { pickableGroups, type Axis } from './schema/groups.js';
import type { InapplicableBlock } from './schema/structure.js';
import type { ViewState } from './view-state.js';

/** One alternative or criterion as laid out. */
export interface LayoutEntry {
  id: string;
  label: string;
  /** With banding: the other chosen groups this entity is in, besides its band's. */
  alsoIn: string[];
}

/** A contiguous run of entries under one chosen group, or the remainder. */
export interface Band {
  /** The group; `undefined` for the entries in none of the chosen groups. */
  groupId: string | undefined;
  /** The group's label; `undefined` for the remainder, which the view words. */
  label: string | undefined;
  entries: LayoutEntry[];
}

/** One axis of the layout. `entries` is the shown order, band by band when banded. */
export interface AxisLayout {
  axis: Axis;
  entries: LayoutEntry[];
  /** Absent when the axis is not grouped, none of its chosen groups exists with a live member, or nothing is shown. */
  bands: Band[] | undefined;
}

/** The whole layout: rows and columns, already swapped when transposed. */
export interface MatrixLayout {
  rows: AxisLayout;
  columns: AxisLayout;
  transposed: boolean;
}

/** Lay out `a` as `view` arranges it. Reads both; writes neither. */
export function matrixLayout(a: Analysis, view: ViewState): MatrixLayout {
  const alternatives = axisLayout(a, 'alternatives', view.alternativeOrder.order, view.filter.hiddenAlternatives, view.grouping.alternatives);
  const criteria = axisLayout(a, 'criteria', view.criterionOrder.order, view.filter.hiddenCriteria, view.grouping.criteria);
  return view.transposed
    ? { rows: criteria, columns: alternatives, transposed: true }
    : { rows: alternatives, columns: criteria, transposed: false };
}

function axisLayout(
  a: Analysis,
  axis: Axis,
  order: readonly string[],
  hidden: readonly string[],
  grouping: readonly string[],
): AxisLayout {
  const entities = axis === 'alternatives' ? a.alternatives : a.criteria;
  const live = new Map(entities.filter((e) => !e.tombstoned).map((e) => [e.id, e.label]));
  const placed = new Set<string>();
  for (const id of order) if (live.has(id)) placed.add(id);
  for (const id of live.keys()) placed.add(id);
  const hide = new Set(hidden);
  const shown = [...placed].filter((id) => !hide.has(id));

  // The groups a band can be drawn for are the ones the reader can pick (#342): live, with a live member.
  // Read only when the axis is grouped: membership is not worked out for a view that bands nothing.
  const groups = new Map(grouping.length > 0 ? pickableGroups(a, axis).map((g) => [g.id, g]) : []);
  const chosen = [...new Set(grouping)].filter((id) => groups.has(id));
  if (chosen.length === 0) {
    return { axis, entries: shown.map((id) => ({ id, label: live.get(id)!, alsoIn: [] })), bands: undefined };
  }

  const memberships = new Map<string, string[]>();
  for (const g of chosen) {
    for (const id of groups.get(g)!.members) memberships.set(id, [...(memberships.get(id) ?? []), g]);
  }
  const entry = (id: string): LayoutEntry => ({ id, label: live.get(id)!, alsoIn: (memberships.get(id) ?? []).slice(1) });
  const bands: Band[] = [
    ...chosen.map((g) => ({
      groupId: g as string | undefined,
      label: groups.get(g)!.label as string | undefined,
      entries: shown.filter((id) => memberships.get(id)?.[0] === g).map(entry),
    })),
    { groupId: undefined, label: undefined, entries: shown.filter((id) => !memberships.has(id)).map(entry) },
  ].filter((b) => b.entries.length > 0);
  // Nothing shown: no bands either, so a view never draws an empty band row.
  return { axis, entries: bands.flatMap((b) => b.entries), bands: bands.length > 0 ? bands : undefined };
}

/**
 * A focus as the layout can show it (#283): an id the layout does not show
 * (hidden, tombstoned, gone) is dropped, so a focus on a hidden row's cell
 * becomes its column's header, and one on nothing shown becomes the corner.
 * The same focus, unchanged, when everything it names is shown. (Inside an
 * omitted block the grid's stop is the block's first cell, which only the view
 * can say: this keeps the ids the layout shows.)
 */
export function focusInLayout(layout: MatrixLayout, focus: ViewState['session']['focus']): ViewState['session']['focus'] {
  const on = (axis: 'alternatives' | 'criteria', id: string | undefined) =>
    id === undefined || (layout.rows.axis === axis ? layout.rows : layout.columns).entries.some((e) => e.id === id);
  const a = on('alternatives', focus?.alternativeId), c = on('criteria', focus?.criterionId);
  if (a && c) return focus;
  const { alternativeId, criterionId } = focus!;
  return a && alternativeId !== undefined ? { alternativeId } : c && criterionId !== undefined ? { criterionId } : undefined;
}

/**
 * A band-by-band block drawn as one cell (#93): its first and last row and
 * column, as indices into the layout's `rows.entries` and `columns.entries`,
 * the bands it lies in, how many cells it stands for, and their shared reason
 * and group pair.
 */
export interface OmittedBlock {
  rows: { first: number; last: number };
  columns: { first: number; last: number };
  rowBand: Band;
  columnBand: Band;
  cells: number;
  /** The reason of the declaration that covers the whole block, else the one every cell's declaration gives alike. */
  reason: string | undefined;
  /**
   * The group pair, `[alternativeGroupId, criterionGroupId]`, of the declaration that covers the whole block (#323), else
   * the one every cell's declaration names (#303): a block a band merges from several declarations is about none of them alone.
   */
  pair: readonly [string, string] | undefined;
}

/**
 * The blocks of a matrix banded on both axes in which every cell is omitted:
 * `omits(alternativeId, criterionId)` gives the declared blocks a cell is in
 * (every one, in declaration order, since groups overlap) when the cell shows
 * nothing but that (no value, no recorded absence of its own, nothing anchored
 * on it), and none otherwise. One cell that shows anything keeps its whole
 * block drawn cell by cell, and a block of one cell is that cell: there is
 * nothing to gather.
 */
export function omittedBlocks(
  layout: MatrixLayout,
  omits: (alternativeId: string, criterionId: string) => readonly InapplicableBlock[],
): OmittedBlock[] {
  const { rows, columns, transposed } = layout;
  if (!rows.bands || !columns.bands) return [];
  const spans = (bands: Band[]) => {
    let next = 0;
    return bands.map((band) => ({ band, first: next, last: (next += band.entries.length) - 1 }));
  };
  const pairKey = (d: InapplicableBlock) => `${d.alternativeGroupId}\u0000${d.criterionGroupId}`;
  const blocks: OmittedBlock[] = [];
  for (const r of spans(rows.bands)) {
    for (const c of spans(columns.bands)) {
      /** Each cell's declarations, empty when the cell shows anything of its own. */
      const lists = r.band.entries.flatMap((re) => c.band.entries.map((ce) => (transposed ? omits(ce.id, re.id) : omits(re.id, ce.id))));
      if (lists.length < 2 || lists.some((l) => l.length === 0)) continue;
      const declarations = lists.map((l) => l[0]!);
      /** What every declaration says alike, by `key`; nothing when any two differ. */
      const shared = (key: (d: InapplicableBlock) => string | undefined) => {
        const said = new Set(declarations.map(key));
        return said.size === 1 ? [...said][0] : undefined;
      };
      // The declarations that cover the whole block, by pair (not identity: a reader may rebuild its objects). When
      // several do (a parent group declared beside a child's), the block is the one for the bands it is drawn under.
      const common = lists.reduce((all, l) => all.filter((d) => l.some((x) => pairKey(x) === pairKey(d))));
      const [alternativeBand, criterionBand] = transposed ? [c.band, r.band] : [r.band, c.band];
      const covering = common.find((d) => d.alternativeGroupId === alternativeBand.groupId && d.criterionGroupId === criterionBand.groupId) ?? common[0];
      const { alternativeGroupId, criterionGroupId } = covering ?? declarations[0]!;
      const onePair = covering !== undefined || shared(pairKey) !== undefined;
      blocks.push({
        rows: { first: r.first, last: r.last }, columns: { first: c.first, last: c.last }, rowBand: r.band, columnBand: c.band,
        cells: lists.length, reason: covering ? covering.reason : shared((d) => d.reason),
        pair: onePair ? [alternativeGroupId, criterionGroupId] : undefined,
      });
    }
  }
  return blocks;
}

/** The ids the reader shows, each axis in the reader's order: what the analysis panels list (#292). */
export interface Shown {
  alternatives: readonly string[];
  criteria: readonly string[];
}

/** What a layout shows, by axis rather than by rows and columns: transposed or not, the same ids. */
export function shownOf(layout: Pick<MatrixLayout, 'rows' | 'columns' | 'transposed'>): Shown {
  const ids = (axis: AxisLayout) => axis.entries.map((e) => e.id);
  const { rows, columns, transposed } = layout;
  return transposed ? { alternatives: ids(columns), criteria: ids(rows) } : { alternatives: ids(rows), criteria: ids(columns) };
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
