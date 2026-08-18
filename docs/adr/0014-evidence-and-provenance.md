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
