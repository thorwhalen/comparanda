/**
 * What the detail panel says about one cell and one alternative, headless.
 *
 * ADR-0027 puts the evidence links, the full assertion list and everything a
 * tooltip may carry into a non-modal side panel, because a tooltip may hold
 * nothing focusable. This module is that panel's content with no DOM: the view
 * renders it, a test reads it, and an export could print it, all naming the
 * same things the same way.
 *
 * Two readings live here:
 *
 * - `cellDetail` -- one cell: what it shows and why (the reduction's result, or
 *   its refusal, or the absence's reason and note), every assertion in it with
 *   its author, justification, evidence and provenance, the set's description
 *   (`describeAssertionSet`), and how the values fall across the declared levels
 *   when there are several (the panel's stacked bar, ADR-0024).
 * - `alternativeStanding` -- one alternative across the criteria: where it
 *   stands against the other alternatives on each, and so its strongest and
 *   weakest criteria (the reference behaviour's "strongest and weakest axis").
 *
 * Derived, never stored (ADR-0003). Nothing here averages a rating or puts two
 * criteria on one scale: a standing is a count of order comparisons within one
 * criterion, which is all an ordinal scale licenses (ADR-0010, ADR-0015).
 */
import { describeAssertionSet, type AssertionSetDescription } from './assertion-set.js';
import { makeReadings } from './analyses/readings.js';
import { cellIndex, cellKey, isInapplicable, reducedValue, type Analysis } from './schema/analysis.js';
import type { CheckStanding, CitationCheck, EvidenceRef } from './schema/evidence.js';
import { isOrdered, type Measurement } from './schema/measurement.js';
import { absenceStanding, NOT_APPLICABLE, NOT_ASSESSED, type AbsenceStanding, type MissingnessVocabulary } from './schema/missingness.js';
import type { Author } from './schema/provenance.js';
import { measurementFor } from './schema/structure.js';
import { isWithheldFromReader, liveAssertions, type Assertion, type Reduced, type ScalarValue } from './schema/values.js';

/** An absence, read through the vocabulary: its code, what the code means, its note, and whether work remains. */
export interface AbsenceDetail {
  code: string;
  /** The code's declared meaning; absent when this analysis does not define the code. */
  means?: string | undefined;
  /** The author's free text. Never a substitute for the code. */
  note?: string | undefined;
  /** From the code's flags; `undeclared` when the code is not defined here, which counts as work remaining. */
  standing: AbsenceStanding | 'undeclared';
}

/** One evidence reference, as the panel lists it. */
export interface EvidenceDetail {
  ref: EvidenceRef;
  /** The reference's own label, else its target: never blank. */
  label: string;
  /** The citation check's standing, when the host injected a way to read it (ADR-0032 clause 4). */
  check?: CheckStanding | undefined;
  /**
   * An agent's summary or inference that names nothing it was derived from:
   * an assertion with nothing behind it, which the panel says (ADR-0014).
   */
  unfounded: boolean;
}

/** One assertion, as the panel lists it. */
export interface AssertionDetail {
  assertion: Assertion;
  /** The author record; absent when the document names an author it does not describe. */
  author?: Pick<Author, 'id' | 'displayName' | 'kind' | 'role'> | undefined;
  /** The principal behind a persona or an agent run, by display name, when it is another author. */
  principal?: string | undefined;
  /** The absence it records, read through the vocabulary. */
  absence?: AbsenceDetail | undefined;
  /** A value a disclosure projection withheld from this reader (ADR-0021): present, not shown. */
  withheldFromReader: boolean;
  /** Replaced by a later assertion in this cell; kept, never deleted. */
  superseded: boolean;
  evidence: EvidenceDetail[];
  /** The round it belongs to, by label when the round is described. */
  round?: string | undefined;
  /** The procedure that produced it, by name when the procedure is described. */
  procedure?: string | undefined;
}

/** How a cell's values fall across the criterion's declared levels: the panel's stacked bar (ADR-0024). */
export interface LevelDistribution {
  /** Every declared level, in declared order, with how many live, visible assertions gave it. */
  levels: { level: ScalarValue; count: number }[];
  /** The values counted. */
  n: number;
  /** Values asserted that are not declared levels, counted apart rather than dropped. */
  undeclared: number;
  /**
   * Whether the bar is ordered (an ordinal scale) or a set of categories (a
   * nominal one). It is never centred: a diverging bar needs a declared
   * neutral level (ADR-0010, ADR-0026), and schema v1 has no field for one.
   */
  ordered: boolean;
}

export interface CellDetail {
  alternativeId: string;
  criterionId: string;
  measure: string;
  /** The reduction's result, as the matrix shows it; absent when the cell has no record at all. */
  reduced?: Reduced | undefined;
  /** The reduction policy that ran: the cell's own, else the analysis default. */
  reduction: string;
  /** The absence the cell shows, read through the vocabulary, when it shows one. */
  absence?: AbsenceDetail | undefined;
  /** A declared inapplicable block covers this cell. */
  inapplicable: boolean;
  measurement?: Measurement | undefined;
  /** Live assertions first, in recorded order, then the superseded ones. */
  assertions: AssertionDetail[];
  /** The live set, described as every view names it. */
  set: AssertionSetDescription;
  /** Present when two or more visible values fall on declared levels. */
  distribution?: LevelDistribution | undefined;
}

