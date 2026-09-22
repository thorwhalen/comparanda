# Architecture Decision Records

**Read them in numeric order for the history; read them by theme for orientation.** The numbers
record when a decision was taken and nothing else, so a first-time reader following 0001 → 0033
learns how the project arrived where it is, while a reader who needs to know *what is true now
about missingness* is better served by the grouping below. Both routes cover the same thirty-three
files.

Every ADR here is **accepted**. Nothing is superseded, nothing is still proposed. Several carry
dated **Amendments** — additive sections that extend or correct a Decision without rewriting it,
per ADR-0001. Where an amendment and the original Decision disagree, the amendment wins and says
so explicitly.

`0000-template.md` is the blank form, not a decision.

Companion reading: [`../../BRIEF.md`](../../BRIEF.md) for what the project is,
[`../domain-model.md`](../domain-model.md) for the vocabulary in full,
[`../cross-repo-coordination.md`](../cross-repo-coordination.md) for the contract with `rubricator`,
and [`../research/`](../research/) for the evidence the 2026-08-21 amendments rest on. The
2026-08-22 amendments — which touch ADRs 0003, 0004, 0006, 0009, 0010, 0011, 0012, 0014, 0015, 0018,
0020 — rest on nine decisions settled by the owner on that date and on reads of the shipped code;
ADRs 0030–0032 are the new decisions those settlements required, and 0033 corrects a framing 0016 got wrong.

---

## Foundations — process, scope, vocabulary

The four documents that decide what kind of thing this is and what words it uses.

| # | Title | Status | Decides |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted | Nygard-format ADRs, immutable once accepted; change direction with a new file, never a quiet edit. ADRs 0002–0029 are pre-implementation specification; 0030–0032 were taken against a partly-built schema and say so. |
| [0002](0002-scope-and-non-goals.md) | Scope and non-goals | accepted | Not a spreadsheet, not a BI tool, not a decision engine; matrices of tens to low hundreds of alternatives — a cap that later licenses no-virtualisation and affordable seriation. |
| [0003](0003-domain-model-and-terminology.md) | Adopt MCDA terminology, and separate measures from encodings | accepted | **alternatives / criteria / subject**; stored **measures** vs derived **encodings**; a level of measurement on every value. The grid is a *performance matrix*, displayed by default as "options". |
| [0016](0016-public-repo-hygiene.md) | Public repository — no proprietary content | **superseded by [0033](0033-example-domains-are-invented-not-sanitised.md)** | Its rule was right and its framing was not: it described the package as originating from one private analysis and derived a denylist from that. Kept readable as the question that was asked. |

## The schema — what a cell is allowed to say

The data contract, and the several different ways a cell can be non-empty, empty, or empty *on purpose*.

| # | Title | Status | Decides |
|---|---|---|---|
| [0004](0004-schema-first-with-zodal.md) | Schema-first, on zodal, with the schema as the public contract | accepted | The schema is the principal export and carries affordances, not just shapes; JSON Schema is emitted as a Node-only build step so the browser never pays for it. **Amended:** the contract is *two* artifacts — the shape, and the core member set of every open vocabulary — and neither has ever been emitted. |
| [0009](0009-missingness.md) | Absence is qualified and visually distinct | accepted | No bare nulls. Six core reason codes — `not-applicable`, `not-assessed`, `deferred`, `not-evidenced`, `indeterminate`, `withheld` — each a flagged, parented object; completeness keys on the `structural` flag, never on a literal code. **Amended:** `informative` is load-bearing (`silenceRate` keys on it), declarations may be overlaid at criterion scope, and every consumer reaches the set through one facade. |
| [0018](0018-preference-range-and-thresholds.md) | Criteria carry a direction of preference, a declared range, and optional thresholds | accepted | `preference` (`increasing`/`decreasing`/`target`/`ordered`/`none`, where `ordered` is order *without* a direction of preference), a required `range` on ordered levels, and optional `indifference` (`q`) / `preferenceThreshold` (`p`). Aggregation refuses to run without a declared range. **Amended:** a measurement may *name* its scale (optional, never defaulted) and carry an anchor set that stores which levels the scale itself requires. |
| [0020](0020-two-kinds-of-weight.md) | Two kinds of weight, never one field | accepted | `substitutionWeight` ships, `votingWeight` is reserved; there is no `weight` field, and a substitution weight without a range is invalid at the boundary. |
| [0021](0021-disclosure-is-orthogonal-to-presence.md) | Disclosure is orthogonal to presence | accepted | Redaction is a view-time **projection**, never an edit, applied where the analysis crosses to the reader — and every analysis reports how many cells were widened by it. |
| [0030](0030-declarations-resolution-and-reported-degradation.md) | Extensible vocabularies — one declaration shape, one resolver, and reported degradation | accepted | Missingness codes, reductions and scales all take one shape: a closed core, an open string at the point of use, a declaration in the document naming a `broader` parent. Reading an unknown id degrades and **records** it; authoring one raises. A degradation is a fact about the build and is never stored. |
| [0031](0031-boundary-validation-honesty-and-completeness.md) | Boundary validation — two rule families | accepted | Every problem declares a `family`, and the family decides the severity. Honesty rejects and **can never be suppressed**; completeness informs and is what `strict=false` drops. `fix` and `ruleId` are required; rules are injected because write-time and on-demand validation compose differently. |
| [0014](0014-evidence-and-provenance.md) | Evidence links are resolver-backed references to spans | accepted | Cite a span, not a document; resolution is lazy and host-supplied; provenance stays distinct from evidence, and a qualified blank is itself citable. **Amended:** a check is persisted and undisplayable without its stamp; a span indexes a persisted rendition with the original fingerprinted; one verdict vocabulary, and `verified` is retired. |

