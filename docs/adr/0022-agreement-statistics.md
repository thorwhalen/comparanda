# ADR-0022: Agreement statistics — unit of analysis, and no threshold ever gates

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0011 point 4 requires an agreement statistic over multi-rater assertions and names Krippendorff's
alpha, "confirm in research". The research confirmed the coefficient and disagreed with the ADR about
where to put it.

The confirmation is numeric: a from-scratch implementation reproduced Krippendorff's own published
example — 4 raters, 12 units, 7 missing values — returning 0.7434 / 0.8154 / 0.8491 against his
stated 0.743 / 0.815 / 0.849 [1]. Alpha genuinely takes any number of observers, any level of
measurement, incomplete data, and small samples [1], which is our case in four bullets.

Two traps surfaced, and both are about *how the number is presented rather than how it is computed*.

The first is the unit of analysis. Alpha "evaluates reliability one variable at a time" [1]. Computed
per cell over two to five assertions there is nothing to chance-correct against — the expected
disagreement is estimated from the same handful of numbers as the observed disagreement. ADR-0011
point 4 implies a per-cell statistic. It cannot be one.

The second is the interpretive bands. The conventional 0.800 / 0.667 cutoffs are Krippendorff's own
[2], and they exist to certify a coding *instrument*, where rater disagreement is measurement error
to be driven out. `comparanda`'s thesis is the opposite one: disagreement is a finding, and a low
alpha on a criterion usually means the criterion is under-defined — which ADR-0011 point 1 already
names as where the most valuable threads in the document live. Borrowing the bands' authority to
suppress a cell would invert the product.

The reasoning and the full literature are in `docs/research/findings-terminology.md` §5.

## Decision

**Krippendorff's alpha is the coefficient, computed per criterion, over alternatives as units, never
per cell.** It is always reported with an interval — jackknife by default, which "offers a very
substantial improvement over the bootstrap interval" at small samples [3]. At 22 alternatives the
interval *is* the story: the smallest published small-sample simulation starts at n = 50 and coverage
only approaches nominal at n = 200 [4], so applying alpha at n ≈ 20 is an extrapolation downward and
must look like one.

**An agreement statistic is labelled by the lowest `independence` rung present in the assertion set
it was computed over.** At `in-session` it is reported as agent self-consistency, or test–retest
reliability, and never as "agreement". Five draws of one model are a legitimate and useful
multi-rater computation; they are not five raters, and the label is where that distinction lives.
This is a labelling rule, not a computation ban — a mixed set is resolved by labelling it at its
lowest rung, never by refusing to produce a number. `rubricator` states the same rule for its own
stability report, so the two repositories state one rule and not two.

**Per cell, report the shape instead of a coefficient**: `n`, the level multiset, `min`, `max`,
`span` in ordinal steps, the mode(s), and a `polarised` flag — two or more occupied levels separated
by at least one empty level, with no dominant mode. All ordinal-legal under ADR-0003, none of them a
coefficient. Where the disagreement ramp and the sort need a scalar, use van der Eijk's A, which is
purpose-built for ordered rating scales and runs over [−1, +1] with +1 unanimity, 0 uniform and −1
perfect bimodality [5, 6]. **A is never displayed without `n` beside it**: it is a shape statistic
that does not know the count, and it is sensitive to the distance between modes, so a 4-versus-5
split may not be flagged where a 1-versus-5 split is [6].

**No threshold gates, warns on, suppresses or excludes anything.** The 0.800 / 0.667 bands are
displayed with their source attached and act on nothing. Every threshold in this area — the band
edges, the modal-prevalence trigger that offers AC2, the jackknife-to-bootstrap switchover, the
`polarised` gap width — is configuration with a default, never a literal in an algorithm.

**A single matrix-wide agreement number is not a legal output.** Different criteria have different
scales, different rater sets and different amounts of missing data; one number over all of them is a
category error, and it is the number a reader will quote. ADR-0015 lists agreement statistics among
its opt-in analyses; here is the qualification that bullet needs — agreement is reported, never
enforced.

