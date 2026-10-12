/**
 * The affordance layer, driven with no view present (#52, ADR-0004).
 *
 * Every refusal a view would make is asserted here against the document alone,
 * with its reason. Editability is the intersection of the document's policy and
 * the host's authorisation; with no host it is the document's policy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { screen } from '../src/core/analyses/screening.js';
import { tombstone } from '../src/core/schema/anchors.js';
import { makeAffordances, cellPolicy, valueAffordance, type EditRequest } from '../src/core/affordances.js';
import { makeAffordances as fromRoot } from '../src/index.js';
import { cellAffordanceOf, inMemoryAnalysisSource } from '../src/store/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => Analysis.parse(JSON.parse(readFileSync(join(root, 'examples', 'relocation.json'), 'utf8')));

describe('editing a cell, with no view and no host', () => {
  it('allows an ordinary cell', () => {
    expect(makeAffordances(relocation()).assert('lisbon', 'rent', 'score')).toEqual({ enabled: true });
  });

  it('refuses, with a reason, every cell that does not exist to be written', () => {
    const aff = makeAffordances(relocation());
    const cases: [string, string, string, RegExp][] = [
      ['nowhere', 'rent', 'score', /no alternative "nowhere"/],
      ['lisbon', 'nothing', 'score', /no criterion "nothing"/],
      ['taipei', 'eu-residency-path', 'score', /does not apply/],
    ];
    for (const [alt, crit, measure, why] of cases) {
      const r = aff.assert(alt, crit, measure);
      expect(r.enabled, `${alt}/${crit}/${measure}`).toBe(false);
      expect(r.reason).toMatch(why);
    }
  });

  it('refuses a measure the criterion declares no measurement for', () => {
    const a = relocation();
    const only = { ...a, criteria: a.criteria.map((c) => (c.id === 'rent'
      ? { ...c, defaultMeasurement: undefined, measurements: { score: c.defaultMeasurement! } } : c)) };
    expect(makeAffordances(only).assert('lisbon', 'rent', 'confidence').reason).toMatch(/declares no measurement for "confidence"/);
  });

  it('refuses a tombstoned row or column', () => {
    const a = tombstone(tombstone(relocation(), { kind: 'alternative', id: 'seoul' }), { kind: 'criterion', id: 'rent' });
    const aff = makeAffordances(a);
    expect(aff.assert('seoul', 'income-tax', 'score').reason).toMatch(/deleted/);
    expect(aff.assert('lisbon', 'rent', 'score').reason).toMatch(/deleted/);
  });

  it('refuses a locked analysis and a read-only cell, but offers a suggestion there', () => {
    const locked = makeAffordances({ ...relocation(), locked: true });
    expect(locked.assert('lisbon', 'rent', 'score').reason).toMatch(/locked; propose a suggestion/);
    expect(locked.suggest('lisbon', 'rent', 'score')).toEqual({ enabled: true });

    const a = relocation();
    const ro = { ...a, cells: a.cells.map((c) => (c.alternativeId === 'lisbon' && c.criterionId === 'rent' ? { ...c, readOnly: true } : c)) };
    const aff = makeAffordances(ro);
    expect(aff.assert('lisbon', 'rent', 'score').reason).toMatch(/read-only/);
    expect(aff.suggest('lisbon', 'rent', 'score').enabled).toBe(true);
    expect(aff.suggest('taipei', 'eu-residency-path', 'score').enabled).toBe(false);
  });
});

describe('editability is the intersection with the host, never a model of its own', () => {
  it('lets the host refuse, with its own reason, what the document allows', () => {
    const asked: EditRequest[] = [];
    const aff = makeAffordances(relocation(), {
      authorize: (r) => {
        asked.push(r);
        return r.alternativeId === 'berlin' ? { enabled: false, reason: 'only the Berlin owner edits Berlin.' } : true;
      },
    });
    expect(aff.assert('lisbon', 'rent', 'score').enabled).toBe(true);
    expect(aff.assert('berlin', 'rent', 'score')).toEqual({ enabled: false, reason: 'only the Berlin owner edits Berlin.' });
    expect(asked).toContainEqual({ action: 'assert', alternativeId: 'berlin', criterionId: 'rent', measure: 'score' });
  });

  it('gives a generic reason when the host answers a bare false', () => {
    expect(makeAffordances(relocation(), { authorize: () => false }).assert('lisbon', 'rent', 'score').reason).toMatch(/not authorised/);
  });

  it('cannot widen what the document refuses: the host is not even asked', () => {
    let calls = 0;
    const aff = makeAffordances({ ...relocation(), locked: true }, { authorize: () => { calls++; return true; } });
    expect(aff.assert('lisbon', 'rent', 'score').enabled).toBe(false);
    expect(calls).toBe(0);
  });

  it('the store composes the provider with the same document policy, and the same words', async () => {
    const a = { ...relocation(), locked: true };
    expect(cellAffordanceOf(inMemoryAnalysisSource(a), a, undefined)).toEqual(cellPolicy(a, undefined));
    expect(cellAffordanceOf(inMemoryAnalysisSource(a, { canUpdate: false }), a, undefined).reason).toMatch(/does not accept updates/);
  });
});

describe('values and blanks a view may offer', () => {
  it('admits only declared levels, and numbers within an ordered range', () => {
    const aff = makeAffordances(relocation());
    expect(aff.value('school-quality', 'score', 4).enabled).toBe(true);
    expect(aff.value('school-quality', 'score', 6).reason).toMatch(/not one of the declared levels/);
    expect(aff.value('rent', 'score', 1500).enabled).toBe(true);
    expect(aff.value('rent', 'score', 'cheap').reason).toMatch(/takes a number/);
    expect(aff.value('nothing', 'score', 1).enabled).toBe(false);
    expect(valueAffordance({ level: 'ratio', preference: 'increasing', range: { min: 0, max: 10 } }, 11).reason).toMatch(/outside/);
  });

  it('agrees with the validator: a value the editor refuses is a document the validator refuses (#165)', () => {
    const a = relocation();
    const aff = makeAffordances(a);
    const i = a.cells.findIndex((c) => c.criterionId === 'school-quality' && c.assertions.some((s) => s.value !== undefined));
    const j = a.cells[i]!.assertions.findIndex((s) => s.value !== undefined);
    for (const value of [99, 'zz', 4] as const) {
      const cells = a.cells.map((c, k) => (k !== i ? c : {
        ...c, assertions: c.assertions.map((s, l) => (l === j ? { ...s, value } : s)),
      }));
      const r = validateAnalysis({ ...a, cells }, { includeCompleteness: false });
      const refused = r.problems.some((p) => p.ruleId === 'value-admitted');
      expect(refused, String(value)).toBe(!aff.value('school-quality', 'score', value).enabled);
    }
  });

  it('the store refuses the value the editor would not offer (#165)', async () => {
    const a = relocation();
    const src = inMemoryAnalysisSource(a);
    const i = a.cells.findIndex((c) => c.criterionId === 'school-quality' && c.assertions.some((s) => s.value !== undefined));
    const cells = a.cells.map((c, k) => (k !== i ? c : {
      ...c, assertions: c.assertions.map((s) => (s.value !== undefined ? { ...s, value: 99 } : s)),
    }));
    await expect(src.update(a.id, { cells })).rejects.toThrow(/value-admitted/);
    expect((await src.getOne(a.id)).cells[i]).toEqual(a.cells[i]);
  });

  it('lists the codes legal on a criterion, criterion overlay included, and refuses the rest', () => {
    const aff = makeAffordances(relocation());
    const tax = aff.missingCodes('income-tax');
    expect(tax).toContainEqual(expect.objectContaining({ code: 'paywalled', source: 'criterion' }));
    expect(tax).toContainEqual(expect.objectContaining({ code: 'not-assessed', source: 'core' }));
    expect(aff.missingCodes('rent').map((c) => c.code)).not.toContain('paywalled');
    expect(aff.missingCode('income-tax', 'paywalled').enabled).toBe(true);
    expect(aff.missingCode('rent', 'paywalled').reason).toMatch(/not a missingness code/);
  });

  it('reports inapplicability from the declared blocks', () => {
    const aff = makeAffordances(relocation());
    expect(aff.inapplicable('taipei', 'eu-residency-path')).toBe(true);
    expect(aff.inapplicable('lisbon', 'eu-residency-path')).toBe(false);
  });

  it('lists exactly the screens screening applies', () => {
    const a = relocation();
    const screens = makeAffordances(a).screens('score');
    expect(screens.map((s) => s.criterionId)).toEqual(screen(a, 'score').screenedOn);
    expect(screens.length).toBeGreaterThan(0);
    expect(screens[0]).toMatchObject({ measure: 'score', rationale: expect.any(String), threshold: expect.any(Number) });
  });
});

describe('nothing about rendering or storage is expressible', () => {
  it('answers in plain data: every answer survives JSON unchanged', () => {
    const aff = makeAffordances(relocation());
    const answers = [
      aff.assert('lisbon', 'rent', 'score'), aff.suggest('taipei', 'eu-residency-path', 'score'),
      aff.value('rent', 'score', 1), aff.missingCodes('income-tax'), aff.screens('score'),
    ];
    expect(JSON.parse(JSON.stringify(answers))).toEqual(answers);
  });

  it('exposes only policy queries', () => {
    expect(Object.keys(makeAffordances(relocation())).sort()).toEqual(
      ['assert', 'inapplicable', 'missingCode', 'missingCodes', 'screens', 'suggest', 'value'],
    );
  });

  it('is exported from the package root', () => {
    expect(fromRoot).toBe(makeAffordances);
  });
});
