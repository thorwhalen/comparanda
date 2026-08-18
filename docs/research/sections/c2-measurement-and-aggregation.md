# Levels of measurement, the Likert-averaging argument, and aggregation methods

**Research question(s):** What arithmetic is legal on `comparanda`'s data, and what aggregation and
reduction methods should the core actually ship? Specifically: (A) is the "1–5 ratings are ordinal,
do not average them" position defensible against the robustness literature, and does the
item-vs-scale distinction change it; (B) for weighted sum, TOPSIS, AHP, PROMETHEE, ELECTRE, Pareto
dominance and sensitivity analysis — what does each assume, when does it mislead, how hard is it to
build, and do we ship it.

**Brief section:** `docs/research/terminology.md` §2 (levels of measurement and the averaging
question) and §3 (aggregation methods, if we offer them at all).

**Evidence grade:** **strong** — the measurement debate, the rank reversal literature and the
incomplete-data skyline result are all settled in primary sources that were read directly; the
dominance-semantics recommendation is my own synthesis (numerically verified, but not lifted from a
paper).

**Citation audit (post-review).** Every reference was re-checked against its source or against
Crossref/OpenAlex metadata. Corrections made: the ELECTRE chapter's URL was dead and its page range
wrong (both fixed in [11], with an access caveat — its quotations are the one materially
unverifiable element left in this section); the per-rank **rank acceptability index** was
misattributed to SMAA (1998) when it belongs to SMAA-2 (2001), now [27]; a claim that SAW was the
*only* rank-reversal-free method in [15] was an overstatement; the Havlicek & Peterson simulation
distributions were wrongly described and are now checked against the primary source [28]; and a
sentence attributed to JMP's documentation is not on the cited page and has been withdrawn. The
verbatim quotations from [4], [6], [9], [10], [15], [19], [21] and [25] were checked
character-for-character and all hold.

---

## Bottom line

The specification's position survives, but its stated *reason* needs replacing. The strongest
counter-argument — Norman's robustness result and Carifio & Perla's defence [3][4][5] — is genuinely
compelling **and does not apply to us**, because it is an argument about *inferential tests* on a
*summed multi-item scale* measuring *one latent construct* across *many respondents*. `comparanda`
has none of those properties: a total column is a descriptive statistic over a dozen deliberately
heterogeneous criteria for one alternative. Carifio & Perla themselves say a Likert scale needs
"8 items at a minimum" of the *same* construct before the composite means anything [4], and Liddell
& Kruschke show that averaging ordinal items does not rescue the analysis anyway [6]. So: **confirm
ADR-0015, amend ADR-0003** to drop the flat "averaging is a category error" phrasing in favour of a
two-part argument (Stevens's invariance argument [1], which is contested, *plus* the
non-compensation argument [11], which is not).

Concretely, ship three things and skip the rest. **Pareto dominance** as the default reduction, with
a three-valued semantics over missing cells — `certainly dominates` / `possibly dominates` /
`incomparable` — computed by naive O(n²·m) pairwise scan, which is correct and fast enough at our
scale [18][19]. **Conjunctive screening** for the "veto criterion with a threshold" feature — and
note that this is *not* ELECTRE's veto threshold; ADR-0015 asserts a mapping that is wrong on the
detail [11][13]. **Weighted sum** as the single opt-in aggregation, normalised against *declared*
per-criterion ranges rather than observed extrema, which is what makes it immune to the rank
reversal that afflicts AHP and TOPSIS [15][16], plus a closed-form weight-flip sensitivity margin
[20] and a Monte-Carlo rank-acceptability analysis [22][27]. Do not ship AHP, TOPSIS, PROMETHEE or
ELECTRE III.

Do **not** implement the obvious "compare only on the criteria where both alternatives have a value"
rule for missing cells. It is the published definition in the incomplete-data skyline literature and
it is *non-transitive and admits cycles*, which can empty the front entirely [19].

---

## Findings

### Part A — levels of measurement

#### A.1 What Stevens actually claims, and how contested it is

Stevens's 1946 typology defines each scale by the group of transformations that leave its
empirical structure invariant, and derives "permissible statistics" from that invariance: an
ordinal scale is invariant under any monotone increasing transformation, so the median and
percentiles are meaningful and the arithmetic mean is not [1]. That is the formal engine behind
`domain-model.md`'s legal-operations table, and it is correct *as a statement about meaningfulness
under transformation*.

It is not, however, uncontested as a rule for practice. Velleman & Wilkinson argue that Stevens's
terminology "fails to deal with classical criticisms at the time it was proposed and ignores
important developments in data analysis over the last several decades", and that scale type does
not, on its own, determine which statistics are legitimate [2]. **(EVIDENCE, [1][2].)**

This matters for us in one specific way: the invariance argument condemns the mean but it *equally*
condemns any monotone re-encoding we might apply to make the mean look better. It is a statement
about the *number*, not about the *tooling*. **(REASONING, not evidence.)**

#### A.2 The strongest counter-argument, stated fairly

The robustness case has three legs, and it is a good case.

1. **Parametric tests are robust to violations of the interval assumption.** Norman's review
   argues that reviewers routinely reject parametric analysis of Likert data on Stevens-derived
   grounds, and that "many studies dating back to the 1930s consistently demonstrate that
   parametric statistics are robust with respect to violations of these assumptions", citing among
   others the Havlicek & Peterson simulations, and concluding that Pearson correlation is robust
   to Likert scale length when distributions are approximately normal and relationships linear [3].
   **(EVIDENCE, [3] — Norman's text is paywalled; the quoted sentence is from the abstract, so treat
   the *conclusion* as high-confidence and Norman's own framing of the cited studies as
   moderate-confidence.)** The Havlicek & Peterson parameters have now been checked against the
   primary source [28] rather than a secondary summary: sample sizes "from 5 to 60" ✓ and
   "5,000 sets of samples of n = 5 or n = 15 and 3,000 sets of samples of n = 30 and n = 60" ✓
   (i.e. 3,000–5,000 replications). But the four simulated distributions are **normal, positively
   skewed, negatively skewed and leptokurtic** — *not* "normal, rectangular and ordinal scales" as
   an earlier draft of this section stated. Their conclusion is that "the Pearson r is insensitive to
   rather extreme violations of the basic assumptions of normality and type of measurement scale"
   [28]. **(EVIDENCE, [28] — abstract verified verbatim via Crossref.)**

