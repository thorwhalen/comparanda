# Inter-rater agreement, Delphi, and displaying disagreement without implying a mean

**Research question(s):** Does Krippendorff's alpha actually handle ordinal data with missing
values (comparanda's exact case), and what is the real computation, its pitfalls, and its
acceptable range? Why are Cohen's/Fleiss's kappa, ICC and Gwet's AC1/AC2 right or wrong here?
What does the Delphi method say about running a multi-round rate–discuss–revise loop well, and
should *rounds* be schema data? And how do you show rater disagreement in a matrix cell roughly
40x30 px without implying a mean?

**Brief section:** `docs/research/terminology.md` §5 — "Multi-rater agreement".

**Evidence grade:** strong — for the agreement statistics (primary sources: Krippendorff's own
computation paper, verified by reproducing his published example numerically; Feinstein &
Cicchetti on the kappa paradoxes; a peer-reviewed comparison establishing that Gwet's AC1 is not
interchangeable with kappa). Moderate for the Delphi recommendations (the method literature is
consistent about anonymity and controlled feedback but genuinely unsettled about stopping rules).
Moderate for the encoding recommendation — the perceptual principles are well evidenced
(Cleveland & McGill; Correll & Gleicher; Kay et al.), but nobody has run a controlled study of
distribution glyphs at exactly this size, so the final ranking is applied reasoning over
established findings rather than a direct empirical result.

---

## Bottom line

ADR-0011 point 4 is right about Krippendorff's alpha and wrong about where to put it. Alpha does
handle ordinal levels of measurement and missing values natively — confirmed against Krippendorff's
own computation paper [1], and reproduced exactly (his published dataset gives
α_nominal = 0.743, α_ordinal = 0.815, α_interval = 0.849; a from-scratch implementation of the
coincidence-matrix formulation returns 0.7434 / 0.8154 / 0.8491). But alpha is a **per-criterion**
statistic computed over alternatives-as-units, not a per-cell one: with two to five raters in a
single cell there is no chance-correction to be had. So compute alpha once per criterion, report it
with an interval, and never gate anything on it. **Per cell, use a shape statistic, not a
reliability coefficient** — van der Eijk's A [23] if you want a scalar, and always alongside `n`.

Do not ship Cohen's or Fleiss's kappa (wrong shape: two raters only / equal ratings per unit, and
both suffer the prevalence paradox [4]). Do not ship ICC (it assumes interval data; a 1–5 rating is
ordinal, ADR-0003). Do not adopt Gwet's AC1/AC2 as a default — its chance model *moves in the
opposite direction to kappa's* under skewed prevalence and it is not a drop-in substitute [6];
offer it as a secondary, labelled coefficient for skewed criteria only.

Support **rounds** in the schema now. The cost is one optional field on the assertion plus a small
`rounds` collection — perhaps 15 lines of schema — and retrofitting it later is a migration through
every stored analysis, exactly the failure BRIEF.md warns about. Add a per-analysis rating
**anonymity policy** with it: the most consistent structural claim in the Delphi literature is that
anonymous rating reduces the inhibition of face-to-face judgement [15], and ADR-0011's "activity is
legible" currently makes anonymous rating impossible.

For the `disagreement` encoding: **ship a rater dot strip** — the criterion's ordinal levels as
fixed slots across the cell, one dot per rater assertion, ties stacked. It is the only candidate
that uses position on a common scale (Cleveland & McGill's most accurately-read channel [21]),
shows `n` by being countable, makes bimodality literally visible as a gap, and places **no mark
whatsoever at the centroid**. Pair it with a `disagreement-spread` colour ramp whose domain is a
dispersion statistic *and nothing else* — the zoom-out and sort-by mode. Reject gradient/violin
cells (they are mean-and-error displays by construction [18]), reject diverging stacked bars in the
cell (they need a declared midpoint and n≥~20), and reject jitter outright.

---

## Findings

### 1. Krippendorff's alpha — confirmed, with the computation

#### 1.1 It is the right coefficient, and the reasons are explicit

EVIDENCE. Krippendorff states the applicability directly: alpha applies to "any number of
observers, not just two", "any metric or level of measurement (nominal, ordinal, interval, ratio,
and more)", "incomplete or missing data", and "large and small sample sizes alike, not requiring a
minimum" [1]. That is comparanda's case in four bullets. The independent NLP survey reaches the
same conclusion via a decision table: Krippendorff's alpha is the only listed coefficient that is
simultaneously nominal/ordinal/interval/ratio-capable, missing-data-capable, two-or-more-raters,
and chance-corrected [7]. Zapf et al. recommend it *exclusively* whenever there are missing values
or ordinal data [3].

#### 1.2 The computation, exactly

EVIDENCE, quoted and structurally reproduced from [1].

Build a **reliability data matrix** for one criterion: units are the **alternatives**, observers
are the **raters**, entries are the ordinal `score` values. Let `m_u` be the number of raters who
asserted a value for alternative `u`. **Alternatives with `m_u < 2` contribute nothing and drop
out** — a lone value affords no comparison. This is how missingness is handled: not by imputation,
but by simply not being pairable.

Build the **coincidence matrix** `o`, a V×V matrix over the value domain. It tabulates *values*,
not units, and enters each unit's pairs twice (as c–k and as k–c), so it is symmetric:

```
o_ck = Σ_u  (number of ordered c–k pairs in unit u) / (m_u − 1)
n_c  = Σ_k o_ck                (marginal: pairable values equal to c)
n    = Σ_c n_c                 (total pairable values)
```

The `1/(m_u − 1)` divisor is what makes units with different rater counts commensurable: a unit
with `m_u` raters contains `m_u(m_u − 1)` ordered pairs and contributes exactly `m_u` to `n`.

Then:

```
α = 1 − Do / De

Do = (1/n)          Σ_c Σ_k  o_ck · δ²(c,k)
De = (1/(n(n−1)))   Σ_c Σ_k  n_c n_k · δ²(c,k)
```

The **ordinal difference function** — this is the part implementations get wrong:

```
δ²_ordinal(c,k) = ( Σ_{g=c}^{k} n_g  −  (n_c + n_k)/2 )²
```

Note what that says: ordinal distance is **not** `(c−k)²`. It is a rank distance measured in
*observed marginal mass* — the number of pairable values lying between the two ranks, minus half
the endpoints. Two adjacent ranks that many raters used are further apart than two adjacent ranks
almost nobody used. The `n_g` are the coincidence-matrix marginals, so **the difference function
depends on the data**, which is why you cannot precompute a fixed distance table. Unused ranks
(`n_g = 0`) contribute nothing and can safely be present in the value domain [1].

For contrast, `δ²_nominal(c,k) = 0 if c=k else 1`, and `δ²_interval(c,k) = (c−k)²`.

The computationally efficient form sums only one off-diagonal triangle:

```
α = 1 − (n − 1) · [ Σ_{c<k} o_ck · δ²(c,k) ] / [ Σ_{c<k} n_c n_k · δ²(c,k) ]
```

**Verification (EVIDENCE, reproduced during this research).** Krippendorff's worked dataset C is a
4-rater × 12-unit matrix with 7 missing values and `m_u` varying from 1 to 4; he publishes
α_nominal = 0.743, α_ordinal = 0.815, α_interval = 0.849 [1]. A direct implementation of the
formulas above returns **0.7434, 0.8154, 0.8491**. Use this as the golden fixture; it is the single
highest-value test in the whole agreement module because it exercises missing data, variable
`m_u`, an unpairable lone value, and all three difference functions at once.

```
raters × alternatives (· = no assertion):
A: 1 2 3 3 2 1 4 1 2 · · ·
B: 1 2 3 3 2 2 4 1 2 5 · 3
C: · 3 3 3 2 3 4 2 2 5 1 ·
D: 1 2 3 3 2 4 4 1 2 5 1 ·
```

#### 1.3 Pitfalls that will actually bite

EVIDENCE.

- **The ordinal metric is the standard implementation bug.** A widely used Python package returned
  0.789 on exactly the fixture above where R's `irr::kripp.alpha` returned 0.815 — a bug report
  and a follow-up PR [11]. If a mature library got this wrong, a fresh TypeScript port will too.
  Gate the port on the fixture.
- **Confidence intervals are the whole story at comparanda's sizes.** A criterion in a
  22-alternative matrix gives at most 22 units. Zapf et al. simulated n = 50, 100 and 200 and found
  the median empirical coverage probability approaching the nominal 95% as n grew, being "quite
  close to the theoretical" only at n = 200 [3] — and their *smallest* simulated sample is still
  more than twice comparanda's, so applying this at n≈20 is an extrapolation downward, not a
  measurement. The `krippendorffsalpha` package documentation is blunter: "For smaller samples the
  jackknife interval offers a very
  substantial improvement over the bootstrap interval, the latter of which offers quite poor
  coverage" [12]. At n≈20 the interval will be wide enough that the point estimate is close to
  meaningless on its own.
- **Alpha is per-variable.** Krippendorff: "α evaluates reliability one variable at a time" [1].
  A single alpha for a whole comparison matrix is a category error — different criteria have
  different value domains, different levels of measurement, and different rater sets.
- **α = 0 is not "no signal", it is "chance-level".** Negative alphas occur and mean systematic
  disagreement. Do not clamp.

#### 1.4 What value is acceptable

EVIDENCE. The conventional cutoffs are Krippendorff's own: rely on α ≥ 0.800; treat
0.800 > α ≥ 0.667 as good only for tentative conclusions; discard below 0.667 [2].

REASONING, and a disagreement with the standard advice. **comparanda should display these bands
and act on none of them.** Those thresholds exist for content analysis, where the goal is to
establish that a coding *instrument* is reliable enough that the coded data may then be analysed —
disagreement there is measurement error to be eliminated. comparanda's premise is the opposite:
"disagreement is a feature", and "a cell where two experienced people scored 2 and 5 is the most
decision-relevant cell on the page" (ADR-0011). A low alpha on a criterion is a *finding* — it
usually means the criterion is under-defined, which ADR-0011 point 1 already identifies as where
the most valuable threads live. Recent methodological work agrees that fixed interpretive
thresholds are too rigid for subjective tasks and that kappa-type coefficients are routinely
reported without accounting for class imbalance, sample size or rater expertise [7]. So: show the
number, show the interval, name the band, link the band's source, and never let a threshold
suppress, warn on, or exclude data.

#### 1.5 Reference implementations

| Implementation | Language | Ordinal? | Missing? | Verdict |
|---|---|---|---|---|
| `fast-krippendorff` (pln-fing-udelar) [10] | Python | yes (`level_of_measurement="ordinal"`, `value_domain=[...]`) | yes (NaN) | **The porting reference.** Vectorised, readable, has the ordinal metric spelled out as `sums_between_indices − (n_v[i1]+n_v[i2])/2` squared — the same formula as [1]. Note its ordinal history [11]. |
| `irr::kripp.alpha` [1,11] | R | yes | yes | The oracle to cross-check against. Produced 0.815 on the fixture. |
| `icr::krippalpha` [13] | R | yes | yes | Second R opinion; bootstrapped CIs. |
| `krippendorffsalpha` (Hughes) [12] | R | yes + user-defined distances | yes | Best inference story — the jackknife interval. Port the *interval* logic from here. |
| `max-schaefer/krippendorff` [14] | TypeScript | not documented beyond numbers/strings | yes (`undefined`) | **Do not depend on it.** One commit, zero stars, self-described side project, no documented ordinal metric. |

REASONING. There is no maintained, ordinal-capable, missing-data-capable Krippendorff's alpha on
npm worth taking a runtime dependency on. Given ADR-0004's "prefer boring, maintained
dependencies" and the standalone-bundle size constraint, **write it in `core`**. It is roughly 80
lines of TypeScript: build the coincidence matrix, build the difference table, two double sums.
Porting `fast-krippendorff`'s structure and validating against the fixture in §1.2 is a half-day.

---

### 2. Why not the alternatives

**Cohen's kappa — no.** Two raters only [7]. comparanda's multi-rater case is "several people may
assert a value" (ADR-0011), unbounded. It also assumes complete data. And it is the origin of the
paradoxes: Feinstein & Cicchetti showed that high observed agreement can be driven to a low kappa
by marginal imbalance, and that kappa is *higher* with asymmetric than symmetric imbalance [4]. The
magnitude is not subtle: Zec et al. report a case study with observed agreement of 71–84% and kappa
values between 0.042 and 0.230 on the same variables [5]. On a criterion where nearly every
alternative scores 4 — which is common, and is itself a finding about a badly chosen criterion —
kappa collapses toward 0 while the raters visibly agree.

**Fleiss's kappa — no.** It handles three or more raters but requires the *same number* of ratings
per unit [7]. comparanda cells will routinely have 2 raters here and 4 there; that is the normal
case, not an edge case. It is also nominal-only, so a 4-vs-5 disagreement counts the same as 1-vs-5
— which throws away the single most useful thing about an ordinal scale. It inherits the prevalence
paradox.

**Weighted kappa — no.** It is the natural ordinal answer for *two* raters [7], and comparanda is
not a two-rater tool. Its weighting scheme also has to be chosen by hand (linear vs quadratic), and
that choice materially moves the number.

**ICC — no.** ICC assumes interval/continuous data [7], and ADR-0003 has already committed to
treating a 1–5 rating as ordinal. Using ICC would silently reintroduce exactly the averaging that
ADR-0015 refuses at the aggregation layer — through the back door of the agreement statistic. There
is also a model-selection trap: there are ten forms of ICC with different assumptions and different
interpretations, and the form must be reported explicitly [9]. Offering a "reliability number"
whose meaning depends on an unreported model choice is the opposite of what this project is for.

**Gwet's AC1/AC2 — offer, do not default.** EVIDENCE. AC1 (nominal) and AC2 (ordinal, weighted)
replace kappa's chance model with one built on raters occasionally guessing on hard-to-score
subjects, giving `AC = (p_a − p_e) / (1 − p_e)` with `p_e = u · Σ π_k(1−π_k) / (q(q−1))` — expected
agreement anchored on how *ambiguous* the categories are rather than on the raters' marginals [8]. It is
explicitly designed against the kappa paradox, is rated "low" sensitivity to imbalance where
Krippendorff's alpha is "moderate" and kappa is "high" [7], handles missing data and unequal rater
counts (subjects with ≥2 raters enter `p_a`; all rated subjects enter `p_e`) [8].

The counter-argument for adopting it wholesale is real, though it is hedged in the original: Zec et
al., having demonstrated the paradox empirically, conclude that "it **might** always be appropriate
to adopt the AC1 statistics, thus bypassing any risk of incurring the paradox and drawing wrong
conclusions about the results of agreement analysis" [5].

But: a peer-reviewed comparison of basic properties concludes AC1 **is not a substitute** for
kappa. For a fixed observed agreement rate, AC1 *increases* as prevalence departs from 0.5 while
kappa *decreases*; and AC1 can take positive or negative values where there is no association
between raters at all, where kappa is 0. The authors specifically warn that the Landis & Koch
verbal bands must not be applied to AC1 values [6].

REASONING. That last point is decisive for a tool whose job is making numbers trustworthy. AC1/AC2
solves a real problem — a criterion where 20 of 22 alternatives score 4 will give a
paradoxically punitive alpha — but it solves it by moving the number in a direction that has no
published interpretive scale. So: compute AC2 (ordinal weights) **on request**, present it beside
alpha with its own label, and show it automatically only with a note when the criterion's modal
level exceeds a configurable prevalence threshold. Never present it as "the" agreement number, and
never colour a cell by it.

---

### 3. Delphi — what the method actually prescribes, and what to store

#### 3.1 The defining features

EVIDENCE. Delphi is conventionally characterised by anonymity, iteration and controlled feedback.
[15] gives the first two directly — rounds repeat and "consensus is sought through the feedback of
information and iteration", while "Anonymity offered by Delphi can reduce the inhibition normally
occurring in decision-making as individuals will be more open with their answers" [15]. (The fourth
feature usually listed, *statistical group response*, belongs to the classic Dalkey / Linstone–Turoff
formulation rather than to either source cited here.)

The RAND/UCLA Appropriateness Method — the best-documented operationalisation — is explicitly a
*modified* Delphi, and its actual structure is **two rating rounds with the face-to-face discussion
inside the second one**, not a discussion round sandwiched between two blind ones: "In the first
round, the ratings are made individually at home, with no interaction among panellists. In the
second round, the panel members meet for 1-2 days under the leadership of a moderator", and after
discussing each chapter they "re-rate each indication individually" [17]. Feedback into round 2 is
distributional plus personal but not attributed — each panellist's round-2 form shows "the frequency
of responses for each indication, as well as the individual panellist's own response" [17], so the
group is visible and the individuals are not. The manual's stated rationale for the discussion is
diagnosis rather than consensus-building: "the two-round process is designed to sort out whether
discrepant ratings are due to real clinical disagreement over the use of the procedure ['real'
disagreement] or to fatigue or misunderstanding ['artifactual' disagreement]" [17]. (A third rating
round exists in the RAM only when *necessity* criteria are also developed, and it is run by mail
[17].)

