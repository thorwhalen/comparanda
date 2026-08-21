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
