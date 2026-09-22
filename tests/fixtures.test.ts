/**
 * The shipped example analyses, and the one that is deliberately hostile.
 *
 * `relocation.json` is the **falsification fixture**: it is the document that
 * decides whether the extension model in ADR-0030 is a design or a paragraph. It
 * carries a criterion on a scale this build does not implement, a missingness
 * code the document declares and this build has never heard of, and a citation
 * whose source has changed since it was ingested.
 *
 * If it validates, dominates, screens, and reports exactly the degradations it
 * should — while `silenceRate` correctly *excludes* the paywalled cells — then
 * every declaration seam works. If it cannot be written, the architecture is
 * prose.
 *
 * Most bugs will be found by this file, which is why it exercises the parts the
 * clean example does not: all six core codes, groups on both axes, an
 * inapplicable group pair, multi-rater disagreement, an acceptability floor,
 * four different levels of measurement in one document, a stale citation, and
 * three annotation threads at two scopes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Analysis, validateAnalysis, scaleDegradations, completeness, vocabularyOf,
  makeCellReader, isInapplicable, contradictedCells,
} from '../src/core/schema/analysis.js';
import { checkStanding, verdictFound } from '../src/core/schema/evidence.js';
import { dominance } from '../src/core/analyses/dominance.js';
import { screen } from '../src/core/analyses/screening.js';
import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const load = (name: string) => JSON.parse(readFileSync(join(examples, name), 'utf8'));

const relocation = () => Analysis.parse(load('relocation.json'));

describe('relocation.json — the messy fixture', () => {
  it('parses and validates', () => {
    const r = validateAnalysis(load('relocation.json'));
    const errors = r.problems.filter((p) => p.severity === 'error');
    expect(errors, errors.map((p) => `${p.ruleId} @ ${p.path}: ${p.message}`).join('\n')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('exercises every core missingness code', () => {
    const a = relocation();
    const used = new Set(
      a.cells.flatMap((c) => c.assertions.map((s) => s.missing?.code)).filter(Boolean),
    );
    for (const code of Object.keys(CORE_MISSING_CODES)) {
      expect(used, `core code "${code}" is never used`).toContain(code);
    }
  });

  it('carries four levels of measurement in one document', () => {
    const levels = new Set(
      relocation().criteria.map((c) => c.defaultMeasurement?.level).filter(Boolean),
    );
    expect([...levels].sort()).toEqual(['nominal', 'ordinal', 'ratio']);
    // Boolean is a two-level nominal, which is the point of modelling it that
    // way rather than adding a fifth level of measurement.
    const visa = relocation().criteria.find((c) => c.id === 'visa-free');
    expect(visa?.defaultMeasurement?.levels).toEqual([false, true]);
  });

  it('has disagreement on at least three cells', () => {
    const a = relocation();
    const contested = a.cells.filter((c) => {
      const values = new Set(c.assertions.map((s) => s.value).filter((v) => v !== undefined));
      return values.size > 1;
    });
    expect(contested.length).toBeGreaterThanOrEqual(3);
  });

  it('has a whole group pair that does not apply', () => {
    const a = relocation();
    expect(isInapplicable(a, 'seoul', 'eu-residency-path')).toBe(true);
    expect(isInapplicable(a, 'montreal', 'eu-residency-path')).toBe(true);
    expect(isInapplicable(a, 'lisbon', 'eu-residency-path')).toBe(false);
  });

  it('has threads at two scopes, one resolved and one open', () => {
    const threads = relocation().threads;
    expect(threads.some((t) => t.resolved)).toBe(true);
    expect(threads.some((t) => !t.resolved)).toBe(true);
    // The criterion-anchored one is where the definitional argument lives, and
    // that is usually the most valuable thread in a document.
    expect(threads.some((t) => t.anchor.scope === 'criterion')).toBe(true);
  });

  it('keeps the criteria it rejected, with reason codes, and not as columns (#63)', () => {
    const a = relocation();
    expect(a.rejectedCriteria.length).toBeGreaterThanOrEqual(2);
    const codes = new Set(a.rejectedCriteria.map((r) => r.reasonCode));
    expect(codes).toContain('merged');
    expect(codes).toContain('not-discriminating');
    const critIds = new Set(a.criteria.map((c) => c.id));
    const critLabels = new Set(a.criteria.map((c) => c.label));
    for (const r of a.rejectedCriteria) {
      expect(r.reason.trim().length).toBeGreaterThan(0);
      // A rejected criterion is not a column: nothing with its label is scored.
      expect(critLabels.has(r.label), `"${r.label}" is rejected and also a criterion`).toBe(false);
      // A merge points at the criterion that absorbed it, which must exist.
      if (r.reasonCode === 'merged') {
        expect(r.mergedIntoId && critIds.has(r.mergedIntoId), `mergedIntoId "${r.mergedIntoId}"`).toBe(true);
      }
      if (r.proposedBy) {
        expect(a.authors.map((x) => x.id)).toContain(r.proposedBy);
      }
    }
  });

  it('cites contradicting evidence, and reports the cell (#65)', () => {
    const a = relocation();
    const refs = a.cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence);
    expect(refs.some((e) => e.stance === 'contradicts')).toBe(true);
    const report = contradictedCells(a, { measure: 'score' });
    expect(report.count).toBe(1);
    expect(report.cells[0]).toMatchObject({ alternativeId: 'berlin', criterionId: 'rent' });
  });

  it('carries a check that failed, not only checks that passed (#65)', () => {
    const refs = relocation().cells.flatMap((c) => c.assertions).flatMap((s) => s.evidence);
    const failed = refs.filter((e) => e.check && e.check.status !== 'unchecked' && !verdictFound(e.check.status));
    const statuses = new Set(failed.map((e) => e.check!.status));
    // Both ways a check fails: the quote is gone from a changed document, and
    // the target cannot be reached at all.
    expect(statuses).toContain('stale');
    expect(statuses).toContain('unresolvable');
    for (const e of failed) {
      // A failed verdict is still a verdict: dated and attributed.
      expect(e.check!.checkedAt).toBeTruthy();
      expect(e.check!.checkerVersion).toBeTruthy();
    }
  });
});

describe('the falsification: what this build cannot interpret', () => {
  it('degrades exactly one scale, and points at the criterion that used it', () => {
    const a = relocation();
    const ds = scaleDegradations(a);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ axis: 'scale', id: 'bt-latent' });

    // `at` is a JSON path, so it is index-based and mechanically resolvable
    // rather than readable. Resolving it is the stronger assertion: it proves
    // the record points at the right criterion, not merely that it mentions one.
    const index = Number(/^criteria\[(\d+)\]/.exec(ds[0]!.at)![1]);
    expect(a.criteria[index]!.id).toBe('school-quality');
    expect(ds[0]!.at).toBe(`criteria[${index}].defaultMeasurement.scale`);
  });

  it('still validates, dominates and screens with that scale unknown', () => {
    // The whole return on putting the extension in the document: level,
    // preference and range are required fields, so an unknown scale costs the
    // NAME and not the behaviour.
    const a = relocation();
    expect(validateAnalysis(a).ok).toBe(true);
    expect(() => dominance(a, { measure: 'score' })).not.toThrow();
    expect(() => screen(a, 'score')).not.toThrow();
  });

  it('reads a declared code this build has never heard of', () => {
    const vocab = vocabularyOf(relocation());
    const r = vocab.resolve('paywalled', 'income-tax');
    expect(r.known).toBe(true);
    expect(r.facts?.terminal).toBe(true);       // inherited from not-evidenced
    expect(r.facts?.informative).toBe(false);   // overridden -- and this is the point
  });

  it('excludes the paywalled cell from silenceRate, which is the whole test', () => {
    // `paywalled` is terminal, so a rate keyed on `terminal` would count it. It
    // is a fact about our access rather than about the city, so the honesty
    // metric must not move for it -- and the override that says so travels
    // inside the document, from a declaration this build did not ship.
    const a = relocation();
    const c = completeness(a, { measure: 'score', criterionIds: ['income-tax'] });
    expect(c.settledAbsent).toBeGreaterThan(c.informativeAbsent);
    const codes = a.cells
      .filter((x) => x.criterionId === 'income-tax')
      .flatMap((x) => x.assertions.map((s) => s.missing?.code));
    expect(codes).toContain('paywalled');
    expect(codes).toContain('withheld');
    expect(codes).toContain('not-evidenced');
    // Of those three terminal absences, only `not-evidenced` is informative.
    expect(c.informativeAbsent).toBe(1);
  });

  it('renders a citation whose source has moved on with a caveat', () => {
    const a = relocation();
    const drifted = a.cells
      .flatMap((c) => c.assertions)
      .flatMap((s) => s.evidence)
      .find((e) => e.check?.originalDrifted);
    expect(drifted, 'the fixture should carry a drifted citation').toBeDefined();
    const standing = checkStanding(drifted!.check, {
      currentCheckerVersion: 'comparanda-check/1.0.0',
      now: new Date('2026-08-22T12:00:00Z'),
    });
    expect(standing.sourceChanged).toBe(true);
    expect(standing.needsCaveat).toBe(true);
  });

  it('reports nothing it can read, so the count means something', () => {
    // A degradation list that is never empty is a list nobody reads. The only
    // unreadable thing in this document is the scale, deliberately.
    const a = relocation();
    const codeDegradations: unknown[] = [];
    completeness(a, { measure: 'score' });
    const reader = makeCellReader(a, 'score', codeDegradations as never[]);
    for (const alt of a.alternatives) {
      for (const crit of a.criteria) reader.read(alt.id, crit.id);
    }
    expect(codeDegradations).toEqual([]);
  });
});

describe('languages.json — the clean fixture', () => {
  it('validates with no errors and no completeness warnings', () => {
    // The clean one is what goes in the documentation, so it has to be
    // genuinely finished: a fully-scored matrix, every score with a reason.
    const r = validateAnalysis(load('languages.json'));
    expect(r.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('is complete: every cell scored, nothing outstanding', () => {
    const a = Analysis.parse(load('languages.json'));
    const c = completeness(a, { measure: 'score' });
    expect(c.outstanding).toBe(0);
    expect(c.valuedRate).toBe(1);
    expect(c.silenceRate).toBe(0);
  });

  it('carries an anchor for every level its scale requires', () => {
    // A criterion whose anchors are missing is scored against taste. This is
    // checked from the document alone -- no preset table is consulted.
    for (const criterion of Analysis.parse(load('languages.json')).criteria) {
      const anchors = criterion.defaultMeasurement?.anchors;
      expect(anchors, `${criterion.id} has no anchors`).toBeDefined();
      for (const level of anchors!.requires) {
        expect(anchors!.levels[level]?.trim(), `${criterion.id} @ ${level}`).toBeTruthy();
      }
    }
  });

  it('has real disagreement between columns, so it is worth looking at', () => {
    // A clean fixture where every alternative scores the same is a screenshot
    // of nothing. Rust and Python should disagree sharply.
    const a = Analysis.parse(load('languages.json'));
    const reader = makeCellReader(a, 'score');
    expect(reader.read('rust', 'performance')?.value).toBe(5);
    expect(reader.read('rust', 'learning-curve')?.value).toBe(1);
    expect(reader.read('python', 'performance')?.value).toBe(2);
    expect(reader.read('python', 'learning-curve')?.value).toBe(5);
  });
});

describe('video-generation.json — real vendors, real blanks', () => {
  const doc = () => Analysis.parse(load('video-generation.json'));

  it('validates with no errors', () => {
    const r = validateAnalysis(load('video-generation.json'));
    const errors = r.problems.filter((p) => p.severity === 'error');
    expect(errors, errors.map((p) => `${p.ruleId} @ ${p.path}`).join('\n')).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // These assert the DISCIPLINE, never the DATA. Every figure here is a dated
  // snapshot of a market that moves monthly, so a test that pinned "Kling is
  // 4K" would go red on a refresh and teach the next person to weaken it. What
  // must survive a refresh is the standard each cell is held to.
  // ---------------------------------------------------------------------

  it('every filled cell quotes a source and says why', () => {
    for (const cell of doc().cells) {
      for (const a of cell.assertions) {
        if (a.value === undefined) continue;
        const where = `${cell.alternativeId}/${cell.criterionId}`;
        expect(a.justification?.trim(), `${where} has no justification`).toBeTruthy();
        expect(a.evidence.length, `${where} cites nothing`).toBeGreaterThan(0);
        for (const e of a.evidence) {
          const quote = e.selectors.find((s) => s.type === 'TextQuoteSelector');
          expect(quote, `${where} has no quote selector`).toBeDefined();
          expect((quote as { exact: string }).exact.trim(), `${where} quotes nothing`).toBeTruthy();
          expect(e.renditionId, `${where} names no rendition`).toBeTruthy();
        }
      }
    }
  });

  it('every stored verdict carries its stamp', () => {
    // The rule that makes a check displayable at all: an undated verdict reads
    // as current forever.
    for (const cell of doc().cells) {
      for (const a of cell.assertions) {
        for (const e of a.evidence) {
          if (!e.check || e.check.status === 'unchecked') continue;
          expect(e.check.checkedAt, `${cell.criterionId} check has no date`).toBeTruthy();
          expect(e.check.checkerVersion, `${cell.criterionId} check has no checker`).toBeTruthy();
        }
      }
    }
  });

  it('every blank says what was looked for and what was found', () => {
    // A blank with no note is the thing this whole vocabulary exists to
    // prevent: it looks like a finding and carries none.
    const blanks = doc().cells.flatMap((c) => c.assertions.filter((a) => a.missing));
    expect(blanks.length).toBeGreaterThan(0);
    for (const a of blanks) {
      expect(a.missing!.note?.trim(), `blank with code ${a.missing!.code} has no note`).toBeTruthy();
      expect(a.missing!.note!.length).toBeGreaterThan(40);
    }
  });

  it('carries no subjective scale, so no cell can be a judgement about a company', () => {
    // The structural proxy for "capability and stated policy only". A quality
    // score lives on an anchored ordinal; every criterion here is either a
    // measured quantity (ratio) or a stated fact (nominal), and a nominal
    // criterion has no direction of preference at all.
    for (const c of doc().criteria) {
      const m = c.defaultMeasurement!;
      expect(['ratio', 'nominal'], `${c.id} is ${m.level}`).toContain(m.level);
      expect(m.anchors, `${c.id} carries anchors, which means it is scored`).toBeUndefined();
      if (m.level === 'nominal') expect(m.preference).toBe('none');
    }
  });

  it('distinguishes an explicit refusal from silence, using a declared code', () => {
    // The extension earns its place: "the vendor declines to say" and "the
    // vendor is silent" are different findings, and the core cannot tell them
    // apart. A reader whose build never heard of it sees `not-evidenced`,
    // which is correct — just less precise.
    const a = doc();
    const declared = a.missingCodes.find((d) => d.id === 'disclosure-declined');
    expect(declared?.broader).toBe('not-evidenced');

    const r = vocabularyOf(a).resolve('disclosure-declined');
    expect(r.known).toBe(true);
    expect(r.facts?.informative).toBe(true);   // inherited: a refusal is about the subject
    expect(r.facts?.terminal).toBe(true);

    const used = a.cells.flatMap((c) => c.assertions).filter(
      (s) => s.missing?.code === 'disclosure-declined',
    );
    expect(used.length).toBeGreaterThan(0);
  });

  it('has both kinds of core blank, because both really occurred', () => {
    const codes = new Set(
      doc().cells.flatMap((c) => c.assertions.map((a) => a.missing?.code)).filter(Boolean),
    );
    expect(codes).toContain('not-evidenced');   // searched; the vendor is silent
    expect(codes).toContain('indeterminate');   // found material; it does not settle it
  });

  it('is finished, not abandoned — nothing outstanding', () => {
    // Every cell was looked at. That is what makes silenceRate mean something:
    // the blanks are findings rather than work nobody did.
    const c = completeness(doc(), { measure: 'score' });
    expect(c.outstanding).toBe(0);
    expect(c.informativeAbsent).toBe(c.settledAbsent);
    expect(c.silenceRate).toBeGreaterThan(0);
  });

  it('says it is a dated snapshot, in the document rather than in a README', () => {
    const s = doc().subject;
    expect(s.context).toMatch(/DATED SNAPSHOT/);
    expect(s.ambiguities?.length, 'ambiguities were considered').toBeGreaterThan(0);
  });
});
