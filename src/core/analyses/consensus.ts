/**
 * Group-informed consensus: what camps that disagree nonetheless agree on
 * (ADR-0011 clause 8, #111).
 *
 * The disagreement *analysis* over a whole matrix, distinct from the
 * disagreement *glyph* on one cell (ADR-0024). Polis's reporting form: not an
 * average across raters, but, cell by cell, whether every camp's answers
 * overlap -- a **shared** cell is common ground, a **divided** one is where the
 * camps part. The camps are the caller's, named author by author: algorithmic
 * grouping a participant cannot contest is the thing ADR-0011 avoids, so this
 * module computes no clustering and has no default camps.
 *
 * Per cell, never per matrix: results are listed by cell and counted per
 * criterion, and no field combines criteria (ADR-0022's rule 1, kept here for
 * the same reason). Nothing averages: a camp's answer is the range of levels
 * its members gave, and two camps share ground where their ranges overlap.
 *
 * Pure: no DOM.
 */
import type { Analysis } from '../schema/analysis.js';
import { cellIndex, cellKey } from '../schema/analysis.js';
import { makeInapplicability } from '../schema/groups.js';
import { measurementFor } from '../schema/structure.js';
import { isWidenedByDisclosure, isWithheldFromReader, type ScalarValue } from '../schema/values.js';
import type { Measurement } from '../schema/measurement.js';
import type { AnalysisResult } from './registry.js';
import { alternativeScope, type AlternativeScopeOptions } from './scope.js';

/** What every result of this analysis rests on, carried with it (#87, ADR-0015). */
export const CONSENSUS_ASSUMPTIONS: readonly [string, ...string[]] = Object.freeze([
  'The camps were named by a person, author by author; nothing here grouped the raters (ADR-0011).',
  "A camp's answer on a cell is the range of values its members gave; personas count as their principal's camp.",
  'On an ordered criterion a camp\'s answer is the span from its lowest to its highest value, and a cell is shared when the spans of all camps overlap. The common values are those any rater gave inside that overlap.',
  'On a nominal criterion a cell is shared only when one value was given in every camp.',
  'A cell is divided when the camps do not share ground, and not compared when a camp gave no value.',
  'Nothing is averaged: on an ordinal criterion the range is in level order, on a nominal one it is the set of values.',
  'Superseded, consensus and withheld assertions do not take part; structurally inapplicable cells are skipped.',
] as const);

/** A camp: a label, and the authors (or their principals) in it. */
export interface Camp {
  id: string;
  label: string;
  authorIds: readonly string[];
}

export type ConsensusStatus = 'shared' | 'divided' | 'not-compared';

export interface CellConsensus {
  alternativeId: string;
  criterionId: string;
  status: ConsensusStatus;
  /** Each camp's values on this cell, in level order; empty for a camp that gave none. */
  camps: { campId: string; values: ScalarValue[] }[];
  /** On a shared cell: the values every camp's range includes (nominal: every camp gave). */
  common?: ScalarValue[];
  /** On a cell not compared: the camps that gave no value. */
  silent?: string[];
}

export interface CriterionConsensus {
  criterionId: string;
  shared: number;
  divided: number;
  notCompared: number;
}

export interface ConsensusResult extends AnalysisResult {
  measure: string;
  cells: CellConsensus[];
  /** Counts per criterion. Deliberately no matrix-wide count. */
  criteria: CriterionConsensus[];
  skipped: { criterionId: string; reason: string }[];
}

export interface ConsensusOptions extends AlternativeScopeOptions {
  measure: string;
  /** At least two camps, none sharing an author. */
  camps: readonly Camp[];
  criterionIds?: readonly string[];
  /**
   * On an interval or ratio criterion: how far apart two camps' ranges may be
   * and still count as overlapping. Default 0; configuration, never a literal
   * in the rule.
   */
  tolerance?: number;
}