REASONING, and this is the finding that matters most: **comparanda's ADR-0011 currently specifies
the discussion round and forbids the anonymity.** Point 3 stores author on every assertion, point 7
says "recent changes are visible — what moved, who moved it, when". That is exactly right for a
transparent working document and exactly wrong for round-1 elicitation, which the RAM runs with no
interaction among panellists at all and whose feedback into the next round is distributional rather
than attributed [17]. The two are not in conflict if anonymity is *scoped and temporary*: the author
is always stored, and the *view* redacts it until the round closes.

#### 3.2 Stopping rules — stability, not consensus

EVIDENCE. Dajani, Sincoff & Talley proposed testing **stability of responses between successive
rounds** as the termination criterion, using a χ² test [16]. That much is confirmed via [15], which
reports the proposal; the 1979 article itself is paywalled, so the stronger gloss usually attached
to it — that stability must be established *before* any analysis of consensus — is
**(UNVERIFIED — could not locate source)**. And the χ² test itself is contested by the very paper
this section otherwise leans on: Holey et al. write that χ² "cannot be considered to test stability in
Delphi studies as it will determine 'the independence of the rounds from responses found in them'
not the stability of responses between separate rounds" [15]. What survives the disagreement is the
*distinction* — consensus is assessed within a round, stability between rounds [15] — not Dajani's
particular test.

