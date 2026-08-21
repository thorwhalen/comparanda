# ADR-0019: Dominance semantics over incomplete and mixed-level data

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0015 names Pareto filtering "the strongest defensible reduction available", and ADR-0009
guarantees that cells are missing — with a reason, but missing. The obvious way to reconcile those
two facts is the rule the skyline literature already published: compare two alternatives only on the
criteria they both have. That rule is broken. Khalefa, Mokbel and Levandoski state it and then prove
it unusable — incomplete data "suffer from non-transitive dominance relation which may lead to a
cyclic dominance behavior", with a three-point counterexample in which "none of the three points can
be considered a skyline as all of them are dominated" [1]; the skyline survey restates it with a
second counterexample [2]. Reproduced numerically during the research: over 200,000 random triples
on a 1–5 ordinal scale with missing cells, the common-dimensions rule produced ~1,900 transitivity
violations and ~69 three-cycles.

The same defect wears a second hat that is much easier to walk into. "Drop a criterion from the
comparison when one side is `not-applicable`" *is* the common-dimensions rule, and two independent
research sections prescribed it without noticing (`docs/research/findings-terminology.md` § 7,
Conflict G). A flagship reduction that can report that every alternative is dominated is worse than
no reduction at all.

## Decision
Dominance is computed over **intervals**, for **one named measure**, against a **fixed comparison
basis**.

1. **Every cell becomes an interval.** An observed value gives `[v, v]`. A **contingently** missing
   value gives the criterion's declared range (ADR-0018) — the standard device of substituting the
   attribute range for a missing consequence [4]. A **structurally** missing value gives no interval
   and leaves the comparison altogether.

2. **Two relations, and only one of them builds a front.** With `j` ranging over the comparison
   basis:
   - `a` **necessarily dominates** `b` iff `lo_a[j] >= hi_b[j]` for every `j`, strict somewhere. It
     holds under every completion of the missing cells.
   - `a` **possibly dominates** `b` iff `hi_a[j] >= lo_b[j]` for every `j`, strict somewhere. It
     holds under at least one completion.

   The names are Greco, Mousseau and Słowiński's *necessary* / *possible* [3]. Necessary dominance
   is a strict partial order — verified by brute force, 0 violations and 0 cycles over the same
   200,000 triples. Possible dominance is **not** transitive (~5,600 violations, ~6,600 cycles in
   the same run) and is used **only as a filter, never to build a front**.

3. **The comparison basis is fixed across the scope, and named in every result.** It is the set of
   criteria applicable to every alternative in the current scope: "dominance computed over the 9
   criteria applicable to all 12 alternatives; 3 excluded as inapplicable." Transitivity was only
   ever lost through a varying basis, so **a per-pair basis is forbidden**. `explainDominance(a, b)`
   may report a per-pair view — "at least as good on 9 of 12; 3 not applicable" — as an
   *explanation*, never as an input to the front. A caller that insists on a per-pair basis anyway
   gets cycle detection and a cycle report, not an assumption of acyclicity.

   The natural scope is an alternatives group, where a declared group-pair inapplicability makes
   applicability homogeneous within the group. This makes ADR-0008's grouping load-bearing for
   ADR-0015's flagship analysis. Whole-analysis scope remains legal and remains transitive.

4. **Dominance runs over criteria for one chosen measure**, supplied by the caller and reported
   beside the basis. There is no dominance across measures: a score front and a confidence front are
   different questions, and blending them would let an alternative be set aside for being less well
   evidenced.

5. **Three result tiers**, because a matrix with gaps has three honest answers:

   | Tier | Definition | What the reader does |
   |---|---|---|
   | **dominated** | something necessarily dominates it | set it aside |
   | **provisionally surviving** | not necessarily dominated, but possibly dominated | these blanks are load-bearing — filling them may eliminate it |
   | **robustly non-dominated** | nothing even possibly dominates it | on the front whatever the blanks turn out to be |

   The middle tier is the product, not a consolation prize.

6. **The gap between the necessary and the possible sets is reported as a measure of what the
   missing data costs the decision**, together with a **value-of-information ranking** of the blanks:
   for each contingently missing cell, count how many possibly-dominated pairs would resolve if it
   were known. Ship it labelled as what it is — a deliberately crude pair-counting proxy for an
   expected-value-of-information calculation we are not doing, which would need a prior over the
   missing cell.

