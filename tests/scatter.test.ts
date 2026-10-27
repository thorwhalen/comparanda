/**
 * The two-criterion scatter's model (#97, ADR-0026): tiers on two criteria and
 * across all of them, from `dominance` and nothing else; a refusal, named,
 * where the pair admits no dominance comparison.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { dominance } from '../src/core/analyses/dominance.js';
import { SCATTER_CAPTION, scatterCriteria, scatterModel, type ScatterModel } from '../src/core/analyses/scatter.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = (name: string) => Analysis.parse(JSON.parse(readFileSync(join(examples, `${name}.json`), 'utf8')));
const languages = example('languages');
const relocation = example('relocation');
const usable = (m: ScatterModel) => {
  if (!m.usable) throw new Error(m.reason);
  return m;
};

describe('scatterModel', () => {
  it('gives each alternative its tier on the two criteria and across every one: the 2-D front is not the frontier', () => {
    const m = usable(scatterModel(languages, { measure: 'score', criteria: ['ecosystem', 'performance'] }));
    const ts = m.points.find((p) => p.alternativeId === 'typescript')!;
    // Dominated by Go on ecosystem and performance, and still non-dominated once every criterion counts.
    expect([ts.here, ts.overall, ts.dominatedBy]).toEqual(['dominated', 'non-dominated', ['go']]);
    expect(m.caption).toBe(SCATTER_CAPTION);
    expect(SCATTER_CAPTION).toBe('non-dominated on these two criteria');
    expect(m.overallBasis).toBe(dominance(languages, { measure: 'score' }).basisDescription);
  });

  it('takes its tiers from dominance, run on the two criteria and on all of them', () => {
    const criteria = ['income-tax', 'school-quality'] as const;
    const m = usable(scatterModel(relocation, { measure: 'score', criteria }));
    const here = dominance(relocation, { measure: 'score', criterionIds: criteria });
    const overall = dominance(relocation, { measure: 'score' });
    const tier = (r: typeof here, id: string) => (r.dominated.includes(id) ? 'dominated' : r.provisional.includes(id) ? 'possibly-dominated' : 'non-dominated');
    for (const p of m.points) expect([p.here, p.overall]).toEqual([tier(here, p.alternativeId), tier(overall, p.alternativeId)]);
  });

  it('places a point only where both values are numbers, and keeps the rest with their tiers', () => {
    const m = usable(scatterModel(relocation, { measure: 'score', criteria: ['rent', 'flight-hours'] }));
    const seoul = m.points.find((p) => p.alternativeId === 'seoul')!;
    expect([seoul.x, seoul.y]).toEqual([undefined, 17]);
    expect(seoul.here).toBe('possibly-dominated');
    expect(m.points.map((p) => p.alternativeId)).toEqual(relocation.alternatives.map((a) => a.id));
    expect(m.axes.map((a) => [a.criterionId, a.range, a.preference])).toEqual([
      ['rent', { min: 0, max: 6000 }, 'decreasing'], ['flight-hours', { min: 0, max: 24 }, 'decreasing'],
    ]);
  });

  it('says why a value is absent, as the matrix does, and leaves a tombstoned alternative out', () => {
    const m = usable(scatterModel(relocation, { measure: 'score', criteria: ['flight-hours', 'eu-residency-path'] }));
    const taipei = m.points.find((p) => p.alternativeId === 'taipei')!;
    expect([taipei.x, taipei.y, taipei.xWords, taipei.yWords]).toEqual([15.5, undefined, '15.5', 'This criterion does not apply to this alternative.']);
    const doc = structuredClone(relocation);
    doc.alternatives.find((a) => a.id === 'seoul')!.tombstoned = true;
    expect(usable(scatterModel(doc, { measure: 'score', criteria: ['rent', 'flight-hours'] })).points.map((p) => p.alternativeId)).not.toContain('seoul');
    expect(scatterCriteria(relocation, 'score')).toEqual(dominance(relocation, { measure: 'score' }).basis);
  });

  it('refuses, saying why, a pair that admits no dominance comparison', () => {
    const refused = (criteria: readonly [string, string]) => {
      const m = scatterModel(relocation, { measure: 'score', criteria });
      return m.usable ? undefined : m.reason;
    };
    expect(refused(['rent', 'climate-type'])).toBe('Climate type cannot be compared for dominance (nominal).');
    expect(refused(['rent', 'rent'])).toMatch(/two different criteria/);
    expect(refused(['rent', 'nope'])).toMatch(/"nope" is not a criterion/);
    // A tombstoned criterion is gone, though dominance given its id would still compare it.
    const doc = structuredClone(relocation);
    doc.criteria.find((c) => c.id === 'flight-hours')!.tombstoned = true;
    expect(scatterModel(doc, { measure: 'score', criteria: ['rent', 'flight-hours'] })).toEqual({ usable: false, reason: '"flight-hours" is not a criterion of this analysis.' });
  });
});
