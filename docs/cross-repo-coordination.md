# Cross-repo coordination — `comparanda` and `rubricator`

**This file is canonical here, in `comparanda`, and is linked from `rubricator` rather than copied
into it.** There is no second copy. If you are reading a duplicate, delete it — a coordination plan
that exists twice is a coordination plan that disagrees with itself, which is the exact failure it
is written to prevent.

Written to be read from either repository. Paths are given repo-qualified
(`comparanda: docs/adr/0011-collaboration.md`) because a relative link only resolves on one side.

---

## 0. The situation

Two repositories, one contract.

- **Code depends one way.** `rubricator` consumes `comparanda`'s published JSON Schema and validates
  at the boundary. `comparanda` never depends on `rubricator`, and must not be able to tell whether
  a human, an agent or a script produced an analysis, except through the authorship metadata every
  value carries (`comparanda: docs/adr/0002-scope-and-non-goals.md`,
  `rubricator: docs/adr/0002-separation-from-comparanda.md`).
- **Requirements flow both ways.** `rubricator`'s Phase 0 research produced **seven schema
  requests** (`rubricator: docs/research/findings-method.md § Schema requests to comparanda`), and
  `comparanda`'s own terminology research independently found that criteria must carry a **direction
  of preference** and a **declared range**, or dominance and screening are undefined
  (`comparanda: docs/research/findings-terminology.md` findings #4, #5, #11). The two research
  rounds converged on the same conclusion from opposite ends. That convergence is the strongest
  evidence available that these fields belong in v1.
- **Today, both repositories are documentation only.** No schema code, no tools, no fixtures beyond
  a README describing them. Every gate below is therefore ahead of us, not behind us, which is the
  cheapest position this plan will ever be written from.

The asymmetry that governs everything: **absorbing a field before v1 freezes costs a line in a
schema file; absorbing it after costs a migration through every stored analysis.**
`comparanda: docs/adr/0011-collaboration.md` names that hazard for multi-rater. Four of the seven
requests are per-assertion fields, so they arrive through exactly that door.

---

## 1. The gates

Three. Each one is a stall, so each has to earn its place by naming work that is *provably wrong* if
started early — not merely awkward. The rejected candidates in §1.4 matter as much as the accepted
ones.

Gate names are `tool-surface`, `schema-v1` and `eval-suite`. They are **not** issue labels — neither
repository's label set contains them. They are the value of the `gate` field an epic or issue
carries, and the string must match one of those three exactly, or `none`. Nothing is ever gated on
"partly" a gate: if only some issues in an epic are blocked, the gate goes on those issues and the
epic stays `none`.

### Gate 1 — `tool-surface`: `rubricator` declares the request set complete

**Owned by** `rubricator`.

**Passes when:**

- [ ] The MCP tool surface is frozen — names, signatures, contracts, and the minimum viable subset.
      (`rubricator: docs/research/findings-method.md § Proposed MCP tool surface` proposes 19 tools,
      11 minimum viable; freezing does not mean building all 19.)
- [ ] `rubricator: docs/adr/PENDING-ACTIONS.md` entries 1–3 are settled — the host framework, the
      determinism boundary, and the structured-output JSON Schema subset. Entry 3 in particular is a
      hard constraint on signatures and is pure rework if retrofitted.
- [ ] Every field `rubricator` must read from or write into a comparanda document is either already
      in the schema sketch (§2.1) or filed as a request (§3).
- [ ] One issue in `rubricator` states, in terms a reader can check: *the request set is complete as
      of tool surface vN*.

**Blocks:** Gate 2, and nothing else. In particular it does **not** block `rubricator`'s prompts,
corpus tools, citation ladder, traversal planner, connector scaffolding or evaluation harness
design — see §2.2.

**Why it is load-bearing:** `comparanda` cannot close intake on a set that is still growing. The
tool surface is the artifact that determines what the agent writes; until it stops moving, "we have
heard everything" is unknowable rather than merely unknown. A request discovered after the surface
freezes has nowhere to land, which is why the freeze and the request deadline are the same event.

### Gate 2 — `schema-v1`: the contract exists, versioned and published

**Owned by** `comparanda`. Two halves, both required, in this order.

**2a — intake closed.**

- [ ] Every one of the seven requests in the §7 register carries a recorded disposition:
      `accept-v1`, `accept-later` (with the migration it will cost, named), `reject` (with a
      reason), or `needs-shape` (bounced back for a concrete JSON fragment). **Zero requests in the
      state "nobody has read it."**
- [ ] The six field-shaping Tier 1 entries in `comparanda: docs/adr/PENDING-ACTIONS.md` are settled:
      new ADR-0018 (preference, range, thresholds), new ADR-0019 (dominance over incomplete data),
      ADR-0009 amended (missingness codes), new ADR-0020 (two kinds of weight), new ADR-0021
      (disclosure orthogonal to presence), new ADR-0023 (rounds). New ADR-0017 is also required
      because it names the library the schema is authored in.

**A caveat on that list.** `comparanda`'s Tier 1 has **nine** entries, not six. The two not named
above — item 8 (ADR-0015 amended, analyses) and item 9 (ADR-0003 amended, vocabulary) — do not shape
the cross-repo contract, so they are not Gate 2a's business. They **do** block 2b, because
`comparanda`'s own schema issues depend on them (the core analysis document is written in ADR-0003's
vocabulary). Gate 2a is the contract-shaping subset; all nine block the schema code.

