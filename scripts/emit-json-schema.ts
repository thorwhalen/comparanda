/**
 * Emit the two artifacts that are this package's cross-repo contract.
 *
 * `package.json` has declared `emit-schema` and listed a `schema` directory in
 * `files` since the repository was created, and this script did not exist -- so
 * `pnpm prepublishOnly` had never once succeeded and no schema artifact had ever
 * been produced. The companion repository validates against the published
 * schema; until this ran, it had nothing to validate against and was pinned to a
 * hand-written sketch.
 *
 * Two files, because they answer different questions:
 *
 * 1. **`comparanda.v1.json`** -- the JSON Schema for an analysis document. What
 *    a producer must emit and a consumer may assume.
 *
 * 2. **`vocabularies.v1.json`** -- the closed core of every open vocabulary,
 *    with the facts each core member carries. JSON Schema can say a missingness
 *    code is a string; it cannot say that `withheld` is terminal and not
 *    informative, and that fact is what a consumer in another language needs in
 *    order to compute `silenceRate` the same way we do. Emitting it from the
 *    same constants the code reads is what keeps the two implementations from
 *    drifting apart while both look correct.
 *
 * What the second file does **not** catch is semantic drift: both repositories
 * can agree that `lower-median` exists and disagree about tie-breaking. Only
 * golden fixtures run through both implementations catch that, and they are a
 * later step. The parity artifact is weaker protection than a green check
 * suggests, and saying so here is cheaper than discovering it.
 */
import * as z from 'zod/mini';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, SCHEMA_VERSION } from '../src/core/schema/analysis.js';
import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';
import { CORE_REDUCTIONS } from '../src/core/schema/values.js';
import { SCALE_CORE } from '../src/core/schema/measurement.js';
import { CitationVerdict, SourceType, Stance } from '../src/core/schema/evidence.js';
import { AuthorKind, Attestation, Independence } from '../src/core/schema/provenance.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schema');

/** Members of a zod enum, as a plain array. */
function membersOf(e: { options: readonly string[] }): string[] {
  return [...e.options];
}

/**
 * The core vocabularies, with their facts.
 *
 * Built from the same frozen tables the runtime reads -- never re-typed here --
 * so that this file cannot say one thing while `missingness.ts` does another.
 */
function vocabularies() {
  return {
    $comment:
      'The closed core of every open vocabulary in comparanda, with the facts each member ' +
      'carries. A consumer in another language needs these to compute the same rates and make ' +
      'the same refusals. Extensions are declared inside each analysis document and are not ' +
      'listed here; every extension names one of these as its `broader` parent.',
    schemaVersion: SCHEMA_VERSION,
    missingCodes: {
      $comment:
        'structural: the cell should be empty, so it leaves every denominator. terminal: someone ' +
        'looked and this is the answer. informative: the absence is a statement about the ' +
        'subject rather than about our process -- silenceRate counts only these.',
      core: CORE_MISSING_CODES,
    },
    reductions: {
      $comment:
        'arithmetic: the reduction can produce a value nobody asserted, which is illegal on ' +
        'nominal and ordinal levels. A declared extension inherits this from its parent.',
      core: CORE_REDUCTIONS,
    },
    scales: {
      $comment:
        'One member. Everything a Stevens-family scale varies by is already a field of ' +
        'Measurement, and every scale-dependent function is a pure function of those fields, so ' +
        'a reader that has never heard of a named scale still validates, dominates and renders it.',
      core: membersOf(SCALE_CORE),
    },
    citationVerdicts: {
      $comment:
        'exact/normalised/fuzzy are ladder rungs -- how hard we had to look. moved/stale are ' +
        'about the document underneath. The retired spellings are `verified`, which read as ' +
        'approval, and `drifted`, which conflated moved with stale.',
      core: membersOf(CitationVerdict),
    },
    sourceTypes: { core: membersOf(SourceType) },
    stances: { core: membersOf(Stance) },
    authorKinds: { core: membersOf(AuthorKind) },
    attestations: { core: membersOf(Attestation) },
    independence: {
      $comment:
        'A ladder, weakest first. An agreement statistic is labelled by the weakest rung present, ' +
        'and personas sharing a principal collapse before the label is chosen.',
      core: membersOf(Independence),
    },
  };
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const document = z.toJSONSchema(Analysis, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://github.com/thorwhalen/comparanda/schema/comparanda.v${SCHEMA_VERSION}.json`,
    title: `comparanda analysis, schema version ${SCHEMA_VERSION}`,
    description:
      'A structured comparison: alternatives x criteria, with qualified missingness, confidence, ' +
      'evidence references to spans, and no default aggregation. Shape only -- the rules a shape ' +
      'cannot express (a value with no justification, a blank whose code the document never ' +
      'defines, an undated verdict) are the honesty family of validateAnalysis, and a document ' +
      'that satisfies this schema can still fail them.',
    ...document,
  };

  const files: [string, unknown][] = [
    [`comparanda.v${SCHEMA_VERSION}.json`, schema],
    [`vocabularies.v${SCHEMA_VERSION}.json`, vocabularies()],
  ];

  for (const [name, content] of files) {
    const path = join(outDir, name);
    // Trailing newline, stable key order from the source objects, two-space
    // indent: the artifact is committed, so a diff should show what changed
    // rather than a reformat.
    writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
    console.log(`wrote schema/${name}`);
  }
}

main();