## Architecture, packaging and deployment

How the code is divided, what it is built on, and how the same view serves an offline HTML file and a live server.

| # | Title | Status | Decides |
|---|---|---|---|
| [0005](0005-headless-core-vs-view.md) | Headless core, separate view, one package with subpath exports | accepted | One npm package with `core` / `view` / `react` / `store` subpaths; the boundary is four CI checks, not an intention. Verified: do not split the package. |
| [0017](0017-stack-preact-zod-mini-explicit-registries.md) | Preact for the view, `zod/mini` for the schema, explicit registries | accepted | Raw bytes govern a mailed file, so Preact and `zod/mini`; registries are populated explicitly by the composition root because self-registering modules are provably deleted by the bundler. |
| [0006](0006-persistence-stores-and-view-state.md) | Persistence through zodal stores, with a notified in-memory fallback | accepted | Every port is a `DataProvider<T>`; the analysis and view state are degenerate one-item providers; `getCapabilities()` is the single source of truth for what the UI offers. **Amended:** v1 builds one of the five ports, and `multiWriter` may be true only where `perContributorFiles` is. |
| [0013](0013-standalone-and-connected.md) | One view, two deployment shapes, adapters as the only difference | accepted | Injected ports — `AnalysisSource` and its siblings — are the only difference between standalone and connected; the single-file build carries a CSP whose `connect-src 'none'` makes zero-network a property the browser enforces, checked in `comparanda build`. |
| [0012](0012-identity.md) | Identity is an injected adapter with a usable anonymous default | accepted | The host asserts identity; `comparanda` authenticates nobody and invents no permission model. Agent runs are identities too, and must be distinguishable from humans at a glance. **Amended:** a persona is its own `Author` carrying an opaque `principalId` — never anonymity, never an independence rung. |

## View state — order, grouping, saved views

Arranging the matrix is the work; these decide what an arrangement is, who owns it, and how it is saved.

| # | Title | Status | Decides |
|---|---|---|---|
| [0007](0007-saved-views-and-dirty-state.md) | Saved views are named snapshots with explicit, visible dirty state | accepted | No autosave; dirty state is the *set* of differing **arrangement** dimensions with per-dimension revert — derivation and session fields are excluded by class; views may be personal, shared or locked; a `ViewSequence` is an ordered list of saved views and nothing more. |
| [0008](0008-reordering-grouping-selection.md) | Reordering is seriation; selection is view state, groups are data | accepted | Groups are authored data, selection and order are per-user view state; grouping is many-to-many on `@zodal/groups-core`; the keyboard-and-menu reorder path is primary and pointer drag is a thin second path. |
| [0025](0025-seriation.md) | Seriation — algorithm, distance, and missingness policy | accepted | Optimal leaf ordering over a missingness-aware Gower distance, per axis, linkage chosen by measurement; pins are *inputs* to the run; view state stores an explained `AxisOrder`, never a bare permutation. |

## Encodings and the view roster

How a measure becomes ink, and which pictures earn their place beside the matrix.