**2b — published.**

- [ ] The zodal schema is written, and TypeScript types are derived from it, never parallel.
- [ ] The migration harness ships **with version 1**, with a registered (no-op) v1 step, per
      `comparanda: skills/comparanda-dev-schema-change/SKILL.md` rule 1.
- [ ] JSON Schema emission is a Node-only, build-time step and appears in no browser entry point.
- [ ] The artifact is published at an **immutable, versioned path** and is fetchable without running
      the package.
- [ ] Every analysis document carries `schemaVersion`.
- [ ] Both example fixtures validate, and the messy one exercises the parts the clean one cannot
      (`comparanda: examples/README.md`).

**Blocks (in `rubricator`):** `analysis_validate` against the real schema; the
`rubricator://schema/comparanda/{version}` resource; the declared-emit set; any claim of
conformance; the end-to-end demo. **Blocks (in `comparanda`):** 2b's *schema code* blocks Phase 2
core logic; 2b's *publication* blocks nothing internally.

**Why 2a is load-bearing and not a stall:** disposition is not implementation. A request can be
rejected in one sentence. The gate costs a reading, not a feature. What it buys is that no field
enters the schema by surprise after v1 — which is the only expensive outcome in this whole plan.

**A legitimate way to pass 2b early:** publish `1.0.0-rc` covering only the fields the first demo
needs, provided the *expensive-to-retrofit shapes* are in it — per-assertion structure, missingness
reason codes, criterion `preference` and `range`, the `rounds` field. Everything else is
additive-optional and therefore a MINOR bump, not a migration. See §6.

### Gate 3 — `eval-suite`: conformance is demonstrated, not asserted

**Owned by** both.

**Passes when:**

- [ ] The fixture rule of §4 is in force: every fixture in either repository that *is* a comparanda
      document validates in that repository's CI, against a pinned schema version.
- [ ] `rubricator` emits at least one analysis from a real public corpus that validates with
      `strict=true`.
- [ ] `comparanda` loads and renders every fixture in the shared set without a runtime error.
- [ ] `rubricator`'s evaluation suite (`rubricator: docs/adr/0008-evaluation.md`) runs at least the
      schema-validity, citation-faithfulness and refusal-to-guess arms against those fixtures.

**Blocks:** a `1.0.0` release of either package; the demo being called *done*; and any claim that a
prompt edit is an improvement rather than churn — which is ADR-0008's whole argument.

**Why it is load-bearing:** everything before this gate is two teams asserting they agree. This is
the first point at which a machine checks.

### 1.4 Gates deliberately *not* taken

Each of these looked like a gate and is not. Recording the rejections is what stops them being
reinvented.

| Rejected gate | Why it is not one |
|---|---|
| "All `comparanda` ADRs settled before `rubricator` starts" | Only the six field-shaping Tier 1 entries touch the contract. Seriation, agreement statistics, matrix accessibility, non-colour channels, the view set and the standalone build — Tiers 2 and 3 — are invisible to `rubricator` forever. |
| "The view exists before `rubricator` emits" | An analysis is a JSON document. It is checkable with a validator and readable in a text editor. The view is how a *team argues about it*, not how it is verified. |
| "`rubricator`'s host framework / `aix` facade settled before `comparanda` writes schema" | `comparanda` does not import Python. These are internal to `rubricator` and block only `rubricator`. |
| "Prompts frozen before schema" | Prompts are content, not contract (`rubricator: CLAUDE.md`). A prompt edit is a file edit in one repo. |
| "`rubricator` waits for the real schema before writing any code" | Explicitly contradicted by `rubricator: BRIEF.md` Phase 0: build against the domain model and a hand-written sketch until the real one lands. §2.1 makes this safe. |
| "A joint release train" | Two languages, two registries, two release rhythms. The version handshake in §3.3 is what replaces it, and it is cheaper. |

