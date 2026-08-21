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

## Amendments

Amendments are dated and additive. Nothing above this line has been edited: the Context, Decision
and Consequences accepted on 2026-08-18 stand as the record of what was decided and why. Each
subsection states what it changes, what it replaces, and on what evidence. Decided 2026-08-21 by
Thor Whalen, on the Phase 0 research: `docs/research/findings-terminology.md` §§ 3–5 and
`docs/research/findings-visualisation.md` §§ 2–3. The numbered references at the end of this file
are cited only from this section.

### 2026-08-21 — Veto screening is conjunctive screening, and the field is `acceptability`

**What changes.** The "Veto screening" bullet claims our rule "matches ELECTRE's veto thresholds".
It does not, and the claim is replaced. ELECTRE's `v_j` bounds the *difference* between two
alternatives on one criterion — the power of a single criterion to block the assertion that `a`
outranks `b` — and it means nothing outside a compensatory outranking construction [3]. Ours is an
absolute floor on an alternative's own value. That has an established name of its own: a
**conjunctive, non-compensatory screening rule**, in Tversky's family [2].

The analysis ships exactly as described. The name and the claim change.

- The schema field is **`acceptability`**. There is no `veto` field.
- **"Veto criterion" remains a permitted display alias** in the UI and in elicitation prose. The
  word is not banned from the product; it is banned from the schema and from the claim.
- `veto` is **reserved, not occupied**. No ELECTRE-sense `v` is proposed for v1 — ADR-0018 ships
  `indifference` (`q`) and `preferenceThreshold` (`p`) only. Reserving the word keeps it free if
  outranking ever arrives.

Why the two can be separated without loss: an ELECTRE veto is meaningless on top of Pareto
dominance, since a dominating alternative is never worse anywhere and there is nothing for a veto
to object to. We can adopt the screening rule and decline the method.

**On the citation.** The wording usually quoted for `v_j` comes from a closed-access ELECTRE survey
chapter whose available copy is gone, so it is not quoted here and nothing rests on it. The claim
rests on Roy's foundational statement of the outranking approach [3]. Issue #36 tracks
re-verification of the chapter for anyone who wants the sharper wording.

### 2026-08-21 — Dominance is necessary/possible over interval completions, with an optional tolerance

**What changes.** The dominance bullet stands as a commitment and gains its semantics. It said what
dominance is *for* and not how it is computed when cells are blank, and the obvious answer is
broken.

- **The common-dimensions rule is forbidden.** Comparing two alternatives only on criteria where
  both carry a value is the published incomplete-data skyline definition, and it is non-transitive:
  it admits cycles in which every alternative is dominated and the front comes back empty [4]. A
  flagship reduction that can report "everything is dominated" is worse than no reduction. It is
  forbidden, not discouraged.
- **Dominance is necessary/possible over interval completions.** Every cell becomes an interval;
  necessary dominance holds under every completion, possible dominance under at least one. The
  result is three tiers — dominated, provisionally surviving, robustly non-dominated — and the
  middle tier is the product, because the gap between the outer two measures what the missing data
  is costing the decision. The interval construction, the transitivity results and the treatment of
  structural absence are **ADR-0019's**; this ADR defers to it rather than restating it.
- **A per-criterion indifference tolerance is supported** — practical dominance [5]. Strict
  dominance "is rare" [1 § 5.5.2.1], and without a tolerance this analysis usually returns nothing
  and looks broken. The default is zero; raising it is a visible user act; it is labelled as the
  relaxation it is; and because the relaxed relation is not guaranteed to be a partial order it
  **reports cycles rather than assuming acyclicity**. The tolerance is interpreted by the criterion's
  declared level (ADR-0018): a count of levels on ordinal, a quantity in units on interval and
  ratio, invalid on nominal.

### 2026-08-21 — Aggregation is gated on weight coverage

**What changes.** "Opt-in and labelled" is not sufficient protection, and this adds the missing
gate. Dropping a missing criterion from a weighted mean and renormalising the surviving weights
**is mean imputation** — it silently assigns each missing criterion this alternative's own average
— and production indices whose teams believe they never impute anything are audited doing exactly
that, with ranks biased up or down by whichever criteria happened to be present [6, 7].

Define **weight coverage** for an alternative as the sum of weights over criteria where it has an
observed value, divided by the sum over criteria applicable to it.

