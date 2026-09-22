/**
 * One move, and one sentence about it (#75, ADR-0027, ADR-0008 as amended).
 *
 * Every reorder route -- the move menu, keyboard grab mode, pointer drag --
 * goes through `moveTo`, and every announcement comes from `describeMove`.
 * ADR-0027: *"Not one per route, and not in the view: the move menu, the grab
 * mode and the pointer drag must say identical things, and the only way to
 * guarantee that is a single function on the headless side of the ADR-0005
 * boundary."* The three route helpers below are the thin translations of a
 * gesture into `(from, to)`; deleting the pointer one leaves the keyboard path
 * untouched, which is the deletability ADR-0008's amendment asks for.
 *
 * **Indices, not ids.** `moveTo(view, axis, from, to)` takes positions in the
 * axis order, as #75 specifies and as the announcement reads them back
 * ("column 4 of 12"). A handle knows its own index; ids are the caller's to
 * resolve. Everything else in view state stays keyed by id, so focus and pins
 * survive the move.
 *
 * **Constraints are honoured, not silently dropped** (ADR-0008, ADR-0025):
 *
 * - Moving a member of a **locked run** moves the whole run, keeping it
 *   contiguous and in its declared order -- provided it *is* contiguous and in
 *   that order to begin with. If a hand arrangement has already broken it, only
 *   the handle moves and the report says the run was not honoured, rather than
 *   quietly re-forming a run the reader took apart.
 * - A move that would land **inside** another locked run stops at that run's
 *   near edge rather than splitting it, and says so.
 * - A **pin** is `{ id, position }` and is an *input to the next seriation run*
 *   (ADR-0025), not a description of the current hand arrangement. A move
 *   therefore leaves every pin exactly as the reader set it: rewriting them to
 *   the new indices would both discard what the pin was asking for and break
 *   ADR-0007 clause 2, since moving something away and back would restore the
 *   order while leaving the pins changed, marking a clean view modified for
 *   ever. What the move does instead is *report* the pins it left describing
 *   somebody else's position, in `pinsDisplaced`, and `describeMove` says so.
 *
 * **A no-op move records nothing.** Asking for the position a thing already
 * occupies leaves the order *and its provenance* untouched, so it cannot mark a
 * clean view modified (ADR-0007).
 *
 * No DOM, no clock: `at` is a parameter, so the same move announces and records
 * identically twice.
 */
import type { Analysis } from './schema/analysis.js';
import type { Axis } from './schema/groups.js';
import type { ViewState } from './view-state.js';

/** Which gesture asked for a move. Carried for logging; never part of the sentence. */
export type MoveRoute = 'keyboard' | 'menu' | 'pointer';

/** What a move did, and everything `describeMove` needs to say so. */
export interface MoveReport {
  axis: Axis;
  /** The entry on the handle that was moved. */
  id: string;
  /** Where it was, and where it ended up: 0-based indices in the axis order. */
  from: number;
  to: number;
  /** How many entries the axis holds, so a position can be read as "of n". */
  total: number;
  /** The entry now immediately before it, when it is not first. */
  before?: string;
  /** Entries that travelled with it because a locked run keeps them together. */
  carried: string[];
  /** A locked run covering `id` that the current order had already broken. */
  brokenRun?: string[];
  /**
   * Set when the requested index could not be honoured, and why:
   *
   * - `range`             past the first or last position.
   * - `locked-run-split`  the landing point was inside another locked run, so
   *                       it stopped at that run's near edge.
   * - `locked-run-block`  the entries locked to this one travel with it, and
   *                       they have to occupy the positions it asked for.
   */
  clamped?: 'range' | 'locked-run-split' | 'locked-run-block';
  /**
   * Pins this move left describing somebody else's position: they named the
   * index their entry sat at, and it no longer does. Pins are **not** rewritten
   * (see the module note), so this is what a reader has to be told.
   */
  pinsDisplaced: { id: string; pinnedTo: number; nowAt: number }[];
  /** True when nothing moved; no provenance was recorded. */
  noOp: boolean;
  route: MoveRoute;
  /** Whether the axis was drawn as columns at the time, for the wording. */
  transposed: boolean;
}

export interface MoveOutcome {
  state: ViewState;
  report: MoveReport;
}

