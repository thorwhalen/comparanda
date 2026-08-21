# Architecture Decision Records

**Read them in numeric order for the history; read them by theme for orientation.** The numbers
record when a decision was taken and nothing else, so a first-time reader following 0001 → 0029
learns how the project arrived where it is, while a reader who needs to know *what is true now
about missingness* is better served by the grouping below. Both routes cover the same thirty files.

Every ADR here is **accepted**. Nothing is superseded, nothing is still proposed. Several carry
dated **Amendments** — additive sections that extend or correct a Decision without rewriting it,
per ADR-0001. Where an amendment and the original Decision disagree, the amendment wins and says
so explicitly.

`0000-template.md` is the blank form, not a decision.

Companion reading: [`../../BRIEF.md`](../../BRIEF.md) for what the project is,
[`../domain-model.md`](../domain-model.md) for the vocabulary in full,
[`../cross-repo-coordination.md`](../cross-repo-coordination.md) for the contract with `rubricator`,
and [`../research/`](../research/) for the evidence the 2026-08-21 amendments rest on.

---

## Foundations — process, scope, vocabulary

The four documents that decide what kind of thing this is and what words it uses.

| # | Title | Status | Decides |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted | Nygard-format ADRs, immutable once accepted; change direction with a new file, never a quiet edit. |
| [0002](0002-scope-and-non-goals.md) | Scope and non-goals | accepted | Not a spreadsheet, not a BI tool, not a decision engine; matrices of tens to low hundreds of alternatives — a cap that later licenses no-virtualisation and affordable seriation. |
| [0003](0003-domain-model-and-terminology.md) | Adopt MCDA terminology, and separate measures from encodings | accepted | **alternatives / criteria / subject**; stored **measures** vs derived **encodings**; a level of measurement on every value. The grid is a *performance matrix*, displayed by default as "options". |
| [0016](0016-public-repo-hygiene.md) | Public repository — no proprietary content | accepted | No content from the originating private analysis anywhere, ever; examples come from public self-explanatory domains, and at least one is deliberately messy. No ADR quotes a source that could not be reached. |

## The schema — what a cell is allowed to say

The data contract, and the several different ways a cell can be non-empty, empty, or empty *on purpose*.

| # | Title | Status | Decides |
|---|---|---|---|
| [0004](0004-schema-first-with-zodal.md) | Schema-first, on zodal, with the schema as the public contract | accepted | The schema is the principal export and carries affordances, not just shapes; JSON Schema is emitted as a Node-only build step so the browser never pays for it. |
| [0009](0009-missingness.md) | Absence is qualified and visually distinct | accepted | No bare nulls. Six core reason codes — `not-applicable`, `not-assessed`, `deferred`, `not-evidenced`, `indeterminate`, `withheld` — each a flagged, parented object; completeness keys on the `structural` flag, never on a literal code. |
| [0018](0018-preference-range-and-thresholds.md) | Criteria carry a direction of preference, a declared range, and optional thresholds | accepted | `preference` (`increasing`/`decreasing`/`target`/`ordered`/`none`), a required `range` on ordered levels, and optional `indifference` (`q`) / `preferenceThreshold` (`p`). Aggregation refuses to run without a declared range. |
| [0020](0020-two-kinds-of-weight.md) | Two kinds of weight, never one field | accepted | `substitutionWeight` ships, `votingWeight` is reserved; there is no `weight` field, and a substitution weight without a range is invalid at the boundary. |
| [0021](0021-disclosure-is-orthogonal-to-presence.md) | Disclosure is orthogonal to presence | accepted | Redaction is a view-time **projection**, never an edit, applied where the analysis crosses to the reader — and every analysis reports how many cells were widened by it. |
| [0014](0014-evidence-and-provenance.md) | Evidence links are resolver-backed references to spans | accepted | Cite a span, not a document; resolution is lazy and host-supplied; provenance stays distinct from evidence, and a qualified blank is itself citable. |

## Architecture, packaging and deployment

How the code is divided, what it is built on, and how the same view serves an offline HTML file and a live server.

| # | Title | Status | Decides |
|---|---|---|---|
| [0005](0005-headless-core-vs-view.md) | Headless core, separate view, one package with subpath exports | accepted | One npm package with `core` / `view` / `react` / `store` subpaths; the boundary is four CI checks, not an intention. Verified: do not split the package. |
| [0017](0017-stack-preact-zod-mini-explicit-registries.md) | Preact for the view, `zod/mini` for the schema, explicit registries | accepted | Raw bytes govern a mailed file, so Preact and `zod/mini`; registries are populated explicitly by the composition root because self-registering modules are provably deleted by the bundler. |
| [0006](0006-persistence-stores-and-view-state.md) | Persistence through zodal stores, with a notified in-memory fallback | accepted | Every port is a `DataProvider<T>`; the analysis and view state are degenerate one-item providers; `getCapabilities()` is the single source of truth for what the UI offers. |
| [0013](0013-standalone-and-connected.md) | One view, two deployment shapes, adapters as the only difference | accepted | Injected ports are the only difference between standalone and connected; the single-file build carries a CSP whose `connect-src 'none'` makes zero-network a property the browser enforces, checked in `comparanda build`. |
| [0012](0012-identity.md) | Identity is an injected adapter with a usable anonymous default | accepted | The host asserts identity; `comparanda` authenticates nobody and invents no permission model. Agent runs are identities too, and must be distinguishable from humans at a glance. |