2. **The debate conflates a response format with a measurement scale.** Carifio & Perla's central
   move — and it is the strongest single point in the whole literature — is that Jamieson [7] and
   her sources use "scale" to mean "the 1–5 response format on one question", where measurement
   theory means "a validated composite of many items". Verbatim: *"Many studies have shown that
   Likert Scales (as opposed to single Likert response format items) produce interval data and that
   the F-test is very robust to violations of the interval data assumption and moderate skewing and
   may be used to analyze 'Likert data' (even if it is ordinal), but not on an item-by-item
   'shotgun' basis, which is simply a current research and analysis practice that must stop."* [4]
   They are explicit that a scale is an **emergent property** of a group of items and that "one does
   not really have what is truly meant by the word and term scale in measurement and psychometrics
   until one has a minimum group of such observations (i.e., 8 items at a minimum usually), as it is
   this measurement scale on which one obtains the required reliability and validity" [4].
   **(EVIDENCE, [4] — read directly, quotations verbatim from the paper.)** The 2008 follow-up
   restates this for the medical-education audience [5].

3. **Practitioner guidance already encodes the distinction.** Boone & Boone's widely-cited
   extension-service note tells practitioners to analyse a *Likert-type item* with frequencies,
   mode and median, and a *Likert scale* (composite) with mean and standard deviation [8]; an HRI
   methods review found that across four years of a major conference only 3 of 110 papers applied
   correct statistical testing to correctly-designed Likert scales [9]. **(EVIDENCE, [8][9].)**

If you accept legs 1–3, the conclusion is: averaging *is* often fine, and a tool that refuses is
being pedantic. That is a fair reading and it deserves to be recorded as such.

#### A.3 Why it nonetheless does not license a total column in `comparanda`

Three reasons, in increasing order of force.

**(i) The counter-evidence to the counter-argument is strong and recent.** Liddell & Kruschke
surveyed every article mentioning "Likert" in three flagship psychology journals and found 100%
analysed ordinal data with a metric model; they then demonstrate by simulation not only inflated
Type I and Type II error rates but *systematic inversions* — "treating ordinal data as metric
indicates the opposite ordering of means than the true ordering of means" — and, critically for the
item-vs-scale question, state verbatim: *"We demonstrate that averaging across multiple ordinal
measurements does not solve or even ameliorate these problems."* They add that "there is no sure-fire
way to detect these problems by treating the ordinal values as metric" [6]. **(EVIDENCE, [6] —
abstract read verbatim from the institutional repository.)** That last clause is the operationally
important one: the failure is *silent*. A tool cannot warn you when your mean is inverted.

**(ii) Legs 1 and 2 of the robustness case are about statistical inference, and we are not doing
inference.** Norman is defending the t-test, ANOVA, regression and Pearson correlation — procedures
with a sampling distribution, over samples of 5 to 60 respondents [3]. A `comparanda` total column
is a descriptive statistic: one number per row, computed from ~12 numbers, with n = 1. No sampling
distribution exists, so "the F-test is robust" is not a claim about it. **(REASONING, not evidence —
but it is the reasoning that decides the question.)**

**(iii) A row of criteria is not a scale, in the exact sense Carifio & Perla define.** A Likert
scale is a composite of ≥8 items *deliberately written to measure the same latent construct*, whose
inter-item reliability has been established; that redundancy is what makes the composite behave
like an interval quantity [4]. `comparanda`'s criteria are the opposite by design — they are chosen
to be *non-redundant*, each capturing a different consideration, and the whole point of the tool is
that the shape across them carries information. Averaging them is precisely the "item-by-item
shotgun" practice Carifio & Perla say "must stop", applied across *different* constructs rather
than within one. The defence of averaging, read carefully, is an argument *against* our total
column, not for it. **(REASONING from the direct quotations in [4]; I consider this the decisive
point.)**

**(iv) The independent, uncontested argument.** Even setting measurement theory entirely aside, a
weighted sum is a *fully compensatory* aggregation: a loss on one criterion is always redeemable by
a gain on another. The ELECTRE literature treats the unacceptability of that trade as one of the
five named conditions under which outranking methods are the right family, alongside the condition
that "actions are evaluated (for at least one criterion) on an ordinal scale ... These scales are
not suitable for the comparison of differences" [11]. **(EVIDENCE, [11] — read directly, §2.1.)**
This argument does not depend on Stevens at all, and nobody in the Likert debate disputes it. It
should become ADR-0015's primary justification.

#### A.4 Item vs scale — the practical rule for us

| | Likert **item** (one question, one respondent) | Likert **scale** (validated composite, ≥~8 items, one construct) | A `comparanda` **row** (heterogeneous criteria) |
|---|---|---|---|
| Level | ordinal [7][8] | argued to be effectively interval [4][5] | **not a scale at all** |
| Mean defensible? | no [8] | contested but defensible [3][4][5]; disputed by [6] | no — the composite has no construct |
| Our analogue | a single `measure` on a single cell | a criterion **group** whose members are declared redundant | the whole row |

The one place the item/scale distinction earns its keep in our schema: **a criteria group may
declare itself a scale.** If an author groups five criteria and marks that group `composite: true`
(asserting they measure one thing), then a within-group mean is a defensible operation and the
tooling can offer it without a warning — that is exactly the composite case the literature
defends. Across groups, and across a whole row, it is not. **(REASONING, grounded in [4].)**

#### A.5 How established tools communicate this without lecturing

The pattern in real products is identical and it is *not* a warning dialog. **The level of
measurement is a first-class, visible property of the column, and it silently changes what the tool
offers.**

- **Vega-Lite** requires every encoded field to declare a `type` from `quantitative | temporal |
  ordinal | nominal | geojson`, and documents the consequence at the point of declaration —
  quantitative scales include zero by default; ordinal "represents ranked order (1st, 2nd, …)" with
  no meaningful comparison of magnitude; nominal "differentiates between values based only on their
  names or categories" [10]. The type is not advice, it is the input that determines the scale and
  the mark. **(EVIDENCE, [10] — documentation read directly.)**