Holey et al. tracked stability with weighted kappa between rounds alongside convergence measures
(rising agreement percentages, converging range and SD, falling comment volume) and reported all of
them as **trends rather than against fixed criteria**, noting that "there is no general agreement in
the literature that defines specific criteria to use to determine when consensus has been achieved,
i.e. when to stop a Delphi study" [15].

REASONING. That is a gift for a tool. "Stop when the trend flattens" is a chart, not a threshold;
comparanda can render a per-criterion round-over-round trace and let the group read it. And it
sidesteps having to hard-code a magic consensus number, which would violate both ADR-0015's stance
and the project's no-magic-numbers principle.

The natural comparanda stability statistic, per criterion, between rounds *r* and *r+1*: the
proportion of raters who changed their assertion, plus the change in the per-cell spread
distribution. Krippendorff's alpha is the *within-round* number; the *between-round* number is
churn. Do not conflate them.

#### 3.3 Should rounds be schema data? Yes. Here is the cost.

REASONING throughout.

**Cost, concretely.** One optional field on the assertion — `round?: RoundId` — plus a
per-analysis collection:

```
Round = { id, label, openedAt, closedAt?, attribution: 'attributed' | 'blind-until-close',
          feedback: 'none' | 'distribution' | 'distribution-and-rationales' }
```

