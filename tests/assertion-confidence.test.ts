/**
 * `Assertion.confidence` (request 17, #307): an optional closed ordinal of evidence quality.
 *
 * Never a number, never `certainty`, never defaulted; its glosses travel in the emitted artifact. It sits beside a
 * `confidence` measure without touching it: a different quantity, which the view layer reads (docs/domain-model.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { Assertion } from '../src/core/schema/values.js';
import { CONFIDENCE_GLOSSES, CONFIDENCE_LEVELS } from '../src/core/schema/evidence.js';

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

  it('is lowest first, and the artifact carries the glosses as the field\'s description, wherever an assertion appears', () => {
    expect(CONFIDENCE_LEVELS).toEqual(['low', 'medium', 'high']);
    const fields: { enum: string[]; description: string }[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o === null || typeof o !== 'object') return;
      const rec = o as Record<string, unknown>;
      const props = rec.properties as Record<string, { enum?: string[]; description?: string }> | undefined;
      if (props?.confidence?.enum) fields.push(props.confidence as { enum: string[]; description: string });
      Object.values(rec).forEach(walk);
    };
    walk(artifact);
    // The cell's assertions, and the assertion a suggestion proposes.
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const f of fields) {
      expect(f.enum).toEqual([...CONFIDENCE_LEVELS]);
      for (const gloss of Object.values(CONFIDENCE_GLOSSES)) expect(f.description).toContain(gloss);
      expect(f.description).toContain('not certainty');
    }
  });

  it('sits beside a confidence measure on the same pair without either being refused', () => {
    const doc = withEdit((cell, _i, d) => {
      cell.assertions[0]!.confidence = 'high';
      d.cells.push({ alternativeId: cell.alternativeId, criterionId: cell.criterionId, measure: 'confidence', assertions: [] });
    });
    // Only the measure's own declaration is missing on that criterion; nothing about the field is a problem.
    expect(validateAnalysis(doc).problems.filter((p) => p.path.endsWith('.confidence'))).toEqual([]);
  });
});
