/**
 * The rater dot strip's data (ADR-0024, #110), before anything draws it: which
 * of a criterion's fixed level slots hold how many assertions, which form the
 * range bracket takes, and whose assertions they are.
 *
 * Headless, like `describeAssertionSet` -- the view draws `slots`, `bracket` and
 * `reading`, and reads `label` aloud; it decides none of them. The one
 * structural requirement is that **no mark sits where a mean would be**. It is
 * met by construction: a slot's position is its level's index and nothing
 * else, a dot is only ever at an occupied slot, and the bracket's marks are its
 * two ends and its modes. Nothing here computes a centre of any kind, and a
 * test holds the module to that.
 *
 * Derived, never stored (ADR-0003).
 */
import { cellShape, disagreementOfCounts } from './analyses/agreement.js';
import { describeAssertionSet, type AssertionSetReading } from './assertion-set.js';
import type { Author } from './schema/provenance.js';
import type { Measurement } from './schema/measurement.js';
import { isOrdered } from './schema/measurement.js';
import { sightingOf, standingInSet, standInIds, type ViewerContext } from './schema/redaction.js';
import type { Analysis } from './schema/analysis.js';
import { liveAssertions, type Cell, type ScalarValue } from './schema/values.js';

/** How many fixed slots a strip draws at most, unless told otherwise: past it the slots are too narrow to count. */
export const DEFAULT_MAX_SLOTS = 9;

/** Whose assertions a strip draws: only a set with more than one head reads as anything but `single`. */
export type StripReading = Exclude<AssertionSetReading, 'single'>;

export interface RaterStripSlot {
  readonly level: ScalarValue;
  /** Assertions at this level; they stack. */
  readonly count: number;
}

export interface RaterStrip {
  /** One per declared level, in level order, empty ones included: the slots are fixed. */
  readonly slots: readonly RaterStripSlot[];
  readonly reading: StripReading;
  /** Slot indices of the lowest and highest occupied level. */
  readonly bracket: { readonly from: number; readonly to: number; readonly modes: readonly number[] };
  /** Live assertions that carry a value off the level list: counted in `label`, drawn nowhere. */
  readonly unplaced: number;
  /** Live assertions that record an absence, which have no level to sit at. */
  readonly absent: number;
  /** The tallest stack, so a drawing can size itself without recounting. */
  readonly tallest: number;
  /** Live assertions whose value this viewer may not see (the round hides it, or a projection withheld it): counted in `label`, never drawn. */
  readonly unseen: number;
  /** The exact multiset, in words (`describeAssertionSet(...).label`). */
  readonly label: string;
}

/**
 * The fixed slots for a measurement: its declared `levels`, else the whole
 * numbers of its `range`; `undefined` when it has neither, is nominal, or has
 * more slots than `maxSlots`.
 */
export function stripLevels(m: Measurement | undefined, { maxSlots = DEFAULT_MAX_SLOTS }: { maxSlots?: number } = {}): ScalarValue[] | undefined {
  if (!m || !isOrdered(m.level)) return undefined;
  if (m.levels && m.levels.length >= 2) return m.levels.length <= maxSlots ? [...m.levels] : undefined;
  const r = m.range;
  if (r && Number.isInteger(r.min) && Number.isInteger(r.max) && r.max > r.min && r.max - r.min + 1 <= maxSlots) {
    return Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);
  }
  return undefined;
}

/**
 * The strip for one cell, or `undefined` when there is nothing to show: fewer
 * than two live assertions (a single value is not a set), or none placed on a slot.
 */
export function raterStrip(
  cell: Pick<Cell, 'assertions'>,
  { authors, levels, means }: {
    authors: readonly Pick<Author, 'id' | 'kind' | 'principalId'>[]; levels: readonly ScalarValue[];
    /** Reads an absence's code as what it means, for the label (#209). */
    means?: ((code: string) => string | undefined) | undefined;
  },
): RaterStrip | undefined {
  const set = describeAssertionSet(cell, { authors, levels, means });
  if (set.reading === 'single') return undefined;
  const shape = cellShape(set.values, levels);
  if (shape.n === 0) return undefined;
  const index = (v: ScalarValue | undefined) => levels.findIndex((l) => l === v);
  const slots = shape.multiset.map(({ level, count }) => ({ level, count }));
  return {
    slots,
    reading: set.reading,
    bracket: { from: index(shape.min), to: index(shape.max), modes: shape.modes.map(index) },
    unplaced: set.values.length - shape.n,
    absent: set.absences.length,
    unseen: 0,
    tallest: Math.max(...slots.map((s) => s.count)),
    label: set.label,
  };
}

/** Whether `value` is a strip this build can draw: for a mark that came from an encoding it did not write. */
export function isRaterStrip(value: unknown): value is RaterStrip {
  const s = value as RaterStrip | null;
  if (s === null || typeof s !== 'object') return false;
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  return Array.isArray(s.slots) && s.slots.length >= 2 && s.slots.every((x) => x && whole(x.count)) &&
    (s.reading === 'raters' || s.reading === 'draws' || s.reading === 'correlated') &&
    s.bracket !== null && typeof s.bracket === 'object' && whole(s.bracket.from) && whole(s.bracket.to) &&
    s.bracket.from < s.slots.length && s.bracket.to < s.slots.length && Array.isArray(s.bracket.modes) &&
    s.bracket.modes.every((i) => whole(i) && i < s.slots.length) && whole(s.tallest) && whole(s.unseen) && typeof s.label === 'string';
}

/**
 * The strip as one viewer may see it (ADR-0021, ADR-0023): what is hidden
 * decided here, through `sightingOf`, never in the view. An assertion whose
 * value the round hides, or a projection withheld, is not drawn and is counted
 * in the label; one whose author is hidden, or that the viewer may see only as
 * part of a distribution, is drawn as an unknown hand of its own with no
 * independence claimed, so the strip cannot say who rated alike. Without a
 * viewer no round hides anything; a projection still does. Fewer than two
 * assertions left to draw is no set, so no strip.
 */
export function raterStripInView(
  analysis: Analysis, cell: Pick<Cell, 'assertions'>,
  { levels, viewer, means }: {
    levels: readonly ScalarValue[]; viewer?: ViewerContext | undefined; means?: ((code: string) => string | undefined) | undefined;
  },
): RaterStrip | undefined {
  const live = liveAssertions(cell.assertions);
  const sighting = new Map(live.map((s) => [s.id, sightingOf(analysis, s, viewer)]));
  const standIns = standInIds(cell.assertions, (s) => sighting.get(s.id) === 'unnamed');
  const unseen = live.filter((s) => sighting.get(s.id) === 'unseen').length;
  const kept = live.filter((s) => sighting.get(s.id) !== 'unseen').map((s) => (standIns.has(s.id) ? standingInSet(s, standIns.get(s.id)!) : s));
  const strip = raterStrip({ assertions: kept }, { authors: analysis.authors, levels, means });
  if (!strip || unseen === 0) return strip;
  return { ...strip, unseen, label: `${strip.label} ${unseen} more not shown to you.` };
}

/**
 * The strip's disagreement index (ADR-0024 amendment): `(1 - A) / 2` over its
 * slot counts, 0 unanimity and 1 perfect bimodality, with A and `n`, which are
 * never shown apart. `undefined` where A is (fewer than three levels).
 */
export function stripDisagreement(strip: RaterStrip): { index: number; a: number; n: number } | undefined {
  return disagreementOfCounts(strip.slots.map((x) => x.count));
}