| weight coverage | what the tool offers |
|---|---|
| **1.0** | point aggregate — still opt-in, still labelled, still warned on ordinal criteria |
| **≥ 2/3, < 1.0** | interval aggregate `[lo, hi]` over ADR-0019's cell completions. No point value anywhere. Ranking only between non-overlapping intervals; overlapping pairs render "not separable on the available data" |
| **< 2/3** | no aggregate. Necessary/possible dominance, acceptability screening and the completeness report only |

Two rules are not negotiable. **Weight renormalisation is labelled as the mean imputation it is**,
at the point of use, in the copy the reader sees when they turn aggregation on. And an alternative
excluded by the gate **stays visible**, labelled "not scored — insufficient coverage": dropping it
silently is case deletion through the back door.

**The 100% rule for a point aggregate is ours.** It rests on the shadow-imputation argument above,
not on a source.

**The 2/3 floor is provisional.** It is the default of a configurable parameter and never a
literal. Its sources are *count*-based availability screens on a 133-economy, 78-indicator index
[6, 7]; applying that number to *weight* coverage, on matrices of our size — roughly 22 × 12 — is
our own extension, and its sensitivity at small `n` is untested. What settles it is the simulation
named in `docs/research/findings-terminology.md` § 9, open question 5: how often the interval
aggregate's ranking changes as coverage falls, run over the example datasets, tracked in issue #84.
Until that runs, 2/3 is the working default and is to be described as one wherever it is exposed.

### 2026-08-21 — Three analyses added, and even-swaps rejected

**What changes.** The list of shipped analyses gains three entries. Nothing is removed.

- **Value-of-information ranking of missing cells.** For each contingently missing cell, count how
  many possibly-dominated pairs would resolve if it were known. That ranks the blanks by what
  filling them would buy — "which gap should we close first?" — and it costs one extra pass over
  the pairwise relation dominance already computes. The crudeness is deliberate and stated at the
  point of use: a proper treatment is an expected-value-of-information calculation needing a prior
  over the missing cell, and this is the cheap proxy, chosen knowingly.
- **`findNonDiscriminatingCriteria`.** A criterion on which every surviving alternative lands in the
  same place is carrying no information, and saying so is a prompt to sharpen it or drop it.
  Dropping such criteria between rounds is what the Pugh case study actually did [9].
- **The datum-relative analysis (Pugh).** Choose an alternative as the datum; every other
  alternative gets **four counts** against it — better, same, worse, and not comparable. This is
  the ordinal-legal substitute for the total column the Decision forbids: better-than is a ranking
  comparison, and ranking is legal on ordinal data. The fourth count is not padding; Pugh's own `S`
  was overloaded between "the merit is similar" and "the difference cannot be determined yet", a
  defect noted in 1984, and separating them here is ADR-0009's rule applied to a derived count [9].

  **There is no net.** `plus − minus` is a compensatory aggregate over ordinal comparisons wearing
  a disguise, and it is the documented misreading of Pugh's method — the reason the technique is
  remembered as concept *selection* rather than controlled convergence [9]. The four counts are a
  profile, not a scalar. Legend copy must say what it is not: "counts of better/same/worse against
  {datum}; not a score, and not comparable across different datums." If anyone wants a net, it goes
  through the opt-in labelled aggregation path above or it does not exist. The mark that renders
  the counts is an encoding under ADR-0010 and costs no schema.

**Even-swaps is rejected**, recorded here so it is not proposed again. It is the distinctive
contribution of the accessible decision-analysis tradition this repository otherwise borrows from,
and it is experimentally path-dependent: subjects end up favouring whichever alternative is
modified in every swap, and whichever criterion serves as the measuring stick [8]. Beyond the bias
it needs cardinal tradeable values — illegal on most of our data — mutable hypothetical
alternatives, and a recorded, replayable swap path. Its two useful by-products, practical dominance
and non-discriminating-criterion detection, are shipped above without it.

### 2026-08-21 — Sensitivity gains a perturbation, and rank acceptability ships

**What changes.** The sensitivity bullet asks only how far a weight must move before the ranking
changes. That is the closed-form weight-flip margin [12], and it stands — but one-at-a-time weight
movement understates joint sensitivity, and it never touches the perturbation the literature says
actually breaks these methods.

- **Sensitivity must include an add/remove-an-alternative perturbation.** Rank reversal under a
  changed alternative set is the standing critique of the compensatory methods [10, 11]. A ranking
  that reorders when an alternative nobody was going to pick is deleted is not a ranking, and since
  weighted sum is the only aggregation method this repository ships, this is the check that keeps
  that choice honest.
