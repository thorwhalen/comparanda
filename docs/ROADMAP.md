# Roadmap

**The GitHub issues are the live source of truth.** This file is the map: the epics in order, what
each one unblocks, where the gates are, and what gets cut first if time runs short. When the two
disagree, the issues win.

Read [`../BRIEF.md`](../BRIEF.md) for the phase plan this elaborates,
[`adr/PENDING-ACTIONS.md`](adr/PENDING-ACTIONS.md) for the decisions Phase 0 must settle, and
[`research/README.md`](research/README.md) for the ledger that says what is already known, and
[`cross-repo-coordination.md`](cross-repo-coordination.md) for the gates, the schema-request protocol
and the version handshake with `rubricator`. That file is canonical for anything involving both
repositories; where this map and it disagree, it wins.

---

## The spine

| # | Epic | Phase | Gate | Unblocks |
|---|---|---|---|---|
| 1 | Settle the ADRs | 0 | `none` | everything |
| 2 | Repository scaffolding and CI | 1 | `none` | all code |
| 3 | The schema | 1 | `none` (it *produces* `schema-v1`) | *is* the `schema-v1` gate |
| 4 | Example datasets | 1 | `none` | every later test; settles four open questions |
| 5 | Cross-repo schema contract | 1 | `tool-surface` | `rubricator`; must land **before** the freeze |
| 6 | Core logic | 2 | `schema-v1` | the view, collaboration |
| 7 | Analyses | 2 | `schema-v1` | the secondary views |
| 8 | The view | 3 | `schema-v1` | the standalone build |
| 9 | Accessibility | 3 | `schema-v1` | merge gate for all view work |
| 10 | Collaboration | 4 | `schema-v1` | — |
| 11 | Standalone build and publish | 5 | `schema-v1` | shipping |

### The gates

Three, shared with `rubricator` and specified in
[`cross-repo-coordination.md`](cross-repo-coordination.md) §1. They are a `gate` field on an epic or
an issue, **not a label** — the label set has no gate names in it — and the value is one of
`tool-surface`, `schema-v1`, `eval-suite` or `none`, spelled exactly. Nothing is gated on "partly" a
gate: if only some issues in an epic are blocked, the gate goes on those issues.

**`tool-surface`** — owned by `rubricator`. Passes when its MCP tool surface is frozen and it states
that its schema-request set is complete. **What it gates here is epic 5 only**: this repository
cannot close intake on a set that is still growing. It gates nothing else in this repository.

**`schema-v1`** — owned here, and it has two halves that block different things.

- **2a, intake closed** — all seven `rubricator` requests carry a recorded disposition, and the
  contract-shaping Tier 1 ADRs are settled. This is what gates epic 3, and it costs a reading rather
  than a feature.
- **2b, published** — the schema is written, the migration harness accepts version 1, the JSON Schema
  artifact is published at an immutable versioned path, and both fixtures validate. The *schema code*
  is what gates epics 6–11; the *publication* blocks nothing inside this repository, only
  `rubricator`.

The freeze is the expensive moment in this project. Every field that cannot be added later without
a migration through every stored analysis — rounds, per-assertion provenance and `independence`,
criterion `preference` and `range`, disclosure, criteria versioning, evidence `stance` — is
deliberately pulled forward into Phase 1 for that reason, and for no other.

**`eval-suite`** — owned jointly. Passes when every fixture in either repository that *is* a
comparanda document validates in that repository's CI against a pinned schema version, `rubricator`
emits a real analysis that validates strict, and this repository loads and renders every shared
fixture without a runtime error. It gates the `1.0.0` release and the end-to-end demo being called
done. It gates no development work.

---

## 1. Settle the ADRs (Phase 0)

`adr/PENDING-ACTIONS.md` holds thirteen new ADRs (0017–0029), nine amendments (ADRs 0003, 0006, 0007,
0008, 0009, 0010, 0011, 0013, 0015) and five confirm-with-note records (ADRs 0002, 0004, 0005, 0014,
0016). ADR-0012 was not examined and carries no recommendation. Nothing in it has been
applied; ADRs are immutable once accepted, so research recommends and a human settles. The issues
follow that file's own tiering: Tier 1 blocks the schema, Tier 2 blocks core logic, Tier 3 blocks
the view and the build.