export interface CellDetailOptions {
  vocabulary: MissingnessVocabulary;
  /** The standing of a citation check, injected so core owns no clock (ADR-0032 clause 4). */
  standing?: ((check: CitationCheck | undefined) => CheckStanding) | undefined;
}

/**
 * Everything the panel says about one cell.
 *
 * A cell with no record still has a detail: no assertions, and the absence the
 * matrix shows for it -- `not-applicable` under a declared block, otherwise
 * `not-assessed` -- so the panel never shows a bare blank either.
 */
export function cellDetail(
  a: Analysis, alternativeId: string, criterionId: string, measure: string, { vocabulary, standing }: CellDetailOptions,
): CellDetail {
  const cell = cellIndex(a).get(cellKey(alternativeId, criterionId, measure));
  const criterion = a.criteria.find((c) => c.id === criterionId);
  const measurement = criterion ? measurementFor(criterion, measure) : undefined;
  const reduced = cell ? reducedValue(a, alternativeId, criterionId, measure) : undefined;
  const inapplicable = isInapplicable(a, alternativeId, criterionId);
  const authors = new Map(a.authors.map((x) => [x.id, x]));
  const rounds = new Map(a.rounds.map((r) => [r.id, r]));
  const procedures = new Map(a.procedures.map((p) => [p.id, p]));

  const absenceOf = (code: string, note?: string): AbsenceDetail => {
    const facts = vocabulary.resolve(code, criterionId).facts;
    return {
      code,
      ...(facts?.means.trim() ? { means: facts.means.trim() } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
      standing: facts ? absenceStanding(facts) : 'undeclared',
    };
  };
  const evidenceOf = (ref: EvidenceRef): EvidenceDetail => ({
    ref,
    label: ref.label?.trim() || ref.target,
    ...(standing ? { check: standing(ref.check) } : {}),
    unfounded: (ref.sourceType === 'agent-summary' || ref.sourceType === 'agent-inference') && ref.derivedFrom.length === 0,
  });
  const live = new Set(cell ? liveAssertions(cell.assertions) : []);
  const detailOf = (s: Assertion): AssertionDetail => {
    const author = authors.get(s.authorId);
    const principal = author?.principalId && author.principalId !== author.id ? authors.get(author.principalId) : undefined;
    const round = s.roundId === undefined ? undefined : rounds.get(s.roundId);
    const procedure = s.procedureId === undefined ? undefined : procedures.get(s.procedureId);
    const hidden = isWithheldFromReader(s);
    return {
      assertion: s,
      ...(author ? { author: { id: author.id, displayName: author.displayName, kind: author.kind, ...(author.role ? { role: author.role } : {}) } } : {}),
      ...(principal ? { principal: principal.displayName } : author?.principalId && author.principalId !== author.id ? { principal: author.principalId } : {}),
      // A withheld assertion stands for a value; its stand-in absence is not the author's.
      ...(s.missing && !hidden ? { absence: absenceOf(s.missing.code, s.missing.note) } : {}),
      withheldFromReader: hidden,
      superseded: !live.has(s),
      evidence: s.evidence.map(evidenceOf),
      ...(s.roundId !== undefined ? { round: round?.label ?? `round ${round?.index ?? s.roundId}` } : {}),
      ...(s.procedureId !== undefined ? { procedure: procedure?.describedAs ?? s.procedureId } : {}),
    };
  };
  const all = cell?.assertions ?? [];
  const assertions = [...all.filter((s) => live.has(s)), ...all.filter((s) => !live.has(s))].map(detailOf);

  // What the matrix shows when nothing is recorded: the declared block, or the gap.
  const shownAbsence = reduced?.missing
    ? absenceOf(reduced.missing.code, reduced.missing.note)
    : reduced?.value === undefined && reduced?.refused === undefined
      ? absenceOf(inapplicable ? NOT_APPLICABLE : NOT_ASSESSED)
      : undefined;
  const visible = cell ? { assertions: cell.assertions.filter((s) => !isWithheldFromReader(s)) } : { assertions: [] };

  return {
    alternativeId, criterionId, measure,
    ...(reduced ? { reduced } : {}),
    reduction: cell?.reduction ?? a.defaultReduction,
    ...(shownAbsence ? { absence: shownAbsence } : {}),
    inapplicable,
    ...(measurement ? { measurement } : {}),
    assertions,
    set: describeAssertionSet(visible, { authors: a.authors, levels: measurement?.levels }),
    ...distributionOf(liveAssertions(visible.assertions), measurement),
  };
}

/** The values over the declared levels, when there are levels and two or more values to place on them. */
function distributionOf(set: readonly Assertion[], m: Measurement | undefined): { distribution?: LevelDistribution } {
  if (!m?.levels || m.levels.length === 0) return {};
  const values = set.flatMap((s) => (s.value === undefined ? [] : [s.value]));
  if (values.length < 2) return {};
  const levels = m.levels.map((level) => ({ level, count: values.filter((v) => v === level).length }));
  const placed = levels.reduce((n, l) => n + l.count, 0);
  return { distribution: { levels, n: values.length, undeclared: values.length - placed, ordered: m.level === 'ordinal' } };
}

/** Why a criterion takes no part in an alternative's standing. */
export type StandingExclusion =
  /** No measurement is declared for this measure. */
  | 'no-measurement'
  /** Nominal, or no direction of preference: there is no better. */
  | 'no-direction'
  /** A target preference: distance from a target is not yet compared soundly (#143). */
  | 'target'
  /** This alternative has no value here: absent, refused, structural or never assessed. */
  | 'no-value'
  /** No other alternative has a value here to compare with. */
  | 'nothing-to-compare';

/** Where one alternative stands on one criterion, against the others with a value there. */
export interface CriterionStandingCount {
  criterionId: string;
  /** Others it is better than, beyond the criterion's indifference threshold. */
  better: number;
  /** Others it is worse than, beyond the threshold. */
  worse: number;
  /** Others with a value here, so compared. */
  compared: number;
  /** `(better - worse) / compared`, in [-1, 1]: a share of order comparisons, never a value. */
  net: number;
}

export interface AlternativeStanding {
  alternativeId: string;
  measure: string;
  /** Every criterion that took part, in the analysis's order. */
  standings: CriterionStandingCount[];
  /** The criteria with the highest net standing; several when tied, none when every criterion stands alike. */
  strongest: CriterionStandingCount[];
  /** The criteria with the lowest net standing, likewise. */
  weakest: CriterionStandingCount[];
  /** Every criterion that took no part, and why: said, never silently dropped. */
  excluded: { criterionId: string; reason: StandingExclusion }[];
}

/**
 * An alternative's strongest and weakest criteria, relative to the other
 * alternatives.
 *
 * On each criterion with a direction of preference, the alternative is
 * compared with every other (non-tombstoned) alternative that has a value
 * there: better, worse, or within the declared indifference threshold. Its net
 * standing is the share of those comparisons it wins less the share it loses.
 * Comparing that share across criteria is what "strongest" means here -- a
 * statement about order within each criterion, never about the values
 * themselves, so a 1-5 rating and a rent in USD are never put on one scale.
 * Blanks are not guessed at: a cell without a value is not compared.
 */
export function alternativeStanding(a: Analysis, alternativeId: string, measure: string): AlternativeStanding {
  const read = makeReadings(a, measure);
  const others = a.alternatives.filter((x) => !x.tombstoned && x.id !== alternativeId).map((x) => x.id);
  const standings: CriterionStandingCount[] = [];
  const excluded: AlternativeStanding['excluded'] = [];
  for (const criterion of a.criteria) {
    if (criterion.tombstoned) continue;
    const m = measurementFor(criterion, measure);
    const why = criterionExclusion(m);
    if (why) {
      excluded.push({ criterionId: criterion.id, reason: why });
      continue;
    }
    const valueOf = (alt: string): number | undefined => {
      const r = read(alt, criterion.id, m!);
      return r.kind === 'value' ? r.numeric : undefined;
    };
    const own = valueOf(alternativeId);
    if (own === undefined) {
      excluded.push({ criterionId: criterion.id, reason: 'no-value' });
      continue;
    }
    const q = m!.thresholds?.indifference ?? 0;
    const sign = m!.preference === 'decreasing' ? -1 : 1;
    let better = 0;
    let worse = 0;
    let compared = 0;
    for (const other of others) {
      const theirs = valueOf(other);
      if (theirs === undefined) continue;
      compared += 1;
      const margin = sign * (own - theirs);
      if (margin > q) better += 1;
      else if (margin < -q) worse += 1;
    }
    if (compared === 0) {
      excluded.push({ criterionId: criterion.id, reason: 'nothing-to-compare' });
      continue;
    }
    standings.push({ criterionId: criterion.id, better, worse, compared, net: (better - worse) / compared });
  }
  const nets = standings.map((s) => s.net);
  const top = Math.max(...nets);
  const bottom = Math.min(...nets);
  // When every criterion stands alike, none is stronger than another.
  const distinct = standings.length > 1 && top !== bottom;
  return {
    alternativeId, measure, standings,
    strongest: distinct ? standings.filter((s) => s.net === top) : [],
    weakest: distinct ? standings.filter((s) => s.net === bottom) : [],
    excluded,
  };
}

function criterionExclusion(m: Measurement | undefined): StandingExclusion | undefined {
  if (!m) return 'no-measurement';
  if (m.preference === 'target') return 'target';
  if (!isOrdered(m.level) || (m.preference !== 'increasing' && m.preference !== 'decreasing')) return 'no-direction';
  return undefined;
}