- **JMP** attaches a *modeling type* — the page names **Continuous, Nominal, Ordinal and None** — to
  every column, and surfaces it as a clickable icon in the Columns panel: the documentation refers to
  "Modeling Type Icons in the Columns Panel" and tells the reader to "Click an icon to change the
  modeling type to Continuous, Nominal, Ordinal, or None" [12]. The modeling type then drives which
  analyses and summary statistics JMP offers. **(EVIDENCE, [12] — page fetched and read directly; the
  type list and the icon behaviour are verbatim.)** An earlier draft of this section attributed to
  [12] the sentence *"the order is used in the analysis but the spacing or distance between the
  ordered levels is not used"*; **that wording does not appear on the cited page** and has been
  removed *(UNVERIFIED — could not locate source)*. It is not needed: the icon-plus-gating behaviour
  is what the design lesson rests on, and that is verified.
- **SPSS** does the same with its Scale / Ordinal / Nominal measurement level and its column-header
  icons. *(UNVERIFIED — the IBM documentation page returned 403 and I could not confirm the exact
  wording; the pattern is asserted from the JMP and Vega-Lite evidence, not from an SPSS source.)*

The design lesson: **do not warn, gate.** A tooltip on the column header that says "ordinal — order
only; medians, not means" costs the reader nothing if they already know, and teaches them if they
do not. A modal that appears when they click "Total" teaches nobody and gets dismissed. When the
user does ask for an illegal operation, offer it *with the method and its assumption printed in the
column header of the result*, which is what ADR-0015 already demands.

---

### Part B — aggregation and reduction methods

For each: assumptions, failure mode, difficulty, verdict.

#### B.1 Weighted sum / simple additive weighting (SAW, WSM)

**Assumes** interval-or-better performance values on a common normalised scale; preferential
independence between criteria; full compensation; and weights that are *scaling constants* tied to
the range of each criterion, not "importances".

**Misleads** in four named ways.

1. **Weights elicited without ranges are meaningless.** This is the single most common error in
   practice; Keeney catalogues twelve mistakes in eliciting trade-offs, of which assigning
   importance weights with no reference to the range of each attribute is the archetype [21].
   `comparanda` will be handed weights by people who have never heard of swing weighting, every
   time. **(EVIDENCE, [21] — from the verified abstract and title; full text paywalled, so the
   *specific* enumeration is moderate-confidence, the existence and thrust of the paper are
   high-confidence.)**
2. **Compensation hides the shape.** ADR-0015 already states this correctly and the outranking
   literature names it as a design condition [11].
3. **Rank reversal, if you normalise relatively.** The literature review of rank reversal across 130
   articles finds AHP (99 of the 130 articles, 76%), TOPSIS, ELECTRE, PROMETHEE, TODIM and DEA all
   exhibit it, and attributes AHP's and TOPSIS's to *normalisation procedures* that make each
   alternative's score depend on the set of alternatives present; **SAW is among the methods that
   review reports as producing no rank reversals** — it cites Zanakis et al. that *"MEW and SAW
   methods have not produced any rank reversals"*, and separately notes WPM being used in place of
   AHP because it does not suffer from RR — while MAVT is treated as the immune reference standard,
   *"a good reference because it has strong normative foundations and is immune to rank reversal"*
   [15]. **(EVIDENCE, [15] — read directly. Note SAW is not the *only* clean method in the review,
   as an earlier draft of this section claimed; MEW and WPM are also reported clean.)** The actionable consequence: a weighted sum that normalises
   by the *observed* min/max of the current alternative set inherits the AHP/TOPSIS failure; one
   that normalises against a *declared* range per criterion does not. **(REASONING from [15].)**
4. **It is silently wrong on ordinal data** in the Liddell & Kruschke sense [6].

**Difficulty:** trivial — an hour, including tests.

**Ship?** **Yes, as the only aggregation.** Opt-in, labelled, warns on ordinal criteria, and
normalises against declared ranges. Refuse to run at all if any participating criterion has no
declared range, rather than silently substituting observed extrema — that refusal is the whole
value of shipping it.

#### B.2 TOPSIS

**Assumes** a meaningful Euclidean distance between alternatives in normalised criterion space, and
hence interval-or-better data on all criteria. Ranks by relative closeness to an ideal and an
anti-ideal solution.

**Misleads:** rank reversal is well documented. García-Cascales & Lamata identify two causes — the
norm TOPSIS uses, and the choice of positive- and negative-ideal solutions — and show that both
relative and absolute normalisation suffer it, with absolute scales merely reducing the rate [16].
**(EVIDENCE, [16] — from the verified abstract and the corroborating review [15].)** The
Euclidean-distance assumption is a strictly stronger commitment than the weighted sum's, so
everything wrong with §B.1 on ordinal data is worse here.

**Difficulty:** easy (a day). **Ship? No.** It costs more assumption than a weighted sum and buys
nothing a weighted sum does not, while adding a failure mode (rank reversal) the weighted sum does
not have.

#### B.3 AHP and rank reversal

**Assumes** the decision-maker can supply consistent pairwise ratio judgements on a 1–9 scale, both
between criteria and between alternatives on each criterion; and that the principal eigenvector of
the comparison matrix recovers a ratio-scale priority vector.

**Misleads:** Belton & Gear showed in 1983 that AHP can reverse the ranking of alternatives when a
copy of an existing alternative is added, and attributed it to normalising each criterion's priority
vector to sum to 1 [14]; Dyer's 1990 critique in *Management Science* and the ensuing exchange with
Harker, Vargas and Saaty is the canonical treatment [14]. The 2018 review confirms AHP is by a wide
margin the most rank-reversal-afflicted method studied [15]. **(EVIDENCE, [14][15].)** Independently:
elicitation cost is O(n²) pairwise judgements per criterion, which is unusable at our target of tens
to low hundreds of alternatives.

**Difficulty:** moderate (eigenvector plus consistency ratio plus an elicitation UI). **Ship? No.**
The elicitation cost alone disqualifies it at our scale; rank reversal disqualifies it on merit.

