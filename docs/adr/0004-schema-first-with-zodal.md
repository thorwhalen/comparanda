# ADR-0004: Schema-first, on zodal, with the schema as the public contract

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Two independent consumers need to agree on what a comparison is: this package's view, and the
`rubricator` agent that produces analyses. If the schema is implicit in the UI's props, the agent
side has to reverse-engineer it and the two drift immediately.

## Decision
The schema is the primary artifact and the package's principal export. Build it with **zodal**,
declaring not just the data shape but the **affordances** — what is editable, by whom, what
missingness codes are legal, which encodings are available, what a view state may contain.

The schema is:
- **runtime-validating** — an analysis from an agent, a file, or an API is validated at the boundary;
- **serialisable to JSON** — the wire and disk format, versioned;
- **the source of typed bindings** — TypeScript types are derived from it, never hand-maintained
  in parallel;
- **published as a language-neutral artifact** (JSON Schema) so `rubricator`'s Python side can
  validate against exactly the same contract.

Affordances live in the schema rather than in components. "This cell is read-only", "this criterion
accepts 1–5 ordinal", "this group pair is inapplicable" are declarations the schema makes; the view
reads and honours them. A second, unrelated view over the same schema must be able to enforce the
same rules without reimplementing them.

## Consequences
- The agent side can be developed against a published contract without the UI existing.
- Schema changes are versioned, breaking-change events with a migration story (ADR-0006).
- There is a real risk of the schema becoming a god-object. Mitigate by keeping *policy* (what is
  allowed) in the schema and *mechanism* (how it is rendered or stored) in adapters.

## Alternatives considered
- *Zod alone.* Fine for validation, but the affordance layer is exactly what zodal adds, and the
  wider ecosystem is already zodal-based.
- *JSON Schema hand-written first.* Language-neutral but a poor authoring experience; generate it
  from zodal instead.

---

## Amendments

### 2026-08-21 — JSON Schema emission is a build-time, Node-only concern

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Phase 0 research confirmed this ADR by reading zodal's source rather than its README: the affordance
layer is real, and `defineCollection` was verified working on a `zod/mini` schema by execution. The
Decision and the Consequences stand. One clause needs a boundary drawn around it.

The Decision requires the schema be "published as a language-neutral artifact (JSON Schema) so
`rubricator`'s Python side can validate against exactly the same contract." That requirement is
unchanged. **What changes is where the emission runs: it is a build step, in Node, and its output is
a checked-in artifact.** No browser bundle may import the code path that produces it.

The reason is measured, not stylistic. `toJSONSchema` lives on classic Zod's `z` namespace barrel,
and importing `z` as a namespace object defeats dead-code elimination — a namespace object's
properties cannot be shaken. The barrel costs **310.9 kB raw / 61.8 kB gzip** against `zod/mini`'s
**15.2 kB raw / 5.5 kB gzip** for the same comparanda-shaped schema, and inspection of the output
confirms the whole classic surface survives: the locale table, `emoji`, `ipv6`, `base64url`, `jwt`,
`duration`. That is the single most expensive line of code available to this project, and the
standalone bundle (ADR-0013) is where it would land. ADR-0017 settles `zod/mini` as the runtime
authoring surface; this amendment records the corollary for the emission side.

Concretely: the runtime schema and the published JSON Schema are the same declaration, emitted at
different times by different code. Drift between them is a CI failure, not a review question — the
emission runs in the release pipeline and the artifact is diffed.

#### References for this amendment

Measurements and full reasoning: `docs/research/findings-visualisation.md` § 5.1 and
`docs/research/findings-terminology.md` § 6.3; the zodal source read is in
`docs/research/sections/c8-prior-art-and-stack.md`. All three are own measurements and source
reads, not citations.

### 2026-08-22 — The contract is two artifacts, and one of them has never been emitted

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The Decision stands, and so does the amendment above. What changes is the *count* of artifacts the
contract consists of, plus one fact about the current state that should have been recorded when it
became true.

**1. `scripts/emit-json-schema.ts` does not exist.** `package.json` declares
`"emit-schema": "tsx scripts/emit-json-schema.ts"` and `prepublishOnly` invokes it. The file is
absent, so `pnpm prepublishOnly` fails and **no JSON Schema artifact has ever been produced**. The
`files` array also lists a `schema` directory that does not exist. `rubricator`'s entire dependency
is defined against an artifact that has never existed, and it is pinned to its own provisional
sketch until this lands.

This is recorded in an ADR rather than only in an issue because the Decision above asserts the
artifact as a *property of the design*, and an assertion nobody can execute is exactly the failure
ADR-0016 forbids in a citation, arriving in the build instead of in a footnote.

**2. The contract is two files, not one.** `comparanda.v1.json` carries the *shape*.
`vocabularies.v1.json`, emitted beside it by the same script in the same pass, carries the **core
member set of every extensible vocabulary**, plus where a declaration for that vocabulary lives in
the document:

    { "schemaVersion": 1,
      "vocabularies": {
        "missingCode": { "core": [...], "extensible": true, "declaredAt": "$.missingCodes" },
        "reduction":   { "core": [...], "extensible": true, "declaredAt": "$.reductions" },
        "scale":       { "core": [...], "extensible": true, "declaredAt": "$.scales" } } }

**Why a second file rather than an `enum` in the first.** ADR-0030 opens three vocabularies at the
point of use: the JSON Schema for `Missing.code`, `Cell.reduction` and `Measurement.scale` is
`{"type": "string"}`, which is correct and which erases exactly the fact a consumer needs — *which
members this build interprets without degrading*. A JSON Schema cannot say "open, and here is the
closed core underneath it" without closing it. So the core sets travel in their own artifact, and
one script emits both so they can never be half-updated.

**3. The parity test runs in the dependent, not here.** `comparanda` must never need to know
`rubricator` exists (ADR-0002). So `comparanda`'s test asserts only that the emitted file equals its
own TypeScript constants; the *cross-language* comparison is `rubricator`'s test against the file it
vendors. That direction is what makes the manifest incapable of lying about either side, and it is
the whole reason the core sets are *read from an artifact* rather than imported as a constant.

**4. What this does not catch, stated so a green check is not over-read.** Key parity is not
semantic parity. Both repositories can register a `lower-median` and disagree about ties, and
nothing here notices. The only real defence is golden fixtures run through both implementations with
byte-compared output, which is deliberately not in v1 (`docs/cross-repo-coordination.md` § 4.4).
