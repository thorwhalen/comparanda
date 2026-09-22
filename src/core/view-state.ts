/**
 * View state: how one reader has arranged an analysis, and whether that
 * arrangement differs from the saved view they loaded (#53, #70).
 *
 * **Not part of the analysis document.** Order, selection, grouping choice,
 * encoding, sort, filter and orientation are per-user and per-moment (ADR-0006,
 * ADR-0008: groups are data, selection is view state). None of this is in
 * `Analysis`, none of it is in the emitted JSON Schema that is the cross-repo
 * contract, and no function here takes an analysis to write to: an operation on
 * view state *cannot* touch the document.
 *
 * **Separately versioned.** `schemaVersion` here is the view-state version, and
 * it migrates on its own chain (`viewStateMigrations`), independently of the
 * document's `SCHEMA_VERSION` (skills/comparanda-dev-schema-change).
 *
 * **Three classes of field** (ADR-0007, amendment of 2026-08-21), declared
 * beside the fields in `VIEW_STATE_FIELD_CLASSES` rather than inside the
 * comparison:
 *
 * - **arrangement** -- what the reader arranged. Saved with a view, compared
 *   for dirty state, individually revertable.
 * - **derivation** -- `AxisOrder.provenance`: how an order was arrived at.
 *   Saved and restored, never compared, so a re-seriation that lands on the
 *   identical order does not mark a clean view modified.
 * - **session** -- where the reader is: the roving `tabindex` position
 *   (ADR-0027), whether the detail panel is open. Persisted with the reader's
 *   working state, never written into a saved view, never compared.
 *
 * The schema is strict: a field nobody classified fails to parse rather than
 * silently joining the dirty-state dimensions.
 *
 * Pure functions throughout; no DOM (ADR-0005).
 */
import * as z from 'zod/mini';

import { createMigrationChain, type MigrationResult } from './migrations.js';
import type { Analysis } from './schema/analysis.js';
import type { Axis } from './schema/groups.js';

/** The view-state schema version. Independent of the analysis `SCHEMA_VERSION`. */
export const VIEW_STATE_VERSION = 1;

/** Which axis a view-state operation applies to. The same spelling `Group.axis` uses. */
const AxisName = z.enum(['alternatives', 'criteria']);

/**
 * How an order was arrived at (ADR-0025, ADR-0007 amendment clause 1).
 *
 * - `authored` -- the order the analysis document lists them in.
 * - `manual`   -- a person moved things; `by` names them.
 * - `sorted`   -- a single-criterion sort, which ADR-0008 treats as seriation
 *                 on a one-criterion input; `by` names who asked, if known.
 * - `seriated` -- computed. Carries the method and every parameter needed to
 *                 answer "why is it in this order" and to re-derive it.
 */
export const OrderProvenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authored') }),
  z.object({
    kind: z.literal('manual'),
    /** The user who arranged it. Required: an unattributed hand arrangement cannot be explained. */
    by: z.string(),
    at: z.optional(z.string()),
  }),
  z.object({
    kind: z.literal('sorted'),
    criterionId: z.string(),
    measure: z.string(),
    direction: z.enum(['best-first', 'worst-first']),
    by: z.optional(z.string()),
    at: z.optional(z.string()),
  }),
  z.object({
    kind: z.literal('seriated'),
    method: z.string(),
    /** Required: ADR-0025 says the record carries it, enough to re-derive the order. */
    linkage: z.string(),
    measure: z.string(),
    distance: z.string(),
    /** ADR-0025's two policies, and only those. */
    missingPolicy: z.enum(['structural-matches', 'skip-all']),
    minOverlap: z.number(),
    /** Achieved Hamiltonian path length. */
    pathLength: z.number(),
    /** Ids left out for too little overlap -- visibly parked, never dropped (ADR-0025). */
    parked: z._default(z.array(z.string()), []),
    /** Any further method parameters, so a run can be reproduced exactly. */
    params: z._default(z.record(z.string(), z.unknown()), {}),
    at: z.optional(z.string()),
  }),
]);
export type OrderProvenance = z.infer<typeof OrderProvenance>;

/**
 * Pins and locked runs: **inputs** to seriation, never overrides applied to its
 * output (ADR-0025). They sit beside `order`, not inside `provenance`, because
 * they survive re-runs and outlive any one method.
 */