7. **Excluded by construction, and reported rather than silent.** Nominal criteria (no order to
   dominate along), criteria with `preference: none`, and criteria with no declared range never
   enter the basis. `target` and `ordered` are also excluded from strict dominance in v1: a target
   criterion needs a distance metric, which smuggles a cardinal assumption back in, and `ordered`
   declares an order without a direction of preference. Both ship in the schema (ADR-0018) and both
   are named in the result as excluded, so the reader can see what the front did not look at.

8. **Practical dominance is a labelled relaxation that must report cycles.** Strict dominance "is
   rare. The extent to which it can help to discriminate between options and so to support real
   decisions is correspondingly limited" [5], so a per-criterion indifference tolerance `q` is
   supported — on a 1–5 ordinal criterion, `q = 1` says one step is noise. The relaxed relation is
   not guaranteed to be a partial order, so it **detects and reports cycles** rather than assuming
   they cannot happen. Default `q = 0`; raising it is a visible user act, and the result says so.

9. **A value the reader is not permitted to see widens like any contingently missing cell**, and the
   widened count is reported — "computed with 3 cells withheld from you". Two readers with different
   access may legitimately compute different fronts; what is not acceptable is that they cannot tell.
   The disclosure model itself is ADR-0021's.

10. **The algorithm is the naive O(n² · m) pairwise scan.** At ADR-0002's stated scale that is ~1.2M
    comparisons at 200 alternatives and 30 criteria — microseconds — and it produces the full
    pairwise relation, which the view needs anyway to explain *why* an alternative was set aside.
    Disk-resident skyline algorithms [6] buy us nothing here.

## Consequences
The front is harder to compute and honest about what it does not know. Interval widening is
conservative by design: one contingent blank in a row makes that alternative hard to dominate *and*
hard to dominate with, so on blank-rich matrices the dominated tier thins out and the provisionally
surviving tier fills. That is the correct representation of the data, and it is why clauses 5 and 6
put the value in the middle tier and the value-of-information ranking rather than in a short list of
survivors. It also means the size of the surviving set is not a quality signal — anything reporting
a survival rate over these matrices has to report blank density beside it.

Grouping becomes a prerequisite for the flagship analysis rather than a convenience, and every
result object grows three obligations: the measure, the basis, and the excluded criteria.

One honest limit: the 200,000-triple simulation verified transitivity and acyclicity. It says
nothing about tier sizes. How much the dominated tier actually yields gets measured on the
deliberately messy example ADR-0016 requires, not asserted here.

## Alternatives considered
- *Compare on the criteria both alternatives have.* The published rule. Forbidden: non-transitive,
  cyclic, and able to empty the front [1, 2].
- *Drop a criterion when one side is `not-applicable`.* The same rule, renamed.
- *Impute the missing cells and compute one front.* Produces a confident answer out of data we do
  not have, which contradicts ADR-0009's whole premise.
- *Refuse dominance on incomplete matrices.* Disables the analysis on essentially every real
  comparison.
- *Call the relations `certain` / `possible`.* "Certain" is unattested in the literature and
  collides with `confidence`, a stored measure in this schema.

## References
1. [Skyline Query Processing for Incomplete Data — M. E. Khalefa, M. F. Mokbel & J. J. Levandoski, ICDE 2008](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf)
2. [A Survey of Skyline Query Processing — C. Kalyvas & T. Tzouramanis, arXiv:1704.01788 (2017)](https://arxiv.org/pdf/1704.01788)
3. [Ordinal regression revisited: multiple criteria ranking using a set of additive value functions — S. Greco, V. Mousseau & R. Słowiński, EJOR 191(2):416–436 (2008)](https://researchportal.port.ac.uk/en/publications/ordinal-regression-revisited-multiple-criteria-ranking-using-a-se/)
4. [Missing consequences in multiattribute utility theory — A. Jiménez, A. Mateos & S. Ríos-Insua, Omega 37(2):395–410 (2009)](https://ideas.repec.org/a/eee/jomega/v37y2009i2p395-410.html)
5. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf), § 5.5.2.1
6. [The Skyline Operator — S. Börzsönyi, D. Kossmann & K. Stocker, ICDE 2001](https://doi.org/10.1109/ICDE.2001.914855)

The derivation, the numerical verification and the two research sections this reconciles are in
[../research/findings-terminology.md](../research/findings-terminology.md) § 3.3 and § 7 Conflicts
A, B and G.
