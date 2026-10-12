# Schema v1 — frozen 2026-10-12

**Schema version 1 of the comparanda analysis document is frozen as of 2026-10-12.** From this date, any change to what `schema/comparanda.v1.json` accepts costs what `skills/comparanda-dev-schema-change/SKILL.md` says it costs: a `SCHEMA_VERSION` bump, a registered migration step (a no-op one for an additive change), a regenerated artifact, and a coordinated `cross-repo` change with `rubricator`. The freeze is issue #57; the decisions it needed are recorded, with their reversibility, in issue #167.

## Where the contract lives

- **Immutable:** the `schema-v1` git tag, and the GitHub release of the same name, which carries both artifacts. The emitted `$id` is the tag's raw URL, so the artifact names its own fixed location.
- **Working copy:** `schema/comparanda.v1.json` and `schema/vocabularies.v1.json` on `main`. A test re-emits both and requires byte-identical output, so the committed copy cannot fall behind the code.
- **Not yet:** an npm release. The tarball already ships `schema/`, but a first publish claims the package name, which is the owner's call (#119).

Any JSON Schema 2020-12 validator consumes the artifact; `tests/generic-validator.test.ts` proves it with Ajv in strict mode, against every example.

## What "frozen" means here

1. **The shape is closed.** Every object refuses keys the schema does not name, in zod (`strictObject`) and in the artifact (`additionalProperties: false`), and no field is left as an unconstrained "anything" — `Suggestion.proposed` is typed as the `Assertion` it proposes. The one deliberate exception is the `params` of a vocabulary declaration, which carries an extension's own parameters. An own `__proto__` key, which zod would accept and drop, is refused by `validateAnalysis` as the artifact refuses it. Before the freeze both validators accepted unknown keys and zod dropped them on parse, so an old document's renamed field validated and was lost on load-then-save (#165). Extension has its own home: the declared vocabularies (`missingCodes`, `reductions`, `scales`), each refining a core member through `broader`.
2. **The version is one integer, pinned.** `schemaVersion` is `const: 1` in the artifact and `literal(1)` in zod, so a generic validator refuses a `0`, a `0.5` or a `2` exactly as this package does; `validateAnalysis` says which version a refused document declared. There is no MINOR: under a closed schema an older reader cannot load a document with a field it does not know, so every change is a bump, and the migration chain carries readers forward. §3.3 of `docs/cross-repo-coordination.md` is amended to say so.
3. **Closing is the reversible direction.** Opening the shape later keeps every stored document valid; closing it later would not. That asymmetry is why the freeze closes it now.
4. **The harness is complete at v1.** `DOCUMENT_MIGRATIONS` is empty, because there is no version 0; a document without `schemaVersion` reads as 1. A test fails the build the moment `SCHEMA_VERSION` is bumped without a step, and a version-2 test fixture runs through the same chain code.

## Fields pulled forward, and why

The rule from the schema epic (#3): **if adding a field afterwards would be a migration through every stored analysis, it ships in v1.** These are the fields that are in v1 for that reason rather than because something uses them today. Each is exercised by the messy fixture, `examples/relocation.json`, and `tests/schema-v1-freeze.test.ts` fails if one stops being exercised.

| field | why it could not wait | ADR |
|---|---|---|
| `Cell.assertions[]` (a cell is a set of assertions) | multi-rater retrofitted onto single-value cells is a migration through every stored analysis | 0011 |
| `Assertion.independence`, `procedureId`, `Analysis.procedures` | five draws of one model stored as five raters cannot be told apart afterwards | 0022, 0023 |
| `Assertion.roundId`, `Analysis.rounds` | a round recorded after the fact cannot say what raters saw | 0023 |
| `Analysis.criteriaVersion`, `Criterion.definedInVersion`, `Assertion.criteriaVersion` | a score cannot be dated against a definition retroactively | 0003 (#62) |
| `Criterion.defaultMeasurement.preference` and `.range` | dominance and screening are undefined without them | 0018 |
| `Criterion.acceptability` | a veto floor added later changes which alternatives were screened out | 0015, 0018 |
| `Assertion.missing` as a code object, extensible through `broader` | a bare null cannot be qualified afterwards | 0009, 0030 |
| `Assertion.disclosure` | disclosure is orthogonal to presence; folding it into `missing` later is a migration | 0021 |
| `EvidenceRef.stance`, `sourceType`, `derivedFrom`, `check` | a citation's direction and pedigree cannot be reconstructed from a URL | 0014 |
| `Criterion.definition` (structured), `provenance`, `Analysis.rejectedCriteria` | the frame's history is lost the moment it is edited | 0003 (#61, #63) |
| `Group` on both axes, `Analysis.inapplicable`, tombstones | structural absence and deletion that keeps annotations | 0008, 0011 |
| `Analysis.suggestions`, `threads` | collaboration arrives in Phase 4; its storage had to be in Phase 1 | 0011 |

Two pulled-forward fields are exercised by tests rather than by the fixture, deliberately: `Assertion.perturbation` (a perturbed draw would change the fixture's pinned "3 draws of one model" reading; `tests/independence.test.ts`) and `Criterion.weights.substitution` (the fixture carries no aggregation, per ADR-0015; `tests/substitution-weight.test.ts`).

## Deferred from the freeze, with reasons

- **#122**, the working-note correction sweep: docs only, it does not touch the schema, and its own text says to wait for rubricator's ADR renumbering.
- **#143**, target criteria in `atLeastAsGood` and screening: analysis behaviour over existing fields; it changes no field.
- **#119**, the first npm publish: the owner's call; the tag and release are the immutable location until then.
