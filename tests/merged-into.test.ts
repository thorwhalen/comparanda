/**
 * A merged reject names its target (#335): `rejectedCriteria[].mergedIntoId` is
 * required for `merged`, and when given on any reject it names a criterion in
 * the analysis. A tombstoned target counts: the merge happened, and the reader
 * can still find where the rejected criterion went.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const relocation = () => JSON.parse(readFileSync(join(root, 'examples/relocation.json'), 'utf8'));
const RULE = 'merged-into-resolves';
const ruled = (doc: unknown) => validateAnalysis(doc).problems.filter((p) => p.ruleId === RULE);

describe('merged-into-resolves', () => {
  it('passes the messy fixture, whose merge names its target', () => {
    expect(ruled(relocation())).toEqual([]);
  });

  it('refuses a merged reject that names no target, at the field, with a fix', () => {
    const doc = relocation();
    delete doc.rejectedCriteria[0].mergedIntoId;
    const r = validateAnalysis(doc);
    expect(r.ok).toBe(false);
    const [p, ...rest] = ruled(doc);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ path: 'rejectedCriteria[0].mergedIntoId', severity: 'error', family: 'schema', adr: 'ADR-0003' });
    expect(p!.message).toContain('"Cost of living" is merged but does not say into which criterion');
    expect(p!.fix).toMatch(/set mergedIntoId .*tombstoned.*or use another reasonCode\.$/);
  });

  it('refuses a target that is not a criterion in the analysis, whatever the code', () => {
    for (const reasonCode of ['merged', 'redundant', undefined]) {
      const doc = relocation();
      doc.rejectedCriteria[0].reasonCode = reasonCode;
      doc.rejectedCriteria[0].mergedIntoId = 'housing';
      const [p, ...rest] = ruled(doc);
      expect(rest, reasonCode).toEqual([]);
      expect(p!.path).toBe('rejectedCriteria[0].mergedIntoId');
      expect(p!.message).toContain('"Cost of living" names "housing", which is not a criterion here');
      // Only a merge must keep a target; anything else may drop it.
      expect(p!.fix.includes('or remove mergedIntoId'), String(reasonCode)).toBe(reasonCode !== 'merged');
      expect(validateAnalysis(doc).ok, reasonCode).toBe(false);
    }
  });

  it('allows a resolvable target on a reject of any other code, on purpose (ADR-0003, 2026-11-09)', () => {
    const doc = relocation();
    doc.rejectedCriteria[1].mergedIntoId = 'rent';
    expect(doc.rejectedCriteria[1].reasonCode).toBe('not-discriminating');
    expect(ruled(doc)).toEqual([]);
  });

  it('is described in the emitted artifact, which cannot enforce it', () => {
    const artifact = readFileSync(join(root, `schema/comparanda.v${SCHEMA_VERSION}.json`), 'utf8');
    const description = JSON.parse(artifact).properties.rejectedCriteria.items.properties.mergedIntoId.description;
    expect(description).toContain('Required when reasonCode is merged');
    expect(description).toContain('tombstoned');
    expect(description).toContain('merged-into-resolves');
  });

  it('accepts a tombstoned target', () => {
    const doc = relocation();
    doc.criteria.find((c: { id: string }) => c.id === 'rent').tombstoned = true;
    expect(ruled(doc)).toEqual([]);
  });

  it('leaves a non-merge reject without a target alone', () => {
    const doc = relocation();
    doc.rejectedCriteria[0].reasonCode = 'redundant';
    delete doc.rejectedCriteria[0].mergedIntoId;
    expect(ruled(doc)).toEqual([]);
  });
});