- **Monte-Carlo rank acceptability ships**, opt-in, alongside weighted sum: sample weight vectors
  from the simplex and report, per alternative, the share of samples placing it at each rank. The
  acceptability index and the central weight vector are SMAA's [13]; the per-rank indices are
  SMAA-2's [14]. It is recorded here because a user-facing analysis with its own question, its own
  view, its own random number generator and its own sample count must not exist only in an export
  list. It is on the order of thirty lines and runs well under a second at our scale, which is why
  declining it for v1 — the live alternative — lost.

### 2026-08-21 — Agreement statistics are reported, never enforced

**What changes.** The agreement bullet named the analysis without saying what may be done with the
number. Two rules, both restrictions:

- **No agreement threshold gates, warns on, suppresses or excludes anything.** The interpretive
  bands in the literature are displayed and acted on by nobody. Disagreement between raters is a
  finding about the subject — ADR-0011's whole thesis — and hiding a cell because raters disagreed
  suppresses exactly what the tool exists to surface.
- **A single matrix-wide agreement number is not a legal output.** Agreement is computed per
  criterion, over alternatives as units, and reported with its interval. One number for the whole
  matrix averages across criteria that were never on a common scale, and it is precisely the figure
  someone will quote out of context.

The coefficient itself, the unit of analysis and the interval requirement are ADR-0022's. This ADR
records only what the analysis layer may do with the result.

### 2026-08-21 — The views that realise these analyses, and one label

**What changes.** The Decision named analyses and not the views that show them, which left two of
them to be reinvented at Phase 3.

- **`ParetoScatter`** realises dominance: two criteria on the axes, with a dominance overlay.
- **`RankFlow`** realises weighted aggregation and its sensitivity: ranking columns joined by slope
  lines, gated behind the weights opt-in. Built here as SVG rather than adopted from a general
  ranking-visualisation library [15], because the standalone bundle's byte budget (ADR-0013,
  ADR-0017) does not stretch to one for a single optional view.
- **A two-criterion frontier is labelled partial** — "non-dominated on these two criteria" — in the
  view, not in documentation elsewhere. An alternative on the 2-D frontier may be dominated across
  all twelve, so `ParetoScatter` carries full-criteria dominance status as a second mark channel and
  the two readings never get confused. This is the assumptions-at-point-of-use rule from the
  Decision, applied to the view most likely to be screenshotted out of context.

Which views ship in v1 is ADR-0026's business. These three commitments are analysis-side and belong
here.

### 2026-08-21 — Rank acceptability is `rankShare`, and it renders inside `RankFlow`

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

The "Sensitivity gains a perturbation" amendment above ships Monte-Carlo rank acceptability and
leaves two problems behind it. Neither touches the analysis, which ships exactly as described.

**1. The word `acceptability` is already taken, and the SMAA quantity gives way.** The "Veto screening
is conjunctive screening" amendment above states that "the schema field is **`acceptability`**", and
shipped code carries it — `Measurement.acceptability`, `Criterion.acceptability`, `screen()`. SMAA's
rank acceptability index is an unrelated quantity: the share of sampled weight vectors placing an
alternative at a given rank. One word, two meanings, one document is the confusion ADR-0020 exists to
prevent for `weight`, and ADR-0019 has already declined a literature term — `certain` — for colliding
with something this schema stores.

The SMAA quantity is **`rankShare`**: per alternative, per rank, the share of sampled weight vectors
that put it there. That is the field name and the label the reader sees. "Rank acceptability index" is
cited once, to [13, 14], as the name the method carries in its own literature, and is used nowhere
else. In this repository `acceptability` means the conjunctive screening floor and nothing else.
SMAA's *central weight vector* keeps its name; it collides with nothing.

**2. It does not get its own view.** That amendment justified recording the analysis here on the
ground that "a user-facing analysis with its own question, its own view, its own random number
generator and its own sample count must not exist only in an export list". The question, the
generator and the sample count stand; **the claim to a view is withdrawn**. Which views ship in v1 is
ADR-0026's business, as the "views that realise these analyses" amendment above says in as many
words, and ADR-0026 admits a view only where it repairs a named weakness of the matrix.
`rankShare` answers "is this conclusion stable under a different weighting", which is `RankFlow`'s
stated job and is already behind the same weighted-aggregation opt-in.

`rankShare` therefore renders **inside `RankFlow`**, as a per-alternative distribution across the rank
columns shown beside the realised ranking. ADR-0026's roster stays at five views. The justifying
sentence is corrected to that extent and to no other.