#### B.4 PROMETHEE

**Assumes** a per-criterion *preference function* mapping the performance difference between two
alternatives to a degree of preference in [0,1]. Brans & Vincke define six generalised criterion
shapes, parameterised by up to three thresholds: **q** (indifference), **p** (preference) and **s**
(Gaussian) [13]. Net flows then rank the alternatives. **(EVIDENCE, [13] — from the verified
citation and multiple corroborating secondary sources; the primary is paywalled.)**

**Misleads:** exhibits rank reversal via flow-score differences [15]; and the six-function menu is a
significant elicitation burden that mostly gets defaulted away.

**Difficulty:** moderate. **Ship? No** — but **steal the vocabulary**. The `q`/`p` threshold pair is
exactly the right way to express "a one-step difference on this 1–5 criterion is not meaningful",
and it applies just as well to dominance (§B.6) as to PROMETHEE.

#### B.5 ELECTRE, and the veto threshold — the mapping in ADR-0015 is wrong

This is the most consequential correction in this section.

ELECTRE builds a binary **outranking relation** `S` meaning "at least as good as", from which four
situations follow for a pair (a, b): `aPb` (a strictly preferred), `bPa`, `aIb` (indifferent), and
`aRb` (**incomparable**) [11]. Construction rests on two tests, quoted verbatim: *"Concordance. For
an outranking aSb to be validated, a sufficient majority of criteria should be in favor of this
assertion."* and *"Non-discordance. When the concordance condition holds, none of the criteria in the
minority should oppose too strongly to the assertion aSb."* [11] Roy's 1991 paper is the foundational
statement [17].

The three thresholds, per criterion j:

| Symbol | Name | Meaning |
|---|---|---|
| `q_j` | **indifference threshold** | difference below which two alternatives are indifferent on j |
| `p_j` | **preference threshold** | difference above which preference on j is strict |
| `v_j` | **veto threshold** | difference above which j alone blocks the outranking assertion |

with `q_j ≤ p_j ≤ v_j` required. Figueira, Mousseau & Roy define the veto verbatim: *"Veto thresholds
express the power attributed to a given criterion to be against the assertion 'a outranks b', when
the difference of the evaluation between g(b) and g(a) is greater than this threshold. These
thresholds can be constant along a scale or it can also vary."* [11] **(EVIDENCE, [11] — chapter §2.4
read directly.)**

**The veto threshold is a threshold on a *difference between two alternatives*, not a floor on an
alternative's own value.** ADR-0015 says: *"Criteria may be marked as vetoes with a threshold;
falling below it flags the alternative regardless of other scores. This matches ELECTRE's veto
thresholds."* The first sentence describes an **absolute cutoff**; the second sentence is
**incorrect**. The established name for what ADR-0015 actually describes is a **conjunctive
(non-compensatory) screening rule** — an alternative must clear a minimum on *every* designated
criterion to remain in the consideration set. That is a well-established family alongside
lexicographic rules, satisficing and Tversky's elimination-by-aspects [23]. **(EVIDENCE, [11][23].)**

The two are not interchangeable, and each answers a different question:

- **Conjunctive screening** answers *"which alternatives are outright unacceptable?"* — one
  parameter per screening criterion, explainable in one sentence, no weights, no pairwise anything.
- **ELECTRE's `v_j`** answers *"a is better on the majority — but is b's advantage on criterion j so
  large that the majority should not carry?"* It only bites inside a *compensatory* comparison. It
  is meaningless on top of Pareto dominance, because under dominance the dominating alternative is
  never worse on any criterion, so there is nothing for a veto to object to. **(REASONING.)**

The second useful thing ELECTRE gives us for free is `aRb` — **incomparability as a first-class
outcome**, distinct from indifference. Our dominance analysis produces exactly this relation and
should use ELECTRE's name for it. Note also that ELECTRE weights are *voting power*, explicitly
"not ... substitution rates as in compensatory aggregation procedures AHP, MACBETH and MAUT", and
"do not depend neither on the ranges nor the encoding of the scales" [11] — the opposite of the
weighted-sum weights in §B.1, which is exactly why the two kinds of weight must never share a field
name in the schema.

**Difficulty of full ELECTRE III:** high. Four parameters per criterion (`w`, `q`, `p`, `v`), a
cutting level λ, a credibility index, and a descending/ascending distillation procedure whose output
is hard to explain to a reader. Choosing realistic threshold values is itself a research topic [24].
**Ship? No — ship the vocabulary and the concepts, not the method.** Adopt `q`, `p`, `v`,
"concordance", "incomparable"; ship conjunctive screening under an honest name.

#### B.6 Pareto dominance and skyline queries — the recommended reduction

**Assumes** only an ordering per criterion and a direction (higher-is-better or lower-is-better).
It requires **no weights, no normalisation, no common scale, no interval assumption** — which makes
it the only reduction in this document that is fully legal on ordinal data. That is why it should be
the default.

The database formulation is the **skyline** [18], and the geometric one is the **maximal vector**
problem, whose classical complexity is O(n log n) for d = 2, 3 and O(n (log n)^{d−2}) for d ≥ 4
[25]. **We should implement none of that.** At tens-to-low-hundreds of alternatives and tens of
criteria, the naive pairwise scan is O(n²·m): at n = 200 and m = 30 that is 1.2 million comparisons,
microseconds in JS, and it has the decisive advantage that it produces the **full pairwise relation**
— which is what the view needs anyway, to explain *why* an alternative was set aside. Block-nested-
loops and its descendants [18] exist for disk-resident data and buy us nothing. **(REASONING, from
the complexity results in [25] and our stated scale in ADR-0002.)**

**The hard part is missing values, and the published answer is a trap.** Khalefa, Mokbel &
Levandoski give the standard definition for incomplete data, verbatim:

> *"Definition 1: Given any two D-dimensional points P and Q that may have incomplete dimensions, a
> point P is said to dominate another point Q if the following two conditions hold: (1) There is at
> least one dimension u_i where both P.u_i and Q.u_i are known, and P.u_i > Q.u_i (2) For all other
> dimensions j, j ≠ i, either P.u_j is unknown, Q.u_j is unknown, or P.u_j ≥ Q.u_j."* [19]