---

## 2. What runs in parallel

This is the valuable half of the document. Almost everything is parallel; the gates touch a thin
seam.

### 2.1 The mechanism that makes `rubricator`'s parallelism safe

Do not have `rubricator` code "assume a schema". Have it depend on **one indirection**:

- Write `rubricator: docs/schema-sketch/comparanda-analysis.sketch.json` — a hand-written JSON
  Schema in the domain-model vocabulary (alternatives, criteria, subject, measure, missing), marked
  `provisional`, containing both the fields the domain model already describes **and** the fields
  the seven requests ask for. Every requested field carries `"x-requested": true` and a pointer to
  the request issue.
- All validation in `rubricator` goes through a single `SchemaSource` facade with two
  implementations: `SketchSchema` and `PublishedSchema(version)`. Nothing else in the codebase names
  a schema file. Swapping at Gate 2 is one line at the composition root.
- **The sketch is not thrown away at Gate 2.** `diff(sketch, published v1)` is the enumerable list of
  changes Gate 2 forces on `rubricator` — and, filed *before* the swap, it is also the most honest
  possible statement of which requests landed. This turns a frightening swap into a checklist.

A second, smaller mechanism: keep the seven requests **shaped**, not prose. A request that arrives as
a JSON fragment plus a validator can be evaluated by `comparanda` in minutes. A request that arrives
as a paragraph gets deferred, and deferral is how a field ends up post-v1.

### 2.2 `rubricator` work that needs nothing from `comparanda`

Build all of this now, against the sketch.

1. **The whole tool surface definition** — names, signatures, contracts, granularity, the minimum
   viable subset, the deliberately-absent list. `rubricator: BRIEF.md` calls this the core artifact
   of the project.
2. **`corpus_add` / `corpus_search`** — the versioned normaliser, the chunker, stable document and
   span ids, character offsets into the normalised full document, BM25 plus normalised substring
   with a fixed tokenizer and deterministic tie-break. Spans live in `rubricator`'s own id space
   until they are written into an evidence reference; nothing here touches the contract.
3. **`check_citations` — the eight-step deterministic ladder.** Pure string algorithms: normalise,
   resolvability, exact containment, bounded-edit-distance containment, drift classification,
   span-size sanity, numeric-claim agreement, polarity trap. `rubricator`'s own research calls this
   tool "not cuttable — it is the product." It touches the schema only where it writes a verdict.
4. **The evidence-reference locator profile** (narrowed W3C Web Annotation selectors, quotes as
   truth, positions as hints) as a standalone typed module with round-trip serialisation tests. This
   is simultaneously the largest schema request and a self-contained deliverable; building it first
   is what converts request #5 from an ask into an *accept-this-shape*.
5. **`plan_traversal`** — a pure function of `(seed, items)`. Zero dependency, and the connector's
   strongest available variance mitigation.
6. **All ten prompts** — `run-analysis`, `frame`, `enumerate-alternatives`, `propose-criteria`,
   `confirm-frame`, `score-cell`, `score-column`, `review`, `audit-existing`, `resume`. Draft
   `propose-criteria` first and hardest.
7. **Every remaining ADR in `rubricator: docs/adr/PENDING-ACTIONS.md`** — the determinism boundary,
   the structured-output subset, the scoring protocol, scales and the two uncertainties, criteria
   revisability, source type and stance, durable partial documents, variance policy per runtime, the
   `aix` facade rule.
8. **The six `aix` facade gaps** — a completion primitive that does not discard the response,
   concurrent sampling, membership enforcement in `constrained_answer`, provider-enforced structured
   output, documented seed support with capability probing, error propagation in batch chat. All
   against the local `aix` package; `comparanda` is not in the picture.
9. **The MCP client-capability probe** — a throwaway server that logs `clientCapabilities` from the
   target clients. One afternoon, and it decides whether the `frame_confirm` fallback path matters
   enormously or not at all.