export const OrderConstraints = z.object({
  /** An id held at a position. */
  pins: z._default(z.array(z.object({ id: z.string(), position: z.number() })), []),
  /** Runs of ids kept contiguous and in this order. */
  lockedRuns: z._default(z.array(z.array(z.string())), []),
});
export type OrderConstraints = z.infer<typeof OrderConstraints>;

/** An explained order: the arrangement, how it came about, and what constrains it. */
export const AxisOrder = z.object({
  order: z.array(z.string()),
  provenance: OrderProvenance,
  constraints: z._default(OrderConstraints, { pins: [], lockedRuns: [] }),
});
export type AxisOrder = z.infer<typeof AxisOrder>;

/** The reader's selection. Here, and never in the analysis document (ADR-0008). */
export const Selection = z.object({
  alternatives: z._default(z.array(z.string()), []),
  criteria: z._default(z.array(z.string()), []),
  cells: z._default(z.array(z.object({ alternativeId: z.string(), criterionId: z.string() })), []),
});
export type Selection = z.infer<typeof Selection>;

/**
 * Which of the document's groups each axis is currently grouped by. The groups
 * themselves are data in the analysis; *choosing to group by them* is view
 * state. Empty means ungrouped.
 */
export const Grouping = z.object({
  alternatives: z._default(z.array(z.string()), []),
  criteria: z._default(z.array(z.string()), []),
});
export type Grouping = z.infer<typeof Grouping>;

/** A plain sort request. The order it produced is recorded in `AxisOrder`. */
export const Sort = z.object({
  axis: AxisName,
  criterionId: z.string(),
  measure: z.string(),
  direction: z.enum(['best-first', 'worst-first']),
});
export type Sort = z.infer<typeof Sort>;

/** What is hidden from this view. Hiding is view state; deleting is not. */
export const Filter = z.object({
  hiddenAlternatives: z._default(z.array(z.string()), []),
  hiddenCriteria: z._default(z.array(z.string()), []),
});
export type Filter = z.infer<typeof Filter>;

/**
 * Where the reader is. The roving `tabindex` position (ADR-0027) is kept by id,
 * never by index, so a reorder does not move the cursor to a different cell:
 * both ids name a cell, one names a header, none is the corner.
 */
export const Session = z.object({
  focus: z.optional(z.object({
    alternativeId: z.optional(z.string()),
    criterionId: z.optional(z.string()),
  })),
  detailPanelOpen: z.optional(z.boolean()),
});
export type Session = z.infer<typeof Session>;

export const ViewState = z.strictObject({
  schemaVersion: z.literal(VIEW_STATE_VERSION),
  alternativeOrder: AxisOrder,
  criterionOrder: AxisOrder,
  grouping: z._default(Grouping, { alternatives: [], criteria: [] }),
  selection: z._default(Selection, { alternatives: [], criteria: [], cells: [] }),
  /** The active encoding's registered id. v1 ships `text-only` (ADR-0032). */
  encoding: z._default(z.string(), 'text-only'),
  sort: z.optional(Sort),
  filter: z._default(Filter, { hiddenAlternatives: [], hiddenCriteria: [] }),
  /** Alternatives as rows is the convention, not a law (ADR-0008). */
  transposed: z._default(z.boolean(), false),
  session: z._default(Session, {}),
});
export type ViewState = z.infer<typeof ViewState>;

export type FieldClass = 'arrangement' | 'session';

/**
 * The class of every top-level view-state field (besides `schemaVersion`).
 *
 * `satisfies` makes the compiler refuse a field added to `ViewState` without a
 * class. The derivation class lives one level down -- `provenance` inside each
 * `AxisOrder` -- and is handled by `arrangementOf`, which is the only place an
 * `AxisOrder` is reduced for comparison.
 */
export const VIEW_STATE_FIELD_CLASSES = Object.freeze({
  alternativeOrder: 'arrangement',
  criterionOrder: 'arrangement',
  grouping: 'arrangement',
  selection: 'arrangement',
  encoding: 'arrangement',
  sort: 'arrangement',
  filter: 'arrangement',
  transposed: 'arrangement',
  session: 'session',
} as const satisfies Record<Exclude<keyof ViewState, 'schemaVersion'>, FieldClass>);

/** A dirty-state dimension: an arrangement field, keyed by schema field, never by label. */
export type Dimension = {
  [K in keyof typeof VIEW_STATE_FIELD_CLASSES]: (typeof VIEW_STATE_FIELD_CLASSES)[K] extends 'arrangement' ? K : never
}[keyof typeof VIEW_STATE_FIELD_CLASSES];