/** Cell by cell, whether the camps' answers overlap. */
export function groupInformedConsensus(a: Analysis, opts: ConsensusOptions): ConsensusResult {
  const { measure, camps, tolerance = 0 } = opts;
  const campOf = campIndex(a, camps);
  const alts = alternativeScope(a, opts);
  const crits = opts.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);
  const index = cellIndex(a);
  const inapplicable = makeInapplicability(a);
  const cells: CellConsensus[] = [];
  const criteria: CriterionConsensus[] = [];
  const skipped: { criterionId: string; reason: string }[] = [];
  let widenedByDisclosure = 0;

  for (const criterionId of crits) {
    const crit = a.criteria.find((c) => c.id === criterionId);
    const m = crit ? measurementFor(crit, measure) : undefined;
    if (!m) { skipped.push({ criterionId, reason: `no measurement for "${measure}"` }); continue; }
    const counts: CriterionConsensus = { criterionId, shared: 0, divided: 0, notCompared: 0 };
    for (const alternativeId of alts) {
      if (inapplicable(alternativeId, criterionId)) continue;
      const cell = index.get(cellKey(alternativeId, criterionId, measure));
      if (cell && isWidenedByDisclosure(cell)) widenedByDisclosure += 1;
      const byCamp = new Map(camps.map((c) => [c.id, [] as ScalarValue[]]));
      for (const s of cell?.assertions ?? []) {
        if (s.supersededBy || s.independence === 'consensus' || s.value === undefined || isWithheldFromReader(s)) continue;
        const camp = campOf.get(s.authorId);
        if (camp !== undefined) byCamp.get(camp)!.push(s.value);
      }
      const entry = compare(alternativeId, criterionId, byCamp, m, tolerance);
      cells.push(entry);
      if (entry.status === 'shared') counts.shared += 1;
      else if (entry.status === 'divided') counts.divided += 1;
      else counts.notCompared += 1;
    }
    criteria.push(counts);
  }
  return { measure, cells, criteria, skipped, widenedByDisclosure, assumptions: CONSENSUS_ASSUMPTIONS };
}

/** Author id -> camp id, with personas following their principal. Throws on fewer than two camps or an author in two. */
function campIndex(a: Analysis, camps: readonly Camp[]): Map<string, string> {
  if (camps.length < 2) throw new Error('group-informed consensus needs at least two camps; with one, there is nobody to disagree with.');
  const ids = new Set(camps.map((c) => c.id));
  if (ids.size < camps.length) throw new Error('two camps share an id; each camp is a side of its own, so their ids must differ.');
  const member = new Map<string, string>();
  for (const camp of camps) {
    for (const id of camp.authorIds) {
      const was = member.get(id);
      if (was !== undefined && was !== camp.id) throw new Error(`author "${id}" is in camps "${was}" and "${camp.id}"; a camp is a side, and one author takes one.`);
      member.set(id, camp.id);
    }
  }
  for (const author of a.authors) {
    if (!member.has(author.id) && author.principalId !== undefined && member.has(author.principalId)) {
      member.set(author.id, member.get(author.principalId)!);
    }
  }
  return member;
}

function compare(
  alternativeId: string, criterionId: string, byCamp: Map<string, ScalarValue[]>, m: Measurement, tolerance: number,
): CellConsensus {
  const order = (v: ScalarValue): number | undefined => {
    if (m.levels && m.levels.length > 0) {
      const i = m.levels.findIndex((l) => l === v);
      return i >= 0 ? i : undefined;
    }
    return typeof v === 'number' ? v : undefined;
  };
  const sorted = (vs: ScalarValue[]) => [...new Set(vs)].sort((x, y) => (order(x) ?? 0) - (order(y) ?? 0));
  // A value off the declared order cannot be placed in a range (the validator reports it); it takes no part.
  const placed = (vs: ScalarValue[]) => (m.level === 'nominal' ? vs : vs.filter((v) => order(v) !== undefined));
  const camps = [...byCamp].map(([campId, values]) => ({ campId, values: sorted(placed(values)) }));
  const base = { alternativeId, criterionId, camps };
  const silent = camps.filter((c) => c.values.length === 0).map((c) => c.campId);
  if (silent.length > 0) return { ...base, status: 'not-compared', silent };

  if (m.level === 'nominal') {
    const common = camps.slice(1).reduce((acc, c) => acc.filter((v) => c.values.includes(v)), camps[0]!.values);
    return common.length > 0 ? { ...base, status: 'shared', common } : { ...base, status: 'divided' };
  }
  const ranges = camps.map((c) => {
    const os = c.values.map(order).filter((o): o is number => o !== undefined);
    return { lo: Math.min(...os), hi: Math.max(...os) };
  });
  const lo = Math.max(...ranges.map((r) => r.lo));
  const hi = Math.min(...ranges.map((r) => r.hi));
  // Ordinal levels are steps, not distances: a tolerance applies to interval and ratio values only.
  const slack = m.level === 'interval' || m.level === 'ratio' ? tolerance : 0;
  if (lo > hi + slack) return { ...base, status: 'divided' };
  const all = sorted(camps.flatMap((c) => c.values));
  const common = all.filter((v) => { const o = order(v); return o !== undefined && o >= lo - slack && o <= hi + slack; });
  return { ...base, status: 'shared', common };
}