That is roughly 15 lines of zodal, one optional string on the hot path, and one new top-level key
in the JSON. Storage overhead per assertion: a short id. Validation overhead: a referential check
that `round` names a declared round.

**Cost of *not* doing it now.** BRIEF.md already states the general case: "retrofitting multi-rater
onto single-value cells is a migration through every stored analysis". Rounds are the same shape of
problem one level down — retrofitting a round onto assertions that only carry a timestamp means
*inferring* round boundaries from timestamps, which is unreliable the moment anyone edits late.
Since the field is optional and the collection may be empty, a single-round analysis pays nothing.

**What rounds buy immediately, even before any Delphi UI exists:**
- The stability trace (§3.2) becomes computable rather than reconstructible.
- The anonymity policy has somewhere to live — it is a property of a round, not of an analysis.
- "Controlled feedback" becomes a declared policy rather than an emergent property of what the UI
  happens to show. What round 2 raters saw of round 1 is the single most method-critical fact in a
  Delphi study, and it should be in the record, not in someone's memory.
- Annotations (ADR-0011 point 2) can be filtered to the round they belong to, which is what makes
  "why did this score move" answerable.

**What to skip in v1:** enforcement. Do not build round locking, deadline handling, or
round-transition workflow. Store the field, compute the trace, redact by policy. The workflow can
come later without a migration — which is the whole point of putting the field in now.

---

### 4. Displaying disagreement without implying a mean

The design brief: a cell of roughly **40 × 30 CSS px**, holding **2–5 assertions** on a **K-level
ordinal scale** (K is typically 5), possibly with some raters not having asserted at all.

The information content is tiny — a multiset of small integers plus a count. The design problem is
not compression; it is **refusing to summarise**.

#### 4.1 The perceptual constraint

EVIDENCE. Cleveland & McGill's ordering of elementary perceptual tasks, from most to least
accurately performed: position along a common scale; position along non-aligned scales; length,
direction, angle; area; volume, curvature; shading and colour saturation [21]. Their design
guideline is to use tasks as high in that ordering as possible. Blascheck et al.'s smartwatch
studies — the closest available evidence for glanceable reading at very small physical sizes, with
stimuli about 29 mm square — found bar and donut charts should be preferred for quick comparison
[22]. Both point the same way: at small sizes, **position and length survive; area, angle and
saturation degrade**.

REASONING. A 40 × 30 px cell at typical density is roughly 10 × 8 mm — smaller than Blascheck's
stimuli. Any encoding whose accuracy relies on judging area, curvature, or a saturation ramp is
being asked to do its worst job at its worst size.