| # | Title | Status | Decides |
|---|---|---|---|
| [0010](0010-encodings-and-uncertainty.md) | Encodings are pluggable; uncertainty is encoded, not annotated | accepted | Eight registered encodings, a parameterised value-suppressing palette with an ordinal merge tree, suppression toward the theme surface rather than white, and contrast gated on WCAG at build time. **Amended:** the roster is nine; palette arity derives from the resolved scale rather than a fixed level count. |
| [0024](0024-disagreement-rater-dot-strip.md) | The disagreement encoding is a rater dot strip | accepted | One dot per assertion on the criterion's levels — no mark ever sits where a mean would be; `disagreement-spread` is the zoom-out ramp over `(1 − A) / 2` and `consensus-suppressed` a re-parameterisation. |
| [0032](0032-text-only-encoding-and-the-matrix-props-contract.md) | `text-only` is v1's encoding, and `MatrixProps` ships before the matrix | accepted | A ninth encoding with no palette, therefore no arity, therefore no scale assumption — correct under a declared scale and accessible by construction. `MatrixProps` is published before the matrix component exists so the first consumer's interim table is deletable rather than refactorable; `standing` is injected so the view owns no clock. |
| [0033](0033-example-domains-are-invented-not-sanitised.md) | Example domains are invented, not sanitised — and the denylist is withdrawn | accepted | Supersedes 0016. This is a general tool that a private study *motivated*, not a sanitised derivative of one, and a denylist would have had to cover every engagement its author has ever run. The rule is kept and generalised — nothing from **any** private engagement, and examples are **invented** rather than anonymised, because an anonymised matrix keeps a shape that identifies. Where an example names a real third party it carries only factual, cited, dated claims and no subjective score. |
| [0026](0026-views-shipped-and-declined.md) | Views shipped in v1, and the ones deliberately declined | accepted | Five views ship, each repairing a named weakness of the matrix. Parallel coordinates deferred; radar declined outright on three arguments a caveat cannot fix. |

## Analyses, and what the tool refuses to compute

The half of the product that is a refusal.

| # | Title | Status | Decides |
|---|---|---|---|
| [0015](0015-analyses-and-no-default-aggregation.md) | Optional analyses, and no aggregate score by default | accepted | No total column; aggregation is opt-in, labelled, and gated on weight coverage. Ships dominance, conjunctive screening (`acceptability`), seriation, sensitivity with SMAA `rankShare`, agreement, completeness, value-of-information and the Pugh datum tally — with no net. |
| [0019](0019-dominance-over-incomplete-data.md) | Dominance semantics over incomplete and mixed-level data | accepted | Necessary/possible dominance over interval completions against a fixed comparison basis; the common-dimensions rule is forbidden as non-transitive; three result tiers, and the middle one is the product. |
| [0022](0022-agreement-statistics.md) | Agreement statistics — unit of analysis, and no threshold ever gates | accepted | Krippendorff's alpha per criterion over alternatives as units, always with an interval; per cell report the shape, not a coefficient; no threshold gates anything and no matrix-wide number is legal. |

## Collaboration

A comparison is argued over, not obeyed.

| # | Title | Status | Decides |
|---|---|---|---|
| [0011](0011-collaboration.md) | Collaboration — annotations, multi-rater values, and disagreement as a finding | accepted | Annotations anchor to stable opaque ids at every scope; every rater assertion is retained and declares its `independence`; deleting a criterion never deletes the argument about whether it should exist. **Amended:** the team is in v1; `Reduction` becomes a declared vocabulary; a cell key must be unique and a merge refuses rather than resolves. |
| [0023](0023-rounds-attribution-and-feedback.md) | Rounds, attribution policy and feedback policy | accepted | An optional `round` on every assertion with `attribution` and `feedback` policies; the author is always stored and the view redacts until the round closes. Stopping is a stability trace, never a threshold. |

## Accessibility

Three ADRs, on the premise that accessibility is not a later pass.

| # | Title | Status | Decides |
|---|---|---|---|
| [0027](0027-matrix-accessibility-semantics.md) | Matrix accessibility semantics | accepted | A real `<table role="grid">` with roving `tabindex`, no virtualisation in v1, sticky headers with scroll padding, and a three-tier disclosure whose tooltip boundary forces the detail panel into Phase 3. |
| [0028](0028-non-colour-channels.md) | Non-colour channels — texture, forced colors, print | accepted | Every meaning-bearing non-colour channel is foreground SVG, never a background image; hatch density carries confidence in a valued cell, and figure/ground, glyph shape and border style carry `structural`, the reason and `terminal` in a missing one. |
| [0029](0029-accessibility-acceptance-criteria.md) | Accessibility acceptance criteria | accepted | A1–A20 are a merge gate, B1–B8 a release gate recorded in the release notes; axe-core is the floor, not the value. |
