/**
 * `Assertion.confidence` (request 17, #307): an optional closed ordinal of evidence quality.
 *
 * Never a number, never `certainty`, never defaulted; its glosses travel in the emitted artifact; and it has one
 * home per (alternative, criterion) -- the field or a `confidence` measure, not both.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { Assertion } from '../src/core/schema/values.js';
import { CONFIDENCE_GLOSSES, CONFIDENCE_LEVELS } from '../src/core/schema/provenance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const relocation = () => readJson('examples/relocation.json');
const artifact = readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`);
const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(artifact);

type Cell = { alternativeId: string; criterionId: string; measure: string; assertions: Record<string, unknown>[] };
/** The messy fixture with `edit` applied to the cell of its first assertion that has a value. */
function withEdit(edit: (cell: Cell, i: number, doc: ReturnType<typeof relocation>) => void) {
  const doc = relocation();
  edit(doc.cells[0], 0, doc);
  return doc;
}

describe('the field', () => {
  it('is exercised by the messy fixture at every level, and the fixture validates', () => {
    const levels = new Set(Analysis.parse(relocation()).cells.flatMap((c) => c.assertions.map((a) => a.confidence)));
    expect([...levels].filter(Boolean).sort()).toEqual([...CONFIDENCE_LEVELS].sort());
    expect(levels.has(undefined), 'absent stays absent: no default level').toBe(true);
    expect(validateAnalysis(relocation()).ok).toBe(true);
  });

  it('survives parse and serialise, absent or present, without being defaulted', () => {
    const parsed = Analysis.parse(relocation());
    const back = Analysis.parse(JSON.parse(JSON.stringify(parsed)));
    expect(back).toEqual(parsed);
    const base = { id: 'a1', authorId: 'ana', at: 't', value: 1 };
    expect('confidence' in Assertion.parse(base)).toBe(false);
    expect(Assertion.parse({ ...base, confidence: 'low' }).confidence).toBe('low');
  });

  it('refuses a number, an unknown word, and the word certainty, in both validators', () => {
    for (const bad of [0.9, 3, 'certain', 'High', 'very-high', null, true]) {
      const doc = withEdit((cell) => { cell.assertions[0]!.confidence = bad; });
      expect(Assertion.safeParse({ id: 'a', authorId: 'b', at: 't', value: 1, confidence: bad }).success, String(bad)).toBe(false);
      expect(ajv(doc), String(bad)).toBe(false);
      expect(validateAnalysis(doc).ok, String(bad)).toBe(false);
    }
    const certainty = withEdit((cell) => { cell.assertions[0]!.certainty = 'high'; });
    expect(ajv(certainty)).toBe(false);
    expect(validateAnalysis(certainty).ok).toBe(false);
  });

  it('is lowest first, and the artifact carries the glosses as the description', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['low', 'medium', 'high']);
    const field = artifact.$defs?.Assertion?.properties?.confidence ?? JSON.stringify(artifact);
    const text = typeof field === 'string' ? field : JSON.stringify(field);
    for (const gloss of Object.values(CONFIDENCE_GLOSSES)) expect(text).toContain(gloss);
    expect(text).toContain('not certainty');
  });
});

describe('one home per alternative and criterion (rule confidence-one-home)', () => {
  const measured = (doc: ReturnType<typeof relocation>, measure = 'confidence') => {
    const c = doc.cells[0];
    doc.cells.push({ alternativeId: c.alternativeId, criterionId: c.criterionId, measure, assertions: [] });
    return doc;
  };
  const homes = (doc: unknown) => validateAnalysis(doc).problems.filter((p) => p.ruleId === 'confidence-one-home');

  it('is silent when the analysis uses the field alone', () => {
    expect(homes(relocation())).toEqual([]);
  });

  it('refuses the field where the same pair also scores a confidence measure, and names both', () => {
    const doc = measured(withEdit((cell) => { cell.assertions[0]!.confidence = 'high'; }));
    const [problem, ...rest] = homes(doc);
    expect(rest).toEqual([]);
    expect(problem!.path).toBe('cells[0].assertions[0].confidence');
    expect(problem!.message).toMatch(/two homes/);
  });

  it('leaves a confidence measure alone, and a field on a pair that has no such measure', () => {
    const bare = relocation();
    const free = bare.cells.find((c: Cell) => c.assertions.every((a) => a.confidence === undefined))!;
    bare.cells.push({ alternativeId: free.alternativeId, criterionId: free.criterionId, measure: 'confidence', assertions: [] });
    expect(homes(bare)).toEqual([]);
    const other = withEdit((cell) => { cell.assertions[0]!.confidence = 'low'; });
    other.cells.push({ alternativeId: 'elsewhere', criterionId: 'x', measure: 'confidence', assertions: [] });
    expect(homes(other)).toEqual([]);
  });
});