#### 4.2 The candidates, ranked for the dense cell

**1. Rater dot strip — ship this.** The criterion's K ordinal levels become K fixed horizontal
slots. One filled dot per rater assertion, at its level. Ties stack vertically. This is a Wilkinson
dot plot degenerated to its honest minimum, and it is the same "discrete outcomes" idea Kay et al.
validated as quantile dotplots — a discrete representation designed for small screens, which
reduced the variance of readers' probabilistic estimates by about 1.15× versus density plots [20].
Here we do not even need quantiles: with n ≤ 5 the dots *are* the data, one per rater, exactly.

At 40 px wide with K=5: 8 px pitch, 5 px dots, 3 px gaps — fits. At 30 px tall with 3 px padding:
24 px of stack, so four 5 px dots with 1 px gaps, or five 4 px dots. Beyond n=5, cap the stack and
render an overflow indicator.

Why it wins:
- **Position on a common scale** — the top of Cleveland & McGill's ordering [21].
- **`n` is countable**, not encoded. Three raters and thirty raters cannot be confused.
- **Bimodality is a literal gap.** The "2 and 5" cell ADR-0011 names shows as two dots at opposite
  ends with visible empty space between them — the most decision-relevant cell becomes the most
  visually distinctive one, with no statistic in the loop.
- **There is no mark at the centroid.** Nothing in the glyph sits where a mean would be. This is
  the requirement, and it is met structurally rather than by convention.
- **Accessible by construction.** The cell's text alternative is the exact multiset ("3 raters:
  2, 2, 5"), not a summary. ADR-0010's "never colour alone" is satisfied trivially, because the
  encoding is not colour. It survives forced-colors mode, print, and every colour-vision deficiency.

**2. Spread ramp — ship this too, as a separate registered encoding.** A single-hue sequential ramp
whose **domain is a dispersion statistic and nothing else**. This is the zoom-out mode, the
sort-by-column mode, and the thumbnail mode. It is honest specifically because value never enters
the mapping: the legend reads "unanimous → contested", and there is no central tendency to imply.
ADR-0010 already permits this shape (sequential means one hue, light to dark; direction inverts per
surface).

**3. Range bracket with rater ticks — the degradation, not the default.** A horizontal rule from
min to max with a tick per rater. Cheaper, survives below ~28 px wide. REASONING: demote it because
a drawn span reads as an *interval*, and an interval invites the eye to its midpoint. It gives back
some of what the dot strip was chosen to prevent. Use it only when the dot strip physically cannot
render.

**4. Diverging stacked bar — not in the cell; yes in the detail panel and column summary.**
Heiberger & Robbins' diverging stacked bar is the established design for Likert data [19], and it
is right — at the scale it was designed for. In a 40 px cell with n=3, each segment is one third of
40 px ≈ 13 px of flat hue, and the reader is being asked to estimate proportions from three
observations. It also requires a declared neutral midpoint to diverge around, which ADR-0010
explicitly forbids for ordinal data absent a declared midpoint. **Where it belongs:** the
criterion-level (column) summary, where n = raters × alternatives is large enough for proportions
to mean something, and the click-through detail panel.

**5. Gradient / violin / density cell — reject.** Correll & Gleicher proposed gradient and violin
plots as better encodings **for mean and error** [18] — they are, by construction, displays of a
central tendency plus a spread around it. That is precisely the representation ADR-0011 point 4
forbids. Note that this is a rejection on *fit*, not on quality: their experiments found the
alternate encodings did outperform bar-charts-with-error-bars for inferential tasks (participants
followed the expected strategy on 89.2% of trials with violin plots and 88.5% with gradient plots
versus 83.2% with bar charts, and were significantly more confident) [18]. The encoding is good and
the job is wrong. And a kernel density estimate from three integers is fabricated data. At 40 × 30
px it is a blob.

**6. Bivariate / VSUP spread encoding — reject as `disagreement`; keep as a variant of the existing
blended encoding.** VSUPs allocate a larger range of the visual channel when uncertainty is low and
a smaller one when it is high, and were shown to make people weight uncertainty more heavily in
decisions [24]. That is a genuinely good result and ADR-0010 already commits to it for
`uncertainty-suppressed` over `confidence`. Substituting disagreement for confidence gives a useful
extra lens — call it `consensus-suppressed`. But it cannot be the answer here: a bivariate colour
map takes *one* value and *one* uncertainty and emits a colour, so it necessarily needs a reduction
over the raters, and it necessarily implies whatever that reduction is. It is a display *of* a
central tendency, plus a caveat.

**7. Jitter — reject outright.** REASONING: jitter is random displacement. At n ≤ 5 the offsets
carry no information, change between renders unless seeded, and add exactly the visual noise the
cell has no room for. Jitter exists to solve overplotting at n in the hundreds. Stacking ties is
the correct answer at this n and is deterministic.

#### 4.3 The per-cell statistic — and one to reject

REASONING. **Do not compute Krippendorff's alpha per cell.** With 2–5 assertions and one unit
there is nothing to chance-correct against; the expected-disagreement term is estimated from the
same handful of numbers as the observed one. Alpha's unit of analysis is the criterion.

Per cell, store or derive the shape directly: `n`, the level multiset, `min`, `max`,
`span = max − min` in ordinal steps, the mode(s), and a `polarised` flag (two or more occupied
levels separated by at least one empty level, with no dominant mode). Those are all
ordinal-legal operations under ADR-0003 and none of them requires a coefficient.