## View state — order, grouping, saved views

Arranging the matrix is the work; these decide what an arrangement is, who owns it, and how it is saved.

| # | Title | Status | Decides |
|---|---|---|---|
| [0007](0007-saved-views-and-dirty-state.md) | Saved views are named snapshots with explicit, visible dirty state | accepted | No autosave; dirty state is the *set* of differing dimensions with per-dimension revert; views may be personal, shared or locked; a `ViewSequence` is an ordered list of saved views and nothing more. |
| [0008](0008-reordering-grouping-selection.md) | Reordering is seriation; selection is view state, groups are data | accepted | Groups are authored data, selection and order are per-user view state; grouping is many-to-many on `@zodal/groups-core`; the keyboard-and-menu reorder path is primary and pointer drag is a thin second path. |
| [0025](0025-seriation.md) | Seriation — algorithm, distance, and missingness policy | accepted | Optimal leaf ordering over a missingness-aware Gower distance, per axis, linkage chosen by measurement; pins are *inputs* to the run; view state stores an explained `AxisOrder`, never a bare permutation. |

## Encodings and the view roster

How a measure becomes ink, and which pictures earn their place beside the matrix.

| # | Title | Status | Decides |
|---|---|---|---|
| [0010](0010-encodings-and-uncertainty.md) | Encodings are pluggable; uncertainty is encoded, not annotated | accepted | Eight registered encodings, a parameterised value-suppressing palette with an ordinal merge tree, suppression toward the theme surface rather than white, and contrast gated on WCAG at build time. |
| [0024](0024-disagreement-rater-dot-strip.md) | The disagreement encoding is a rater dot strip | accepted | One dot per assertion on the criterion's levels — no mark ever sits where a mean would be; `disagreement-spread` is the zoom-out ramp and `consensus-suppressed` a re-parameterisation. |
| [0026](0026-views-shipped-and-declined.md) | Views shipped in v1, and the ones deliberately declined | accepted | Five views ship, each repairing a named weakness of the matrix. Parallel coordinates deferred; radar declined outright on three arguments a caveat cannot fix. |

## Analyses, and what the tool refuses to compute

The half of the product that is a refusal.

| # | Title | Status | Decides |
|---|---|---|---|
| [0015](0015-analyses-and-no-default-aggregation.md) | Optional analyses, and no aggregate score by default | accepted | No total column; aggregation is opt-in, labelled, and gated on weight coverage. Ships dominance, conjunctive screening (`acceptability`), seriation, sensitivity, agreement, completeness, value-of-information and the Pugh datum tally — with no net. |
| [0019](0019-dominance-over-incomplete-data.md) | Dominance semantics over incomplete and mixed-level data | accepted | Necessary/possible dominance over interval completions against a fixed comparison basis; the common-dimensions rule is forbidden as non-transitive; three result tiers, and the middle one is the product. |
| [0022](0022-agreement-statistics.md) | Agreement statistics — unit of analysis, and no threshold ever gates | accepted | Krippendorff's alpha per criterion over alternatives as units, always with an interval; per cell report the shape, not a coefficient; no threshold gates anything and no matrix-wide number is legal. |

## Collaboration

A comparison is argued over, not obeyed.

| # | Title | Status | Decides |
|---|---|---|---|
| [0011](0011-collaboration.md) | Collaboration — annotations, multi-rater values, and disagreement as a finding | accepted | Annotations anchor to stable opaque ids at every scope; every rater assertion is retained; deleting a criterion never deletes the argument about whether it should exist. |
| [0023](0023-rounds-attribution-and-feedback.md) | Rounds, attribution policy and feedback policy | accepted | An optional `round` on every assertion with `attribution` and `feedback` policies; the author is always stored and the view redacts until the round closes. Stopping is a stability trace, never a threshold. |

## Accessibility

Three ADRs, on the premise that accessibility is not a later pass.

| # | Title | Status | Decides |
|---|---|---|---|
| [0027](0027-matrix-accessibility-semantics.md) | Matrix accessibility semantics | accepted | A real `<table role="grid">` with roving `tabindex`, no virtualisation in v1, sticky headers with scroll padding, and a three-tier disclosure whose tooltip boundary forces the detail panel into Phase 3. |
| [0028](0028-non-colour-channels.md) | Non-colour channels — texture, forced colors, print | accepted | Every meaning-bearing non-colour channel is foreground SVG, never a background image; hatch density and glyph shape are the two channels and neither does the other's job. |
| [0029](0029-accessibility-acceptance-criteria.md) | Accessibility acceptance criteria | accepted | A1–A20 are a merge gate, B1–B8 a release gate recorded in the release notes; axe-core is the floor, not the value. |
