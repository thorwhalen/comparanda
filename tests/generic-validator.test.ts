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
 * `strict: true` makes Ajv refuse an unknown keyword or an ill-typed keyword
 * value in the schema itself. The current artifact uses no `$ref` or `format`,
 * so today that is most of what strict mode checks; it is on so that the day the
 * emitter starts producing either, a malformed one fails here first.
 *
 * Note what this does **not** prove: the emitted shape is open (no
 * `additionalProperties: false`), so a misspelled optional field passes both
 * Ajv and zod, which strips unknown keys.
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
    // Each case must fail for the reason it was built to fail for, not merely fail.
    const failsWith = (d: unknown, keyword: string, instancePath: string) => {
      expect(validate(d)).toBe(false);
      expect(validate.errors?.map((e) => [e.keyword, e.instancePath])).toContainEqual([keyword, instancePath]);
    };

    const missingRequired = structuredClone(base);
    delete missingRequired.subject;
    failsWith(missingRequired, 'required', '');

    const wrongType = structuredClone(base);
    wrongType.criteria = 'not an array';
    failsWith(wrongType, 'type', '/criteria');

    const badEnum = structuredClone(base);
    badEnum.criteria[0].defaultMeasurement = {
      ...badEnum.criteria[0].defaultMeasurement,
      level: 'not-a-level-of-measurement',
    };
    failsWith(badEnum, 'enum', '/criteria/0/defaultMeasurement/level');
  });
});
