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