i.e. compare only on the dimensions both points have. This is the rule any implementer would reach
for. The same paper then proves it is unusable: *"In contrast to the case of complete data where the
dominance relation is transitive, incomplete data suffer from non-transitive dominance relation
which may lead to a cyclic dominance behavior"* (abstract), and states of the general cyclic case
that *"none of these three points can be considered a skyline as each point is dominated by at least
one other point"* (§I). It then gives the worked counterexample p₁ = (4,3,4,−), p₂ = (2,1,−,5),
p₃ = (−,−,5,2), where p₁ dominates p₂ on the first two dimensions, p₂ dominates p₃ on the fourth,
and p₃ dominates p₁ on the third — concluding that *"In this case of cyclic dominance, none of the
three points can be considered a skyline as all of them are dominated"* [19]. **(EVIDENCE, [19] —
PDF retrieved and text extracted; abstract, §I and the counterexample passage all checked
character-for-character, including Definition 1 above.)**

A tool whose headline reduction can report that every alternative is dominated is worse than no
tool.

**The recommendation: interval-completion dominance, three-valued.** For every cell, derive a lower
and an upper bound. A present value gives `[v, v]`. A cell `missing` for a contingent reason
(`not-assessed`, `pending`, `unknown`, `withheld`) gives `[lo_j, hi_j]`, the declared range of the
criterion. Then define two relations:

- **`certainlyDominates(a, b)`** iff for every criterion j, `lower(a,j) ≥ upper(b,j)`, with strict
  inequality on at least one. Read: *a beats b under every possible filling-in of the blanks.*
- **`possiblyDominates(a, b)`** iff for every criterion j, `upper(a,j) ≥ lower(b,j)`, with strict on
  at least one. Read: *a beats b under at least one filling-in.*

`certainlyDominates` is a strict partial order — transitive and acyclic — which is exactly what the
naive rule fails to be. Proof sketch: if `lower(a) ≥ upper(b)` componentwise and `lower(b) ≥
upper(c)` componentwise, then since `upper(b) ≥ lower(b)` we get `lower(a) ≥ upper(c)`.
`possiblyDominates` is *not* transitive and must never be used to build a front. **(REASONING; I
verified all three claims by brute force over 200,000 random triples on a 1–5 ordinal scale with
missing cells: certain-dominance produced 0 transitivity violations and 0 three-cycles;
possible-dominance produced ~5,600 violations and ~6,600 cycles; the Khalefa common-dimensions rule
produced ~1,900 violations and ~69 cycles — confirming [19] empirically.)**

This gives the view three genuinely useful tiers instead of one:

| Tier | Definition | What the reader does |
|---|---|---|
| **dominated** | some a `certainlyDominates` it | set it aside now; no further work needed |
| **provisionally surviving** | not certainly dominated, but some a `possiblyDominates` it | *these blanks are load-bearing* — filling them may eliminate it |
| **robustly non-dominated** | nothing even possibly dominates it | on the front no matter what the blanks turn out to be |

The middle tier is a feature, not a caveat: it converts a missing value from an embarrassment into a
prioritised to-do list, which is precisely what ADR-0009 says completeness reporting is for. It also
yields the best analysis in this whole document — **"which blank cell, if filled, would most change
the picture"** — computed by, for each contingently-missing cell, counting how many
possibly-dominated pairs would resolve if it were known. That is a value-of-information ranking, it
costs one extra pass, and no spreadsheet can do it.

Two more semantic details:

- **`not-applicable` is not the same as unknown.** A criterion that does not apply to an alternative
  has no bounds to give. Treat it as *removed from the comparison for every pair involving that
  alternative on that criterion* — i.e. it contributes neither support nor obstruction. Record the
  count of dropped criteria on the relation so the view can say "a dominates b on 9 of 12 criteria;
  3 not applicable" rather than pretending the comparison was complete. **(REASONING.)**
- **Nominal criteria cannot participate in dominance at all**, since dominance needs an order.
  Exclude them from the relation by construction and say so in the result, rather than coercing them
  to an arbitrary order. **(REASONING from [1][10].)**

Optionally, apply the indifference threshold `q_j` borrowed from §B.4/§B.5: treat `a ≻_j b` only
when `value(a,j) > value(b,j) + q_j`. On a 1–5 ordinal criterion, `q_j = 1` says "one step is
noise". Ship this as an explicitly-labelled relaxation, and *report cycles* if any appear rather
than assuming acyclicity — the relaxed relation is not guaranteed to be a partial order.

#### B.7 Sensitivity analysis

Two techniques, both implementable, answering different questions. The field has a recent systematic
review that classifies the approaches [26], but you do not need its taxonomy to build these.

**(a) Weight-flip margin (local, exact, cheap).** The standard framing is Triantaphyllou & Sánchez's:
find, for each criterion, the smallest change in its weight that reverses the ranking of a pair of
alternatives, and call the criterion with the smallest such change the *most critical criterion*
[20]. For a weighted sum with weights summing to 1, where the other weights are re-normalised
proportionally, the exact flip is available in closed form. Let `D = P(a) − P(b)` be the current
score gap and `d_j = v(a,j) − v(b,j)` the gap on criterion j. Then the change `δ` in `w_j` that makes
the two alternatives tie is

```
δ*(a, b, j) = D · (1 − w_j) / (d_j − D)
```

feasible only when `w_j − 1 ≤ δ* ≤ w_j` (otherwise no achievable weight on criterion j can flip that
pair). Report `100 · |δ*| / w_j` as the percent change. **(REASONING — this is my own derivation, not
a quotation from [20], which is paywalled; I verified it numerically on 20,000 random instances with
2–6 criteria and it produced an exact tie in every feasible case, with weights remaining
non-negative and summing to 1.)** The headline number for the UI is
`min over (adjacent pairs, criteria) of |δ*|` — BRIEF.md's "a ranking that flips under a 5% weight
change is not a ranking", made computable.