10. **The store behind a `Mapping` interface**, in the platform user-data directory, never inside the
    package. The *record format* is a comparanda document, so this depends on the sketch, not on v1.
11. **The numeric tools** — `aggregate_assertions`, `stability_report` (dominance survival rate,
    Pareto-set churn, per-criterion test–retest agreement), `compute_coupling_matrix`,
    `fit_bradley_terry`. Order statistics and vendored numerics over in-memory structures.
12. **The evaluation harness design and the arms that settle the open questions** — `cellwise` vs
    `in_session_isolated`, withheld prior vs visible prior, anchors on vs off. These need a corpus
    and a model, not a schema.

### 2.3 `comparanda` work that needs nothing from `rubricator`

Which is to say: nearly all of it, once Gate 2a is closed.

1. **The zodal schema itself, the migration harness, JSON Schema emission, versioning.** Gate 2a is
   the only input from the other repo, and it is an input of *decisions*, not of code.
2. **Both example fixtures, hand-authored** — `languages.json` clean, `relocation.json` deliberately
   messy. These do not need an agent; they need a person and an afternoon, and they must exist
   *before* `rubricator` can be judged, because they are the reference documents.
3. **All of Phase 2 core logic** — view state, saved views, dirty-state comparison, store adapters
   and the capability-driven fallback chain, completeness reporting, necessary/possible dominance
   over interval completions, conjunctive screening, seriation, Krippendorff's alpha (own it, about
   eighty lines).
4. **All of Phase 3 view** — the matrix, the encodings including the blended one that changes minds,
   the rater dot strip, reorder, group, select, the detail panel, and the four accessibility
   constraints that fail a PR on their own.
5. **All of Phase 5** — the standalone single-file build, the CSP-enforced zero-network property, the
   byte budget, docs, publish.
6. **The `EvidenceResolver` port.** `comparanda` defines the port; `rubricator`'s
   `rubricator://analysis/{id}/span/{span_id}` resource is *an* implementation of it. Neither side
   needs the other to build its half — that is what a port is for.
7. **Annotation anchoring**: stable opaque id tuples, `supersededBy` for splits, tombstones instead
   of hard deletes, `aliases` so a `rubricator` re-run that renames a criterion still resolves, and a
   `repairHint` that is stored and never consulted.
8. **Packaging** — subpath exports, tarball checks, the no-DOM test environment for `core`.

### 2.4 Genuinely joint, and small

- The **shared fixture set** (§4) — one owner, one home, both consumers.
- The **request register** (§7) — one table, mirrored issues, one disposition column.
- The **domain vocabulary**. Both repos already write in it. The cheapest possible coordination
  mechanism is that neither repo ever says "items" or "features".

---

## 3. The schema-request protocol

`comparanda: skills/comparanda-dev-schema-change/SKILL.md` already writes down a five-step protocol
for a breaking change. This section is the fuller lifecycle it abbreviates, and adds the version
handshake.

### 3.1 How a request becomes a schema change

1. **File in `rubricator` first**, labelled `cross-repo` (the only label either repo's set carries
   for this; there is no `schema-request` label). `rubricator` owns the *justification*;
   it is the only side that knows what becomes impossible without the field. The body must carry:
   the field or fields, **a concrete JSON fragment** (not a description of one), the `rubricator`
   behaviour that is unbuildable without it with the ADR or findings section that requires it, and —
   non-negotiable — **what `rubricator` will do if the request is rejected**. A request with no
   stated fallback is a demand, and a demand cannot be triaged.
2. **Mirror in `comparanda` immediately**, labelled `cross-repo`, cross-linked
   both ways. The `comparanda` issue is the one that decides; the `rubricator` issue is the one that
   records the consequence.
3. **Triage in `comparanda`** against the five tests the schema-change skill already lists — is it
   derived? is it view state? is it a bare null? does it presume a level of measurement? does it
   survive multi-rater? — plus a sixth this document adds:

   > **Does the field let `comparanda` tell that an agent produced the analysis?** ADR-0002 says it
   > must not be able to, except through authorship metadata. `authorKind` and `independence` are
   > legitimate *because* they are authorship metadata and a human panel needs them equally. A field
   > named for the producer rather than the property would not be.

4. **Disposition, always recorded, in the `comparanda` issue**: `accept-v1` / `accept-later` (naming
   the migration it will cost) / `reject` (with the reason) / `needs-shape` (bounced back). A
   rejection closes with a comment, and the `rubricator` mirror records the fallback actually taken.
   Silence is not a disposition and does not pass Gate 2a.
