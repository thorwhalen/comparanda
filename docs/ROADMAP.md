# Roadmap

**The GitHub issues are the live source of truth.** This file is the map: the v1 spine, the epics in
order, where the gates are, and what gets cut first. When the two disagree, the issues win.

Read [`../BRIEF.md`](../BRIEF.md) for the phase plan this elaborates, [`adr/README.md`](adr/README.md)
for the decisions, [`research/README.md`](research/README.md) for what is already known, and
[`cross-repo-coordination.md`](cross-repo-coordination.md) for the gates, the schema-request protocol
and the version handshake with `rubricator`. **That file is canonical for anything involving both
repositories; where this map and it disagree, it wins.**

---

## What changed on 2026-08-22

Nine decisions were settled by the owner and one architecture was fixed against them. Four
consequences reshape this map, and they are stated first because the rest of the file is written
against them.

1. **A team arguing over a shared document is in v1.** Epic 10 was Phase 4. Most of it is now v1
   (ADR-0011, amended). The staging its own body said should not be reshuffled is reshuffled, on the
   record.
2. **Three closed vocabularies become declared, open ones** — missingness scope, reductions, and
   measurement scales — over one substrate with one resolver and degradation that is *reported*
   (ADR-0030). This is the change that must land before the freeze; after it, each one is a
   migration through every stored analysis.
3. **Validation grows two families.** Honesty rejects and cannot be suppressed; completeness informs
   (ADR-0031). "Not yet assessed" stays a first-class valid state.
4. **v1 renders text, not colour** (ADR-0032). A declared scale removes the arity the palette
   assumed, and blocking a working product on a palette redesign is the wrong trade.

**Iterate by adding.** The organising constraint on everything below: a later improvement should be
*a new row in a table, one new function, or one changed argument at a composition root* — never a
call-site sweep. Where a step here cannot be described that way, it is on the critical path
precisely because it cannot.

---

## The v1 spine

The epics below are the map. This is the **line through them** — the smallest slice that proves
every seam exists. Nothing on it depends on this repository's view epic, because the view is a
placeholder behind a Phase-3 epic behind an accessibility merge gate, and the product must not wait
on it.

| # | Step | What it proves |
|---|---|---|
| 1 | The hygiene guards can actually see every file, and the missingness core set has one home | every later source-scan guard actually scans |
| 2 | `declarations.ts`: `Resolution`, `Degradation`, `declarationFields` | the substrate the next four steps reuse |
| 3 | Missingness gains criterion scope and a facade; the resolver returns a `Resolution` | the template, finished |
| 4 | `Reduction` opens; `Measurement.scale` and `AnchorSet` land; `Analysis` gains three arrays | the freeze-critical fields |
| 5 | `Author` gains `principalId` / `actingAs` / `attestation`; `effectiveIndependence` computes | two personas are not two raters |
| 6 | `Rendition`, `renditionId`, `excerptHash`, and one verdict vocabulary | a quote resolves offline, and "checked" means one thing |
| 7 | Cell keys are unique and there is one reader | contributor files can be reconstituted at all |
| 8 | Validation families, with `fix` required | an unfinished analysis passes; an uncheckable one does not |
| 9 | `emit-json-schema.ts` exists; `comparanda.v1.json` and `vocabularies.v1.json` are emitted | the contract is producible, which it never has been |
| 10 | `languages.json` validates | the clean case |
| 11 | **`relocation.json` validates while declaring a scale and a code this build does not implement** | **every declaration seam, or the ADRs are prose** |
| 12 | `MatrixProps` is published; `text-only` renders it | the other repository can render, and its table is deletable |

**On step 1, which is partly behind us.** The two concrete defects are repaired: the literal NUL
bytes are out of `src/core/schema/analysis.ts`, and the inline six-code missingness array in
`validateAnalysis` now reads `CORE_MISSING_CODES`. CI gained a NUL-byte guard that runs *ahead* of
the hygiene scans, which is the right fix — dropping `-I` from those greps would make them read real
binaries and emit noise. What is still owed is the guard for the second defect: a source scan
asserting that no module outside `missingness.ts` contains a core code literal. It would have caught
a violation sitting in the file that owns the rule, and nothing did.

**Deliberately not on the spine:** `mountMatrix`, the colour encodings, saved views, reorder,
grouping, the detail panel, seriation, agreement, the standalone build. Each is an addition at a
named seam.

---

## The spine, as epics

