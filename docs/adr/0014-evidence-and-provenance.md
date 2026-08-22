# ADR-0014: Evidence links are resolver-backed references to spans

- **Status:** accepted
- **Date:** 2026-08-18

## Context
The difference between an asserted comparison and a defensible one is whether each cell can be
traced to something. An agent-produced analysis in particular is only as trustworthy as its
citations, and "trust me, I read 1,070 documents" is not a citation.

## Decision
A value may carry zero or more **evidence references**. A reference is an opaque, typed pointer
resolved by a host-supplied `EvidenceResolver` — the core never assumes documents live anywhere in
particular.

Reference targets should identify a **span**, not merely a document: a character range, a page and
rectangle, a line range, a timestamp. Pointing at a 500-page PDF is not evidence. Prefer existing
standards over inventing a locator format — W3C Web Annotation selectors are the obvious candidate
and should be evaluated first (research brief).

Requirements:
- **Resolution is lazy.** Hovering a cell may show a cached excerpt; opening it asks the resolver
  for the full target, ideally with the span highlighted.
- **Excerpts may be embedded** so the standalone bundle can show supporting text with no network.
- **A reference can go stale**, and staleness is surfaced rather than silently rendering a dead
  link.
- **Provenance is distinct from evidence.** Provenance is *who asserted this and when*; evidence is
  *what supports it*. Both are stored; do not conflate them.

## Consequences
This is the feature that makes an analysis auditable months later, and the main reason to prefer
this tool over a spreadsheet. It also constrains `rubricator`: an agent that cannot cite a span
should be recording `unknown` rather than a confident number.

---

## Amendments

### 2026-08-21 — The detail panel is load-bearing, excerpts are content fields, and a blank can be evidenced

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Phase 0 research confirmed this ADR. The span-not-document rule and the resolver indirection both
hold up, and the instruction to evaluate W3C Web Annotation selectors first was the right one — the
`rubricator` side drafted a narrowed selector profile against it. Three notes attach. The Context
and the Decision above stand except where note 3 names a replacement; the last sentence of the
Consequences is superseded.

**1. The detail panel is an architectural constraint, not a UI preference.** Progressive disclosure
runs cell → tooltip → detail panel, and the boundary between the last two tiers is hard: a tooltip
may never contain focusable content. The ARIA Authoring Practices Guide is explicit — "Tooltip
widgets do not receive focus. A hover that contains focusable elements can be made using a
non-modal dialog" [1]. Evidence links are focusable. Therefore evidence links may never appear in a
tooltip, and the detail panel is the only accessible home for the capability that distinguishes an
agent-produced analysis from a spreadsheet. This ADR's "hovering a cell may show a cached excerpt;
opening it asks the resolver for the full target" is unchanged in substance and now carries a
constraint it did not anticipate: the hover tier may show excerpt *text* and never a link. The
tooltip must also satisfy all three legs of WCAG SC 1.4.13 — dismissible, hoverable, persistent,
with no auto-dismiss timer [2]. See ADR-0027 for the matrix semantics this sits inside.

**2. Embedded excerpts are zodal content fields.** "Excerpts may be embedded so the standalone
bundle can show supporting text with no network" gets a mechanism: model the excerpt with
`storageRole: 'content'` and let zodal's existing metadata/content bifurcation carry the split. The
standalone build then holds excerpts inline while the connected build fetches them through the
resolver, with **no change in consuming code**. This was going to be special-cased; it does not
need to be. Verified by reading `@zodal/core`, not inferred —
`docs/research/sections/c8-prior-art-and-stack.md` § on `ContentRef` / bifurcation types.

**3. A `Missing` record may carry evidence references and provenance, and the fallback code was
named wrong.** The Consequences sentence "an agent that cannot cite a span should be recording
`unknown`" is replaced. `unknown` no longer exists (ADR-0009, amended), and the code it becomes
depends on which failure occurred:

| the agent | records |
|---|---|
| searched, and the sources are silent on this criterion | `not-evidenced` |
| found material and could not resolve it to a level | `indeterminate` |

Collapsing the two destroys the more useful signal. A column of `not-evidenced` down one
alternative says the documentation is thin; a column of `indeterminate` says the criterion is not
yet operationalised, and the criteria discussion is unfinished.

Both are *findings*, and a finding is citable. **A `Missing` record therefore takes the same
evidence references and the same provenance as a scored measure.** "We searched these three sources
and none addresses migration cost" names three spans and an asserter; it is not an absence. This
follows from ADR-0009 — a blank with a reason is a stored assertion, not a null — and it is what
makes an agent's refusal to guess auditable rather than merely trusted. Provenance stays distinct from
evidence here exactly as it does for a score.

