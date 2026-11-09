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
import { scopeGroups } from '../src/core/analyses/scope.js';

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

  it('scopes both comparisons to one group of alternatives, and names the scope (#286, ADR-0019 clause 3)', () => {
    const criteria = ['rent', 'flight-hours'] as const;
    const m = usable(scatterModel(relocation, { measure: 'score', criteria, groupId: 'g-asia' }));
    expect(m.points.map((p) => p.alternativeId)).toEqual(['taipei', 'seoul']);
    expect(m.scope).toEqual({ groupId: 'g-asia', label: 'Asia', size: 2 });
    const here = dominance(relocation, { measure: 'score', criterionIds: criteria, groupId: 'g-asia' });
    expect(m.notes).toEqual(here.notes);
    expect(m.overallBasis).toBe(dominance(relocation, { measure: 'score', groupId: 'g-asia' }).basisDescription);
    expect(m.basis).toBe('compared within the group "Asia": 2 options, strictly: any difference counts.');
    // The default is every live alternative, and says so.
    expect(usable(scatterModel(relocation, { measure: 'score', criteria })).basis).toBe('compared across every option (5), strictly: any difference counts.');
    // A group that is not a live group of alternatives is refused, never thrown.
    expect(scatterModel(relocation, { measure: 'score', criteria, groupId: 'g-cost' })).toEqual({ usable: false, reason: '"g-cost" is not a group of options in this analysis.' });
  });

  it('applies the practical tolerance where a criterion declares an indifference threshold, and says which (#286, ADR-0019 clause 8)', () => {
    const criteria = ['rent', 'flight-hours'] as const;
    const doc = structuredClone(relocation);
    doc.criteria.find((c) => c.id === 'rent')!.defaultMeasurement!.thresholds = { indifference: 600 };
    const strict = usable(scatterModel(doc, { measure: 'score', criteria }));
    const practical = usable(scatterModel(doc, { measure: 'score', criteria, usePracticalTolerance: true }));
    const tierOf = (m: typeof strict, id: string) => m.points.find((p) => p.alternativeId === id)!.here;
    // Lisbon's rent is 150 below Berlin's, within the 600 that counts as none, and its flight half an hour longer: dominated, but only under the tolerance.
    expect([tierOf(strict, 'lisbon'), tierOf(practical, 'lisbon')]).toEqual(['non-dominated', 'dominated']);
    expect(practical.points.find((p) => p.alternativeId === 'lisbon')!.dominatedBy).toEqual(['berlin']);
    // The tiers are dominance's, with the tolerance passed through.
    expect(practical.notes).toEqual(dominance(doc, { measure: 'score', criterionIds: criteria, usePracticalTolerance: true }).notes);
    expect(practical.axes.map((a) => [a.indifference, a.indifferenceWords])).toEqual([[600, '600 USD/month'], [undefined, undefined]]);
    // Counted over the criteria compared (6), not every criterion (8: two are nominal, so not compared).
    expect(doc.criteria).toHaveLength(8);
    expect(practical.tolerance).toMatchObject({ applied: true, overall: { declared: 1, of: 6 }, effect: 'both' });
    expect(practical.basis).toBe(
      'compared across every option (5), with the practical tolerance: a difference at or below a criterion\'s indifference threshold counts as none ' +
      '(Rent: 600 USD/month; Flight hours to family: none declared, so compared strictly; 1 of the 6 criteria compared across every criterion declares one).',
    );
    // Off by default; and where nothing declares a threshold, the model says so, in words worded for whether it is on.
    expect(strict.tolerance.applied).toBe(false);
    const none = (on: boolean) => usable(scatterModel(relocation, { measure: 'score', criteria, usePracticalTolerance: on })).tolerance;
    expect(none(false)).toMatchObject({ overall: { declared: 0, of: 6 }, effect: 'none' });
    expect(none(false).said).toBe('Unavailable: none of the 6 criteria compared declares an indifference threshold, so the practical tolerance would change nothing.');
    expect(none(true).said).toBe('On, but none of the 6 criteria compared declares an indifference threshold, so it changes nothing: the comparison is strict.');
    // A threshold off the two axes moves only the outer mark, and the hint says so.
    const off = usable(scatterModel(doc, { measure: 'score', criteria: ['income-tax', 'flight-hours'] })).tolerance;
    expect(off.effect).toBe('outer-only');
    expect(off.said).toBe('Neither Income tax burden nor Flight hours to family declares an indifference threshold, so here the tolerance changes only the tier across every criterion (1 of the 6 criteria compared declares one).');
    // On an ordinal scale a threshold counts levels: the range's unit names the scale, and is not said after it.
    const ordinal = doc.criteria.find((c) => c.id === 'income-tax')!.defaultMeasurement!;
    ordinal.range = { ...ordinal.range!, unit: '1-5' };
    ordinal.thresholds = { indifference: 1 };
    expect(usable(scatterModel(doc, { measure: 'score', criteria: ['income-tax', 'flight-hours'], usePracticalTolerance: true })).basis)
      .toContain('(Income tax burden: 1 level; Flight hours to family: none declared');
    // A threshold of zero changes nothing, so it is not counted as declared.
    doc.criteria.find((c) => c.id === 'rent')!.defaultMeasurement!.thresholds = { indifference: 0 };
    expect(usable(scatterModel(doc, { measure: 'score', criteria })).axes[0].indifference).toBeUndefined();
  });
});

describe('scopeGroups', () => {
  it('offers the live groups of alternatives that have a member the reader shows, in document order', () => {
    expect(scopeGroups(relocation).map((g) => [g.id, g.members, g.shown])).toEqual([
      ['g-europe', ['lisbon', 'berlin'], 2], ['g-asia', ['taipei', 'seoul'], 2], ['g-americas', ['montreal'], 1],
    ]);
    // Montreal hidden: the Americas have nothing shown, so are not offered; Asia has one of two shown.
    const shownAlternatives = ['lisbon', 'berlin', 'taipei'];
    expect(scopeGroups(relocation, { shownAlternatives }).map((g) => [g.id, g.shown])).toEqual([['g-europe', 2], ['g-asia', 1]]);
    // A tombstoned group, and a group of criteria, are never offered.
    const doc = structuredClone(relocation);
    doc.groups.find((g) => g.id === 'g-europe')!.tombstoned = true;
    expect(scopeGroups(doc).map((g) => g.id)).toEqual(['g-asia', 'g-americas']);
  });

  it('names a sub-group\'s parent, and counts its members in the parent', () => {
    const doc = structuredClone(relocation);
    doc.groups.push({ id: 'g-iberia', label: 'Iberia', axis: 'alternatives', parentId: 'g-europe' });
    doc.alternatives.find((a) => a.id === 'lisbon')!.groupIds = ['g-iberia'];
    const groups = scopeGroups(Analysis.parse(doc));
    expect(groups.find((g) => g.id === 'g-iberia')).toMatchObject({ label: 'Iberia', parentLabel: 'Europe', members: ['lisbon'] });
    expect(groups.find((g) => g.id === 'g-europe')!.members).toEqual(['lisbon', 'berlin']);
  });
});