| # | Epic | Phase | Gate | Unblocks |
|---|---|---|---|---|
| 1 | Settle the ADRs | 0 | `none` | everything |
| 2 | Repository scaffolding and CI | 1 | `none` | all code |
| 3 | The schema | 1 | `none` (it *produces* `schema-v1`) | *is* the `schema-v1` gate |
| 4 | Example datasets | 1 | `none` | every later test; **and the falsification of ADR-0030** |
| 5 | Cross-repo schema contract | 1 | `tool-surface` | `rubricator`; must land **before** the freeze |
| 6 | Core logic | 2 | `schema-v1` | the view, collaboration |
| 7 | Analyses | 2 | `schema-v1` | the secondary views |
| 8 | The view | 3 | `schema-v1` | the standalone build |
| 9 | Accessibility | 3 | `schema-v1` | merge gate for all view work |
| 10 | Collaboration | **1–2 for clauses 1–4 and 7; 4 for the rest** | `schema-v1` | — |
| 11 | Standalone build and publish | 5 | `schema-v1` | shipping |

### The gates

Three, shared with `rubricator` and specified in
[`cross-repo-coordination.md`](cross-repo-coordination.md) §1. They are a `gate` field on an epic or
an issue, **not a label**, and the value is one of `tool-surface`, `schema-v1`, `eval-suite` or
`none`, spelled exactly. Nothing is gated on "partly" a gate: if only some issues in an epic are
blocked, the gate goes on those issues.

**`tool-surface`** — owned by `rubricator`. **Gates epic 5 only**: this repository cannot close
intake on a set that is still growing. It gates nothing else here.

**`schema-v1`** — owned here, two halves.

- **2a, intake closed** — every request carries a recorded disposition and the contract-shaping ADRs
  are settled. Gates epic 3. Costs a reading, not a feature. **It is formally open today** while
  most of the original seven requests are visibly satisfied by the shipped schema, which is the
  cheapest possible thing to fix and has not been fixed.
- **2b, published** — the schema is written, the migration harness accepts version 1, **both
  artifacts** are published at an immutable versioned path, and both fixtures validate. The *schema
  code* gates epics 6–11; the *publication* blocks nothing here, only `rubricator`. **Note that no
  artifact has ever been emitted**: the script `package.json` invokes does not exist.

**`eval-suite`** — owned jointly. Passes when every fixture in either repository that *is* a
comparanda document validates in that repository's CI against a pinned schema version, `rubricator`
emits a real analysis that validates strict, and this repository loads and renders every shared
fixture without a runtime error. It gates the `1.0.0` release and the demo being called done. It
gates no development work.

**The freeze is the expensive moment in this project.** Every field that cannot be added later
without a migration through every stored analysis is deliberately pulled forward, and the list grew
on 2026-08-22: criterion `preference` and `range`, the assertion model with `independence`, rounds,
disclosure, criteria versioning, evidence `stance`, the missingness code objects — **plus** the
opened `Reduction`, `Measurement.scale` and `anchors`, `Analysis.scales` / `reductions` /
`renditions`, the persona fields on `Author`, `renditionId` and `excerptHash`, the verdict
vocabulary, and cell-key uniqueness.

---

## 1. Settle the ADRs (Phase 0)

The settled set is thirty-three files: ADRs 0001–0032 plus the template. Everything is `accepted`;
nothing is superseded. Several carry dated amendments, which is how this project changes its mind
(ADR-0001).

Four questions genuinely needed a human. All four are settled. Two are worth recording because the
answer changed the plan rather than confirming it:

- **The ELECTRE quotation was re-verified rather than dropped.** A retrievable full-text copy was
  located on 2026-08-22 and the transcribed quotations hold verbatim; a further passage, previously
  uncited, corroborates the ADR's correction from inside the chapter that defines both rules. The
  caveat is lifted, the wording is quotable, and **the section numbers are recorded in place of a
  URL** — because the copy is a third-party mirror and the previous one rotted. That is ADR-0014's
  cite-a-span rule applied to our own bibliography. Issue #36 closed as verified. The consequence
  for this map is that no ADR-0015 amendment is owed and no citation needs replacing; the earlier
  plan assumed the opposite.
- **The missingness rename landed in full**, and `informative` with it. `silenceRate` narrowed from
  every terminal absence to `informativeAbsent / applicable`, which is what ADR-0009 clause 5 always
  defined it as and not what shipped first.

**Done.** `adr/PENDING-ACTIONS.md` is deleted; its content lives in the ADRs it named.

## 2. Repository scaffolding and CI (Phase 1)