export const DIMENSIONS: readonly Dimension[] = Object.freeze(
  (Object.keys(VIEW_STATE_FIELD_CLASSES) as (keyof typeof VIEW_STATE_FIELD_CLASSES)[])
    .filter((k): k is Dimension => VIEW_STATE_FIELD_CLASSES[k] === 'arrangement'),
);

/**
 * A saved view's content: the arrangement with its derivation, and no session.
 * ADR-0007: a cursor position is not part of what was arranged.
 */
export type SavedViewState = Omit<ViewState, 'session'>;

export function snapshotOf(v: ViewState): SavedViewState {
  const { session: _session, ...saved } = structuredClone(v);
  return saved;
}

/** The comparable part of one dimension. Provenance is derivation, so it is dropped here. */
function arrangementOf(v: SavedViewState, d: Dimension): unknown {
  const value = v[d];
  const sorted = (xs: readonly string[]) => [...xs].sort();
  if (d === 'alternativeOrder' || d === 'criterionOrder') {
    const o = value as AxisOrder;
    // Order is a list; its constraints are sets. Pins by id, locked runs by
    // their contents (the order *inside* a run is meaningful and kept).
    return {
      order: o.order,
      constraints: {
        pins: [...o.constraints.pins].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : x.position - y.position)),
        lockedRuns: [...o.constraints.lockedRuns].sort((x, y) => {
          const a = JSON.stringify(x), b = JSON.stringify(y);
          return a < b ? -1 : a > b ? 1 : 0;
        }),
      },
    };
  }
  if (d === 'selection') {
    const s = value as Selection;
    return {
      alternatives: sorted(s.alternatives),
      criteria: sorted(s.criteria),
      cells: [...s.cells].map((c) => `${JSON.stringify([c.alternativeId, c.criterionId])}`).sort(),
    };
  }
  if (d === 'filter') {
    const f = value as Filter;
    return { hiddenAlternatives: sorted(f.hiddenAlternatives), hiddenCriteria: sorted(f.hiddenCriteria) };
  }
  return value;
}

/** JSON with keys sorted, so two structurally equal values compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    }
    return v;
  }) ?? 'undefined';
}

/**
 * The dimensions in which `current` differs from the loaded `snapshot`
 * (ADR-0007 clause 2). Structural, so undoing a change back to the original
 * clears it; provenance and session are never compared.
 */
export function dirtyDimensions(current: ViewState | SavedViewState, snapshot: SavedViewState): Dimension[] {
  return DIMENSIONS.filter((d) => canonical(arrangementOf(current, d)) !== canonical(arrangementOf(snapshot, d)));
}

/** Whether the "Modified" marker shows: some dimension differs. */
export function isDirty(current: ViewState | SavedViewState, snapshot: SavedViewState): boolean {
  return dirtyDimensions(current, snapshot).length > 0;
}

/** Revert one dimension to the snapshot, keeping everything else (ADR-0007 clause 2). */
export function revertDimension(current: ViewState, snapshot: SavedViewState, d: Dimension): ViewState {
  return { ...current, [d]: structuredClone(snapshot[d]) } as ViewState;
}

/** Revert every dimension; the session (where the reader is) is kept. */
export function revertAll(current: ViewState, snapshot: SavedViewState): ViewState {
  return { ...structuredClone(snapshot), session: current.session };
}

// --- operations. Each returns a new ViewState and never touches an analysis. ---

const orderKey = (axis: Axis) => (axis === 'alternatives' ? 'alternativeOrder' : 'criterionOrder');

/** Replace an axis order: a manual move, a sort, or a seriation run's result. */
export function applyOrder(v: ViewState, axis: Axis, order: readonly string[], provenance: OrderProvenance): ViewState {
  const key = orderKey(axis);
  return { ...v, [key]: { ...v[key], order: [...order], provenance: structuredClone(provenance) } };
}

export function setGrouping(v: ViewState, axis: Axis, groupIds: readonly string[]): ViewState {
  return { ...v, grouping: { ...v.grouping, [axis]: [...groupIds] } };
}

export function setSelection(v: ViewState, selection: Partial<Selection>): ViewState {
  return {
    ...v,
    selection: {
      alternatives: [...(selection.alternatives ?? [])],
      criteria: [...(selection.criteria ?? [])],
      cells: (selection.cells ?? []).map((c) => ({ ...c })),
    },
  };
}