If a scalar is needed for the ramp's domain and for sorting, use **van der Eijk's A** [23]. It is
purpose-built for ordered rating scales and was introduced as a critique of using the standard
deviation as a dispersion measure on such scales — the exact wording of that critique is
**(UNVERIFIED — could not locate source)**, since van der Eijk (2001) is paywalled and no open copy
of its text could be reached; the measure and the properties stated below are verified against [25]
and against R's `agrmt` documentation [23]. It ranges over [−1, +1]: **+1 unanimity, 0 uniform, −1 perfect
bimodality** [23,25]. Its formula is `A = U · (1 − (S−1)/(K−1))` with `U = ((K−2)·TU − (K−1)·TDU) /
((K−2)·(TU + TDU))`, where S is the number of occupied categories, K the number of categories, and
TU / TDU are counts of category triples conforming to or deviating from unimodality; the
distribution is decomposed into semi-uniform layers and A is the weighted mean of the per-layer
scores [25].

Two caveats to carry into the implementation. First (REASONING, derived from the formula rather
than cited: every term in A depends only on the *pattern* of the frequency vector, so multiplying
every count by a constant leaves A unchanged), A is a **shape** statistic — it does not know `n`, so
two raters at {2,5} and twenty raters at {2,…,5} can score identically. **Never display A without
`n` beside it.** Second (EVIDENCE [25]), A is sensitive to the *distance*
between modes: a visually bimodal distribution with close modes may not be flagged, while the same
shape with wider separation is: [25] report a visually bimodal distribution (their Panel E) that A
fails to classify as bimodal while a more widely separated one (Panel F) crosses the threshold. For
comparanda that sensitivity is arguably a feature — a 4-vs-5
split is a smaller problem than a 1-vs-5 split — but it should be documented, and the layer
decomposition should be validated against R's `agrmt::agreement` (which notes a revised algorithm
distinct from the 2001 original) rather than reimplemented from the formula alone [23].

**Reject Tastle & Wierman's consensus measure**, despite it being the other obvious candidate.
EVIDENCE: `Cns(X) = 1 + Σ p_i · log₂(1 − |X_i − μ_X| / d_X)`, where **μ_X is the arithmetic mean of
the ordinal codes** — confirmed in the R reference implementation, which computes `mx =
mean(expand(V))` [27,26]. Taking the mean of 1–5 ratings is the exact category error ADR-0003
identifies and ADR-0015 refuses. Adopting a per-cell disagreement statistic that internally averages
ordinal codes, in a tool whose thesis is that you must not average ordinal codes, would be
indefensible the first time a user read the source.

---

## What this means for the schema / the view / the agent

### Schema (Phase 1, non-deferrable)

```ts
// on the assertion — one optional field, but it must exist from v1
round?: RoundId

// new top-level collection on the analysis
rounds: Array<{
  id: RoundId
  label: string
  openedAt: Timestamp
  closedAt?: Timestamp
  attribution: 'attributed' | 'blind-until-close'
  feedback: 'none' | 'distribution' | 'distribution-and-rationales'
}>
```

Everything else the agreement work needs is already in ADR-0011's multi-rater assertions.

### Core (Phase 2, pure, no DOM)

```ts
// per criterion, over alternatives as units. Units with < 2 assertions drop out.
krippendorffAlpha(
  assertions: RaterAssertion[],
  opts: { level: 'nominal'|'ordinal'|'interval'|'ratio'; valueDomain: readonly V[] }
): { alpha: number; nUnits: number; nPairable: number }

// jackknife by default at small n; bootstrap above a configurable unit count
alphaInterval(..., opts: { method: 'jackknife'|'bootstrap'; level: 0.95; ... })

// per cell — deliberately NOT alpha
cellSpread(assertions): {
  n: number; levels: V[]; min: V; max: V; span: number
  modes: V[]; polarised: boolean; agreementA: number   // van der Eijk
}

// per criterion, between two rounds
roundStability(criterionId, fromRound, toRound): { changedFraction: number; spreadDelta: number }

// secondary, on request only
gwetAC2(assertions, opts: { weights: 'ordinal' }): { ac2: number }
```

Thresholds — the Krippendorff bands, the "modal prevalence high enough to offer AC2" trigger, the
jackknife/bootstrap switchover unit count, the `polarised` gap width — are all **configuration with
defaults, never literals in the algorithm**.

Missingness mapping (settles an interaction between ADR-0009 and this work):

| Reason | Treatment in alpha |
|---|---|
| `not-applicable` | **excluded entirely** — structurally absent, no reliability question exists |
| `not-assessed`, `pending` | absent; the alternative simply has fewer pairable values, possibly `m_u < 2` and so drops |
| `withheld` | absent, same as above, but counted and reported separately so the reader knows the number is partial |
| `unknown` | absent by default, **and counted separately** — a rater who looked and could not determine is a real observation, but it is not a point on the ordinal scale and must not be forced onto one |

### View (Phase 4)

Register **two** encodings against ADR-0010's registry, not one:

- `disagreement` — the rater dot strip. K slots across the cell; one dot per assertion; ties stack;
  no centroid mark, no mean line, no median line, no box. Degrades to a range bracket below a
  configurable minimum cell width, and to the spread ramp below a second, smaller threshold.
  Text alternative is the exact multiset.
- `disagreement-spread` — sequential single-hue ramp over `agreementA` (or `span`, configurable).
  Sortable. Legend reads "unanimous → contested". Value is not in the mapping.

Plus one addition to the existing family:
- `consensus-suppressed` — the ADR-0010 `uncertainty-suppressed` VSUP with disagreement substituted
  for confidence. Cheap: it is a parameter change on an encoding that already has to exist.

