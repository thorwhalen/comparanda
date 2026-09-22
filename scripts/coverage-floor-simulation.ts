/**
 * The coverage-floor simulation ADR-0015 asks for before the 2/3 default is
 * fixed (#84; findings-terminology.md § 9, open question 5).
 *
 * The question: on matrices of *our* size, how much does an aggregate's
 * ranking change as weight coverage falls? Two answers are measured, because
 * the gate offers one thing and forbids another:
 *
 * - **separable**: of the pairs the complete data orders strictly, the share
 *   the gated interval aggregate still orders. Intervals contain the truth, so
 *   they are never *wrong*; what falls with coverage is how often they can say
 *   anything at all.
 * - **imputation flips**: of the same pairs, the share whose order *reverses*
 *   under the thing the gate forbids -- a point value from weights renormalised
 *   over the observed criteria (mean imputation).
 *
 * Deterministic: a seeded generator draws weight vectors, completions of the
 * fixtures' own blanks (uniform over each declared range, integer levels on
 * ordinal criteria) and the cells hidden at each step. Neither example carries
 * substitution weights, so weights are generated; that is stated wherever the
 * result is quoted.
 *
 * Run: `npx tsx scripts/coverage-floor-simulation.ts`
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { measurementFor } from '../src/core/schema/structure.js';
import { weightedSum, type WeightedSumRow } from '../src/core/analyses/weighted-sum.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Deterministic PRNG (LCG), so every number here is reproducible from the seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const BINS = [
  { label: '1.0', lo: 1, hi: 1 },
  { label: '[0.8, 1.0)', lo: 0.8, hi: 1 },
  { label: '[2/3, 0.8)', lo: 2 / 3, hi: 0.8 },
  { label: '[0.5, 2/3)', lo: 0.5, hi: 2 / 3 },
  { label: '< 0.5', lo: 0, hi: 0.5 },
] as const;

export interface BinResult { label: string; pairs: number; separable: number; imputationFlips: number }

type Doc = Record<string, unknown> & { criteria: { id: string; weights?: unknown }[]; cells: { alternativeId: string; criterionId: string; measure: string; assertions: Record<string, unknown>[] }[]; alternatives: { id: string }[] };

function binOf(coverage: number): number {
  if (coverage >= 1 - 1e-12) return 0;
  for (let i = 1; i < BINS.length; i += 1) if (coverage >= BINS[i]!.lo - 1e-12 && coverage < BINS[i]!.hi) return i;
  return BINS.length - 1;
}

/**
 * Simulate over one example. `criteria` are the ids the sum can use (ordered,
 * directed, ranged); weights are drawn over them.
 */
export function simulate(fixture: string, criteria: readonly string[], { seed = 84, weightDraws = 20, completions = 5, hideSteps = 6 } = {}): BinResult[] {
  const rand = rng(seed);
  const raw = JSON.parse(readFileSync(join(here, '..', 'examples', fixture), 'utf8')) as Doc;
  const parsed = Analysis.parse(raw);
  const alts = parsed.alternatives.filter((x) => !x.tombstoned).map((x) => x.id);
  const bins = BINS.map((b) => ({ label: b.label, pairs: 0, separable: 0, imputationFlips: 0 }));

  const measurements = new Map(criteria.map((cid) => [cid, measurementFor(parsed.criteria.find((c) => c.id === cid)!, 'score')!]));

  // One complete "truth" per completion: the fixture's observed values, and a
  // draw for each blank. Structural cells stay structural.
  for (let c = 0; c < completions; c += 1) {
    const truth = new Map<string, number>();
    const base = weightedSum(Analysis.parse(withWeights(raw, criteria, criteria.map(() => 1))), { measure: 'score', criterionIds: criteria, coverageFloor: 0 });
    for (const alt of alts) {
      for (const cid of criteria) {
        const m = measurements.get(cid)!;
        const row = base.rows.find((r) => r.alternativeId === alt)!;
        const blank = row.status === 'interval' && row.blankCriteria.includes(cid);
        const observed = observedValue(parsed, alt, cid);
        if (observed !== undefined && !blank) { truth.set(`${alt}|${cid}`, observed); continue; }
        if (isStructuralFor(base, alt, cid)) continue;
        const { min, max } = m.range!;
        const v = m.level === 'ordinal' ? min + Math.floor(rand() * (max - min + 1)) : min + rand() * (max - min);
        truth.set(`${alt}|${cid}`, v);
      }
    }
    const completed = complete(raw, truth);

    for (let w = 0; w < weightDraws; w += 1) {
      const weights = criteria.map(() => 0.05 + rand());
      const full = Analysis.parse(withWeights(completed, criteria, weights));
      const truthRows = weightedSum(full, { measure: 'score', criterionIds: criteria, coverageFloor: 0 }).rows;
      const truthValue = new Map(truthRows.filter((r) => r.status === 'point').map((r) => [r.alternativeId, (r as { value: number }).value]));

      // Hide cells one at a time, in a random order, recording every step.
      const cells = [...truth.keys()];
      shuffle(cells, rand);
      for (let k = 0; k <= Math.min(hideSteps, cells.length); k += 1) {
        const hidden = new Set(cells.slice(0, k * Math.max(1, Math.floor(cells.length / (hideSteps + 1)))));
        const doc = Analysis.parse(withWeights(hide(completed, hidden), criteria, weights));
        const rows = new Map(weightedSum(doc, { measure: 'score', criterionIds: criteria, coverageFloor: 0 }).rows.map((r) => [r.alternativeId, r]));
        for (let i = 0; i < alts.length; i += 1) {
          for (let j = i + 1; j < alts.length; j += 1) {
            const x = alts[i]!, y = alts[j]!;
            const tx = truthValue.get(x), ty = truthValue.get(y);
            if (tx === undefined || ty === undefined || Math.abs(tx - ty) < 1e-12) continue;
            const rx = rows.get(x)!, ry = rows.get(y)!;
            const bin = bins[binOf(Math.min(rx.coverage, ry.coverage))]!;
            bin.pairs += 1;
            const [lx, hx] = boundsOf(rx), [ly, hy] = boundsOf(ry);
            const sep = lx > hy || ly > hx;
            if (sep) bin.separable += 1;
            const ix = imputed(doc, x, criteria, weights), iy = imputed(doc, y, criteria, weights);
            if (ix !== undefined && iy !== undefined && Math.sign(ix - iy) !== Math.sign(tx - ty)) bin.imputationFlips += 1;
          }
        }
      }
    }
  }
  return bins;
}