/** Who moved it, and when -- a parameter, never a hidden clock. */
export interface MoveAttribution {
  by: string;
  at?: string;
  /** Recorded on the report only; the sentence is identical whichever it was. */
  route?: MoveRoute;
}

const orderKeyOf = (axis: Axis) => (axis === 'alternatives' ? 'alternativeOrder' : 'criterionOrder');

/** The contiguous, declared-order occurrences of each locked run in `order`. */
function runBlocks(order: readonly string[], lockedRuns: readonly (readonly string[])[]): { start: number; end: number; run: readonly string[] }[] {
  const blocks: { start: number; end: number; run: readonly string[] }[] = [];
  for (const run of lockedRuns) {
    if (run.length < 2) continue;
    const start = order.indexOf(run[0]!);
    if (start < 0) continue;
    const placed = run.every((id, k) => order[start + k] === id);
    if (placed) blocks.push({ start, end: start + run.length - 1, run });
  }
  return blocks;
}

/** The entries that must move together with the entry at `from`. */
function blockAt(
  order: readonly string[],
  from: number,
  lockedRuns: readonly (readonly string[])[],
): { ids: string[]; offset: number; brokenRun?: readonly string[] } {
  const id = order[from]!;
  const run = lockedRuns.find((r) => r.length > 1 && r.includes(id));
  if (!run) return { ids: [id], offset: 0 };
  const block = runBlocks(order, [run])[0];
  if (!block) return { ids: [id], offset: 0, brokenRun: run };
  return { ids: order.slice(block.start, block.end + 1), offset: from - block.start };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Move the entry at `from` to `to` on one axis, honouring pins and locked runs.
 *
 * `from` must be a position on the axis -- a route asking to move a position
 * that does not exist is a bug, so it throws rather than guessing. `to` is
 * clamped into the axis instead: "move later" from the last position is a
 * reader pressing a key one more time, and the honest answer is that it is
 * already last.
 */
export function moveTo(
  v: ViewState,
  axis: Axis,
  from: number,
  to: number,
  { by, at, route = 'menu' }: MoveAttribution,
): MoveOutcome {
  const key = orderKeyOf(axis);
  const current = v[key].order;
  const total = current.length;
  if (!Number.isInteger(from) || from < 0 || from >= total) {
    throw new Error(
      `cannot move ${axis} position ${from}: the axis holds ${total} ` +
        `${total === 1 ? 'entry' : 'entries'}, so positions run 0..${total - 1}.`,
    );
  }
  const requested = Math.trunc(to);
  const bounded = clamp(requested, 0, total - 1);
  const { lockedRuns, pins } = v[key].constraints;
  const { ids, offset, brokenRun } = blockAt(current, from, lockedRuns);

  const moving = new Set(ids);
  const rest = current.filter((x) => !moving.has(x));
  // Where the block's first entry goes, so the handle itself lands on `bounded`.
  let insertAt = clamp(bounded - offset, 0, rest.length);
  let clamped: MoveReport['clamped'] = bounded !== requested ? 'range' : undefined;

  // Never split another locked run: stop at its near edge instead. A tie goes
  // to the earlier edge, so the same request always lands in the same place.
  // Run to a fixpoint: stepping to one run's edge can land inside the next run
  // along, and a single pass in declaration order would leave it there.
  const others = runBlocks(rest, lockedRuns.filter((r) => !r.some((x) => moving.has(x))));
  for (let pass = 0; pass <= others.length; pass += 1) {
    const inside = others.find((b) => insertAt > b.start && insertAt <= b.end);
    if (!inside) break;
    insertAt = insertAt - inside.start <= inside.end + 1 - insertAt ? inside.start : inside.end + 1;
    clamped = 'locked-run-split';
  }

  const order = [...rest.slice(0, insertAt), ...ids, ...rest.slice(insertAt)];
  const landed = insertAt + offset;
  // Dragging a member of a run to a position its own run has to occupy: the run
  // wins, nothing was split, and the report says which of the two it was.
  if (landed !== bounded && clamped === undefined) clamped = 'locked-run-block';
  const noOp = order.every((x, i) => x === current[i]);
  if (noOp) {
    return {
      state: v,
      report: {
        axis, id: current[from]!, from, to: from, total, carried: [], pinsDisplaced: [],
        noOp: true, route, transposed: v.transposed,
        ...(from > 0 ? { before: current[from - 1]! } : {}),
        ...(clamped ? { clamped } : {}),
        ...(brokenRun ? { brokenRun: [...brokenRun] } : {}),
      },
    };
  }

  // Pins are left exactly as set (see the module note). What changed is which
  // entry sits at the index a pin names, and that is reported, not repaired.
  const was = new Map(current.map((id, i) => [id, i]));
  const now = new Map(order.map((id, i) => [id, i]));
  const pinsDisplaced = pins.flatMap((p) => {
    const before = was.get(p.id);
    const after = now.get(p.id);
    // Only pins this move displaced: one that already disagreed with the order
    // is not news, and one still at its pinned index is not displaced.
    if (before === undefined || after === undefined) return [];
    if (before !== p.position || after === p.position) return [];
    return [{ id: p.id, pinnedTo: p.position, nowAt: after }];
  });

  const state: ViewState = {
    ...v,
    [key]: {
      ...v[key],
      order,
      provenance: { kind: 'manual' as const, by, ...(at === undefined ? {} : { at }) },
    },
  };

  return {
    state,
    report: {
      axis, id: current[from]!, from, to: landed, total,
      carried: ids.filter((x) => x !== current[from]),
      pinsDisplaced,
      noOp: false, route, transposed: v.transposed,
      ...(landed > 0 ? { before: order[landed - 1]! } : {}),
      ...(clamped ? { clamped } : {}),
      ...(brokenRun ? { brokenRun: [...brokenRun] } : {}),
    },
  };
}

/** Grab mode's keys (ADR-0027): arrows and `Tab` step, `Home`/`End` jump. */
export type KeyboardMove = 'earlier' | 'later' | 'to-start' | 'to-end';

/** The move menu's entries (ADR-0027), including "before…". */
export type MenuMove =
  | { kind: 'to-start' } | { kind: 'earlier' } | { kind: 'later' } | { kind: 'to-end' }
  | { kind: 'before'; id: string } | { kind: 'after'; id: string };

/**
 * Keyboard grab mode. One step per key press, `Home`/`End` to the ends -- and
 * nothing else: the move itself is `moveTo`.
 */
export function moveByKeyboard(
  v: ViewState, axis: Axis, from: number, key: KeyboardMove, who: MoveAttribution,
): MoveOutcome {
  const total = v[orderKeyOf(axis)].order.length;
  const to = key === 'earlier' ? from - 1
    : key === 'later' ? from + 1
      : key === 'to-start' ? 0
        : total - 1;
  return moveTo(v, axis, from, to, { ...who, route: 'keyboard' });
}

/**
 * The move menu. Its "before"/"after" entries name an id; the rest are positions.
 *
 * "Before X" is resolved against the order **with the moving block taken out**,
 * not by nudging an index by one: when a locked run travels with the handle,
 * `k` entries leave, and a fixed +/-1 lands the handle on the wrong side of the
 * anchor -- saying "after Montreal" while putting it before, which is precisely
 * the drift a single `describeMove` exists to prevent.
 */
export function moveByMenu(
  v: ViewState, axis: Axis, from: number, target: MenuMove, who: MoveAttribution,
): MoveOutcome {
  const key = orderKeyOf(axis);
  const order = v[key].order;
  if (!Number.isInteger(from) || from < 0 || from >= order.length) {
    // Let `moveTo` own the message for a position that does not exist.
    return moveTo(v, axis, from, from, { ...who, route: 'menu' });
  }
  const to = (): number => {
    if (target.kind === 'to-start') return 0;
    if (target.kind === 'to-end') return order.length - 1;
    if (target.kind === 'earlier') return from - 1;
    if (target.kind === 'later') return from + 1;

    const { ids, offset } = blockAt(order, from, v[key].constraints.lockedRuns);
    const moving = new Set(ids);
    if (moving.has(target.id)) {
      throw new Error(
        `cannot move ${axis} position ${from} ${target.kind} "${target.id}": ` +
          'they are locked together and move as one.',
      );
    }
    const rest = order.filter((x) => !moving.has(x));
    const anchor = rest.indexOf(target.id);
    if (anchor < 0) throw new Error(`cannot move ${axis} position ${from}: "${target.id}" is not on this axis.`);
    // The block's first entry goes at the anchor (before) or just past it
    // (after); the handle lands `offset` further along, whatever k is.
    return (target.kind === 'before' ? anchor : anchor + 1) + offset;
  };
  return moveTo(v, axis, from, to(), { ...who, route: 'menu' });
}

/** Pointer drag: a drop index, and nothing else. Deletable without touching the keyboard path. */
export function moveByPointer(
  v: ViewState, axis: Axis, from: number, dropIndex: number, who: MoveAttribution,
): MoveOutcome {
  return moveTo(v, axis, from, dropIndex, { ...who, route: 'pointer' });
}

/** Rows or columns, for this axis, under this orientation (ADR-0008: the convention, not a law). */
function geometryWord(axis: Axis, transposed: boolean): 'row' | 'column' {
  return (axis === 'alternatives') !== transposed ? 'row' : 'column';
}

function labelsOf(a: Analysis, axis: Axis): Map<string, string> {
  const entries = axis === 'alternatives' ? a.alternatives : a.criteria;
  return new Map(entries.map((e) => [e.id, e.label]));
}

function singularNoun(a: Analysis, axis: Axis): string {
  const al = a.aliases;
  const word = axis === 'alternatives' ? al?.alternative ?? 'alternative' : al?.criterion ?? 'criterion';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The plural in the analysis's own vocabulary, for counts a numeral alone would leave bare. */
function pluralNoun(a: Analysis, axis: Axis): string {
  const al = a.aliases;
  return axis === 'alternatives' ? al?.alternatives ?? 'alternatives' : al?.criteria ?? 'criteria';
}

/**
 * The announcement, and the only place it is written (ADR-0027).
 *
 * Position-of-total in the analysis's own vocabulary -- *"Criterion Memory
 * safety moved to column 4 of 12, after Startup time."* -- so a deployment that
 * calls its criteria "factors" hears "factors" here too. Never "items" or
 * "features" (ADR-0003).
 *
 * Takes a `MoveReport`, so every route that produced the same move says the
 * same sentence; the route itself is not in the text. No DOM, no clock, no
 * locale lookup: a string a live region can read as it is.
 */
export function describeMove(a: Analysis, report: MoveReport): string {
  const labels = labelsOf(a, report.axis);
  // An order may name an entry the document no longer lists; its id is the
  // honest fallback, and silence is not.
  const label = (id: string) => labels.get(id) ?? id;
  const noun = singularNoun(a, report.axis);
  const geo = geometryWord(report.axis, report.transposed);
  const at = `${geo} ${report.to + 1} of ${report.total}`;

  // Why a requested position was not reached. A run that came along is not a
  // run that was split, and saying the wrong one is worse than saying neither.
  const refusal = report.clamped === 'locked-run-split' ? 'a locked run cannot be split'
    : report.clamped === 'locked-run-block' ? `the ${pluralNoun(a, report.axis)} locked to it come with it`
      : undefined;

  const pins = report.pinsDisplaced;
  const pinNote = pins.length === 0 ? ''
    : pins.length === 1
      ? ` ${label(pins[0]!.id)} is pinned to ${geo} ${pins[0]!.pinnedTo + 1} and now sits at ${geo} ${pins[0]!.nowAt + 1}.`
      : ` ${pins.length} pins no longer name the ${geo} their ${pluralNoun(a, report.axis)} sit at.`;

  if (report.noOp) {
    return refusal === undefined
      ? `${noun} ${label(report.id)} is already ${at}.`
      : `${noun} ${label(report.id)} did not move: ${refusal}. It is still ${at}.`;
  }

  const carried = report.carried.length === 0 ? ''
    : report.carried.length <= 2
      ? `, with ${report.carried.map(label).join(' and ')} kept beside it`
      : `, with ${report.carried.length} more ${pluralNoun(a, report.axis)} kept beside it`;
  const place = report.before === undefined ? ', first' : `, after ${label(report.before)}`;
  const stopped = refusal === undefined ? '' : ` It stopped there: ${refusal}.`;

  return `${noun} ${label(report.id)} moved to ${at}${place}${carried}.${stopped}${pinNote}`;
}
