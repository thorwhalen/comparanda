# ADR-0015: Optional analyses, and no aggregate score by default

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Every comparison tool eventually grows a "total" column, and it is almost always the least
defensible number on the page: it averages ordinal ratings (a category error, ADR-0003), it hides
the shape of a row, and it invites the reader to stop thinking. Two alternatives averaging 3.4 can
be entirely different bets — one flat, one a pair of 5s and a pair of 1s that make it unbuildable.

There are, however, genuinely useful non-aggregating analyses that this data supports.

## Decision
**No aggregate score is computed or displayed by default.** Aggregation is available, opt-in, and
always labelled with its method and its assumptions.

Ship these analyses, all optional and all clearly named:

- **Dominance / Pareto filtering.** Which alternatives are dominated — worse or equal on every
  criterion — and can be set aside without any weighting at all. This is the strongest defensible
  reduction available and requires no value judgements.
- **Veto screening.** Criteria may be marked as vetoes with a threshold; falling below it flags the
  alternative regardless of other scores. This matches ELECTRE's veto thresholds and reflects how
  people actually reason ("if we can't reach the buyer, the market size is irrelevant").
- **Seriation** (ADR-0008), as an analysis and not only an interaction.
- **Sensitivity analysis.** If weights *are* used: how much must a weight move before the ranking
  changes? A ranking that flips under a 5% weight change is not a ranking.
- **Agreement statistics** where multi-rater data exists (ADR-0011).
- **Completeness reporting** (ADR-0009).
- **Weighted aggregation**, opt-in, with the method named (weighted sum, TOPSIS, AHP, …) and with a
  warning when applied to ordinal data.

Every analysis states its assumptions in the UI at the point of use, not in documentation
elsewhere.

## Consequences
The default presentation asks more of the reader, which is the point. The risk is that users want a
number and go elsewhere to get one; mitigate by making dominance filtering and veto screening
prominent, since they answer "which can I stop considering" — the question a total is usually a
poor proxy for.