Do the number allocation first, in one pass — two research rounds proposed overlapping blocks and
nothing in the content depends on which numbers win.

One of these items has a consequence in the companion repository and is the largest un-tracked
cross-repo cost in the plan: the ADR-0009 amendment **renames** `pending` → `deferred` and `unknown`
→ `indeterminate`. `rubricator`'s ADR drafts, prompts and evaluation metric names are all written
against the old spellings. Settle it inside the intake half of `schema-v1`, and link the outcome to
the `rubricator` issue that sweeps the names. See
[`cross-repo-coordination.md`](cross-repo-coordination.md) §7.1.

Four items genuinely need a human rather than more reading: the number allocation; whether renaming
`unknown` → `indeterminate` is worth the churn; whether the ELECTRE quotation behind the ADR-0015
correction can be re-verified (the substance survives without it, the quotation should not be cited
until someone with library access checks it); and whether ADR-0008 is amended or superseded.

**Done when** `adr/PENDING-ACTIONS.md` is deleted, because its content lives in the ADRs it names.

## 2. Repository scaffolding and CI (Phase 1)

One npm package, subpath exports (`comparanda`, `/view`, `/store`), TypeScript throughout, a test
runner, and the two lint rules that are correctness requirements rather than style: no DOM in
`core`, and no classic Zod barrel import in any browser entry point.

The pre-publish denylist check (ADR-0016) lands here. **The denylist file is gitignored and never
committed** — it names the private terms it exists to protect, so committing it publishes exactly
what it defends against. CI reads it from a secret; a missing denylist fails the publish rather
than passing it.

## 3. The schema (Phase 1)

`zod/mini` for the runtime schema, JSON Schema emission as a Node-only build step, TypeScript types
derived and never hand-maintained. The affordance layer — what is editable, which missingness codes
are legal, which group pairs are inapplicable — is schema content, not component logic.

The migration harness is written **with** version 1, not when a migration is first needed. Every
version bump registers a step even when it is a no-op, so the path from any stored analysis to the
current version is always a composed chain.

## 4. Example datasets (Phase 1)

`languages.json` clean, `relocation.json` deliberately messy. The messy one is the more important
fixture and has its own issue: it is what exercises all six missingness codes, criterion groups and
alternative groups, an inapplicable group-pair block, multi-rater disagreement on at least three
cells, a criterion carrying an `acceptability` threshold, mixed levels of measurement, evidence links
with embedded excerpts including one deliberately stale, and three annotation threads — one resolved,
one open, one anchored to a criterion rather than a cell. Most bugs will be found by it.

`examples/README.md` is the authority on that list and is currently **stale in two places**: it says
"all five missingness codes" (the ADR-0009 amendment takes the core set to six by adding
`not-evidenced`), and it asks for "a criterion marked as a veto with a threshold" using a word the
ADR-0015 amendment reserves for ELECTRE's pairwise sense — the field is renamed `acceptability`.
Update that file in the same pass as the ADRs.

It also settles four open questions the research explicitly deferred to it — the coverage floor,
what a `target` criterion can honestly report, the realistic size of an inlined analysis payload,
and whether the missingness rename survives contact with real prompts.

## 5. Cross-repo schema contract (Phase 1)

`rubricator` writes into this schema, and the dependency runs one way in code while requirements run
both ways. Its research names seven schema requests; absorbing them before the freeze is far cheaper
than migrating every stored analysis afterwards. Every request gets a **recorded disposition** —
`accept-v1`, `accept-later`, `reject` or `needs-shape` — and silence is not one of them; that is what
the intake half of `schema-v1` checks. Mirror-issue keys must be unique across this whole roadmap,
not merely within this epic: the schema epic already owns `schema-criterion-preference`, so the
mirrors take a `request-` prefix. The most important single field in that list is
`independence` on an assertion: five draws of one model must never render as five raters.

