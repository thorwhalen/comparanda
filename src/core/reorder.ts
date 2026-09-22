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
 * - A **pin** is `{ id, position }`, so a move that shifts a pinned entry would
 *   leave its recorded position describing somebody else. Pins stay attached to
 *   their ids and their positions are rewritten to the arrangement the reader
 *   just made -- the pin survives the move, which is what makes it an input to
 *   the next seriation run rather than an override of this one.
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
  /** Set when the requested index could not be honoured, and why. */
  clamped?: 'range' | 'locked-run';
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
  for (const b of runBlocks(rest, lockedRuns.filter((r) => !r.some((x) => moving.has(x))))) {
    if (insertAt > b.start && insertAt <= b.end) {
      insertAt = insertAt - b.start <= b.end + 1 - insertAt ? b.start : b.end + 1;
      clamped = 'locked-run';
    }
  }

  const order = [...rest.slice(0, insertAt), ...ids, ...rest.slice(insertAt)];
  const landed = insertAt + offset;
  // Dragging a middle member of a run to the very start asks for a position the
  // members before it must occupy. The run wins, and the report says so.
  if (landed !== bounded && clamped === undefined) clamped = 'locked-run';
  const noOp = order.every((x, i) => x === current[i]);
  if (noOp) {
    return {
      state: v,
      report: {
        axis, id: current[from]!, from, to: from, total, carried: [], noOp: true, route,
        transposed: v.transposed,
        ...(landed > 0 ? { before: order[landed - 1]! } : {}),
        ...(clamped ? { clamped } : {}),
        ...(brokenRun ? { brokenRun: [...brokenRun] } : {}),
      },
    };
  }

  // Pins stay attached to their ids: rewrite each to where the reader put it.
  const movedPins = pins.map((p) => {
    const i = order.indexOf(p.id);
    return i < 0 ? { ...p } : { id: p.id, position: i };
  });

  const state: ViewState = {
    ...v,
    [key]: {
      ...v[key],
      order,
      provenance: { kind: 'manual' as const, by, ...(at === undefined ? {} : { at }) },
      constraints: { ...v[key].constraints, pins: movedPins },
    },
  };

  return {
    state,
    report: {
      axis, id: current[from]!, from, to: landed, total,
      carried: ids.filter((x) => x !== current[from]),
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

/** The move menu. Its "before"/"after" entries name an id; the rest are positions. */
export function moveByMenu(
  v: ViewState, axis: Axis, from: number, target: MenuMove, who: MoveAttribution,
): MoveOutcome {
  const order = v[orderKeyOf(axis)].order;
  const anchorOf = (id: string) => {
    const i = order.indexOf(id);
    if (i < 0) throw new Error(`cannot move ${axis} position ${from}: "${id}" is not on this axis.`);
    return i;
  };
  const to = target.kind === 'to-start' ? 0
    : target.kind === 'to-end' ? order.length - 1
      : target.kind === 'earlier' ? from - 1
        : target.kind === 'later' ? from + 1
          // Landing *before* an anchor that sits after us means taking the place
          // in front of it, which is one lower once we have left our own slot.
          : target.kind === 'before' ? anchorOf(target.id) - (anchorOf(target.id) > from ? 1 : 0)
            : anchorOf(target.id) + (anchorOf(target.id) > from ? 0 : 1);
  return moveTo(v, axis, from, to, { ...who, route: 'menu' });
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

  if (report.noOp) return `${noun} ${label(report.id)} is already ${at}.`;

  const carried = report.carried.length === 0 ? ''
    : report.carried.length <= 2
      ? `, with ${report.carried.map(label).join(' and ')} kept beside it`
      : `, with ${report.carried.length} kept beside it`;
  const place = report.before === undefined ? ', first' : `, after ${label(report.before)}`;
  const stopped = report.clamped === 'locked-run'
    ? ' It stopped there: a locked run cannot be split.'
    : '';

  return `${noun} ${label(report.id)} moved to ${at}${place}${carried}.${stopped}`;
}