#### References for this amendment

Full reasoning: `docs/research/findings-visualisation.md` § 4.4 (note 1),
`docs/research/sections/c8-prior-art-and-stack.md` (note 2), and
`docs/research/findings-terminology.md` § 4 (note 3).

1. [ARIA Authoring Practices Guide — Tooltip Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
2. [Understanding SC 1.4.13: Content on Hover or Focus (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)

---

### 2026-08-22 — A check travels inside the document, stamped; and a quote resolves against a persisted rendition

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

Two decisions taken together, because neither is much use alone. The Decision above says a reference
"can go stale, and staleness is surfaced rather than silently rendering a dead link". It does not say
where a *verification result* lives, nor what a span indexes into once ingestion has cleaned a
document up. Both were open; both are settled here.

#### 1. The check is persisted, and it is undisplayable without its stamp

**A citation `check` is stored inside the analysis**, rather than recomputed on open and shown only
when a resolver is present.

The trade is real and was taken with it in view: a standalone bundle showing *something* against a
shared document showing something *wrong*. The common case decided it — a finished comparison is
sent to someone who has neither the corpus nor a resolver, and "we checked every quote" is a large
part of why that recipient would trust it. Recomputing-only makes the verification absent exactly
where it does the most work.

The risk does not disappear by losing the vote, so it is answered structurally:

- **`checkedAt` and `checkerVersion` are required for every status except `unchecked`**, which is
  the absence of a verdict rather than an undated one. The rule is enforced by
  `validateCitationCheck`, wired into `validateEvidence`, so it binds at the boundary rather than
  wherever someone remembers to call it. This follows the module's existing convention — zod carries
  the shape, plain functions carry the rules — and it is what keeps validation *strict on honesty
  and forgiving on completeness*: an unverified reference is a legitimate state, an **undated
  verdict** is not.
- **Every non-current standing carries a caveat, and the view contract may not render one as
  current.** `checkStanding` returns `unchecked | current | older-checker | aged` with a
  `needsCaveat` flag. Version mismatch outranks recency: a check run one second ago by the previous
  checker is `older-checker`, because what changed is the thing doing the checking.
- **Recomputation always supersedes.** Where a resolver is present the live result wins and the
  stored one is replaced. Persisted is the floor, not the ceiling.
- **`now` is a parameter, never a hidden clock**, so a bundle rendered twice from the same inputs
  renders identically.

**There is deliberately no default age threshold.** An expiry variant — render a check as absent once
it is older than some age — was considered and rejected: it removes the misleading-verdict risk by
going blind, with no way for the recipient to refresh, and the age is a number nobody can justify.
Age is always *reported* and only *acted on* when a caller supplies `staleAfterDays` and owns that
choice.

#### 2. A span indexes into a persisted normalised rendition, with the original fingerprinted

Ingestion normalises documents — strips navigation, rejoins hyphenated lines, collapses whitespace.
A character range therefore indexes the *cleaned* text and not the file a reader opens, which is the
uncheckable citation this ADR exists to forbid. Two options were live. **We keep our own cleaned
rendition, cite into it, and store the original's locator together with a content hash of the
original.**

- **What it buys.** Every quote in an analysis resolves — offline, indefinitely, whether or not the
  original still exists at its locator. It is the only option under which "a citation nobody can
  check is not a citation" survives a source that moves, changes or 404s.
- **What it costs.** A second copy of every ingested document: storage, and a redistribution
  question for anything not freely licensed. And the link a reader follows is to our rendition, with
  the original as a secondary link.
- **Why not an offset map back to the original.** When the original is edited or re-fetched, every
  offset is silently wrong — pointing confidently at the wrong sentence, which is worse than not
  citing at all.

**The hash is not decoration; it is what makes drift visible.** Three standings, all three of which
must render distinctly, and the middle one is the one that will actually occur:

| rendition | original hash | what the reader is told |
|---|---|---|
| resolves | matches | checkable and current |
| resolves | **differs** | checkable **against what we ingested**; the source has changed since |
| missing | — | not resolvable here, and *why* — never a bare "unverified" |

**This costs no new selector type.** `TextPositionSelector` already indexes the rendition, and
`TextQuoteSelector` with prefix and suffix is already stored beside it — the multi-selector design
this ADR adopted from the W3C model is exactly what lets a quote be re-found by content when the
rendition is unavailable. That fallback resolver is **additive later**, not required now.

#### Consequence for `rubricator`

The Consequences above already constrain it. Two further constraints follow, and its ADR-0014 is
amended to match: an ingestion step that normalises a document **must persist the rendition it
produced**, and a stored check that reaches a delivered analysis **must carry its stamp**. A
rendition that exists only inside a run is a citation that only its author can check.

*(The Consequences paragraph above says an agent that cannot cite a span "should be recording
`unknown`". Read that as ADR-0009's current vocabulary: **`not-evidenced`** where the sources were
consulted and are silent, **`indeterminate`** where material was found and does not resolve to a
level.)*

Closes #66.

### 2026-08-22 — The rendition is addressable, and the verdict vocabulary has one spelling

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The amendment above settles both halves as *policy*: a check is persisted and stamped, and a span
indexes into a persisted normalised rendition with the original fingerprinted. Neither has fields
yet, and one existing name is wrong. Four decisions follow; nothing above is reversed.

**1. A `Rendition` is a first-class record, and a reference names one.**

    Rendition { id, originalLocator, originalSha256, normaliserId, retrievedAt, content }
    EvidenceRef.renditionId?: string

`originalSha256` is the drift detector of the three-standing table above; the rendition's **own
address** is what a `TextPositionSelector` indexes into. They are deliberately two hashes — one
answers "has the source changed since we ingested it", the other answers "what exactly do these
offsets point at" — and a single hash cannot answer both. Without `renditionId` on the reference,
the table above has no way to say *which* rendition resolved, which is the difference between a
standing and a guess.

`normaliserId` travels **onto the reference**, not only onto the rendition, because a stored verdict
computed under one normaliser is not reproducible under another, and a verdict that is not
reproducible is not a verdict.

**2. `quoteHash` is renamed `excerptHash`, and this is a correction rather than a preference.** The
field hashes *our stored excerpt* — a third thing, distinct from both the original document and the
quote as it appears in the rendition. Called `quoteHash` it reads as the hash of the thing a reader
would re-find, which is the one thing it is not, and a checker written against the name rather than
against the code will check the wrong string. Renaming costs an edit before the freeze and a
migration after it.

**3. The check verdict vocabulary has three live spellings, and one is accepted.** This repository
ships `verified | not-found | drifted | unchecked | unresolvable`. `rubricator` publishes
`verified | normalised | partial | not-found | empty` — **pinned green by doctests running under
`--doctest-modules`, so its CI currently enforces a contract this repository never agreed to.** And
`rubricator`'s own ADR-0014 mandates a third: `exact | normalised | fuzzy | moved | stale |
unresolvable`, retiring the word `verified` outright.

**The third is the accepted spelling**, on the reasoning already recorded there: it distinguishes an
exact match from a normalisation-tolerant one — which is the difference between a citation and a
paraphrase — and it splits our `drifted` into the two cases the amendment above already requires the
reader be told apart: `moved` (the rendition resolves, the original hash differs) and `stale` (the
rendition is missing). `unchecked` is retained beside them: it is the absence of a verdict, which is
why the amendment above exempts it from the stamp requirement, and it is not a rung.

`verified` is **retired and reserved for nothing** in both repositories. Reconciling before the
freeze costs an enum edit; reconciling after costs a migration plus a period in which two systems
disagree about what "checked" means, which is the failure this ADR exists to prevent.

**4. `validateCitationCheck`'s problems are the honesty family.** The shipped rule is right and
correctly placed — zod carries the shape, plain functions carry the rules, and requiredness is
enforced there rather than by making the fields non-optional, which would break `unchecked`. Under
ADR-0031 its output is `family: 'honesty'`, so an undated verdict is a **rejection** rather than a
note, which is what the amendment above means by "an unverified reference is a legitimate state, an
undated verdict is not". The classification is not a new rule; it is where the existing rule's
severity stops being a per-call-site choice.

**5. The requirement that a caveat be rendered is a test obligation, not an aspiration.** The
amendment above says "the view contract may not render a non-current standing as current".
`checkStanding` ships and nothing consumes it, because the view is a placeholder — so the
requirement is recorded here as an obligation on **the first component that renders a check**: a
test that fails if `checkStanding().needsCaveat` is true and no caveat appears. Recorded now so it
cannot later be discovered as a missing feature rather than a broken promise.

There is still **no default age threshold**, for the reason already given: expiring a check on an
age nobody can justify goes blind, with no way for a recipient to refresh. `staleAfterDays` is
supplied by a caller who owns that choice.
