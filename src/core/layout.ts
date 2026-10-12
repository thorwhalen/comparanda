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
 */
import type { Analysis } from './schema/analysis.js';
import { axisGroups, membersOfGroup, type Axis } from './schema/groups.js';
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
  /** Absent when the axis is not grouped, none of its chosen groups exists, or nothing is shown. */
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

  const groups = new Map(a.groups.filter((g) => g.axis === axis && !g.tombstoned).map((g) => [g.id, g.label]));
  const chosen = [...new Set(grouping)].filter((id) => groups.has(id));
  if (chosen.length === 0) {
    return { axis, entries: shown.map((id) => ({ id, label: live.get(id)!, alsoIn: [] })), bands: undefined };
  }

  const space = axisGroups(a, axis);
  const memberships = new Map<string, string[]>();
  for (const g of chosen) {
    for (const id of membersOfGroup(space, g)) memberships.set(id, [...(memberships.get(id) ?? []), g]);
  }
  const entry = (id: string): LayoutEntry => ({ id, label: live.get(id)!, alsoIn: (memberships.get(id) ?? []).slice(1) });
  const bands: Band[] = [
    ...chosen.map((g) => ({
      groupId: g as string | undefined,
      label: groups.get(g) as string | undefined,
      entries: shown.filter((id) => memberships.get(id)?.[0] === g).map(entry),
    })),
    { groupId: undefined, label: undefined, entries: shown.filter((id) => !memberships.has(id)).map(entry) },
  ].filter((b) => b.entries.length > 0);
  // Nothing shown: no bands either, so a view never draws an empty band row.
  return { axis, entries: bands.flatMap((b) => b.entries), bands: bands.length > 0 ? bands : undefined };
}