**(b) Rank acceptability over the whole weight space (global, Monte Carlo).** The weight-flip margin
is a one-at-a-time analysis and understates joint sensitivity. SMAA answers the stronger question by
*"exploring the weight space"*, computing for each alternative an **acceptability index** — the share
of feasible weightings that make it the preferred one — plus a **central weight vector**, described
as *"representing the typical valuations resulting in that decision"* [22]. The generalisation from
"is it first?" to "what share of weightings give it *each* rank" — the **rank acceptability index**
`b^r_i` we actually want — is **SMAA-2**, not the original SMAA: Lahdelma & Salminen state that they
*"introduce the SMAA-2 method, which extends the original SMAA by considering all ranks in the
analysis"* [27]. **(EVIDENCE, [22] and [27] — both abstracts verified verbatim. Cite [27], not [22],
for anything per-rank.)** A serviceable implementation is ~30 lines: sample N weight vectors
uniformly from the simplex (draw `m` Exponential(1) variates and normalise — equivalently
Dirichlet(1,…,1)), score, rank, tally. N = 10,000 at n = 100, m = 20 is well under a second. Present
it as a stacked bar per alternative. If an alternative is first under 3% of all weightings, no amount
of weight-arguing will make it the answer, and that is worth knowing before the argument starts.

---

## What this means for the schema / the view / the agent

### Schema

- Keep `level: 'nominal' | 'ordinal' | 'interval' | 'ratio'` per `(criterion, measure)` (ADR-0003).
  The Vega-Lite precedent [10] confirms this is the right shape: a declared type on the field that
  determines downstream behaviour, not a comment.
- **Add a required `range` to every ordinal/interval/ratio `(criterion, measure)`**: `{ lo, hi,
  direction: 'higher-is-better' | 'lower-is-better' }`. It is load-bearing three times over — bounds
  for interval-completion dominance (§B.6), the declared normalisation that keeps weighted sum free
  of rank reversal (§B.1, [15]), and the range without which elicited weights are meaningless
  (§B.1, [21]). Ordinal criteria additionally carry ordered `levels`.
- **Add optional per-criterion thresholds, under the ELECTRE/PROMETHEE names** [11][13]:
  `indifference` (`q`), `preference` (`p`), `veto` (`v`). Document that `q ≤ p ≤ v`.
- **Add `acceptability`** — the *absolute* cutoff for conjunctive screening. This is a **different
  field** from `veto` and must not be conflated with it. If the product wants to say "veto criterion"
  in the UI, that is a display alias; the schema field is `acceptability`.
- **Two kinds of weight, never one field.** `substitutionWeight` (a scaling constant, range-dependent,
  used by weighted sum) and `votingWeight` (importance/voting power, range-independent, used by
  outranking) mean different things [11][21]. Ship only the first for now, but name it explicitly so
  the second can be added without a migration.
- Allow a criteria group to declare `composite: true`, meaning its members measure one construct;
  only then is a within-group mean offered without a warning (§A.4, [4]).

### Core — the functions to export

```ts
// —— levels of measurement (SSOT for what is legal) ——
type Level = 'nominal' | 'ordinal' | 'interval' | 'ratio';
type Verdict = { ok: true }
             | { ok: 'qualified'; warning: string; citation: string }
             | { ok: false; reason: string };

permittedStatistics(level: Level): ReadonlySet<StatisticName>;
checkStatistic(stat: StatisticName, level: Level): Verdict;   // never throws; the caller renders it

// —— non-aggregating reductions (the default, ADR-0015) ——
type Relation = 'certainly-dominates' | 'possibly-dominates' | 'incomparable' | 'equivalent';

dominanceRelation(matrix, opts?: { measure, indifference?, includeCriteria? }): DominanceRelation;
paretoFront(matrix, opts?): {
  robust: AlternativeId[];        // nothing even possibly dominates them
  provisional: AlternativeId[];   // survive certainly, possibly dominated
  dominated: Array<{ id; by: AlternativeId[] }>;
  cycles: AlternativeId[][];      // empty under certain-dominance; populated if `indifference` used
  excludedCriteria: CriterionId[];// nominal criteria, and any without a declared range
};
explainDominance(a, b, matrix): {
  supporting: CriterionId[]; opposing: CriterionId[];
  notApplicable: CriterionId[]; undetermined: CriterionId[];
};
blockingCells(matrix): Array<{ alternative; criterion; pairsResolved: number }>;
                                  // value-of-information: which blank most changes the picture

conjunctiveScreen(matrix, thresholds): {                       // NOT ELECTRE's veto — see §B.5
  passing: AlternativeId[];
  failing: Array<{ id; failedOn: Array<{ criterion; value; threshold }> }>;
  undetermined: Array<{ id; unknownOn: CriterionId[] }>;        // cannot screen across a blank
};

// —— aggregation (opt-in, labelled, ADR-0015) ——
weightedSum(matrix, { weights, ranges }): {
  scores: Map<AlternativeId, number>;
  method: 'weighted-sum';
  assumptions: string[];      // rendered at the point of use, not in docs
  warnings: Warning[];        // one per ordinal criterion participating
  refusals: Refusal[];        // criteria with no declared range: refuse, do not guess
};

// —— sensitivity ——
weightFlipMargins(matrix, weights): Array<{
  higher; lower; criterion; delta; percentOfWeight; feasible: boolean }>;
mostCriticalCriterion(matrix, weights): { criterion; percentOfWeight } | null;
rankAcceptability(matrix, { samples = 10_000, rng }): {   // SMAA-2 semantics, [27]
  indices: Map<AlternativeId, number[]>;      // b^r_i, share of weightings giving rank r
  centralWeights: Map<AlternativeId, number[]>;           // central weight vector, [22]
};
```

Three rules on this surface. Every analysis returns its `assumptions` as data so the view can print
them next to the result (ADR-0015). Nothing throws on an illegal operation — it returns a `Verdict`
or a `refusals` list, because the caller, not the core, decides whether to render a warning or hide
a menu item. And `paretoFront` returns `cycles` even though it is provably empty in the default
configuration, so that the relaxed configurations cannot silently lie.

**Do not export:** `topsis`, `ahp`, `promethee`, `electre`. If a consumer asks, the answer is
`paretoFront` plus `weightedSum` plus `rankAcceptability`, which dominates all four on assumptions
per unit of insight.