5. **Land in `comparanda`**: version bump, migration registered even if a no-op, migration tested
   round-trip, JSON Schema regenerated, both fixtures still valid, and **the messy fixture exercises
   the new field** — the clean one will not find the bug.
6. **Publish** the versioned artifact at its immutable path.
7. **`rubricator` bumps its declared emit set**, re-pins its vendored copy, and adds a fixture that
   exercises the new field.

Steps 1–4 are cheap and are the ones that must not be skipped. Steps 5–7 are ordinary release work.

### 3.2 Who files what, in one line each

| Artifact | Repo | Filed by |
|---|---|---|
| The request, with fragment, justification and fallback | `rubricator` | `rubricator` |
| The mirror, with the disposition | `comparanda` | `rubricator` opens it; `comparanda` decides in it |
| The schema PR, migration and fixture update | `comparanda` | `comparanda` |
| The published artifact | `comparanda` | `comparanda` |
| The vendored copy, emit-set bump and conformance fixture | `rubricator` | `rubricator` |

### 3.3 The version handshake

- **`comparanda` publishes versions; `rubricator` declares a set.**
- Version is `MAJOR.MINOR`. **MAJOR** = anything a v(N-1) reader cannot load without migrating —
  a removal, a rename, a narrowing, a required addition. **MINOR** = additive and optional only.
  This split is what makes the `1.0.0-rc` shortener in §6 safe.
- Each version is published as an **immutable file at a versioned path**, never mutated after
  release, alongside a mutable `latest` pointer that nothing in `rubricator` is allowed to resolve at
  runtime.
- **`comparanda` reads a range**: any version for which the migration harness holds a composed chain
  to current. That is the harness's entire purpose.
- **`rubricator` declares a set, not a range** — an explicit module constant such as
  `EMITS = {"1.0", "1.1"}`. A set, because a range silently claims a version nobody tested, and a
  MINOR-additive change would then have `rubricator` emitting fields an older `comparanda` build
  drops on load, with no error anywhere.
- **`rubricator` emits the lowest version that expresses the analysis**, not the newest. A document
  that uses no v1.1 field is emitted as v1.0 and is therefore readable by the widest set of
  `comparanda` builds. Emitting the newest by default is the single easiest way to make documents
  gratuitously incompatible.
- **`rubricator` vendors** the JSON Schema files for every version in `EMITS`, pinned by content
  hash, and serves them through `rubricator://schema/comparanda/{version}`. Vendored, not fetched:
  the connector must work with no network, and no tool may make a network call. The dependency
  becomes a build-time copy, which is also why there is no circular dependency to worry about.
- **A scheduled `rubricator` CI job** compares the vendored set against the published `latest` and
  opens a PR when it is behind. That job **warns; it never fails a build.** A red build because
  someone else released is a coordination tax with no safety benefit.
- A **MAJOR** bump is a coordinated event: mirrored issues, `comparanda` release, then a `rubricator`
  release that *adds* the new version to `EMITS`. Dropping the old version is a separate, later
  release after a stated deprecation window — never the same one.

---

## 4. Shared fixtures — where they live

Both BRIEFs call fixtures a shared asset. Both are right, and they mean two different things by it.
The recommendation resolves that first, because most of the difficulty is in the conflation.

### 4.1 The split

- A **`comparanda` example** is a *finished analysis document*: subject, alternatives, criteria,
  measures, missing cells with reasons, evidence references, annotations. It is an **output**.
- A **`rubricator` eval fixture** is an *input plus an expected output*: a corpus of public-domain
  source documents, a question, and a gold matrix — including cells where the evidence is
  deliberately absent, which is what the refusal-to-guess arm tests. The corpus is not a comparanda
  concept at all.

They overlap in exactly one object: the finished analysis document.

### 4.2 The recommendation

**Analysis-document fixtures live in `comparanda: examples/`, owned by `comparanda`, and are
vendored into `rubricator` at a pinned tag by the same mechanism that vendors the schema.**

- `comparanda: examples/languages.json` — clean, complete, tidy.
- `comparanda: examples/relocation.json` — deliberately messy: all missingness reason codes, an
  inapplicable group-pair block, multi-rater disagreement on at least three cells, mixed levels of
  measurement, a stale evidence reference, three annotation threads.

**Corpora and gold sets live in `rubricator`**, in its test fixtures, and `comparanda` never sees
them.