**The view must render the interval honestly.** A column header carries its criterion's alpha with
its interval and its band label, and a wide interval must be visible as a wide interval, not rounded
away next to a reassuring band name. This is the display half of the small-sample fact above; without
it the number acquires a precision the data does not have.

**Missingness maps onto alpha by ADR-0009's flags, not by literal codes.** Reason codes with
`structural: true` are excluded from the computation entirely — there was never a question to answer,
so no reliability question exists. Every other code is *absent* from the ordinal domain, leaving the
alternative with fewer pairable values and possibly dropping it. Three of them are additionally
**counted and reported separately**: `not-evidenced`, `indeterminate` and `withheld`. A cell somebody
searched and found silent, a cell an assessor could not resolve, and a cell a reader may not see are
three different observations about the subject, and none of them is a point on the ordinal scale.
Keying on the flag rather than the string is ADR-0009's own rule, and it is what keeps a downstream
deployment's custom structural code from silently breaking the computation.

**The implementation is owned in `core`** — roughly 80 lines — and gated on Krippendorff's dataset C
as a golden fixture. The fixture is not arbitrary: it exercises missing data, variable rater counts,
an unpairable lone value and all three difference functions at once, and it is exactly the fixture a
mature library got wrong, returning 0.789 where R returned 0.815 [7]. The ordinal difference function
is the standard bug — it is not `(c−k)²` but a rank distance measured in observed marginal mass,
which depends on the data, so no fixed distance table can be precomputed [1, 8]. There is no
maintained, ordinal-capable, missing-data-capable Krippendorff implementation on npm worth a runtime
dependency [9].

**Acceptance criterion for Gate 3:** a fixture whose assertions are repeated draws of one agent must
not surface any number labelled agreement.

## Consequences
The number that appears is defensible and small in scope. What becomes easy is trusting it: it has a
named unit of analysis, an interval, a source for its band, and a label that says what kind of
concordance it measures.

What becomes hard is answering "what is the agreement score for this comparison" — there isn't one,
and a user who wants one is told why. The view carries the cost of that refusal, since a column of
per-criterion alphas with intervals is more expensive to lay out and to explain than a single figure
in a corner. We also take on ~80 lines of statistical code with a bug that a mature library shipped,
which is why the fixture is a gate and not a test.

The labelling rule makes `independence` load-bearing for a *presentation* decision, not just for
provenance. An assertion set with no `independence` recorded must be labelled at the most cautious
reading available, and a set migrated in after the fact cannot be relabelled honestly — which is why
the field belongs in v1.

## Alternatives considered
- *Per-cell alpha.* Nothing to chance-correct at n ≤ 5. Rejected; the shape statistics above replace
  it.
- *Gate the analysis on an alpha threshold.* Would suppress precisely the cells this tool exists to
  surface, and at n ≈ 20 would suppress nearly all of them.
- *Suppress the point estimate below a minimum unit count and show only the interval.* Raised in
  adversarial review. It is the same suppression rule wearing a statistician's hat, and at our normal
  size it means never showing an alpha at all. Show the number, show the interval, name the band,
  link the band's source.
- *Cohen's kappa.* Two raters, complete data, and the origin of the prevalence paradox — high
  observed agreement driven to a low kappa by marginal imbalance [10].
- *Fleiss's kappa.* Requires the same number of ratings per unit — our normal case is two here and
  four there — and is nominal-only, discarding the one useful property of an ordinal scale.
- *ICC.* Assumes interval data [11], which would reintroduce ordinal averaging through the back door
  of the agreement statistic, and has ten forms whose choice must be reported.
- *Gwet's AC2 as the primary coefficient.* Offered instead as a **labelled secondary** for skewed
  criteria only. It does solve the paradox, but a peer-reviewed comparison finds AC1 is not a
  substitute for kappa — at fixed observed agreement it moves opposite to kappa as prevalence departs
  from 0.5 — and its authors specifically warn that the standard verbal bands must not be applied to
  it [12]. A number with no published interpretive scale cannot be *the* agreement number in a tool
  whose job is making numbers trustworthy. It is never shown without that caveat attached.