## 6. Core logic (Phase 2)

View state, saved views with structural dirty comparison, the `DataProvider` ports and the fallback
chain, identity, and the one `moveTo` / `describeMove` pair that every reorder route — keyboard,
menu, pointer — goes through. All testable in plain Node, before any pixels.

## 7. Analyses (Phase 2)

Dominance, screening, seriation, completeness, agreement, the datum-relative tally, opt-in weighted
sum behind a coverage gate, and sensitivity.

The dominance issue carries the finding that most easily goes wrong: the obvious rule for an
incomplete matrix — compare two alternatives only on the criteria both have — is non-transitive,
admits cycles, and can report that every alternative is dominated. Necessary and possible dominance
over interval completions, on a fixed comparison basis, is the rule that works.

## 8. The view (Phase 3)

Matrix, encodings, reorder, group, select, detail panel, plus the three secondary views that earn
their place. Specified at one issue per deliverable with a short body: the ADRs describe the target
in more detail than a pre-implementation roadmap honestly can, and inventing precision here would be
pretending we know things we will only learn by building.

## 9. Accessibility (Phase 3)

Its own epic, not a section of the view epic, because folding it in is exactly how it becomes a later
pass. The automated checks are a merge gate; the manual pass runs once per release and is recorded in
the release notes.

## 10. Collaboration (Phase 4)

Annotations and attribution first, then multi-rater and disagreement, then suggestion mode. The
*schema* accommodates all of it from Phase 1; this epic is the runtime and the view for it.

## 11. Standalone build and publish (Phase 5)

`comparanda build` emits one self-contained HTML file with a CSP that makes the no-network property
browser-enforced rather than merely tested, a byte budget that fails the build, and a CLI that says
out loud that some mail gateways block `.html` attachments by true type regardless of extension.

---

## What we would cut under time pressure

The BRIEF asks for this list by name. It is ordered: the first thing to go is at the top.

**Cut first — recoverable later, no migration.**

1. **Rank-flow / slope view** and the **detail-panel diverging spread bar**. The research says so
   directly: matrix, dot-plot small multiples and the Pareto scatter cover overview, value reading
   and reduction, which is the whole argument a comparison usually needs.
2. **Weighted aggregation and sensitivity analysis.** Both are opt-in by design, and the project's
   stated position is that the table is often the finished product. Cutting them cuts nothing the
   default presentation uses.
3. **Suggestion mode** (Phase 4's third stage). Annotations plus attribution deliver most of the
   collaboration value; proposals are the part a team can live without for a release.
4. **The `disagreement-spread` ramp and `consensus-suppressed`.** Ship the rater dot strip alone —
   it is the one that refuses to summarise.
5. **Nested groups.** Render one level, as ADR-0008 already suggests; the schema keeps nesting.
6. **Cross-tab synchronisation** of view state. Single-tab is the common case and the failure is
   visible rather than silent.

**Cut with care — costs a migration or a redesign later.**

7. **Multi-rater runtime** (not the schema). The assertion model must ship in v1 regardless; what can
   slip is the view and the agreement analysis over it.
8. **Seriation as an automatic action.** Keep manual reorder and single-criterion sort — they are the
   same code path. This costs the project its most distinctive analysis, so cut it last.

**Never cut, at any schedule.**

- Any Phase 1 schema field whose absence becomes a migration: criterion `preference` and `range`,
  the assertion model with `independence`, `rounds`, disclosure, criteria versioning, evidence
  `stance`, the missingness code objects.
- The **migration harness itself**, written with version 1.
- The **accessibility merge gate**. It is cheap while the view is small and unaffordable afterwards.
- The **denylist check** and the public-repo constraint generally.
- The **CSP-enforced zero-network property** of the standalone bundle — it fails only offline, at the
  reader's desk, which is the worst place to discover it.
- **Qualified missingness.** It is the product.
