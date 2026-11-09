/**
 * The reject vocabulary (request 19, #315): the shipped codes plus the companion's four, `merged-into` spelled `merged`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { Analysis, SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';
import { REJECT_REASON_CODES, REJECT_REASON_GLOSSES } from '../src/core/schema/structure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true }).compile(readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`));
const withCode = (reasonCode: string) => {
  const doc = readJson('examples/relocation.json');
  doc.rejectedCriteria[1].reasonCode = reasonCode;
  return doc;
};

/** The companion's five (rubricator ADR-0016) and where each lands here. */
const COMPANION_TO_HERE: Record<string, string> = {
  'merged-into': 'merged', 'means-objective': 'means-objective', 'not-controllable': 'not-controllable',
  'no-discrimination-expected': 'no-discrimination-expected', 'user-rejected': 'user-rejected',
};

describe('rejectedCriteria[].reasonCode', () => {
  it('accepts every code, in zod, the artifact and the validator, and glosses each in the artifact', () => {
    for (const code of REJECT_REASON_CODES) {
      expect(Analysis.safeParse(withCode(code)).success, code).toBe(true);
      expect(ajv(withCode(code)), code).toBe(true);
      expect(validateAnalysis(withCode(code)).ok, code).toBe(true);
    }
    const description = JSON.stringify(readJson(`schema/comparanda.v${SCHEMA_VERSION}.json`)).match(/Why it was rejected\.[^"]*/)?.[0] ?? '';
    for (const code of REJECT_REASON_CODES) expect(description, code).toContain(`${code}: ${REJECT_REASON_GLOSSES[code]}`);
  });

  it('takes in all five of the companion\'s codes, with merged-into spelled merged', () => {
    for (const [theirs, ours] of Object.entries(COMPANION_TO_HERE)) {
      expect(REJECT_REASON_CODES, theirs).toContain(ours);
    }
    expect(REJECT_REASON_CODES).not.toContain('merged-into');
    expect(Analysis.safeParse(withCode('merged-into')).success).toBe(false);
    expect(ajv(withCode('merged-into'))).toBe(false);
  });

  it('is exercised by the messy fixture beyond the shipped codes', () => {
    const codes = Analysis.parse(readJson('examples/relocation.json')).rejectedCriteria.map((r) => r.reasonCode);
    expect(codes).toContain('means-objective');
  });
});
