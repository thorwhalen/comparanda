/**
 * Schema v1 is frozen (#57, `docs/schema-v1.md`). What the freeze promises, as tests.
 *
 * - The shape is closed, in zod and in the emitted artifact, and both refuse
 *   the same unknown key -- including the fields #158 renamed, which used to
 *   validate and then vanish on load-then-save (#165).
 * - Every field pulled forward into v1 to avoid a later migration is exercised
 *   by the messy fixture, or by a named test where the fixture deliberately
 *   does not carry it. A field nobody exercises is a field whose bugs nobody finds.
 * - The freeze note names its date and its decisions, so it is an event, not a mood.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { DOCUMENT_MIGRATIONS, missingMigrationSteps } from '../src/core/migrations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const schema = readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`);
const relocation = () => readJson('examples/relocation.json');

describe('the shape is closed', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

  it('every object in the artifact refuses keys it does not name', () => {
    const open: string[] = [];
    const walk = (s: unknown, at: string) => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o.type === 'object' && o.properties && o.additionalProperties !== false) open.push(at);
      for (const [k, v] of Object.entries(o)) walk(v, `${at}/${k}`);
    };
    walk(schema, '#');
    expect(open).toEqual([]);
  });

  it('no field is left unconstrained, except the declared extension point `params`', () => {
    // An empty schema accepts anything: `Suggestion.proposed` was one, which
    // left a hole in the closed shape (#57 review). Declaration `params` are the
    // one place open by design -- they carry an extension's own parameters.
    const CONSTRAINING = ['type', '$ref', 'anyOf', 'oneOf', 'allOf', 'const', 'enum', 'not'];
    const loose: string[] = [];
    const walk = (s: unknown, at: string, key: string) => {
      if (Array.isArray(s)) { s.forEach((v, i) => walk(v, `${at}/${i}`, String(i))); return; }
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      const container = ['properties', '$defs', 'dependentRequired', 'default'].includes(key);
      if (at && !container && !CONSTRAINING.some((k) => k in o) && !/\/params\/additionalProperties$/.test(at)) loose.push(at);
      for (const [k, v] of Object.entries(o)) if (k !== 'default') walk(v, `${at}/${k}`, k);
    };
    walk(schema, '', '');
    expect(loose).toEqual([]);
  });

  it('refuses a schemaVersion other than 1 in both validators, and an own __proto__ key in zod as Ajv does', () => {
    for (const v of [0, -1, 0.5, 2]) {
      const d = { ...relocation(), schemaVersion: v };
      expect(ajv(d), String(v)).toBe(false);
      expect(validateAnalysis(d).problems.map((p) => p.ruleId), String(v)).toContain('schema-version-readable');
    }
    const proto = JSON.parse(JSON.stringify(relocation()).replace('{"id":', '{"__proto__":{"x":1},"id":'));
    expect(ajv(proto)).toBe(false);
    expect(validateAnalysis(proto).ok).toBe(false);
  });

  it('zod and the artifact refuse the same unknown key, at the root and deep inside', () => {
    const doc = relocation();
    const cases: [string, (d: Record<string, any>) => void][] = [
      ['root', (d) => { d.selection = { alternatives: ['lisbon'] }; }],
      ['assertion', (d) => { d.cells[0].assertions[0].confidense = 3; }],
      ['suggestion proposal', (d) => { d.suggestions[0].proposed.valeu = true; }],
      ['criterion definition (#158: renamed missingRule)', (d) => {
        d.criteria[0].definition = { ...(d.criteria[0].definition ?? {}), missingRule: 'old shape' };
      }],
    ];
    expect(ajv(doc)).toBe(true);
    for (const [where, mutate] of cases) {
      const d = structuredClone(doc);
      mutate(d);
      expect(ajv(d), where).toBe(false);
      expect(validateAnalysis(d).ok, where).toBe(false);
    }
  });

  it('a parsed document survives a JSON round trip unchanged, so load-then-save loses nothing', () => {
    const a = Analysis.parse(relocation());
    expect(Analysis.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
});

/**
 * Does a *meaningful* value sit at this dotted path? `[]` walks every array
 * item. `false`, `null`, `""`, `[]` and `{}` do not count: a fixture setting
 * every tombstone to `false` exercises nothing (#57 review).
 */