## References
Cited from the Amendments only. The full reasoning and the wider literature are in
`docs/research/findings-terminology.md` §§ 3–5 and `docs/research/findings-visualisation.md` § 2.

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [Elimination by aspects: A theory of choice — A. Tversky, *Psychological Review* 79(4):281–299 (1972)](https://doi.org/10.1037/h0032955)
3. [The outranking approach and the foundations of ELECTRE methods — B. Roy, *Theory and Decision* 31:49–73 (1991)](https://link.springer.com/article/10.1007/BF00134132). The later ELECTRE survey chapter (Figueira, Mousseau & Roy, 2005, [doi:10.1007/0-387-23081-5_4](https://doi.org/10.1007/0-387-23081-5_4)) states the veto threshold in the wording usually quoted, but is closed access and its available copy is gone — it is therefore not quoted here.
4. [Skyline Query Processing for Incomplete Data — M. E. Khalefa, M. F. Mokbel & J. J. Levandoski, ICDE 2008](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf) — the standard common-dimensions definition, and the proof that it is non-transitive.
5. [A Preference Programming Approach to Make the Even Swaps Method Even Easier — J. Mustajoki & R. P. Hämäläinen, *Decision Analysis* 2(2):110–123 (2005)](https://doi.org/10.1287/deca.1050.0043) — the source for practical dominance.
6. [Composite Indicator Development and Analysis in R with COINr, ch. 6: Missing data and Imputation — W. Becker (2022)](https://bluefoxr.github.io/COINrDoc/missing-data-and-imputation.html) — "shadow imputation".
7. [Global Innovation Index 2024, Appendix II: JRC statistical audit — Joint Research Centre / WIPO (2024)](https://www.wipo.int/web-publications/global-innovation-index-2024/en/appendix-ii-joint-research-centre-jrc-statistical-audit-of-the-2024-global-innovation-index.html) — the 66% availability screen, and the audited bias from renormalising over present indicators.
8. [Biases and path dependency in the Even Swaps method — T. J. Lahtinen & R. P. Hämäläinen (2016), *EJOR* 249(3):890–898](https://doi.org/10.1016/j.ejor.2015.09.056); [working-paper PDF](https://sal.aalto.fi/publications/pdf-files/mlah14.pdf).
9. [The Pugh Controlled Convergence Method: Model-Based Evaluation and Implications for Design Theory — D. D. Frey et al., *Research in Engineering Design* 20 (2009)](https://dspace.mit.edu/handle/1721.1/49448) — open-access manuscript; also the source for Pahl & Beitz's objection to the overloaded `S`.
10. [The Rank Reversal Problem in Multi-Criteria Decision Making: A Literature Review — R. F. F. Aires & L. Ferreira (2018)](https://www.scielo.br/j/pope/a/BPwgsywPZqgctBDcfPXxczg/?lang=en)
11. [The state of the art development of AHP (1979–2017) — A. Emrouznejad & M. Marra, *International Journal of Production Research* 55(22) (2017)](https://doi.org/10.1080/00207543.2017.1334976) — secondary source, for the standing of the rank-reversal critique.
12. [A Sensitivity Analysis Approach for Some Deterministic Multi-Criteria Decision-Making Methods — E. Triantaphyllou & A. Sánchez (1997)](https://repository.lsu.edu/eecs_pubs/1396/) — paywalled; the closed-form weight-flip margin used here was verified numerically rather than quoted.
13. [SMAA — Stochastic multiobjective acceptability analysis — R. Lahdelma, J. Hokkanen & P. Salminen, *EJOR* 106(1):137–143 (1998)](https://research.aalto.fi/en/publications/smaa-stochastic-multiobjective-acceptability-analysis/) — the acceptability index and central weight vector.
14. [SMAA-2: Stochastic Multicriteria Acceptability Analysis for Group Decision Making — R. Lahdelma & P. Salminen, *Operations Research* 49(3):444–454 (2001)](https://doi.org/10.1287/opre.49.3.444.11220) — the rank acceptability index.
15. [LineUp: Visual Analysis of Multi-Attribute Rankings — S. Gratzl, A. Lex, N. Gehlenborg, H. Pfister & M. Streit, IEEE InfoVis (2013)](https://data.jku-vds-lab.at/papers/2013_infovis_lineup.pdf) — read as prior art for `RankFlow`, declined as a dependency.
