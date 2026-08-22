/**
 * The committed schema artifacts must be what the code would emit today.
 *
 * `package.json` has declared `emit-schema` and shipped a `schema` directory in
 * `files` since this repository was created, and the script did not exist -- so
 * `prepublishOnly` had never succeeded and no artifact had ever been produced.
 * The companion repository validates against the published schema and was
 * therefore pinned to a hand-written sketch.
 *
 * The load-bearing test here is the staleness one. An emitter that exists but is
 * only run by hand at release time is an artifact that silently describes an old
 * schema for however long it takes anyone to notice; the cross-repo contract
 * then says one thing while the code does another, which is the failure this
 * whole boundary exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION } from '../src/core/schema/analysis.js';
import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';
import { CORE_REDUCTIONS } from '../src/core/schema/values.js';
import { CitationVerdict } from '../src/core/schema/evidence.js';
import { Independence } from '../src/core/schema/provenance.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schema');
const documentPath = join(schemaDir, `comparanda.v${SCHEMA_VERSION}.json`);
const vocabPath = join(schemaDir, `vocabularies.v${SCHEMA_VERSION}.json`);

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('the artifacts exist', () => {
  it('has both files, at the current schema version', () => {
    expect(existsSync(documentPath), `${documentPath} is missing; run pnpm emit-schema`).toBe(true);
    expect(existsSync(vocabPath), `${vocabPath} is missing; run pnpm emit-schema`).toBe(true);
  });

  it('describes an analysis document', () => {
    const s = readJson(documentPath);
    expect(s.$schema).toContain('json-schema.org');
    expect(s.type).toBe('object');
    for (const required of ['alternatives', 'criteria', 'cells', 'authors', 'subject']) {
      expect(Object.keys(s.properties)).toContain(required);
    }
  });

  it('says plainly that satisfying the shape is not the whole contract', () => {
    // A document can validate against this schema and still be rejected by the
    // honesty family. Anyone integrating against the artifact alone needs to
    // know that before they discover it.
    expect(readJson(documentPath).description).toMatch(/honesty/);
  });
});

describe('the artifacts are not stale', () => {
  it('re-emitting produces byte-identical files', () => {
    const before = [readFileSync(documentPath, 'utf8'), readFileSync(vocabPath, 'utf8')];
    execFileSync('npx', ['tsx', 'scripts/emit-json-schema.ts'], { cwd: root, stdio: 'pipe' });
    const after = [readFileSync(documentPath, 'utf8'), readFileSync(vocabPath, 'utf8')];
    expect(after[0], 'schema/comparanda.v1.json is stale; run pnpm emit-schema').toBe(before[0]);
    expect(after[1], 'schema/vocabularies.v1.json is stale; run pnpm emit-schema').toBe(before[1]);
  }, 60_000);
});

describe('the vocabulary artifact carries the facts a shape cannot', () => {
  const vocab = () => readJson(vocabPath);

  it('exports the missingness core with all three flags, verbatim', () => {
    // Emitted from the same frozen table the runtime reads. If this ever has to
    // be re-typed, the two can disagree while both look right -- which is the
    // whole reason the artifact is generated rather than written.
    expect(vocab().missingCodes.core).toEqual(CORE_MISSING_CODES);
  });

  it('carries what silenceRate keys on, which JSON Schema cannot say', () => {
    const core = vocab().missingCodes.core;
    expect(core['not-evidenced'].informative).toBe(true);
    expect(core.withheld.informative).toBe(false);
    // Those two are both terminal, and a consumer computing silenceRate from
    // `terminal` alone gets a different, weaker number.
    expect(core['not-evidenced'].terminal).toBe(core.withheld.terminal);
  });

  it('exports the reduction core with the arithmetic flag', () => {
    expect(vocab().reductions.core).toEqual(CORE_REDUCTIONS);
    expect(vocab().reductions.core.mean.arithmetic).toBe(true);
    expect(vocab().reductions.core['lower-median'].arithmetic).toBe(false);
  });

  it('exports one spelling of the citation verdict, and not the retired ones', () => {
    const core: string[] = vocab().citationVerdicts.core;
    expect(core).toEqual([...CitationVerdict.options]);
    expect(core).not.toContain('verified');
    expect(core).not.toContain('drifted');
    expect(core).not.toContain('not-found');
  });

  it('exports the independence ladder in order, weakest first', () => {
    expect(vocab().independence.core).toEqual([...Independence.options]);
    expect(vocab().independence.core[0]).toBe('shared-context');
  });

  it('lists no extensions, because extensions live in documents', () => {
    // Anything a deployment declares travels inside its analysis. If this file
    // ever grows a registry of them, the design has quietly inverted.
    const v = vocab();
    for (const key of ['missingCodes', 'reductions']) {
      expect(Object.keys(v[key])).toEqual(['$comment', 'core']);
    }
  });
});
