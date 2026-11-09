/**
 * The reject vocabulary (request 19, #315): the shipped codes plus the companion's four, `merged-into` spelled `merged`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { REJECT_REASON_CODES } from '../src/core/schema/structure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`));
const withCode = (reasonCode: string) => {
  const doc = readJson('examples/relocation.json');
  doc.rejectedCriteria[1].reasonCode = reasonCode;
  return doc;
};

describe('rejectedCriteria[].reasonCode', () => {
  it('carries the shipped codes and the four of rubricator ADR-0016, in zod, the artifact and the validator', () => {
    for (const code of ['means-objective', 'not-controllable', 'no-discrimination-expected', 'user-rejected', 'merged', 'not-discriminating']) {
      expect(REJECT_REASON_CODES, code).toContain(code);
      expect(Analysis.safeParse(withCode(code)).success, code).toBe(true);
      expect(ajv(withCode(code)), code).toBe(true);
      expect(validateAnalysis(withCode(code)).ok, code).toBe(true);
    }
  });

  it('spells a merge once: the companion\'s merged-into is refused here', () => {
    expect(REJECT_REASON_CODES).not.toContain('merged-into');
    expect(Analysis.safeParse(withCode('merged-into')).success).toBe(false);
    expect(ajv(withCode('merged-into'))).toBe(false);
  });

  it('is exercised by the messy fixture beyond the shipped codes', () => {
    const codes = Analysis.parse(readJson('examples/relocation.json')).rejectedCriteria.map((r) => r.reasonCode);
    expect(codes).toContain('means-objective');
  });
});