function exercised(doc: unknown, path: string): boolean {
  const step = (vals: unknown[], seg: string): unknown[] => vals.flatMap((v) => {
    if (seg === '[]') return Array.isArray(v) ? v : [];
    return v && typeof v === 'object' && seg in (v as object) ? [(v as Record<string, unknown>)[seg]] : [];
  });
  const meaningful = (v: unknown) => v !== undefined && v !== null && v !== false && v !== '' &&
    !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
  const segs = path.split('.').flatMap((s) => (s.endsWith('[]') ? [s.slice(0, -2), '[]'] : [s]));
  return segs.reduce<unknown[]>(step, [doc]).some(meaningful);
}

describe('every pulled-forward field is exercised (docs/schema-v1.md)', () => {
  const PULLED_FORWARD = [
    'cells[].assertions[].independence', 'cells[].assertions[].procedureId', 'procedures[].id',
    'cells[].assertions[].roundId', 'rounds[].feedback', 'rounds[].attribution',
    'criteriaVersion', 'criteria[].definedInVersion', 'cells[].assertions[].criteriaVersion',
    'criteria[].defaultMeasurement.preference', 'criteria[].defaultMeasurement.range',
    'criteria[].acceptability',
    'cells[].assertions[].missing.code', 'missingCodes[].broader',
    'cells[].assertions[].disclosure',
    'cells[].assertions[].evidence[].stance', 'cells[].assertions[].evidence[].sourceType',
    'cells[].assertions[].evidence[].derivedFrom', 'cells[].assertions[].evidence[].check',
    'criteria[].definition', 'criteria[].provenance', 'rejectedCriteria[].reasonCode',
    'groups[].axis', 'inapplicable[].alternativeGroupId', 'groups[].tombstoned',
    'suggestions[].proposed', 'threads[].anchor',
  ];

  it.each(PULLED_FORWARD)('relocation.json carries %s', (path) => {
    expect(exercised(relocation(), path)).toBe(true);
  });

  it('the helper is not vacuous: falsy and empty values do not count', () => {
    expect(exercised({ g: [{ t: false }, { t: null }, { t: {} }, { t: [] }] }, 'g[].t')).toBe(false);
    expect(exercised({ g: [{ t: false }, { t: true }] }, 'g[].t')).toBe(true);
  });

  it('every field the freeze note lists is in the pinned list', () => {
    const note = readFileSync(join(root, 'docs', 'schema-v1.md'), 'utf8');
    for (const field of ['roundId', 'criteriaVersion', 'definedInVersion', 'provenance', 'derivedFrom', 'suggestions']) {
      expect(note, field).toContain(field);
      expect(PULLED_FORWARD.some((p) => p.includes(field)), field).toBe(true);
    }
  });

  it('the two exercised elsewhere name the tests that carry them', () => {
    const note = readFileSync(join(root, 'docs', 'schema-v1.md'), 'utf8');
    for (const [field, test] of [['perturbation', 'independence.test.ts'], ['weights.substitution', 'substitution-weight.test.ts']] as const) {
      expect(note).toContain(field);
      expect(note).toContain(test);
      expect(existsSync(join(root, 'tests', test)), test).toBe(true);
      expect(readFileSync(join(root, 'tests', test), 'utf8'), test).toContain(field.split('.').pop()!);
    }
  });
});

describe('the freeze is an event', () => {
  it('is at version 1, with a complete migration chain and no step from a version 0', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(DOCUMENT_MIGRATIONS).toEqual([]);
    expect(missingMigrationSteps()).toEqual([]);
  });

  it('the artifact names its immutable location, the release tag', () => {
    expect(schema.$id).toBe(
      `https://raw.githubusercontent.com/thorwhalen/comparanda/schema-v${SCHEMA_VERSION}/schema/comparanda.v${SCHEMA_VERSION}.json`,
    );
  });

  it('the freeze note carries its date and points at its decisions', () => {
    const note = readFileSync(join(root, 'docs', 'schema-v1.md'), 'utf8');
    expect(note).toMatch(/frozen 2026-10-12/);
    expect(note).toContain('#167');
  });
});