One npm package, subpath exports (`comparanda`, `/view`, `/store`), TypeScript throughout, a test
runner, and the two lint rules that are correctness requirements rather than style: no DOM in
`core`, no classic Zod barrel in a browser entry point.

**The pre-publish denylist check is withdrawn** (ADR-0033 supersedes ADR-0016). It was scoped to
one private analysis, and this package is a general tool that such a study motivated rather than a
sanitised derivative of it — so the list would have had to cover every engagement its author has
ever run, be maintained forever, and never be demonstrably complete. Checked across both
repositories, tree and full history: zero occurrences. What remains in CI is the pair of checks that
are generic and satisfiable — no absolute local paths, and no NUL bytes in tracked files.

**The guard-integrity work this epic owns is half done, and the remaining half is what matters
most.** A NUL byte in a tracked file makes `grep -I` and `ripgrep` classify it as binary and skip
it silently, which had exempted the largest schema file in the repository from both the absolute-path
scan and the denylist scan. That is repaired, and CI now runs a NUL-byte guard *before* the hygiene
scans so it cannot recur. What does not yet exist is the source-scan family the vocabulary ADRs
lean on — no core missingness code literal outside `missingness.ts`, no core reduction literal
outside `values.ts`. A guard that cannot fail is not a guard, and the one violation those scans
would have caught was found by reading rather than by CI.

## 3. The schema (Phase 1)

`zod/mini` for the runtime schema, JSON Schema emission as a Node-only build step, TypeScript types
derived and never hand-maintained. The affordance layer is schema content, not component logic.

The migration harness is written **with** version 1. Note the rule as the code has it: *every version
bump registers a step*. The `comparanda-dev-schema-change` wording — "a registered (no-op) v1 step" —
is literally unsatisfiable, because `registerMigration` throws when `from >= SCHEMA_VERSION` and
`SCHEMA_VERSION` is 1. The code is right and the rule is wrong; reword the rule.

**This epic now carries the declaration substrate** (ADR-0030) and the vocabularies built on it, the
persona fields, the rendition fields, cell-key uniqueness, and the validation families (ADR-0031).
The ordering matters: steps 3–8 of the spine all consume step 2.

## 4. Example datasets (Phase 1)

`languages.json` clean, `relocation.json` deliberately messy. **The messy one is now the
falsification fixture for the whole declaration architecture**, and its scope grew: on top of all six
missingness codes, both axes of groups, an inapplicable group pair, multi-rater disagreement, an
`acceptability` floor, mixed levels of measurement, evidence with a deliberately stale reference and
three annotation threads, it must **declare a scale and a missingness code this build does not
implement**, and carry a check whose `originalSha256` differs from what the rendition was made from.

One integration test then asserts it validates, dominates, screens, that `silenceRate` treats the
custom code by its declared flags, and that **exactly two** degradation records surface. If that test
is green, every declaration seam exists. If it cannot be written, ADR-0030 is prose.

`examples/README.md` is the authority on the list and is current. Neither fixture exists yet; both
are still a README describing them.

## 5. Cross-repo schema contract (Phase 1)

Every request gets a **recorded disposition** — `accept-v1`, `accept-later`, `reject` or
`needs-shape` — and silence is not one of them. The register grew from seven to sixteen on
2026-08-22; §7 and the new §7.3 of the coordination document are the checklist.

**All seven original dispositions are still empty**, so Gate 2a is formally unpassed while most of
them are visibly satisfied by the shipped schema. Recording them is a reading.

Two items here are cheap and block the other repository outright: publishing `MatrixProps`, and
reconciling the citation verdict vocabulary — the latter urgently, because three spellings are live
and the dependent's CI currently pins the wrong one green through doctests.

## 6. Core logic (Phase 2)

View state, saved views with structural dirty comparison, **one** `DataProvider` port and the
fallback chain, identity, the reducer registry with its admissibility wrapper, and the single
`moveTo` / `describeMove` pair every reorder route goes through. All testable in plain Node.

The port set narrowed from five to one (ADR-0006, amended): four of the five are view-state
conveniences, and splitting a port set before any member has two implementations freezes a guess.
`getCapabilities()` remains the single source of truth, and gains the `multiWriter` /
`perContributorFiles` pair — the first may only be true where the second is, which is the only reason
a last-write-wins provider is safe for a shared analysis.

**Merge is not this repository's in v1**, and that is a decision, not a gap. What is ours is the
golden fixtures that stop a later TypeScript port drifting from the first implementation.

## 7. Analyses (Phase 2)

