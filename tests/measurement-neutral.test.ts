/**
 * `Measurement.neutral` (request 18, #311): an optional declared neutral level, ordinal only, one of the levels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { validateMeasurement, type Measurement } from '../src/core/schema/measurement.js';
import { PROPERTY_DESCRIPTIONS } from '../src/core/schema/schema-descriptions.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const artifact = readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`);
const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(artifact);
const ordinal: Measurement = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] };
const withNeutral = (neutral: unknown) => {
  const doc = readJson('examples/relocation.json');
  doc.criteria.find((c: { id: string }) => c.id === 'winter-daylight').defaultMeasurement.neutral = neutral;
  return doc;
};

describe('Measurement.neutral', () => {
  it('is optional, exercised by the messy fixture, and the fixture validates', () => {
    expect(Analysis.parse(readJson('examples/relocation.json')).criteria.find((c) => c.id === 'winter-daylight')?.defaultMeasurement?.neutral).toBe(3);
    expect(validateMeasurement(ordinal)).toEqual([]);
    expect(validateAnalysis(readJson('examples/relocation.json')).ok).toBe(true);
  });

  it('admits one of the levels, and refuses what the scale cannot take', () => {
    expect(validateMeasurement({ ...ordinal, neutral: 3 })).toEqual([]);
    for (const bad of [6, 0, 2.5, 'mid', true]) {
      const [problem] = validateMeasurement({ ...ordinal, neutral: bad });
      expect(problem?.path, String(bad)).toBe('neutral');
      expect(validateAnalysis(withNeutral(bad)).ok, String(bad)).toBe(false);
    }
  });

  it('is admitted on ordinal measurements only', () => {
    for (const level of ['nominal', 'interval', 'ratio'] as const) {
      const m: Measurement = level === 'nominal'
        ? { level, preference: 'none', levels: [1, 2, 3], neutral: 2 }
        : { level, preference: 'increasing', range: { min: 0, max: 10 }, neutral: 5 };
      expect(validateMeasurement(m).map((p) => p.message).join(), level).toMatch(/neutral needs an ordinal level/);
    }
  });

  it('is the same in the artifact: a number parses, a non-scalar is refused, and the description travels', () => {
    expect(ajv(withNeutral(3))).toBe(true);
    expect(ajv(withNeutral([3]))).toBe(false);
    // The description is the emitter's, written wherever an object has a `neutral` property; the name must mean one
    // thing in the schema, which is checkable: every such object is a measurement, and has `levels` beside it.
    const owners: { properties: Record<string, { description?: string }> }[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o === null || typeof o !== 'object') return;
      const props = (o as { properties?: Record<string, { description?: string }> }).properties;
      if (props?.neutral) owners.push(o as (typeof owners)[number]);
      Object.values(o).forEach(walk);
    };
    walk(artifact);
    expect(owners.length).toBeGreaterThan(0);
    for (const o of owners) {
      expect(o.properties.neutral!.description).toBe(PROPERTY_DESCRIPTIONS.neutral);
      expect(Object.keys(o.properties), 'a neutral belongs to a measurement').toEqual(expect.arrayContaining(['levels', 'level', 'preference']));
    }
  });
});