### View

- **Level of measurement is a glyph in the column header with a tooltip**, following JMP and
  Vega-Lite [10][12]. Ordinal columns simply do not offer "mean" in their menu. No modal.
- The dominance result renders as three tiers, not two. The **provisional** tier is where the
  blanks live and should be the most interactive part of the screen.
- Incomparability is rendered as itself, borrowing ELECTRE's `aRb` [11] — never as a tie.
- Weight sliders show the flip margin live: *"this ranking survives a ±18% change in Cost."*

### Agent (`rubricator`)

- When it fills a cell it must set `level` and `range`; a criterion emitted without a declared range
  is a schema violation, not a default.
- It should prefer `pending`/`unknown` over a guessed value, because a blank now merely makes an
  alternative *provisionally* surviving, whereas a wrong value can eliminate the right answer
  certainly. The dominance semantics recommended here make ADR-0009's qualified-absence stance
  mathematically, not just morally, correct.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0003 | **amend** | Replace the bare "averaging a 1–5 rating is a category error" with the two-part argument: Stevens's invariance [1] (contested by [2][3][4]) *plus* the uncontested non-compensation argument [11]. Record Norman/Carifio & Perla fairly [3][4] and state why they do not apply to a heterogeneous criteria row. Add the required `range` and `direction` per `(criterion, measure)`. |
| ADR-0015 | **amend** | The "veto criterion with a threshold" is a **conjunctive screening rule** [23], not ELECTRE's veto threshold `v_j`, which thresholds a *pairwise difference* [11]. Correct the claimed mapping, rename the schema field to `acceptability`, and reserve `veto` for the ELECTRE sense. Also: specify the three-tier dominance output and forbid the common-dimensions rule [19]. Otherwise **confirm** — the no-default-aggregation decision is upheld on stronger grounds than it was made on. |
| ADR-0009 | **confirm** | The reason codes turn out to be load-bearing for dominance: `not-applicable` removes a criterion from a comparison, the contingent codes widen a cell to its declared range. Missingness earns its complexity here. |
| ADR-0010 | **confirm** | Nothing in this section touches encodings. |
| — | **new ADR** | *"Dominance semantics over incomplete and mixed-level data."* Fix `certainlyDominates` / `possiblyDominates` on interval completion; state that the common-dimensions rule is rejected because it is non-transitive and cyclic [19]; state that nominal criteria and criteria without a declared range are excluded by construction; state that the naive O(n²·m) scan is the chosen algorithm and why. This is the most consequential algorithmic decision in the core and it deserves its own record. |
| — | **new ADR** | *"Two kinds of weight."* `substitutionWeight` (compensatory, range-dependent) and `votingWeight` (outranking, range-independent) are different quantities [11][21] and must never share a field. |

---

## Open questions

1. **Should `withheld` widen to the full range, or be excluded like `not-applicable`?** Someone knows
   the value; it is unknown *to this reader*. Widening is the safe choice and is what I recommend,
   but a case exists for treating it as structurally absent so an analysis shared outside the
   need-to-know group is not silently more conservative than the one inside it. Settle it by
   deciding whether two readers with different access should ever see different fronts.
2. **Norman's full text is still unread** (paywalled); his conclusion is quoted from the abstract.
   The Havlicek & Peterson parameters he cites have since been checked against that paper's own
   abstract [28] — sample sizes and replication counts confirmed, the distribution list corrected
   (§A.2). This does not change the recommendation, but if the ADR is going to quote Norman himself,
   someone should read his PDF.
   **Higher priority: the ELECTRE chapter [11].** Its quotations underpin §B.5, the section's most
   consequential correction, and the copy they were taken from no longer exists online. Someone with
   library access should re-verify those four quotations against the printed chapter before ADR-0015
   is amended on their authority. The *substance* of the correction does not depend on them — the
   q/p/v threshold triple is independently attested by [24]'s title alone, and Roy [17] is the
   foundational statement — but the section quotes wording it can no longer show anyone.
3. **Whether the `q`-relaxed dominance relation is worth shipping at all.** It is strictly more
   useful on a coarse 1–5 scale and strictly less safe (cycles possible). A week of use on the messy
   example dataset from ADR-0016 would settle it: if the relaxation empties or tangles the front on
   realistic data, drop it.
4. **Value-of-information ranking beyond pair-counting.** "How many possibly-dominated pairs would
   resolve" is a crude proxy for "how much would knowing this change the decision". A proper
   treatment is an expected-value-of-information calculation, which needs a prior over the missing
   cell. Probably out of scope; worth one paragraph in the new dominance ADR explaining that the
   cheap proxy was chosen deliberately.
5. **`composite: true` groups.** I recommend the affordance but have not designed it. It needs at
   minimum a reliability statistic before the tool endorses a within-group mean, and computing one
   requires multi-rater data (ADR-0011). Sequence it after Phase 4.

---

## REFERENCES

