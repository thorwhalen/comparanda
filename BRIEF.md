# Brief for the implementing agent — comparanda

Read this first, then `docs/domain-model.md`, then `docs/adr/` in order. Restate your
understanding of the scope before writing code.

## What you are building

An npm package, `comparanda`, in two separable parts:

1. a **headless core** — a zodal schema for a structured comparison, plus the logic over it
   (validation, view-state, analyses, migrations), with no DOM;
2. a **view** — a reorderable, groupable, annotatable matrix that consumes the schema.

Plus a build command that emits a **single self-contained HTML file** with an analysis baked in.

The schema is also the contract for a companion repo, `rubricator`, which is the agent that
*produces* analyses. You are building the thing it writes into. Publish the schema as JSON Schema
so `rubricator`'s Python side can validate against the identical contract.

## Non-negotiables

- **Public repository.** Nothing from **any** private engagement — no company names, product
  names, personal names or initials — in code, tests, fixtures, docs, examples, or commit messages.
  Example domains are **invented**, not anonymised: an anonymised matrix keeps the criteria and the
  disagreements of the original, and that shape is identifying to anyone who was in the room. Read
  ADR-0033 and build the examples it describes. This one is a hard constraint.
- **No default aggregation.** ADR-0015. A total column is opt-in, labelled, and warns on ordinal
  data.
- **Absence is qualified.** ADR-0009. No bare nulls.
- **Accessibility is not a later pass.** Keyboard reorder, no colour-alone encoding, computed
  contrast. ADR-0010 and the visualisation research brief.
- **Standalone must actually work offline.** ADR-0013. Add a CI check that the bundle issues zero
  network requests.

## Order of work

**Phase 0 — research.** Do `docs/research/terminology.md` and `docs/research/visualisation.md`
before schema code. They exist because this problem has fifty years of prior art and the names,
failure modes and algorithms already exist. Write the two findings files. Where research changes a
decision, amend the ADR — several are marked `proposed` precisely so you can settle them with
evidence.

**Phase 1 — schema.** The zodal schema, JSON Schema emission, validation, versioning and the
migration harness. Write the migration harness now, with version 1, not when it is first needed.
Ship the messy example dataset from ADR-0033 alongside, because the clean one will not exercise
the parts that matter.

**Phase 2 — core logic.** View state, saved views and dirty-state comparison (ADR-0007), store
adapters and the fallback chain (ADR-0006), completeness and dominance and veto screening
(ADR-0015). All testable in plain Node. Get this right before any pixels.

**Phase 3 — view.** The matrix, encodings, reorder, group, select, detail panel. Match or exceed
the reference behaviour described below.

**Phase 4 — collaboration.** Annotations and attribution first; then multi-rater and the
disagreement encoding; then suggestion mode. ADR-0011. The *schema* must accommodate all of it from
Phase 1 — retrofitting multi-rater onto single-value cells is a migration through every stored
analysis.

**Phase 5 — standalone build**, docs, publish.

## Reference behaviour

A working prototype established the target for the view layer. It had: a matrix of ~22 rows × 12
columns; three encodings (value, confidence, and a value-suppressing blend); sort by any column;
filter by row group; a per-cell tooltip carrying a one-line justification and a confidence flag; a
click-to-open detail panel naming each row's strongest and weakest axis; automatic flags for rows
scoring at or below a threshold on designated veto criteria; a legend that changes with the
encoding; and full light/dark support with text contrast computed from the rendered background.

Everything in this repo is that, generalised, plus: drag reordering, grouping of both axes,
selection, saved views, persistence, annotations, multi-rater values, evidence links, and pluggable
adapters.

Two lessons from building it, both worth inheriting:

- The **blended encoding is the one that changes minds**, because it makes high-score-thin-evidence
  cells recede. Get it right; it is the most valuable single feature.
- Text colour must be **computed from the actual rendered background**. A fixed lightness threshold
  produced unreadable cells in one theme and not the other, and blended encodings land on arbitrary
  intermediate colours where no threshold is correct.

## Working agreements

- Stack: TypeScript throughout. Choose the framework in an ADR before writing view code; justify
  it against the standalone-bundle constraint (bundle size matters when the file is mailed).
- Tests: the core is pure and should be tested thoroughly. The view needs interaction tests for
  reorder, keyboard operation and dirty-state.
- Every non-obvious decision becomes an ADR. Several are `proposed` — settle them and say why.
- Prefer boring, maintained dependencies. This is a small team's tool that must still build in
  three years.
- Ask before adding a runtime dependency heavier than the thing it replaces.

## First deliverable

Do not start with code. Produce:
1. the two research findings files;
2. a proposed schema sketch, in the domain-model vocabulary, with the messy example expressed in it;
3. a list of the ADRs you would change, with reasoning;
4. a phase plan with what you would cut if you had half the time.

Then stop and check in.
