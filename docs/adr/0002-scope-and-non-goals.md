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

---

## Amendments

### 2026-08-21 — Confirmed; the scale cap earned its keep twice

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Phase 0 research confirmed this ADR without changing it. Recorded because a confirmation is a
decision, and because the confirmation came with two concrete uses that were not foreseen when the
boundary was drawn.

**The scale cap is load-bearing.** "The matrices this targets are tens to low hundreds of
alternatives, not millions" was written as a non-goal — a thing we decline to build. It turned out
to license two things instead:

1. **No virtualisation in v1** (ADR-0027). This is not a deferral; virtualisation is actively
   harmful to the accessibility properties that ADR matters most about, because `aria-rowindex` and
   `aria-colindex` change what a screen reader announces without changing navigation, and a
   recycling row renderer breaks it outright. The cap is what makes declining it honest rather than
   lazy. The documented trigger to revisit sits at roughly 500 alternatives.
2. **Optimal leaf ordering becomes affordable** (ADR-0025). OLO is O(n³) in its improved form; at a
   hundred alternatives that is on the order of 10⁶ operations, which is milliseconds. The seriation
   literature's tradeoff recommendations are calibrated against ten-thousand-object problems on a
   five-minute budget, and adopting a tradeoff recommendation without adopting the constraint that
   produced it is exactly the reflex this ADR exists to resist.

**The non-goal on aggregation has external support.** A government multi-criteria analysis manual
states the position this ADR takes about not returning "the answer", in its own voice: "In a basic
form of MCA this performance matrix may be the final product of the analysis" [1 § 4.3.2]. The
matrix as the deliverable is a recognised method, not a missing feature. ADR-0015 owns the
aggregation stance itself; this is the scope half of the same argument, and it strengthens the
non-goal rather than amending it.

Nothing in the In-scope or Explicit-non-goals lists changes.

#### References for this amendment

Full reasoning: `docs/research/findings-terminology.md` § 1 and
`docs/research/findings-visualisation.md` §§ 1.2, 4.2.

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