Column headers carry the criterion's alpha **with its interval** and its band label; a wide interval
must be visible as a wide interval, not rounded away. The diverging stacked bar lives in the detail
panel and the column summary, never in a cell.

### Agent (`rubricator`)

An agent-produced analysis is a single-rater round. It should write `round` on every assertion so
that a human review pass becomes round 2 and the stability trace works from the first revision. An
agent asked to produce several independent passes is a legitimate multi-rater case, and alpha across
those passes is a genuinely useful self-consistency signal — but it must be labelled as agent
self-consistency, never as expert agreement.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0011 | confirm | Point 4's core claim is verified: Krippendorff's alpha does handle ordinal data and missing values, and is the right coefficient. |
| ADR-0017 (new) | new ADR | Agreement statistics: alpha is **per-criterion**, never per-cell; per-cell uses van der Eijk's A plus `n`; Tastle–Wierman rejected for averaging ordinal codes; alpha always reported with a jackknife interval; **no threshold ever gates, warns on, or suppresses data**; Gwet's AC2 offered as a labelled secondary for skewed criteria only; the missingness-to-alpha mapping table above. |
| ADR-0018 (new) | new ADR | The `disagreement` encoding is a **rater dot strip**, with `disagreement-spread` as its zoom-out companion and `consensus-suppressed` as a VSUP variant. Records the ranking and why gradient/violin, diverging bars in-cell, and jitter were rejected. |
| ADR-0019 (new) | new ADR | Rounds are first-class optional schema data from v1, carrying an **attribution policy** (`blind-until-close`) and a **feedback policy**. Amends ADR-0011 point 7's "activity is legible" to "legible after the round closes" for round-scoped assertions. Stopping is a stability *trace*, not a consensus threshold. |
| ADR-0015 | amend | The "Agreement statistics" bullet needs the qualification that agreement is reported, never enforced, and that a single matrix-wide agreement number is not a legal output. Do via ADR-0017 since accepted ADRs are immutable. |
| ADR-0010 | confirm | The registry design absorbs three new encodings with no schema change — exactly as predicted. The "no diverging palette on ordinal data without a declared midpoint" rule is what disqualifies in-cell diverging stacked bars, so it earned its keep. |
| ADR-0009 | confirm | The reason codes map cleanly onto alpha's pairability rules; the mapping table belongs in ADR-0017, not in a revision here. |
| ADR-0003 | confirm | The ordinal commitment is what lets us reject ICC and Tastle–Wierman on principle rather than taste. It paid for itself. |

---

## Open questions

- **The van der Eijk layer decomposition.** Every secondary source states `A = U·(1 − (S−1)/(K−1))`
  and the U formula, but none I could reach states the semi-uniform layer decomposition procedurally,
  and R's `agrmt` documents a revised algorithm distinct from the 2001 original [23]. *Settled by:*
  reading van der Eijk (2001) directly and diffing against `agrmt::agreement`'s source, then
  building a fixture table of A for every distribution of n = 5 over K = 5 — there are only 126 of
  them (and 251 for all n ≤ 5, since C(n+4,4) sums to 251 over n = 1…5) — so the fixture can be
  exhaustive.
- **Jackknife vs bootstrap crossover.** [12] asserts the jackknife is substantially better "for
  smaller samples" without naming a unit count. *Settled by:* a simulation over comparanda-sized
  matrices (10–50 alternatives, 2–5 raters, 5 levels, 0–40% missing) measuring interval coverage.
  Cheap to run and worth running before the threshold becomes a default.
- **Does the dot strip actually beat the spread ramp for the intended task?** The perceptual
  argument is strong but indirect — nobody has tested distribution glyphs at 40 × 30 px for a
  "find the contested cell" task. *Settled by:* a small within-subjects study once the view exists;
  the honest interim position is to ship both and make switching one keystroke.
- **Whether `unknown` should be a value in the alpha domain.** Two raters who both looked and both
  could not determine have agreed about something. Treating it as missing discards that.
  *Settled by:* a design decision, not research — but it should be an explicit configuration flag
  with `missing` as the default rather than an unexamined assumption.
- **How many raters comparanda actually gets.** Everything above assumes 2–5 per cell. If real
  usage is overwhelmingly 2, the dot strip is nearly trivial and van der Eijk's A is nearly
  degenerate (determined by whether the two levels are adjacent), and a simpler `span`-based design
  would do. *Settled by:* usage, which means the encoding should be parameterised over K and n
  rather than hard-tuned for n = 3.

---

## REFERENCES

