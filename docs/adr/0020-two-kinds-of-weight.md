# ADR-0020: Two kinds of weight, never one field

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
"Weight" names two different quantities in the multi-criteria literature, and they are not variants
of each other.

A **substitution weight** belongs to compensatory aggregation — weighted sum and its relatives. It
is a scaling constant that says how much of one criterion's swing buys how much of another's, and it
is defined only relative to the declared range each criterion swings across. Elicited without a
range in mind it is not a scaling constant at all but a bare statement of importance, which is the
trade-off mistake Keeney names [1]; the aggregate computed from it is arbitrary.

A **voting weight** belongs to outranking — ELECTRE and its relatives. It is voting power in a
concordance test: how much of the criteria set supports the claim that one alternative is at least
as good as another. It is deliberately *not* a rate of exchange, and it is independent of the range
and the encoding of the scale it sits on [2]; that independence is the point, because outranking
exists to avoid compensation. Consumed as a substitution weight in a weighted sum it delivers
exactly the full compensation its elicitation refused.

Two quantities, two elicitation procedures, two failure modes, one English word. ADR-0015 ships
weighted aggregation as an opt-in analysis, so this repository will carry at least one of them.
Naming costs nothing now and costs a migration through every stored analysis later.

## Decision
Name them separately in the schema. There is no `weight` field.

- Ship **`substitutionWeight`** now, and only it. The name is explicit from the first release so
  that **`votingWeight`** can be added later as a new field rather than as a migration.
- **A `substitutionWeight` on a criterion with no declared `range` (ADR-0018) is invalid.** This is
  a validation rule enforced at the schema boundary, not advice in a tooltip and not a warning at
  aggregation time. The weight is meaningless without the range, so the document that carries it is
  malformed.
- `votingWeight`, when it exists, carries no range dependency, because voting power does not have
  one.
- If weights are ever elicited **in the product**, elicit them from choices, not from numbers: put
  the user in front of pairwise trade-offs between hypothetical alternatives and derive the weights,
  as PAPRIKA does [3]. A slider labelled "importance" collects the wrong quantity confidently.

## Consequences
One more word to type, and it becomes impossible to elicit one quantity and consume it as the other
— which a single `weight` field guarantees somebody eventually does, silently, producing a ranking
that looks entirely plausible. Nothing about that failure shows up in a test.

The costs are real but small. `votingWeight` is a name in the vocabulary with no code behind it, and
ADR-0015 declines outranking methods, so it stays reserved rather than shipped; a reserved name that
never gets used is cheaper than the migration it insures against. And the validation rule makes
ADR-0018's declared range a hard precondition for weighted aggregation rather than a soft one, which
means a criterion authored without a range cannot be weighted at all until somebody declares one.
That is the intended pressure.

## Alternatives considered
- *A single `weight` field.* The failure mode is silent and produces a plausible ranking. Rejected.
- *One field plus a `weightKind` discriminator.* Every consumer must then check the discriminator,
  and the range validation becomes conditional on it. An omitted check is invisible; two names make
  the mistake impossible to type.
- *Ship no weight field until weighting is built.* ADR-0015 already offers opt-in weighted
  aggregation, and adding the field afterwards is the migration this ADR exists to avoid.
- *Numeric importance elicitation (sliders, direct 0–100 entry).* Collects importance and stores it
  as a scaling constant — the same category confusion at a different layer.

## References
The reasoning behind this decision, with the full literature, is in
`docs/research/findings-terminology.md` §§ 3.1–3.2.

1. [Common Mistakes in Making Value Trade-Offs — R. L. Keeney, *Operations Research* 50(6):935–945 (2002)](https://pubsonline.informs.org/doi/10.1287/opre.50.6.935.357) — full text paywalled; title and abstract verified.
2. [The outranking approach and the foundations of ELECTRE methods — B. Roy, *Theory and Decision* 31:49–73 (1991)](https://link.springer.com/article/10.1007/BF00134132). The often-quoted statement that ELECTRE weights are "not substitution rates" comes from the later ELECTRE survey chapter (Figueira, Mousseau & Roy, 2005, [doi:10.1007/0-387-23081-5_4](https://doi.org/10.1007/0-387-23081-5_4)), whose wording cannot currently be re-verified — it is therefore not quoted here, and the claim rests on Roy's foundational statement.
3. [What is the PAPRIKA method? — 1000minds; after P. Hansen & F. Ombler, *Journal of Multi-Criteria Decision Analysis* 15:87–107 (2008)](https://www.1000minds.com/paprika)
