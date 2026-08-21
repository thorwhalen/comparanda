# ADR-0026: Views shipped in v1, and the ones deliberately declined

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
The matrix is the view this repository is built around, and it encodes its measures in colour — the
channel Cleveland & McGill's ranking of elementary perceptual tasks places *last* for decoding
accuracy, behind position along a common scale [1]. The matrix is therefore, by construction, the
least accurate available way to read one value. Its virtue is elsewhere: every (alternative,
criterion) pair at once, and block structure under seriation (ADR-0025).

That fixes the selection rule. **A secondary view earns its place only by repairing a specific
weakness of the matrix** — not by being expected, and not by looking analytical. The matrix is weak
at exactly four things: reading and comparing values on one criterion; answering "which alternatives
can I stop considering"; showing whether a conclusion is *stable*; and showing the spread between
raters inside a cell.

A second filter runs underneath and disqualifies more candidates than any perceptual argument: our
scores are **ordinal**. Any view whose visual variable invites arithmetic the level of measurement
does not license — enclosed area, length ratios, slope magnitude — commits the category error the
total column of ADR-0015 exists to prevent.

## Decision
Five components ship. Each carries the job it does that the matrix cannot.

| View | The job the matrix does not do |
|---|---|
| Matrix with seriation (ADR-0025) | overview and block structure — the baseline the others repair |
| Small-multiple dot plots | reading and comparing values on one criterion; rater spread |
| Two-criterion scatter with a dominance overlay | reduction: which alternatives can be set aside |
| Rank-flow / slope, gated | stability of a conclusion under a changed weighting |
| Diverging stacked bar, detail panel only | the shape of disagreement inside one cell |

Four constraints are part of the decision, not implementation detail:

- **The dot plots render their axis as discrete labelled ticks** carrying the criterion's own level
  names (ADR-0018), with no continuous rule between them, so the spacing reads as ordering rather
  than distance. Equal spacing along a continuous axis smuggles an interval assumption in through
  geometry, and nobody fixes it. Each panel carries an **explicit `missing` lane keyed by reason
  code** (ADR-0009), or it silently drops precisely the alternatives that ADR exists to keep
  visible. One dot per rater assertion on the shared axis makes disagreement a visible gap, so this
  one component fills two of the four holes and doubles as the multi-rater view at panel scale —
  ADR-0024's rater dot strip is the same reading compressed into a cell.
- **The two-criterion frontier is labelled partial in the view** — "non-dominated on these two
  criteria" — and carries each alternative's full-criteria dominance tier from ADR-0019 as a second
  mark channel. An alternative on a 2-D frontier may be dominated across the full criteria set, and
  this is the view most likely to be screenshotted out of context.
- **Rank-flow is gated behind ADR-0015's weighted-aggregation opt-in** and captioned as a
  *stability* finding, never as a winner. Defensible: "this ranking is not stable; a 5% weight change
  moves three alternatives past each other." Not defensible: "this is the best alternative." Bump
  charts are reported unsuitable much past thirty ranked alternatives [2] — our own boundary — so it ranks
  the current selection rather than the whole analysis. The slope chart for rater-versus-rater is the
  same component, and it connects **ranks**, never values, because angle reads as magnitude.
- **The diverging stacked bar never appears in a matrix cell.** Across alternatives only the first
  segment shares a baseline, which is the structural defect [3]; the per-rater dot plot wins there
  because every dot shares one axis. Within one cell, centred on a declared neutral level — declared,
  per ADR-0010's rule against diverging palettes on undeclared midpoints — it is right, and it lives
  in the detail panel. The design reference for it is a principled argument rather than a measured
  result [4], and the one controlled comparison we found is equivocal [5]; it ships as consensus
  practice, scoped.

**Decline parallel coordinates for v1.** On a five-level ordinal scale every polyline lands on one
of five heights per axis, and twenty-odd alternatives coincide over long runs until they are
individually untraceable. Worse, the axis-order problem is *not* matrix seriation wearing a different
hat: a parallel-coordinates ordering wants **dissimilar** dimensions adjacent so clusters become
salient [6], where seriation wants **similar** rows and columns adjacent so blocks become solid.
Shipping both means maintaining two conflicting orderings of the same criteria, and then explaining
why "arrange to reveal structure" gave two different answers in one document. Revisit only if
ratio-scale criteria become common.

**Decline radar outright, not with a caveat.** Two of the three arguments are arithmetic:

1. **Enclosed area is quadratic in the values.** For *n* equally spaced axes,
   `A = ½·sin(2π/n)·Σ r_i·r_(i+1)`. A flat 3 across six criteria encloses 23.383; a flat 4 — *one
   ordinal step better everywhere* — encloses 41.569, which is 1.78× the area, exactly (4/3)². The
   reader perceives a difference nearly twice the size of the one in the data, on a scale where the
   difference is not even a ratio.
2. **The same data has many different areas.** Area depends on products of *adjacent* radii, so
   permuting the axes changes it, and axis order is an arbitrary authoring choice. Over the cyclic
   orders of one six-criterion profile the area ranges 13.423 … 21.218 — a **1.58× spread from
   reordering alone**. This is not a thought experiment: a published method searches the permutations
   and keeps "the one that yields a maximal total area" [7]. A view whose headline visual property
   can be inflated by 58% by reordering the columns has no place in a tool whose premise is
   auditability.
