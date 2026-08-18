# ADR-0002: Scope and non-goals

- **Status:** accepted
- **Date:** 2026-08-18

## Context
"A tool for comparing things" expands without limit. It can become a spreadsheet, a BI product, a
project tracker, or a decision-automation engine, and each of those has swallowed a project like
this before.

## Decision

**In scope.**
- A schema for a comparison: subject, alternatives, criteria, measures, values, missingness,
  groups, provenance, annotations.
- A view over that schema: reorderable, groupable, selectable, annotatable, with pluggable
  encodings.
- Persistence of both the analysis and the *view state* (order, grouping, selection, saved views).
- Two deployment shapes: a self-contained standalone bundle, and a connected mode with adapters.
- Collaboration: comments, annotations, multi-rater values, edit attribution.
- A small set of optional, clearly-labelled analyses (dominance filtering, seriation, agreement).

**Explicit non-goals.**
- Not a spreadsheet: no inter-cell formulas, no cell references, no expression language.
- Not a BI tool: no warehouse connectors, no aggregation over large row counts. The matrices this
  targets are tens to low hundreds of alternatives, not millions.
- Not a decision engine: it does not return "the answer". Aggregation is offered as a lens and is
  never the default presentation.
- Not a document store: evidence links point outward through resolvers; documents live elsewhere.
- Not a real-time collaborative editor in v1: no operational transform, no CRDT, no live cursors.
  See ADR-0011 for the concurrency stance actually taken.

## Consequences
The non-goals are the load-bearing half. When a feature request arrives, the first question is
which non-goal it violates. Scope creep here would be gradual and each step defensible, which is
exactly why the boundary is written down before any code exists.