- *Tastle and Wierman's consensus measure.* Rejected outright: it internally computes the arithmetic
  mean of the ordinal codes, confirmed in the R reference source as `mx = mean(expand(V))` [13, 14].
  Shipping a per-cell disagreement statistic that averages ordinal codes, in a tool whose thesis is
  that you must not, would be indefensible the first time anyone read the source. ADR-0003 earned its
  keep here by disqualifying a plausible choice on principle rather than on taste.

## References
The reasoning is in `docs/research/findings-terminology.md` §5 and its working note
`docs/research/sections/c4-agreement.md`. The labelling rule and the interval-rendering requirement
come from the surviving review findings on this draft in `docs/research/phase0-review.md`.

1. [Computing Krippendorff's Alpha-Reliability — Klaus Krippendorff (2011, literature updated 2013)](https://www.asc.upenn.edu/sites/default/files/2021-03/Computing%20Krippendorff's%20Alpha-Reliability.pdf)
2. [Krippendorff's alpha — Wikipedia](https://en.wikipedia.org/wiki/Krippendorff%27s_alpha) — secondary source for the 0.800 / 0.667 bands, which it attributes to Krippendorff, *Content Analysis*, 2nd ed. (2004), pp. 241–243.
3. [confint.krippendorffsalpha — CRAN reference manual, `krippendorffsalpha`, John Hughes (2021)](https://search.r-project.org/CRAN/refmans/krippendorffsalpha/html/confint.krippendorffsalpha.html); package paper: [arXiv:2103.12170](https://arxiv.org/abs/2103.12170)
4. [Measuring inter-rater reliability for nominal data – which coefficients and confidence intervals are appropriate? — Zapf, Castell, Morawietz & Karch (2016), BMC Medical Research Methodology](https://pmc.ncbi.nlm.nih.gov/articles/PMC4974794/)
5. [Measuring Agreement in Ordered Rating Scales — van der Eijk (2001), Quality & Quantity 35(3):325–341](https://link.springer.com/article/10.1023/A:1010374114305) — **paywalled and not read directly**; the measure and its properties are taken from [6] and from the R implementation notes, [`agrmt::agreement`](https://search.r-project.org/CRAN/refmans/agrmt/html/agreement.html), which documents a revised algorithm distinct from the 2001 original.
6. [Quantifying Polarization: A Comparative Study of Measures and Methods — arXiv:2501.07473 (2025)](https://arxiv.org/abs/2501.07473) — source for the restated van der Eijk A formulas and the mode-distance sensitivity finding.
7. [fast-krippendorff issue #4: "Ordinal value seems off" — 0.789 vs R's 0.815 on Krippendorff's own example](https://github.com/pln-fing-udelar/fast-krippendorff/issues/4)
8. [fast-krippendorff — pln-fing-udelar (Python; the ordinal metric spelled out)](https://github.com/pln-fing-udelar/fast-krippendorff/blob/main/krippendorff/krippendorff.py)
9. [max-schaefer/krippendorff — TypeScript implementation](https://github.com/max-schaefer/krippendorff) — one commit, zero stars, self-described side project; **do not depend on it.**
10. [High agreement but low kappa: I. The problems of two paradoxes — Feinstein & Cicchetti (1990), Journal of Clinical Epidemiology 43:543–549](https://pubmed.ncbi.nlm.nih.gov/2348207/)
11. [A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research — Koo & Li (2016), Journal of Chiropractic Medicine 15:155–163](https://pubmed.ncbi.nlm.nih.gov/27330520/)
12. [Gwet's AC1 is not a substitute for Cohen's kappa – A comparison of basic properties — Vach & Gerke (2023), MethodsX 10:102212](https://doi.org/10.1016/j.mex.2023.102212)
13. [Consensus and dissention: A measure of ordinal dispersion — Tastle & Wierman (2007), International Journal of Approximate Reasoning 45(3):531–545](https://www.sciencedirect.com/science/article/pii/S0888613X06001186)
14. [`agrmt` R package — `consensus.R` source, showing `mx = mean(expand(V))`](https://rdrr.io/rforge/agrmt/src/R/consensus.R)