**The join, and the anti-drift rule:**

> **Any fixture, in either repository, that is a comparanda document must validate in that
> repository's CI against a pinned schema version.** That is the only mechanism required. It does not
> need a third repo, a shared package, or a release train.

**The one shared editorial decision:** both repositories use the same public domains, so that the
end-to-end demo tells one story. `rubricator`'s corpus is built toward the **relocation** subject
specifically, so that the agent's output can be compared cell-by-cell against `comparanda`'s
hand-authored messy fixture on an identical frame. That comparison is the strongest evaluation
available to either project, and it costs nothing beyond agreeing on the subject. Source documents
must be genuinely public — government open data and similar — with the licence recorded per document
in the corpus manifest.

### 4.3 Why not the alternatives

- **A third fixtures repository.** Adds a release to coordinate, and creates a place where a fixture
  can be schema-invalid with nobody responsible for it. At two repos and this scale it is pure
  overhead.
- **Fixtures owned by `rubricator`.** Inverts ADR-0002. The owner of the format must own the corpus
  of the format, or the corpus drifts from the format — and the direction of the code dependency
  already tells us which way that goes.
- **Duplicated in both.** They will diverge within one schema bump, and the divergence will surface
  as a mysterious demo failure rather than as a diff.

---

## 5. Failure modes if the gates are ignored

### 5.1 v1 freezes before the per-assertion requests are dispositioned

`authorKind`, `independence`, `perturbation` and the analysis-level `procedure` record are
**per-assertion** fields. If they land after v1, every stored analysis must be migrated with a
guessed default, and the only safe default is "unknown independence".

The cost is not the migration script. It is that **every agreement statistic computed before the
migration becomes permanently uninterpretable** — nobody can afterwards say whether a given
Krippendorff's alpha was computed over five raters or over five draws of one model. Five draws of
one model must never render as five raters, and after the fact there is no way to find out which it
was. This is precisely the hazard `comparanda: docs/adr/0011-collaboration.md` names for multi-rater,
arriving through the `rubricator` door instead of the multi-rater door.

### 5.2 `rubricator` builds against no schema at all, rather than against a sketch

The requests never become concrete, and `comparanda` ends up triaging prose.

Concretely: `criteria_set` is specified to **reject any criterion missing a required definition
field** — objective, question, level, preference, attribute type, anchors at 1/3/5 for ordinal,
evidence rule, missing rule, exclusions. If that list exists only in a findings table when
`comparanda` writes the criterion type, `comparanda` ships a free-text description because that is
the reasonable default, and `rubricator`'s most important validation tool has nowhere to write.

The cost: `criteria_set` degrades to a lint over free text; the honesty guarantee stays expressible
only at the cell level, which is the wrong level — it is *defined* by the criterion and merely
*exercised* by the cell; and the fix is a MAJOR schema bump plus a rewrite of the criteria tools and
the `propose-criteria` prompt.

### 5.3 The demo is attempted before the fixture rule is in force

Both repositories build a `relocation` example independently, and they do not agree.

Concretely: `comparanda` hand-authors a messy fixture using the missingness codes as currently
published; `rubricator`'s gold set uses the renamed codes from the ADR-0009 amendment plus the
requested `insufficient_evidence_to_discriminate`, which is the negative case of its pairwise
escalation rule. Neither document validates against the other side's schema version.

The cost is small in engineering and large in confidence: the demo fails at the boundary, and the
failure looks like an agent bug. Someone spends a day or two inside the scoring loop before anybody
diffs the two code sets. One CI check prevents it entirely.

*(Honourable mention, cheap to avoid: if `rubricator` declares a version **range** rather than a set,
a MINOR-additive `comparanda` release makes `rubricator` start emitting fields that an older
`comparanda` build silently drops on load. No error is raised anywhere, and the missing data is
discovered by a reader noticing a blank cell.)*

---

## 6. The critical path

From today — both repositories documentation-only — to a first end-to-end demo: **an agent produces
an analysis; `comparanda` renders it.**

Everything in §2.2 and §2.3 runs beside this chain. These are the links that genuinely block.

1. **`comparanda` settles the six field-shaping Tier 1 ADRs** (plus new ADR-0017, which names the
   library the schema is authored in). Blocking because they are field decisions, not opinions.
   — joining here: **`rubricator` freezes the tool surface and closes the request set** (Gate 1),
   and **`comparanda` dispositions the seven requests** (Gate 2a). This join is the only place the
   two repositories must wait on each other before the end.
