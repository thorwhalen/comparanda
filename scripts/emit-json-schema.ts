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
import { AuthorKind, AttestationMethod, Independence } from '../src/core/schema/provenance.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schema');

/** Members of a zod enum, as a plain array. */
function membersOf(e: { options: readonly string[] }): string[] {
  return [...e.options];
}

/**
 * The vocabulary manifest, in the shape ADR-0004 specifies.
 *
 * `vocabularies` carries the three **extensible** vocabularies: the closed core
 * underneath an open string, whether it is extensible, and where a declaration
 * for it lives in the document. That last field is what stops a consumer having
 * to know our field names by reading our source.
 *
 * Two deliberate extensions to the ADR's sketch, both additive:
 *
 * 1. **`facts`** beside `core`. The ADR shows `core` as a member set, and a set
 *    is not enough: a consumer computing `silenceRate` needs to know that
 *    `withheld` is terminal and **not** informative, and one keying on
 *    `terminal` alone gets a different, weaker number. The facts are what JSON
 *    Schema cannot say and are the reason this file exists at all.
 * 2. **`closedEnums`**. Vocabularies that are *not* extensible -- citation
 *    verdicts, source types, stances, author kinds, attestation methods, the
 *    independence ladder -- are listed separately rather than folded in beside
 *    the open three, because calling a closed enum "extensible: false" in the
 *    same map invites a consumer to try extending it.
 *
 * Everything is built from the frozen tables the runtime reads. Nothing here is
 * re-typed, so this file cannot say one thing while the schema says another.
 */
function manifest() {
  return {
    schemaVersion: SCHEMA_VERSION,
    $comment:
      'The closed core of every vocabulary in comparanda. Extensions are declared inside each ' +
      'analysis document and are not listed here; every extension names one of these as its ' +
      '`broader` parent, which is what lets a reader that has never heard of it classify it.',
    vocabularies: {
      missingCode: {
        $comment:
          'structural: the cell should be empty, so it leaves every denominator. terminal: ' +
          'someone looked and this is the answer. informative: the absence is a statement about ' +
          'the subject rather than about our process -- silenceRate counts only these, and ' +
          'not-evidenced and withheld differ on exactly this while sharing terminal.',
        core: Object.keys(CORE_MISSING_CODES),
        facts: CORE_MISSING_CODES,
        extensible: true,
        declaredAt: '$.missingCodes',
      },
      reduction: {
        $comment:
          'arithmetic: the reduction can produce a value nobody asserted, which is illegal on ' +
          'nominal and ordinal levels. A build that cannot run a declared reduction refuses ' +
          'rather than running its parent, because substituting changes a number a reader acts on.',
        core: Object.keys(CORE_REDUCTIONS),
        facts: CORE_REDUCTIONS,
        extensible: true,
        declaredAt: '$.reductions',
      },
      scale: {
        $comment:
          'One member. Everything a Stevens-family scale varies by is already a field of ' +
          'Measurement, and every scale-dependent function is a pure function of those fields, ' +
          'so a reader that has never heard of a named scale still validates, dominates and ' +
          'renders it.',
        core: membersOf(SCALE_CORE),
        extensible: true,
        declaredAt: '$.scales',
      },
    },
    closedEnums: {
      $comment:
        'Not extensible. A document naming a member outside these is wrong rather than newer, ' +
        'and there is no `broader` to degrade through.',
      citationVerdict: {
        $comment:
          'exact/normalised/fuzzy are ladder rungs -- how hard we had to look. moved/stale are ' +
          'about the document underneath. The retired spellings are `verified`, which read as ' +
          'approval, and `drifted`, which conflated moved with stale.',
        core: membersOf(CitationVerdict),
      },
      sourceType: { core: membersOf(SourceType) },
      stance: { core: membersOf(Stance) },
      authorKind: { core: membersOf(AuthorKind) },
      attestationMethod: { core: membersOf(AttestationMethod) },
      independence: {
        $comment:
          'A ladder, weakest first. An agreement statistic is labelled by the weakest rung ' +
          'present, and personas sharing a principal collapse before the label is chosen.',
        core: membersOf(Independence),
      },
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
    [`vocabularies.v${SCHEMA_VERSION}.json`, manifest()],
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