1. [Computing Krippendorff's Alpha-Reliability — Klaus Krippendorff (2011, literature updated 2013)](https://www.asc.upenn.edu/sites/default/files/2021-03/Computing%20Krippendorff's%20Alpha-Reliability.pdf)
2. [Krippendorff's alpha — Wikipedia (accessed 2026)](https://en.wikipedia.org/wiki/Krippendorff%27s_alpha) — used as a secondary source for the 0.800 / 0.667 reliability bands ("social scientists commonly rely on data with reliabilities α ≥ 0.800, consider data with 0.800 > α ≥ 0.667 only to draw tentative conclusions, and discard data whose agreement measures α < 0.667"), which Wikipedia attributes to Krippendorff, *Content Analysis: An Introduction to Its Methodology*, 2nd ed. (2004), pp. 241–243.
3. [Measuring inter-rater reliability for nominal data – which coefficients and confidence intervals are appropriate? — Zapf, Castell, Morawietz & Karch (2016), BMC Medical Research Methodology](https://pmc.ncbi.nlm.nih.gov/articles/PMC4974794/)
4. [High agreement but low kappa: I. The problems of two paradoxes — Feinstein & Cicchetti (1990), Journal of Clinical Epidemiology 43:543–549](https://pubmed.ncbi.nlm.nih.gov/2348207/)
5. [High Agreement and High Prevalence: The Paradox of Cohen's Kappa — Zec, Soriani, Comoretto & Baldi (2017), The Open Nursing Journal](https://pmc.ncbi.nlm.nih.gov/articles/PMC5712640/)
6. [Gwet's AC1 is not a substitute for Cohen's kappa – A comparison of basic properties — Vach & Gerke (2023), MethodsX 10:102212](https://doi.org/10.1016/j.mex.2023.102212)
7. [Counting on Consensus: Selecting the Right Inter-annotator Agreement Metric for NLP Annotation and Evaluation — Joseph James (2026), arXiv:2603.06865](https://arxiv.org/abs/2603.06865)
8. [Gwet's AC2 Basic Concepts — Real Statistics Using Excel (accessed 2026)](https://real-statistics.com/reliability/interrater-reliability/gwets-ac2/gwets-ac2-basic-concepts/) — secondary source for the AC1/AC2 formulas; primary is Gwet, *Handbook of Inter-Rater Reliability* (2001).
9. [A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research — Koo & Li (2016), Journal of Chiropractic Medicine 15:155–163](https://pubmed.ncbi.nlm.nih.gov/27330520/)
10. [fast-krippendorff — pln-fing-udelar (Python implementation, ordinal metric source)](https://github.com/pln-fing-udelar/fast-krippendorff/blob/main/krippendorff/krippendorff.py)
11. [fast-krippendorff issue #4: "Ordinal value seems off" — 0.789 vs R `irr::kripp.alpha`'s 0.815 on Krippendorff's own example](https://github.com/pln-fing-udelar/fast-krippendorff/issues/4)
12. [confint.krippendorffsalpha — CRAN reference manual, `krippendorffsalpha` R package, John Hughes (2021)](https://search.r-project.org/CRAN/refmans/krippendorffsalpha/html/confint.krippendorffsalpha.html); package paper: [krippendorffsalpha: An R Package for Measuring Agreement Using Krippendorff's Alpha Coefficient — Hughes (2021), arXiv:2103.12170](https://arxiv.org/abs/2103.12170)
13. [krippalpha — `icr` R package reference](https://www.rdocumentation.org/packages/icr/versions/0.6.2/topics/krippalpha)
14. [max-schaefer/krippendorff — TypeScript implementation](https://github.com/max-schaefer/krippendorff)
15. [An exploration of the use of simple statistics to measure consensus and stability in Delphi studies — Holey, Feeley, Dixon & Whittaker (2007), BMC Medical Research Methodology 7:52](https://pmc.ncbi.nlm.nih.gov/articles/PMC2216026/)
16. [Stability and agreement criteria for the termination of Delphi studies — Dajani, Sincoff & Talley (1979), Technological Forecasting and Social Change 13(1):83–90](https://www.sciencedirect.com/science/article/abs/pii/0040162579900076)
17. [The RAND/UCLA Appropriateness Method User's Manual — Fitch et al. (2001), RAND MR-1269](https://www.rand.org/content/dam/rand/pubs/monograph_reports/2011/MR1269.pdf)
18. [Error Bars Considered Harmful: Exploring Alternate Encodings for Mean and Error — Correll & Gleicher (2014), IEEE TVCG 20(12):2142–2151](https://graphics.cs.wisc.edu/Papers/2014/CG14/Preprint.pdf)
19. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — Heiberger & Robbins (2014), Journal of Statistical Software 57(5):1–32](https://www.jstatsoft.org/v57/i05/)
20. [When (ish) is My Bus? User-centered Visualizations of Uncertainty in Everyday, Mobile Predictive Systems — Kay, Kola, Hullman & Munson (2016), CHI](https://dl.acm.org/doi/10.1145/2858036.2858558)
21. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — Cleveland & McGill (1984), JASA 79(387):531–554](https://www.jstor.org/stable/2288400) — stable record; an open scan of the same article is mirrored at [math.pku.edu.cn](https://math.pku.edu.cn/teachers/xirb/Courses/biostatistics/Biostatistics2016/GraphicalPerception_Jasa1984.pdf) (note: the `www.` host 302-redirects and fails TLS chain verification in some clients).
22. [Glanceable Visualization: Studies of Data Comparison Performance on Smartwatches — Blascheck, Besançon, Bezerianos, Lee & Isenberg (2018), IEEE InfoVis / TVCG; stimuli 28.73 mm × 28.73 mm](https://www.microsoft.com/en-us/research/wp-content/uploads/2018/08/GlanceableVis-InfoVis2018.pdf)
23. [Measuring Agreement in Ordered Rating Scales — van der Eijk (2001), Quality & Quantity 35(3):325–341](https://link.springer.com/article/10.1023/A:1010374114305); R implementation notes: [`agrmt::agreement`](https://search.r-project.org/CRAN/refmans/agrmt/html/agreement.html)
24. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer (2018), CHI](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
25. [Quantifying Polarization: A Comparative Study of Measures and Methods — (2025), arXiv:2501.07473](https://arxiv.org/abs/2501.07473) — used for the restated van der Eijk A / U formulas and the mode-distance sensitivity finding.
26. [Consensus and dissention: A measure of ordinal dispersion — Tastle & Wierman (2007), International Journal of Approximate Reasoning 45(3):531–545](https://www.sciencedirect.com/science/article/pii/S0888613X06001186)
27. [`agrmt` R package — `consensus.R` source, showing `mx = mean(expand(V))`](https://rdrr.io/rforge/agrmt/src/R/consensus.R)
