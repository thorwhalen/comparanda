---
name: comparanda-dev-schema-change
description: Use when changing comparanda's schema — adding a measure, a missingness code, an affordance, an evidence-reference field, or anything the published JSON Schema emits. Covers the migration harness requirement, versioning and breaking-change rules, the cross-repo coordination protocol with the rubricator companion repo, what belongs in the schema (policy) versus an adapter (mechanism), and the checklist a schema PR must satisfy. Trigger on any edit to the schema package, to JSON Schema emission, to migrations, or on "can we add a field for X".
metadata:
  audience: developers
---

# Changing the comparanda schema

The schema is the package's **principal export** and the **contract with a second repository**
(ADR-0004, ADR-0002). It is not an internal type declaration. Changing it is a release event.

## The three rules that are not negotiable

1. **Write the migration before you need it.** ADR-0006: the migration harness ships with
   version 1, not when a migration is first required. Every schema version bump registers a
   migration, even a no-op one, so the path from any stored analysis to the current version is
   always a composed chain of registered steps.
2. **Policy in the schema, mechanism in adapters.** "This cell is read-only", "this criterion
   accepts 1–5 ordinal", "this group pair is inapplicable" are schema declarations. *How* a cell
   renders or persists is not. The stated risk in ADR-0004 is the schema becoming a god-object;
   this line is the mitigation.
3. **Nothing derived gets stored.** Measures are stored (`score`, `confidence`); encodings are
   computed (`value`, `categorical`, `uncertainty-suppressed`, `disagreement`). If you are adding
   a field for something the view can compute, you are adding an encoding, and it costs a
   registration, not a schema change (ADR-0003, ADR-0010).

## Before adding a field, run these tests

- **Is it derived?** → it is an encoding or an analysis, not a measure.
- **Is it view state?** Order, grouping, selection, active encoding are per-user and belong in
  view state, not in the analysis document (ADR-0008). Groups are data; selection is not.
- **Is it a bare null?** → no absence without a reason code (ADR-0009). Every new optional value
  needs its missingness story stated.
- **Does it presume a level of measurement?** Every value is typed per `(criterion, measure)` by
  level of measurement. A new numeric field must declare nominal / ordinal / interval / ratio,
  because that is what lets the tooling refuse an illegal operation — most importantly, refuse to
  average a 1–5 rating (ADR-0003, ADR-0015).
- **Does it survive multi-rater?** A cell may hold several assertions for the same measure from
  different authors. ADR-0011 is explicit that retrofitting multi-rater onto a single-value cell
  is a migration through every stored analysis. Any new per-cell field must be *per assertion*
  unless there is a stated reason it is not.

## Cross-repo coordination — the part that is easy to forget

`rubricator` is the agent that produces analyses in this schema. The dependency runs one way in
code (`rubricator` depends on `comparanda`; never the reverse) but **requirements flow both
ways**: rubricator's needs — evidence-reference selectors, source-type marking, per-assertion
provenance that distinguishes five draws of one model from five human raters — are schema
requirements, and absorbing them *before* v1 freezes is far cheaper than migrating every stored
analysis afterwards.

Protocol for a breaking change:

1. Open an issue here labelled `cross-repo`, describing the change and the migration.
2. Open the mirror issue in `rubricator` and cross-link them.
3. Land the change here with the version bump and the migration.
4. Publish the JSON Schema artifact.
5. `rubricator` bumps the schema versions it declares it can emit.

An analysis must remain equally valid whether a human, an agent, or a script produced it —
`comparanda` must not be able to tell the difference except through the authorship metadata every
value carries (ADR-0002, ADR-0012).

## Schema PR checklist

- [ ] Version bumped, migration registered (even if a no-op), migration tested round-trip.
- [ ] JSON Schema emission regenerated; emission is a **build-time, Node-only** concern and must
      not pull the emitting machinery into the shipped runtime bundle.
- [ ] TypeScript types are *derived* from the schema, not hand-maintained in parallel.
- [ ] Both example datasets still validate — and the **messy** one exercises the new field. The
      clean example will not find the bug (ADR-0016, `examples/README.md`).
- [ ] `core` still has no DOM reference and still tests in plain Node (ADR-0005).
- [ ] If the change affects what `rubricator` emits or consumes: `cross-repo` issue opened and
      linked in the PR body.
- [ ] No content from the private originating analysis anywhere in the diff, fixtures included
      (ADR-0016).

## Where things are

    docs/domain-model.md                      the vocabulary and the three corrections
    docs/adr/0003-domain-model-and-terminology.md   measures vs encodings, levels of measurement
    docs/adr/0004-schema-first-with-zodal.md  the schema as public contract
    docs/adr/0006-persistence-stores-and-view-state.md   migrations, stores, view state
    docs/adr/0009-missingness.md              no bare nulls
    docs/adr/0011-collaboration.md            multi-rater from day one
    docs/adr/0014-evidence-and-provenance.md  evidence vs provenance
    docs/research/findings-terminology.md     the research behind the model
    examples/README.md                        what the messy fixture must exercise