3. **It cannot render a qualified `missing`.** A missing axis either collapses to the centre — which
   draws "nobody has looked yet" as "scores worst possible", a lie — or breaks the polygon. ADR-0009
   requires that structural and contingent absence be distinguishable and that neither read as a
   value. Radar structurally cannot comply, and this argument alone is sufficient.

A caveat fixes none of the three, which is why the option of shipping radar with a warning is
rejected rather than deferred. **When radar is requested — and it will be — the question behind the
request is "show me the shape of this alternative against that one". Answer it with the dot-plot
small multiple, two alternatives highlighted on the shared axis.** Same question, honest encoding,
handles `missing`.

One honest correction in the other direction, so the record does not overclaim: we could not locate a
controlled study comparing radar against a dot-plot small multiple on ordinal profile tasks. The
strongest direct experiment compares radar only against **other radial designs**, where it is least
effective and least liked [8]. That refutes "radar is the natural display for a composite indicator";
it is not by itself a licence to say "radar is worse than a dot plot". The decline rests on the three
arguments above, not on that study.

**If half the time were available:** ship the matrix, the dot panels and the two-criterion scatter,
and cut rank-flow and the detail-panel spread bar. Those three cover overview, value reading and
reduction, which is the whole argument a comparison usually needs. Recorded here so the cut is a
decision already taken rather than a panic in the last week of Phase 3.

## Consequences
A small, defensible set of views, each with a stated job, and a written answer to the request that
otherwise arrives every six months. Refusing radar costs one link instead of one argument.

The costs are real. Two of the four holes are filled by components with hard prerequisites: the
scatter cannot be built before criteria carry a direction of preference (ADR-0018) and dominance has
its incomplete-data semantics (ADR-0019), and rank-flow cannot exist before weighted aggregation
does. Declining parallel coordinates also declines the one view that shows all criteria at once
without colour, so the dot-plot small multiple carries more weight than it otherwise would, and panel
count is the scaling risk to manage. And users arriving from spreadsheet tools will read the absence
of radar as an omission rather than a decision; the answer is this ADR, and the dot-plot small
multiple beside it.

## Alternatives considered
- *Ship radar with a caveat.* A caveat does not fix a quadratic area, an arbitrary axis order, or a
  `missing` that renders as "worst". Rejected, not deferred.
- *Ship parallel coordinates anyway.* Two conflicting criterion orderings to maintain forever, and an
  ordinal collapse that makes individual alternatives untraceable.
- *Ship rank-flow ungated.* A rank-flow view presupposes a ranking, which presupposes an aggregation
  — the thing ADR-0015 refuses to do by default. Gating it keeps the direction of the claim honest.
- *In-cell diverging stacked bars, at matrix scale.* Only the first segment shares a baseline [3],
  and ADR-0010 forbids a diverging palette on ordinal data without a declared midpoint.
- *One more view per unfilled request.* The selection rule is the defence. A view that does not
  repair a named weakness of the matrix is a maintenance cost with a screenshot attached.

## References
The reasoning, the numerical verification of the radar figures, and the wider literature are in
`docs/research/findings-visualisation.md` § 2.

1. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — W. S. Cleveland & R. McGill, *JASA* 79(387):531–554 (1984)](https://www.jstor.org/stable/2288400)
2. [Colorslope: a balanced visualization of overview and details on ranks over time — Wang et al., *Visual Intelligence* 1 (2023)](https://link.springer.com/article/10.1007/s44267-023-00008-9) — the reported unsuitability of bump charts much past thirty ranked rows.
3. [LineUp: Visual Analysis of Multi-Attribute Rankings — S. Gratzl, A. Lex, N. Gehlenborg, H. Pfister & M. Streit, IEEE InfoVis (2013)](https://data.jku-vds-lab.at/papers/2013_infovis_lineup.pdf) — the baseline-alignment defect of stacked bars, and the prior art for rank-flow.
4. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — R. M. Heiberger & N. B. Robbins, *Journal of Statistical Software* 57(5) (2014)](https://www.jstatsoft.org/article/view/v057i05) — a design argument from perceptual principles, cited as consensus and not as a measured result.
5. [The efficacy of stacked bar charts in supporting single-attribute and overall-attribute comparisons — Indratmo, Howorko, Boedianto & Daniel, *Visual Informatics* (2018)](https://www.sciencedirect.com/science/article/pii/S2468502X18300287) — 30 participants; equivocal for single-criterion comparison.
6. [Evaluating Reordering Strategies for Cluster Identification in Parallel Coordinates — Blumenschein et al., *Computer Graphics Forum* 39(3), EuroVis (2020)](https://onlinelibrary.wiley.com/doi/10.1111/cgf.14000) — axis ordering optimises for dissimilar neighbours; over 30 strategies, no consensus default.
7. [Multidimensional mechanics: Performance mapping of natural biological systems using permutated radar charts — Porter & Niksiar, *PLOS ONE* 13(9) (2018)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0204309)
8. [Off the Radar: Comparative Evaluation of Radial Visualization Solutions for Composite Indicators — Y. Albo, J. Lanir, P. Bak & S. Rafaeli, *IEEE TVCG* 22(1) (2016)](https://pubmed.ncbi.nlm.nih.gov/26529525/) — radar against other radial designs only.