export function setEncoding(v: ViewState, encoding: string): ViewState {
  return { ...v, encoding };
}

export function setSort(v: ViewState, sort: Sort | undefined): ViewState {
  const { sort: _old, ...rest } = v;
  return sort === undefined ? rest as ViewState : { ...rest, sort: { ...sort } };
}

export function setFilter(v: ViewState, filter: Partial<Filter>): ViewState {
  return {
    ...v,
    filter: {
      hiddenAlternatives: [...(filter.hiddenAlternatives ?? v.filter.hiddenAlternatives)],
      hiddenCriteria: [...(filter.hiddenCriteria ?? v.filter.hiddenCriteria)],
    },
  };
}

/** Swap which axis is rows. Orders, selection and focus are by id, so nothing else moves. */
export function transpose(v: ViewState): ViewState {
  return { ...v, transposed: !v.transposed };
}

/** Pin an id at a position: an input to the next seriation run, not an edit of its output. */
export function pin(v: ViewState, axis: Axis, id: string, position: number): ViewState {
  const key = orderKey(axis);
  const pins = v[key].constraints.pins.filter((p) => p.id !== id).concat({ id, position });
  return { ...v, [key]: { ...v[key], constraints: { ...v[key].constraints, pins } } };
}

export function unpin(v: ViewState, axis: Axis, id: string): ViewState {
  const key = orderKey(axis);
  const pins = v[key].constraints.pins.filter((p) => p.id !== id);
  return { ...v, [key]: { ...v[key], constraints: { ...v[key].constraints, pins } } };
}

/** Keep a run contiguous and in this order through re-runs. */
export function lockRun(v: ViewState, axis: Axis, run: readonly string[]): ViewState {
  const key = orderKey(axis);
  const lockedRuns = [...v[key].constraints.lockedRuns.map((r) => [...r]), [...run]];
  return { ...v, [key]: { ...v[key], constraints: { ...v[key].constraints, lockedRuns } } };
}

export function unlockRun(v: ViewState, axis: Axis, run: readonly string[]): ViewState {
  const key = orderKey(axis);
  const same = (r: readonly string[]) => r.length === run.length && r.every((x, i) => x === run[i]);
  const lockedRuns = v[key].constraints.lockedRuns.filter((r) => !same(r)).map((r) => [...r]);
  return { ...v, [key]: { ...v[key], constraints: { ...v[key].constraints, lockedRuns } } };
}

/** Move the roving `tabindex`. Session state: it never marks a view modified. */
export function setFocus(v: ViewState, focus: Session['focus']): ViewState {
  const session: Session = { ...v.session };
  if (focus === undefined) delete session.focus;
  else session.focus = { ...focus };
  return { ...v, session };
}

// --- creation, persistence and migration ---

/**
 * The view state a reader starts from: the document's own order, with
 * tombstoned entities left out. Reads the analysis; never writes it.
 */
export function initialViewState(a: Analysis): ViewState {
  return ViewState.parse({
    schemaVersion: VIEW_STATE_VERSION,
    alternativeOrder: { order: a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id), provenance: { kind: 'authored' } },
    criterionOrder: { order: a.criteria.filter((x) => !x.tombstoned).map((x) => x.id), provenance: { kind: 'authored' } },
  });
}

/**
 * View state's own migration chain, at version 1 with no steps. Registration is
 * the composition root's job, never this module's (ADR-0017 clause 4).
 */
export const viewStateMigrations = createMigrationChain({ currentVersion: VIEW_STATE_VERSION });

/** Serialise the reader's working view state, session included, for their own store. */
export function serializeViewState(v: ViewState): string {
  return JSON.stringify(ViewState.parse(v));
}

/**
 * Read persisted view state: migrate on the view-state chain, then validate.
 * Throws with the problems rather than returning a half-read state.
 */
export function parseViewState(json: string): { state: ViewState; migration: MigrationResult } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`not a valid view state: not JSON (${(e as Error).message})`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('not a valid view state: expected a JSON object');
  }
  let migration: MigrationResult;
  try {
    migration = viewStateMigrations.migrate(raw as Record<string, unknown>);
  } catch (e) {
    throw new Error(`view state: ${(e as Error).message}`);
  }
  const parsed = ViewState.safeParse(migration.document);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`not a valid view state: ${problems}`);
  }
  return { state: parsed.data, migration };
}
