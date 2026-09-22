/**
 * The emitted JSON Schema, consumed by a validator that is not ours.
 *
 * `emitted-artifact.test.ts` proves the committed artifact is what the code
 * emits today. That is self-consistency: it cannot tell whether the artifact is
 * a JSON Schema anyone else can actually use. The companion repository reads it
 * from Python, with a generic validator, and never sees `validateAnalysis`.
 *
 * So this file loads `schema/comparanda.v<N>.json` into Ajv -- a stock JSON
 * Schema 2020-12 validator with no knowledge of zod or of this package -- and
 * checks every shipped example against it. If an example passes our own
 * validation and fails here, the artifact and the code disagree, and it is the
 * artifact the other repository trusts (#55, #69).
 *
 * `strict: true` is deliberate: Ajv then also refuses a schema that uses an
 * unknown keyword or an ambiguous construct, which is exactly the class of
 * emitter output a stricter consumer elsewhere would choke on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { SCHEMA_VERSION, validateAnalysis } from '../src/core/schema/analysis.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const schema = readJson(join(root, 'schema', `comparanda.v${SCHEMA_VERSION}.json`));
const examplesDir = join(root, 'examples');
const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith('.json')).sort();

function compile() {
  // `allErrors` so a failure lists every violation, not the first one.
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return ajv.compile(schema);
}

const describeErrors = (errors: unknown) => JSON.stringify(errors, null, 2);

describe('the emitted JSON Schema, read by a generic validator', () => {
  it('compiles under a strict, independent JSON Schema 2020-12 implementation', () => {
    expect(() => compile()).not.toThrow();
  });

  it('finds the examples to check (so the loop below is not vacuous)', () => {
    // The examples README names three golden fixtures; a rename that emptied
    // this list would otherwise turn every assertion below into a no-op.
    expect(exampleFiles).toEqual(
      expect.arrayContaining(['languages.json', 'relocation.json', 'video-generation.json']),
    );
  });

  for (const file of exampleFiles) {
    it(`validates examples/${file}`, () => {
      const validate = compile();
      const doc = readJson(join(examplesDir, file));
      const ok = validate(doc);
      expect(ok, `examples/${file} fails the emitted schema:\n${describeErrors(validate.errors)}`).toBe(true);
      // And our own validator agrees, so the two cannot quietly diverge on a
      // fixture that one of them accepts.
      expect(validateAnalysis(doc).ok).toBe(true);
    });
  }

  it('rejects a document the shape forbids, so a pass above means something', () => {
    // A schema that accepts everything would make every test above green. Take
    // a real fixture and break it in three ways the emitted shape must catch.
    const validate = compile();
    const base = readJson(join(examplesDir, 'languages.json'));

    // `subject` is required; `alternatives` is not, because it defaults to [].
    const missingRequired = structuredClone(base);
    delete missingRequired.subject;
    expect(validate(missingRequired)).toBe(false);

    const wrongType = structuredClone(base);
    wrongType.criteria = 'not an array';
    expect(validate(wrongType)).toBe(false);

    const badEnum = structuredClone(base);
    badEnum.criteria[0].defaultMeasurement = {
      ...badEnum.criteria[0].defaultMeasurement,
      level: 'not-a-level-of-measurement',
    };
    expect(validate(badEnum)).toBe(false);
  });
});
