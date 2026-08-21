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