function boundsOf(r: WeightedSumRow): [number, number] {
  return r.status === 'point' ? [r.value, r.value] : r.status === 'interval' ? r.interval : [0, 1];
}

/** The forbidden estimate: weights renormalised over observed criteria only. */
function imputed(a: Analysis, alt: string, criteria: readonly string[], weights: number[]): number | undefined {
  let num = 0, den = 0;
  criteria.forEach((cid, i) => {
    const v = observedValue(a, alt, cid);
    if (v === undefined) return;
    const m = measurementFor(a.criteria.find((c) => c.id === cid)!, 'score')!;
    const u = (v - m.range!.min) / (m.range!.max - m.range!.min);
    num += weights[i]! * (m.preference === 'decreasing' ? 1 - u : u);
    den += weights[i]!;
  });
  return den > 0 ? num / den : undefined;
}

function observedValue(a: Analysis, alt: string, cid: string): number | undefined {
  const cell = a.cells.find((c) => c.alternativeId === alt && c.criterionId === cid && c.measure === 'score');
  const vals = (cell?.assertions ?? []).filter((s) => !s.supersededBy && typeof s.value === 'number').map((s) => s.value as number);
  if (vals.length === 0) return undefined;
  const sorted = [...vals].sort((p, q) => p - q);
  return sorted[Math.floor((sorted.length - 1) / 2)]; // lower median, the fixtures' default
}

function isStructuralFor(base: ReturnType<typeof weightedSum>, alt: string, cid: string): boolean {
  const row = base.rows.find((r) => r.alternativeId === alt);
  if (!row || row.status === 'not-scored') return false;
  return row.renormalised?.criteria.includes(cid) ?? false;
}

function withWeights(doc: Doc, criteria: readonly string[], weights: number[]): Doc {
  const out = structuredClone(doc);
  out.criteria = out.criteria.map((c) => {
    const i = criteria.indexOf(c.id);
    return i === -1 ? { ...c, weights: undefined } : { ...c, weights: { substitution: weights[i] } };
  });
  return out;
}

function complete(doc: Doc, truth: Map<string, number>): Doc {
  const out = structuredClone(doc);
  const at = '2026-09-22T00:00:00Z';
  out.cells = out.cells.filter((c) => c.measure !== 'score' || !truth.has(`${c.alternativeId}|${c.criterionId}`));
  const authorId = (doc as { authors?: { id: string }[] }).authors?.[0]?.id ?? 'sim';
  for (const [key, value] of truth) {
    const [alternativeId, criterionId] = key.split('|') as [string, string];
    out.cells.push({
      alternativeId, criterionId, measure: 'score',
      assertions: [{ id: `sim-${key}`, authorId, at, version: 1, evidence: [], value, justification: 'simulated' }],
    });
  }
  return out;
}

function hide(doc: Doc, hidden: Set<string>): Doc {
  const out = structuredClone(doc);
  for (const c of out.cells) {
    if (c.measure === 'score' && hidden.has(`${c.alternativeId}|${c.criterionId}`)) {
      c.assertions = [{ ...c.assertions[0]!, value: undefined, justification: undefined, missing: { code: 'not-assessed' } }];
    }
  }
  return out;
}

function shuffle<T>(xs: T[], rand: () => number): void {
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

export const FIXTURES = [
  { fixture: 'languages.json', criteria: ['ecosystem', 'performance', 'hiring', 'learning-curve', 'tooling'] },
  {
    fixture: 'relocation.json',
    criteria: ['rent', 'income-tax', 'winter-daylight', 'flight-hours', 'school-quality', 'eu-residency-path'],
  },
] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { fixture, criteria } of FIXTURES) {
    console.log(`\n${fixture}`);
    console.log('coverage      pairs  separable  imputation-flips');
    for (const b of simulate(fixture, criteria)) {
      const pct = (n: number) => (b.pairs === 0 ? '   -' : `${((100 * n) / b.pairs).toFixed(1).padStart(5)}%`);
      console.log(`${b.label.padEnd(12)} ${String(b.pairs).padStart(6)}  ${pct(b.separable).padStart(9)}  ${pct(b.imputationFlips).padStart(15)}`);
    }
  }
}