Dominance, screening, seriation, completeness, agreement, the datum-relative tally, opt-in weighted
sum behind a coverage gate, and sensitivity.

The dominance issue carries the finding that most easily goes wrong: the obvious rule for an
incomplete matrix — compare two alternatives only on the criteria both have — is non-transitive,
admits cycles, and can report that every alternative is dominated. Necessary and possible dominance
over interval completions, on a fixed basis, is the rule that works. It ships with generated triples
pinning transitivity.

## 8. The view (Phase 3)

**v1 registers one encoding, `text-only`** (ADR-0032), and publishes `MatrixProps` before the matrix
exists so the first consumer's interim table is deletable rather than refactorable. The remaining
eight encodings arrive with arity derived from the resolved scale rather than assumed — the palette's
hardcoded nine colours for five scores by three confidence levels is exactly what a declared scale
breaks.

Whatever renders a check must render `checkStanding().needsCaveat`, with a test that fails if it does
not, and must take `standing` injected so the view owns no clock.

## 9. Accessibility (Phase 3)

Its own epic, because folding it in is how it becomes a later pass. Automated checks are a merge
gate; the manual pass runs once per release and is recorded in the release notes.

One correction from the vocabulary work: the blank-cell announcement must read the vocabulary's
`means` string, never a literal code. A custom code has no announcement text under the current
design, which turns the gate into a false pass on exactly the documents it most needs to catch.

## 10. Collaboration (**mostly Phase 1–2 now**)

Anchored annotations at every scope, threads with resolve, multi-rater values with every assertion
retained, disagreement as an encoding, a legible activity record, and **version-checked writes with
conflicts surfaced** — that last one no longer optional — are v1 (ADR-0011, amended). Suggestion mode
and the rounds runtime stay staged.

The *schema* accommodated all of it from Phase 1, which is what makes the restaging affordable. The
Consequences warning is now load-bearing rather than prospective: there is no window in which
retrofitting multi-rater could have been cheap, because the multi-rater shape is what v1 stores.

## 11. Standalone build and publish (Phase 5)

`comparanda build` emits one self-contained HTML file with a CSP that makes zero-network
browser-enforced rather than merely tested, a byte budget that fails the build, and a CLI that says
out loud that some mail gateways block `.html` attachments by true type regardless of extension.

---

## What we would cut under time pressure

Ordered; the first thing to go is at the top. **Revised 2026-08-22** — two items left this list
because the team is in v1, and two joined it.

**Cut first — recoverable later, no migration.**

1. **Rank-flow / slope view** and the **detail-panel diverging spread bar**. The research says so
   directly: matrix, dot-plot small multiples and the Pareto scatter cover overview, value reading
   and reduction.
2. **Weighted aggregation and sensitivity analysis.** Both opt-in by design, and the project's
   stated position is that the table is often the finished product.
3. **The colour encodings.** `text-only` is v1's encoding and is correct under a declared scale;
   everything else in ADR-0010's roster is an addition at a registered seam. *(New. The cheapest
   large cut available, and it costs no migration.)*
4. **Nested groups.** Render one level; the schema keeps nesting.
5. **Cross-tab synchronisation** of view state. Single-tab is common and the failure is visible.
6. **The degradation banner.** The records still surface to a caller; only the rendering slips.
   *(New.)*

**Cut with care — costs a migration or a redesign later.**

7. **Seriation as an automatic action.** Keep manual reorder and single-criterion sort — the same
   code path. This costs the project its most distinctive analysis, so cut it last.

**No longer cuttable.**

- **Suggestion mode** was cut item 3 and **the multi-rater runtime** was cut item 7. The first is
  still *staged* rather than cut; the second is v1 (ADR-0011, amended). The `disagreement-spread`
  ramp and `consensus-suppressed` fold into item 3 above.

**Never cut, at any schedule.**

- Any Phase 1 schema field whose absence becomes a migration — the freeze list under "The gates".
- The **declaration substrate and the falsification fixture together**. Either alone is worthless:
  the substrate untested is a claim, and the fixture with nothing to falsify is a JSON file.
- The **migration harness itself**, written with version 1.
- The **accessibility merge gate**. Cheap while the view is small, unaffordable afterwards.
- The **denylist check** and the public-repo constraint generally — including the guard integrity
  that makes it able to see every file.
- The **CSP-enforced zero-network property** of the standalone bundle.
- **Qualified missingness.** It is the product.
- **Honesty validation.** It cannot be suppressed by a flag, and it cannot be cut by a schedule.