2. **`comparanda` writes the zodal schema v1**, the migration harness with a registered v1, and the
   Node-only JSON Schema emission.
3. **`comparanda` hand-authors `relocation.json`** and validates it. Blocking, because it is the only
   thing that proves the schema can express the hard cases — and it is the demo's gold document.
4. **`comparanda` publishes the versioned artifact** and tags a release. **Gate 2b.**
5. **`rubricator` swaps `SketchSchema` → `PublishedSchema("1.0")`**, works the sketch/published diff,
   vendors the artifact, declares `EMITS = {"1.0"}`.
6. **`rubricator`'s `measures_write`, `analysis_validate` and `check_citations` write real cells
   against the real schema.** Everything upstream of these — corpus, search, traversal, prompts, the
   tool surface — is already finished in parallel.
7. **The connector runs end-to-end on the relocation corpus** and emits a document that validates
   with `strict=true`. *First half of the demo.*
8. **`comparanda` core loads that document** — validation plus the minimum view state. A slice of
   Phase 2, not all of it.
9. **`comparanda` view renders the matrix** with one encoding and the missingness treatment. A slice
   of Phase 3, not all of it.
10. **Demo.** Then Gate 3 turns the demo into a standing check.

Ten links, of which 1 → 2 → 3 → 4 → 5 → 6 → 7 → (8 ‖ 9) → 10 are serial.

### What shortens it

1. **Publish `1.0.0-rc` at step 4 covering only the demo's field set.** This is the single largest
   shortener. It is safe *because* of the MAJOR/MINOR split in §3.3: everything omitted is
   additive-optional and costs a MINOR bump, not a migration — provided the expensive-to-retrofit
   shapes are in the rc, namely per-assertion structure, missingness reason codes, criterion
   `preference` and `range`, and the `rounds` field. Those four are the freeze; the rest is not.
2. **Cut the demo's `comparanda` surface to a render slice.** Steps 8 and 9 are the largest optional
   bulge on the chain. A demo needs load, validate, matrix, one encoding, and missingness
   distinguishable without colour. It does not need saved views, dirty state, reorder, grouping, the
   detail panel, the blended encoding or the standalone build — all of which are Phase 2/3/5 work
   that can land after the demo without changing it.
3. **The schema sketch removes steps 1–4 from `rubricator`'s chain entirely** (§2.1). Without it,
   `rubricator`'s chain begins where `comparanda`'s ends and the whole path roughly doubles. This is
   already assumed above; it is listed because it is the assumption that would be quietly dropped
   under pressure.
4. **Hand-author the demo document before the schema code exists.** Writing `relocation.json` in the
   domain-model vocabulary is `comparanda: BRIEF.md`'s own first deliverable, and it de-risks step 2
   by finding the expressiveness problems before the zodal code is written rather than after.
5. **Run steps 8 and 9 against the hand-authored fixture, in parallel, before the agent output
   exists.** The demo decomposes into two independently demonstrable halves — *the renderer renders a
   messy analysis* and *the agent produces a valid one* — and only their join needs both repositories
   at once. Proving each half early means the join is a five-minute event rather than a debugging
   session.

### What does *not* shorten it

Starting `rubricator`'s deployed agent runtime, or `comparanda`'s standalone single-file build.
Both are real deliverables and neither is on this path. So is the CLI, and so is Phase 4
collaboration beyond what the schema already accommodates.

---

## 7. The request register

The seven requests, as filed by `rubricator`'s Phase 0 research. This table is the Gate 2a checklist;
the disposition column is filled in by `comparanda`, in the mirrored issues, and nowhere else.