1. [On the Theory of Scales of Measurement — S. S. Stevens (1946)](https://www.science.org/doi/10.1126/science.103.2684.677)
2. [Nominal, Ordinal, Interval, and Ratio Typologies Are Misleading — Paul F. Velleman & Leland Wilkinson (1993)](https://www.tandfonline.com/doi/abs/10.1080/00031305.1993.10475938)
3. [Likert scales, levels of measurement and the "laws" of statistics — Geoff Norman (2010)](https://link.springer.com/article/10.1007/s10459-010-9222-y)
4. [Ten Common Misunderstandings, Misconceptions, Persistent Myths and Urban Legends about Likert Scales and Likert Response Formats and their Antidotes — James Carifio & Rocco J. Perla (2007)](https://thescipub.com/abstract/jssp.2007.106.116)
5. [Resolving the 50-year debate around using and misusing Likert scales — James Carifio & Rocco J. Perla (2008)](https://asmepublications.onlinelibrary.wiley.com/doi/10.1111/j.1365-2923.2008.03172.x)
6. [Analyzing ordinal data with metric models: What could possibly go wrong? — Torrin M. Liddell & John K. Kruschke (2018)](https://scholarworks.iu.edu/dspace/items/9bcd0f5e-7837-4f9c-ac07-a114e595e146)
7. [Likert scales: how to (ab)use them — Susan Jamieson (2004)](https://asmepublications.onlinelibrary.wiley.com/doi/10.1111/j.1365-2929.2004.02012.x)
8. [Analyzing Likert Data — Harry N. Boone Jr. & Deborah A. Boone (2012)](https://commons.joe.org/joe/vol50/iss2/48/)
9. [Four Years in Review: Statistical Practices of Likert Scales in Human-Robot Interaction Studies — Mariah L. Schrum, Michael Johnson, Muyleng Ghuy & Matthew C. Gombolay (2020)](https://arxiv.org/abs/2001.03231)
10. [Type — Vega-Lite documentation (n.d.)](https://vega.github.io/vega-lite/docs/type.html)
11. [Electre Methods (chapter, *Multiple Criteria Decision Analysis: State of the Art Surveys*, pp. 133–153) — José Figueira, Vincent Mousseau & Bernard Roy (2005)](https://doi.org/10.1007/0-387-23081-5_4) — title, authors and page range verified via Crossref and OpenAlex. **Access caveat:** the copy originally consulted (a Paris-Dauphine institutional-repository handle) is gone — that host no longer resolves — and the chapter is closed access with no open-access copy indexed anywhere. The quotations attributed to [11] in §A.3(iv), §B.5 and §B.6 below were transcribed from that copy and **cannot currently be re-verified against an accessible source**. The substantive claims they support are independently corroborated (see [17] and [24]); the *wordings* are not.
12. [About Modeling Types — JMP documentation (n.d.)](https://www.jmp.com/support/help/en/19.0/jmp/about-modeling-types.shtml)
13. [Note—A Preference Ranking Organisation Method: The PROMETHEE Method for Multiple Criteria Decision-Making — J. P. Brans & Ph. Vincke (1985)](https://pubsonline.informs.org/doi/10.1287/mnsc.31.6.647)
14. [Remarks on the Analytic Hierarchy Process — James S. Dyer (1990)](https://doi.org/10.1287/mnsc.36.3.249) — *Management Science* 36(3):249–258. DOI now **verified** to resolve to this paper (title and author confirmed via Semantic Scholar; the INFORMS landing page bot-blocks automated fetches, hence the 403, but the record is real). The companion primary source is Belton, V. & Gear, T., ["On a short-coming of Saaty's method of analytic hierarchies"](https://doi.org/10.1016/0305-0483(83)90047-6), *Omega* 11(3):228–230, 1983 — DOI located and verified via Crossref (note the published title hyphenates "short-coming").
15. [The Rank Reversal Problem in Multi-Criteria Decision Making: A Literature Review — Renan F. F. Aires & Luciano Ferreira (2018)](https://www.scielo.br/j/pope/a/BPwgsywPZqgctBDcfPXxczg/?lang=en)
16. [On rank reversal and TOPSIS method — M. S. García-Cascales & M. T. Lamata (2012)](https://www.sciencedirect.com/science/article/pii/S0895717711007850)
17. [The outranking approach and the foundations of ELECTRE methods — Bernard Roy (1991)](https://link.springer.com/article/10.1007/BF00134132)
18. [The Skyline Operator — Stephan Börzsönyi, Donald Kossmann & Konrad Stocker (2001)](https://doi.org/10.1109/ICDE.2001.914855)
19. [Skyline Query Processing for Incomplete Data — Mohamed E. Khalefa, Mohamed F. Mokbel & Justin J. Levandoski (2008)](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf)
20. [A Sensitivity Analysis Approach for Some Deterministic Multi-Criteria Decision-Making Methods — Evangelos Triantaphyllou & Alfonso Sánchez (1997)](https://repository.lsu.edu/eecs_pubs/1396/)
21. [Common Mistakes in Making Value Trade-Offs — Ralph L. Keeney (2002)](https://pubsonline.informs.org/doi/10.1287/opre.50.6.935.357)
22. [SMAA — Stochastic multiobjective acceptability analysis — Risto Lahdelma, Joonas Hokkanen & Pekka Salminen (1998)](https://research.aalto.fi/en/publications/smaa-stochastic-multiobjective-acceptability-analysis/) — *European Journal of Operational Research*. Abstract verified. Note this paper defines the **acceptability index** (share of weightings making an alternative *the preferred one*) and the **central weight vector**; it does **not** define per-rank indices — for those see [27].
23. [Elimination by aspects: A theory of choice — Amos Tversky (1972)](https://doi.org/10.1037/h0032955)
24. [Choosing realistic values of indifference, preference and veto thresholds for use with environmental criteria within ELECTRE — Martin Rogers & Michael Bruen (1998)](https://www.sciencedirect.com/science/article/abs/pii/S0377221797001756)
25. [On Finding the Maxima of a Set of Vectors — H. T. Kung, F. Luccio & F. P. Preparata (1975)](https://www.eecs.harvard.edu/~htk/publication/1975-jacm-kung-luccio-preparata.pdf)
26. [Sensitivity analysis approaches in multi-criteria decision analysis: A systematic review — Jakub Więckowski & Wojciech Sałabun (2023)](https://www.sciencedirect.com/science/article/pii/S156849462300933X) — *Applied Soft Computing*; DOI [10.1016/j.asoc.2023.110915](https://doi.org/10.1016/j.asoc.2023.110915).
27. [SMAA-2: Stochastic Multicriteria Acceptability Analysis for Group Decision Making — Risto Lahdelma & Pekka Salminen (2001)](https://doi.org/10.1287/opre.49.3.444.11220) — *Operations Research* 49(3):444–454. This, not [22], is the source for the **rank acceptability index** (per-rank shares). Abstract verified via Crossref.
28. [Robustness of the Pearson Correlation against Violations of Assumptions — Larry L. Havlicek & Nancy L. Peterson (1976)](https://doi.org/10.2466/pms.1976.43.3f.1319) — *Perceptual and Motor Skills* 43(3):1319–1334. Cited second-hand by Norman [3]; abstract verified directly here to check the simulation parameters quoted in §A.2.
