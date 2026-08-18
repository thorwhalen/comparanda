# ADR-0009: Absence is qualified and visually distinct

- **Status:** accepted
- **Date:** 2026-08-18

## Context
In every comparison table that matters, some cells are empty, and the reasons are not
interchangeable. "Does not apply" and "nobody has checked" look identical in a spreadsheet and
mean opposite things about whether the analysis is finished.

## Decision
No bare nulls. Every absence carries a reason code from a closed, schema-declared set. The initial
set — `not-applicable`, `not-assessed`, `pending`, `unknown`, `withheld` — is defined in
[../domain-model.md](../domain-model.md), and analyses may extend it.

Requirements:
- **Structural vs contingent absence is queryable.** "What is left to do here" must be answerable,
  which means `not-applicable` is excluded from completeness counts and the others are not.
- **The view distinguishes them**, and not by colour alone — a hatch, a glyph, an empty cell with a
  rule. `not-applicable` should read as "correctly nothing"; `not-assessed` should read as a gap.
- **An agent can be instructed to leave cells blank with a reason.** "Fill Pain and Market for all
  alternatives, mark everything else `pending`" is a supported instruction, and the resulting
  document is valid and complete-as-specified rather than half-broken.
- **Completeness is reportable** at analysis, row, column and group level.

## Consequences
Slightly heavier authoring, and worth it. The alternative — a nullable value — pushes the
distinction into a comment field where it cannot be counted or filtered.