| # | Request | Why it is expensive later | Disposition |
|---|---|---|---|
| 1 | Criteria carry a **structured definition** — objective, question, scale anchors, evidence rule, missing rule, exclusions — not free text | The honesty guarantee is *defined* by the criterion and only *exercised* by the cell; free text puts it at the wrong level and `criteria_set` has nowhere to validate | — |
| 2 | Criteria sets are **versioned**; every measure records the criterion version it was scored against | Without it, a redefinition mid-analysis produces columns scored against different rubrics, invisibly. Cheap now, impossible to retrofit honestly | — |
| 3 | Criteria carry **provenance**, and **rejected** criteria with reason codes ship with the analysis | The criteria-level application of the discipline the schema already applies to values and to missing cells | — |
| 4 | Assertions carry `authorKind`, `independence`, `perturbation`; analyses carry a `procedure` record; `mode` joins the reduction enum | Per-assertion, therefore the ADR-0011 migration hazard exactly. `independence` is the most important field in this table | — |
| 5 | Evidence references carry `stance` and `sourceType`, plus `derivedFrom`, `quoteHash` and a tool-written `check` | Contradicting evidence is currently unrepresentable and therefore uncountable — the most damaging citation failure available in a decision matrix | — |
| 6 | Confirm the criterion **`preference`** (direction) field | Independently required by `comparanda`'s own research (findings #4, #5): dominance and screening are undefined without a direction | — |
| 7 | A `missing` reason for `insufficient_evidence_to_discriminate` | The negative case of the pairwise escalation rule has no existing code, so it currently collapses into a catch-all — which is the thing the missingness ADR exists to abolish | — |

Requests 1, 2, 3 and 6 are criterion-shaped; 4 is assertion-shaped; 5 is evidence-shaped; 7 is a
single enum member. Only 4 and 5 carry real design weight for `comparanda`; the rest are field
additions once the shape is agreed. That distribution is worth knowing before triage starts, because
it means Gate 2a is a short meeting and two long ones, not seven long ones.

### 7.1 The eighth item, which is not a request — the missingness rename

Not in the register because `rubricator` did not ask for it: `comparanda`'s ADR-0009 amendment
(`comparanda: docs/adr/PENDING-ACTIONS.md` Tier 1 item 3) **renames two reason codes** — `pending` →
`deferred` and `unknown` → `indeterminate` — and adds `not-evidenced`, taking the core set from five
to six. It is marked `decision-needed` in `comparanda` precisely because the rename is contested.

**It is the largest un-tracked cross-repo consequence in this plan.** `rubricator` writes `pending`
and `unknown` throughout its own ADR drafts: the resume semantics of its durable-partial-analysis
ADR are keyed on `not-assessed` / `pending` / `unknown`; the honesty rule of its scales ADR is
"no citable span ⇒ `unknown`"; and two of its evaluation metrics are named for the code
(`unknown_preference_rate`, `low_confidence_laundering_rate`, and the degenerate-agent counter-metric
for an agent that always returns `unknown`). If the rename lands after `rubricator` has written those
ADRs, prompts and metric names, the cost is a prompt change and a metric rename in the companion
repo — which is exactly the cost ADR-0009's own amendment text cites as the reason to decide now.

**The rule:** the rename is settled inside Gate 2a (it is one of the six field-shaping entries), and
`rubricator` must not write a code literal into a prompt, an ADR or a metric name before that
disposition is recorded. `rubricator` carries **one issue** tracking the outcome, linked from the
`comparanda` ADR-0009 issue, whose job is to sweep the code names through its ADRs, prompts and
metric names once the rename is decided either way. Note also that the codes travel *inside* the
document with `broader` and the `structural` / `terminal` flags, so nothing in `rubricator` may
`switch` on a literal code — which is what makes the sweep a rename and not a redesign.

### 7.2 Mirror-issue keys must not collide

The mirrored `comparanda` issue for each request needs a key that is unique across the **whole**
`comparanda` roadmap, not just within the cross-repo epic. `comparanda`'s schema epic already
contains an issue keyed `schema-criterion-preference` (the implementation of the field). A mirror
issue reusing that key makes every `{{comparanda:schema-criterion-preference}}` reference from
`rubricator` ambiguous, and it will resolve to whichever the tooling saw first. Prefix the mirrors —
`request-criterion-preference`, `request-assertion-independence`, and so on — and make the
`rubricator` side's `{{comparanda:…}}` placeholders match, exactly.

---

## Related reading

- `comparanda: skills/comparanda-dev-schema-change/SKILL.md` — the schema PR checklist and the five
  before-you-add-a-field tests. This document extends its cross-repo section; it does not replace it.
- `comparanda: docs/adr/PENDING-ACTIONS.md` — the tiering. Tier 1 is Gate 2a's ADR half.
- `rubricator: docs/adr/PENDING-ACTIONS.md` — the Order table. Items 1–3 are Gate 1's ADR half.
- `rubricator: docs/research/findings-method.md` — the tool surface and the request table.
- `comparanda: docs/research/findings-terminology.md` — findings #4, #5 and #11, which are why the
  criterion `preference` request is a confirmation rather than a new ask.
