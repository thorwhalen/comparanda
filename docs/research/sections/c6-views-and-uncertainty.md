# Which views to ship, and how to encode uncertainty honestly

**Research question(s):** Which views beyond the matrix earn a place in v1 — parallel coordinates,
Pareto scatter, slope/bump charts, small multiples of dot plots, radar, rank-flow under weight
changes, diverging bars for multi-rater spread — and for each, what does it answer better than the
matrix and when does it mislead? Then: how do we encode uncertainty honestly — the exact
construction of a value-suppressing uncertainty palette, which alternative uncertainty channels
survive a dense table, what the literature really says about whether people read uncertainty
encodings correctly, and the concrete algorithm for computing ink colour from the actually-rendered
background.

**Brief section:** `docs/research/visualisation.md` §2 (Other views worth having) and §3
(Uncertainty visualisation).

**Evidence grade:** **moderate.** The VSUP construction is nailed down from the paper *and* its
reference implementation, so the spec is exact. The contrast algorithms are quoted from normative
text and verified numerically against published reference values. But the *comparative* claims —
which view wins which task — rest on a thin and internally inconsistent empirical base: the
strongest anti-radar experiment compares radar only against other radial forms, and a 2024 review
finds the uncertainty-visualisation literature produces conflicting results because the field
lacks a shared definition of its own subject [1]. Two of the sharpest arguments here (the radar
area artefacts, the fact that radar cannot represent a qualified missing) are mathematics and
project constraints rather than user studies — which is why they are the ones I lean on.

## Bottom line

Ship four views in v1, in this order: the **matrix** (already decided), **small multiples of dot
plots**, **two-criterion scatter with a dominance/Pareto overlay**, and **rank-flow (bump) under
weight changes** — the last gated behind opting into weights and inheriting ADR-0015's warning.
Ship **diverging stacked bars for multi-rater spread inside the detail panel only**, never at
matrix scale. **Decline parallel coordinates** for v1: 1–5 ordinal values collapse every line onto
five heights per axis, and its axis-ordering objective is a *different* optimisation from the
matrix's seriation, so it would need a second ordering we would then have to explain. **Decline
radar outright**, not with a caveat — it cannot represent a qualified missing without lying
(ADR-0009), its enclosed area scales as the square of the values, and permuting the axes of one
6-criterion profile changes that area by up to **1.58×** with no change to the data (verified
below). For uncertainty: implement the VSUP tree exactly as specified in Part B, with one
deliberate change from the reference implementation — suppress toward the **theme surface**, not
toward white — and one improvement the paper's design space explicitly permits: an **ordinal merge
tree** over the actual score levels instead of uniform binning, giving 9 colours for a 5-level
score × 3-level confidence. Be honest about what VSUP buys: the original experiment found **no
accuracy benefit** over an ordinary bivariate map; the measured effect is on *decisions*, and it
came from 24 crowdworkers on one synthetic task. So do not lean on the blend alone — keep the
value as text in every cell and keep a single-measure confidence encoding one click away. For ink:
**gate on WCAG 2.x, tie-break on APCA**, and make it a **build-time palette test** rather than a
render-time computation, because the palette is 9–15 colours × 2 themes and every one of them can
be checked before shipping.

---

## Findings

### Part A — the other views

#### A.0 The frame: what the matrix is bad at

Cleveland & McGill's ranking of elementary perceptual tasks by decoding accuracy puts *position
along a common scale* first and *shading / colour saturation* last [2] (EVIDENCE). The matrix
encodes its measures in colour. So the matrix is, by construction, the *least* accurate available
encoding for reading a value, and its virtue lies entirely elsewhere: it shows every
(alternative, criterion) pair at once, and under seriation it makes block structure visible.

That fixes the selection criterion for every other view. **A secondary view earns its place only
if it repairs a specific weakness of the matrix.** It does not earn its place by being popular, by
looking analytical, or by showing the same data in a rounder shape. Concretely, the matrix is weak
at:

1. reading and comparing *values* on one criterion (colour is the worst channel);
2. answering "which alternatives can I stop considering" without the reader doing 22 × 12 mental
   comparisons;
3. showing whether a conclusion is *stable* under a change of assumptions;
4. showing the *spread* between raters inside a single cell.

Those are four holes, and the four views below fill them one each. (reasoning, not evidence — but
the perceptual premise it rests on is [2].)

A second constraint runs through all of it. Our scores are **ordinal** (domain model, Correction
2). Any view whose visual variable invites arithmetic the level of measurement does not license —
area, length ratios, slope magnitude, polygon size — commits the same category error as the total
column that ADR-0015 exists to prevent. This is the single most useful filter in Part A, and it
disqualifies more candidate views than any perceptual argument does.

---

#### A.1 Small multiples of dot plots — **SHIP. Rank 1.**

**What it answers better than the matrix:** "On *this* criterion, how do the alternatives actually
line up, and by how much?" It converts the matrix's worst channel (colour) into its best
(position on a common scale) [2] (EVIDENCE). One panel per criterion, alternatives as dots on a
shared, aligned axis; row order shared with the matrix so the two views are legible as the same
document.

**Verifying the brief's claim that this is "often the most honest view of ordinal data":**
**Partly confirmed, with one correction the folklore misses.**

- Confirmed: position on a common scale is the most accurately decoded channel [2] (EVIDENCE). And
  unlike a bar, a dot has no length, so it does not invite the reader to say "twice as good" — a
  ratio statement that is illegal at ordinal level. That is a real honesty property.
- The correction: a dot plot still places the levels at *equal spacing* along the axis, which is
  an interval assumption smuggled in through the geometry. Nothing in "rating 4" says it is as far
  from 3 as 3 is from 2. The mitigation is cheap and nobody does it: **render the axis as discrete
  labelled ticks carrying the criterion's own level names** ("adequate", "strong", …), with no
  continuous rule between them. Then the spacing reads as ordering, not distance. (reasoning, not
  evidence)

**When it misleads:** (a) panel count explodes — twelve criteria is fine, forty is not; (b) ties
overplot, and at 1–5 with tens of alternatives ties are the common case, so dots must stack or
beeswarm and a stacked column of five dots must not read as "one dot, bigger"; (c) it silently
drops alternatives with a missing on that criterion unless each panel carries an explicit
**missing lane** with its reason code (ADR-0009).

**Bonus, and this is why it ranks first:** it is also the correct view for multi-rater data. One
dot per rater assertion on the same axis makes disagreement a *visible gap on a common scale*
rather than a number the reader must trust (ADR-0011 §4). It fills hole 1 and hole 4 with the same
component.

---

#### A.2 Scatter with a Pareto frontier — **SHIP. Rank 2.**

**What it answers better than the matrix:** "Which alternatives can I stop considering?" Dominance
requires only the ≥ relation, so it is **legal on ordinal data** — it is the strongest reduction
available with no weights and no value judgements at all. ADR-0015 already ships dominance
filtering as an analysis; this is its visual form, and the pairing matters: an analysis that
returns a set of names is much less persuasive than one that shows you the frontier.

**When it misleads — and this is the failure mode to design against:** *a two-criterion frontier
is not the frontier.* An alternative that is non-dominated on (cost, speed) may be dominated once
all twelve criteria are considered, and vice versa. Shipping a 2-D Pareto plot without saying so
manufactures false survivors. Requirements:

- Label the frontier "non-dominated **on these two criteria**", in the view, not the docs
  (ADR-0015's "every analysis states its assumptions at the point of use").
- Carry the **full-criteria dominance status** as a second mark channel (outline, or a small
  glyph), so the reader sees immediately that a point on the 2-D frontier is globally dominated.
- Ordinal overplotting is severe: a 5 × 5 grid has 25 addressable positions for tens of
  alternatives. Use a binned/beeswarm layout with counts, not random jitter — random jitter on
  ordinal data invents precision that is not there.
- An alternative with a `missing` on either axis **cannot be placed**. List it beside the plot with
  its reason code rather than dropping it (ADR-0009). A silently absent alternative is exactly the
  failure the whole project exists to prevent.

The MCDA literature on visualising Pareto fronts is large but mostly aimed at many-objective
*optimisation* with thousands of continuous solution points [3] — a different problem from tens of
hand-scored ordinal alternatives, and its techniques (self-organising maps, star-coordinate
palettes) do not transfer. Honest assessment: for our size and level of measurement, an ordinary
labelled scatter with the frontier drawn is both sufficient and better understood than anything
that literature offers. (reasoning, informed by [3])

---

#### A.3 Bump / rank-flow under weight changes — **SHIP. Rank 3, gated.**

**What it answers better than the matrix:** "Does this conclusion survive a plausible change of
assumptions?" ADR-0015 already commits to sensitivity analysis; a rank-flow diagram is what makes
it legible. Two ranking columns side by side, alternatives connected by lines, one column per
weight setting. A ranking that reshuffles under a 5% weight change announces itself.

**Prior art, and it is strong:** LineUp [4] (InfoVis 2013 Best Paper) is precisely this — a
multi-attribute ranking view with interactive weights, where "through integration of slope graphs,
LineUp can also be used to compare multiple alternative rankings on the same set of items" [4]
(EVIDENCE, quoted). It ships as a maintained TypeScript library, `lineupjs`. Before building this
from scratch, evaluate that library against the standalone-bundle size constraint; it is the
single closest piece of prior art to comparanda's whole view layer, and its stated requirement
"R VII: Handle missing values … 'downgrading' or omitting an item because of missing values might
not be acceptable for certain tasks" [4] is our ADR-0009 arrived at independently.

**When it misleads — the honest tension:** a rank-flow view *presupposes a ranking*, which
presupposes an aggregation, which on ordinal data is the category error ADR-0015 exists to refuse.
The resolution is to be strict about the direction of the claim the view supports:

- **Defensible:** "this ranking is not stable — a 5% weight change moves three alternatives past
  each other." A negative result about stability needs no belief in the aggregation at all; it is
  a statement about the *aggregation's* fragility.
- **Not defensible:** "this is the best alternative." The view must never be the place a winner is
  declared.

Ship it behind the same opt-in gate and the same ordinal warning as weighted aggregation
(ADR-0015), and phrase its default caption as a stability finding.

**Scale limit (EVIDENCE):** bump charts degrade past roughly 30 ranked entries, and are reported as "not
suitable for the visualization of too many data items (e.g., > 30), even for users to carry out
basic tasks" [5]. Our matrices are tens of alternatives — right at that boundary. Mitigate by
ranking only the current selection/filter, which the view-state model already supports (ADR-0008).

**Slope charts (two columns only) are the degenerate case of the same component** — same code,
two ranking columns, no weight slider. Use it for rater-vs-rater and criterion-vs-criterion
comparison. One caveat: slope *angle* reads as magnitude, which is illegal on ordinal values.
Connect **rank positions**, not values, and label both endpoints, so the line encodes "moved past"
rather than "moved by this much". Tufte's slopegraph, and the bump chart as its ranked
specialisation, are described exactly this way in [4].

---

#### A.4 Diverging / stacked bars for multi-rater spread — **SHIP, detail panel only. Rank 4.**

**What it answers better than the matrix:** the *shape* of disagreement inside one cell — not just
"raters disagree" but "four said 4 and one said 1", which is a different finding from "three said
2 and two said 4".

**The evidence, honestly graded:**

- Heiberger & Robbins [6] is the standard reference recommending diverging stacked bar charts for
  Likert and other rating scales. It is a *design* paper (JSS, with the `HH` R implementation)
  arguing from perceptual principles — not a controlled experiment. Cite it as design consensus,
  not as measured superiority. (EVIDENCE of consensus; not evidence of effect)
- The one controlled comparison I found is more equivocal. Indratmo et al. [7], 30 participants,
  compared classical, inverting and diverging stacked bars: for *overall-attribute* comparisons the
  inverting variant was significantly faster; for *single-attribute* comparisons **all three chart
  types performed similarly**. So the gain from diverging is real but task-specific and modest.
  (EVIDENCE, moderate)
- LineUp states the structural problem plainly: stacked bars "complicate the comparison of
  individual attribute scores across multiple items, as only the first one is aligned to the
  baseline" [4] (EVIDENCE, quoted). LineUp's response is to ship four alignment strategies —
  classical, diverging, ordered, and all-aligned — as a toggle.

**Conclusion, which splits the brief's question in two:** for spread **within one cell**, a
diverging stacked bar centred on the scale's neutral level is right, and it belongs in the detail
panel. For comparing spread **across alternatives**, it is the wrong tool for exactly the reason
LineUp names — only one segment shares a baseline — and the per-rater dot plot of A.1 wins,
because every dot shares one axis. Do not put stacked bars in matrix cells.

---

#### A.5 Parallel coordinates — **DO NOT SHIP in v1. Rank 6.**

**What it would answer:** trade-off shape across many criteria at once; clusters of alternatives
with similar profiles.

**Why it fails on *our* data specifically** (reasoning, with literature support): with 1–5 ordinal
scores, every polyline lands on one of five heights per axis. Twenty-two alternatives across
twelve criteria produce lines that coincide over long runs and become individually untraceable —
the segment-identity problem that all of PCP's clutter-reduction literature exists to fight, in
its worst case. PCP's power comes from continuous, well-spread values; ordinal collapse removes
exactly that.

**The axis-order problem is real and it is not the same problem as the matrix's seriation**
(EVIDENCE): only *adjacent* axis pairs are readable in a PCP, optimising the ordering is NP-hard,
and the community has proposed **over 30 automatic ordering strategies** with no consensus default
[8]; screen-space quality metrics for the purpose — line crossings, crossing angles, convergence
and over-plotting, computed **per adjacent axis pair** — go back to Dasgupta & Kosara's Pargnostics
[9]. Crucially the objective differs: a PCP ordering wants *dissimilar*
dimensions adjacent to make clusters salient [8], whereas matrix seriation wants *similar* rows
and columns adjacent to make blocks solid. Shipping both means maintaining two orderings of the
same criteria, and then explaining to a user why "arrange to reveal structure" produced different
answers in two views of one document. That is a real cost for a view that our data already
degrades.

**Verdict:** decline for v1. Revisit if ratio-scale criteria (cost, latency, headcount) become
common enough that the collapse problem goes away — at which point the PCP gets its own ordering
and its own ADR.

---

#### A.6 Radar / spider charts — **DO NOT SHIP. Not even with a caveat. Rank 7 (last).**

The brief asked me to find the actual evidence and to report honestly if it is weaker than the
folklore. It is weaker than the folklore in one respect and *stronger* in another. Both below.

**Where the folklore overclaims (honest correction).** I could not locate a controlled study
directly comparing a radar chart against a dot-plot small-multiple on ordinal profile-comparison
tasks. The strongest direct experiment is Albo, Lanir, Bak & Rafaeli [10] (TVCG 2016), which
compared radar against **two other radial designs** — the Flower chart used in the OECD Better
Life Index, and a Circle chart — on a formal task taxonomy for composite indicators. Radar was
**least effective and least liked**, with a strong participant preference for Flower [10]
(EVIDENCE). That is a genuine controlled result and it refutes "radar is the natural display for a
composite indicator", which is the folklore we would be shipping to. But it is a within-radial
comparison, so it does not by itself license "radar is worse than a dot plot". The confident
blog-level consensus against radar rests on much less experimental work than its tone implies, and
an implementer should know that.

**Where the case is stronger than the folklore — and this is decisive.** Two of the arguments are
not opinions at all. I verified them numerically rather than repeating them.

*Artefact 1 — area is quadratic in the values.* For a radar polygon with n equally spaced axes and
radii r₀…r_{n−1}, the shoelace formula gives the enclosed area exactly:

    A = ½ · sin(2π/n) · Σᵢ rᵢ · r₍ᵢ₊₁₎ mod n

(Derivation, verified against a direct shoelace computation: for r = [5,1,4,2,3,1] both give
13.423394.) Scaling every value by k scales A by **k²**. Concretely: an alternative scoring a flat
3 on six criteria encloses area 23.383; an alternative scoring a flat 4 — *one ordinal step better
on every axis* — encloses 41.569. That is **1.78× the area**, exactly (4/3)². The reader who
compares the blobs perceives a difference nearly twice the size of the one in the data, on a scale
where the difference in the data is not even a ratio.

*Artefact 2 — the same data has many different areas.* The area depends on the products of
*adjacent* radii, so it changes when you permute the axes, and axis order is an arbitrary
authoring choice. Over all cyclic orders of the same 6-criterion profile [5,1,4,2,3,1], the area
ranges 13.423 … 21.218 — a **1.58× spread from reordering alone**, across the 30 distinct
arrangements this profile admits (it repeats the value 1, so it realises half of the (n−1)!/2 = 60
orderings that six *distinct* axes would give). For a 5-criterion profile it is 1.30× across 12
arrangements. And this is not a theoretical worry: a published biomechanics paper using
"permutated radar charts" explicitly
*searches* the permutations and selects "the one that yields a maximal total area" [11] (EVIDENCE)
— practitioners in the wild treat axis order as a free parameter for tuning the impression the
chart makes. A view whose headline visual property can be inflated 58% by reordering the columns
has no place in a tool whose entire premise is auditability.

*The project-specific argument, which alone would be sufficient.* **Radar cannot represent a
qualified missing.** A missing axis either collapses to the centre — which renders "nobody has
looked yet" as "scores worst possible", a lie — or it breaks the polygon. ADR-0009 requires that
`not-applicable` and `not-assessed` be visually distinguishable and that neither read as a value.
Radar structurally cannot comply. (reasoning, but a direct consequence of an accepted ADR)

Add the channel argument — radar asks the reader to compare *angle* and *area*, both ranked below
position and length for decoding accuracy [2] — and the case is closed.

**What to do about the request when it arrives** (and it will): the job radar is asked to do is
"show me the shape of this alternative and let me compare it to that one". Answer it with the
small-multiple dot plot of A.1 on a shared axis, with the two alternatives highlighted. Same
question, honest encoding, and it handles missings.

---

#### A.7 The ranked recommendation

| Rank | View | Ship v1 | Fills | Primary justification | Chief risk to manage |
|---|---|---|---|---|---|
| 1 | Matrix + seriation | **yes** (decided) | overview, block structure | ADR-0008; the only view showing every cell | colour is the least accurate channel [2] |
| 2 | Small multiples of dot plots | **yes** | value reading; multi-rater spread | position on a common scale is the most accurate channel [2] | panel count; tie overplotting; missing lane |
| 3 | 2-criterion scatter + Pareto frontier | **yes** | "what can I stop considering" | dominance is ordinal-legal; ADR-0015 already ships it | 2-D frontier ≠ global frontier — must be labelled |
| 4 | Rank-flow / bump under weight change | **yes, gated** | stability of conclusions | ADR-0015 sensitivity analysis; LineUp prior art [4] | presupposes an aggregation; >30 alternatives degrades [5] |
| 4= | Slope chart (2 columns) | **yes** (same component) | rater vs rater | degenerate case of rank-flow, no extra code | angle reads as magnitude — connect ranks, not values |
| 5 | Diverging stacked bar, **detail panel only** | **yes, scoped** | shape of disagreement in one cell | design consensus [6]; modest measured gain [7] | only one segment shares a baseline [4] — never at matrix scale |
| 6 | Parallel coordinates | **no** | trade-off shape | — | ordinal collapse; a second, conflicting axis ordering [8] |
| 7 | Radar / spider | **no** | — | — | quadratic area; 1.58× area swing from reordering; cannot show `missing` |

If half the time were available, cut ranks 4 and 5 and ship the matrix, the dot plots and the
Pareto scatter. Those three cover overview, value reading and reduction, which is the whole
argument a comparison usually needs.

---

### Part B — uncertainty visualisation

#### B.1 Value-suppressing uncertainty palettes — the implementable spec

I read the paper [12] and the MIT-licensed reference implementation [13], which pins down details
the paper leaves to the figures. What follows is exact.

**The idea.** A traditional bivariate map is a 2-D square: every (value, uncertainty) pair gets its
own output. A VSUP is a **tree**: as uncertainty rises, values are mapped to fewer and fewer
outputs, "culminating in a singularity where all inputs are mapped to an identical, highly
uncertain mark regardless of data value" [12] (EVIDENCE, quoted). The saving is spent where it
helps: more distinguishable colours among *certain* values, none among uncertain ones.

**The quantisation tree** (from [13], `treeQuantization(branch, layers)`):

- Parameters: branching factor `b` (default 2), layer count `L` (default 2; the paper's figures use
  `b = 2, L = 4`).
- Layer `i ∈ [0, L)`. **Layer 0 is the root — a single node — and it is the most uncertain layer.**
  Layer `i` has `bⁱ` nodes.
- Total output colours `N = Σᵢ bⁱ = (b^L − 1)/(b − 1)`. For `b = 2, L = 4`: `1+2+4+8 = 15`, which
  matches the paper's stated "15 to the bivariate map's 16" [12].
- Representative value of node `(i, j)`, `j ∈ [0, bⁱ)`: the **bin midpoint**,
  `v = vScale.invert((2j+1) / (2·bⁱ))`. "The data value of a parent is the midpoint of all of its
  children" [12].
- Representative uncertainty of layer `i`: `u = uScale.invert(1 − (i+1)/L)`.
- **Lookup.** Normalise `u` to `û ∈ [0,1]` where **1 = most uncertain**. Walk `i` upward while
  `û < 1 − (i+1)/L − ε` (`ε = 1e-9`), capped at `L−1`; then find the bin `j` whose midpoint
  interval contains `v`.

  ⚠️ comparanda stores **confidence**, not uncertainty. `û = 1 − normalise(confidence)`. Getting
  this backwards inverts the entire encoding and it will look plausible, so unit-test the corners.

**The colour construction** (from [13], `simpleScale`, mode `usl`):

1. `c = ramp(v̂)` — sample the sequential value ramp at the bin's **normalised midpoint**, not at
   the datum's own value. This is what makes the palette a finite, enumerable set.
2. Suppress: `c′ = interpolateLab(c, SURFACE)(û)` — interpolate in **CIELAB** from the value colour
   toward the surface, by the normalised uncertainty.

The reference implementation hardcodes `SURFACE = "#fff"`. **This is the one deliberate change
comparanda makes:** suppression must target the *actual theme surface*. On a light surface that is
the published behaviour (lighten + desaturate). On a dark surface, interpolating toward white would
make the least-trustworthy cells the brightest things on the page — the exact inverse of the
intent. Parameterise it. (reasoning, but a direct consequence of the mechanism.) The alternate
modes `us` (desaturate to `s = 0` in HSL) and `ul` (lighten to `l = 1` in HSL) exist in [13];
prefer `usl` because it moves lightness and saturation together and does it in a roughly
perceptually uniform space.

**Do not "fix" the root.** At layer 0 the representative `û = (L−1)/L` — 0.75 for `L = 4` — so the
most-uncertain colour sits 75% of the way to the surface, **not at the surface**. That is what
keeps a maximally uncertain cell distinguishable from an empty cell, which matters enormously to us
because empty means something specific (ADR-0009). Preserve the property explicitly and test it.

**Choosing the ramp** (EVIDENCE, from [12]): use a ramp that avoids very light and very dark
endpoints — the paper uses Viridis for exactly this reason, because "many standard color ramps …
interpolate in both hue and luminance … This interpolation in luminance interferes with our
uncertainty encoding, introducing ambiguity" [12]. Our suppression channel *is* lightness; a
value ramp that already spends its lightness range collides with it. Note the tension with
ADR-0010's "sequential means one hue, light to dark": for the `value` encoding that rule is
right; for
`uncertainty-suppressed` the ramp must reserve lightness headroom. Both ramps should be declared
per encoding rather than shared.

**Sizing the tree for ordinal data — an improvement on the library.** The reference implementation
bins uniformly, which suits continuous data. Ours is not continuous: a score has `k` levels
(commonly 5) and confidence has `m` levels (commonly 3). Uniform binning with `b = 3, L = 3` gives
9 leaf bins for 5 levels — wasteful, and the aliasing lands unevenly across the levels. The paper
explicitly opens this door: "non-uniform binning would allow the designer to target particular
distributions or important subregions of the data" [12].

So specify an **ordinal merge tree** instead: the leaf layer is exactly the `k` score levels, and
each higher layer merges adjacent groups until layer 0 is one group. For `k = 5, m = 3`:

    layer 2 (highest confidence): {1} {2} {3} {4} {5}      5 bins
    layer 1 (medium confidence):  {1,2} {3} {4,5}          3 bins
    layer 0 (lowest confidence):  {1,2,3,4,5}              1 bin
                                                    total  9 colours

Nine colours, well under the ≤16 ceiling the paper adopts from Wainer & Francolini [12], and every
colour now corresponds to a **nameable set of levels** — which means the legend and the tooltip can
say "**2 or 3, low confidence**" in words instead of asking the reader to invert a colour ramp.
That is a real gain in a tool whose product claim is auditability. (reasoning, built on [12]'s
stated design space.)

The merge tree is an **encoding parameter, not schema** — it is derived, it lives in the view, and
it is registered against the encoding (ADR-0010, domain model Correction 1).

**Legend.** Ship the **wedge/arc** legend (`arcmapLegend` in [13]), root at the narrow end. Honest
framing: the paper found **no significant effect of legend shape** on identification accuracy
(F(1,70) = 0.04, p = 0.84) or on decision-making (F(1,61) = 0.01, p = 0.92), and recommends the
wedge for VSUPs only because "it makes the conceptual differences between the two more apparent"
[12] (EVIDENCE). We are choosing it for communication, not for measured performance. Say so
internally so nobody later defends it as an empirical result.

**What VSUP actually buys — the honest reading of the evidence.** This matters because BRIEF.md
calls the blended encoding "the most valuable single feature", and it deserves an accurate
warrant rather than an inflated one.

| Comparison | Result | Grade |
|---|---|---|
| Superimposed vs juxtaposed (identification accuracy) | 58% vs 51%, F(1,166) = 5.5, p = 0.02 — superimposed wins | EVIDENCE [12] |
| Discrete vs continuous bins (identification accuracy) | 63% vs 47%, F(1,166) = 30, p < 0.01 — discrete wins | EVIDENCE [12] |
| **VSUP vs traditional discrete bivariate (identification accuracy)** | **F(1,70) = 1.4, p = 0.24 — no significant difference** | EVIDENCE [12] |
| VSUP vs traditional (uncertainty of choices, mean) | F(1,61) = 0.05, p = 0.83 — no difference in central tendency | EVIDENCE [12] |
| VSUP vs traditional (distribution of choice uncertainty) | KS D = 0.5, p = 0.03 — VSUP users avoided the most uncertain regions | EVIDENCE [12] |
| VSUP vs traditional (danger/value accepted) | M = 0.32 vs 0.29, t = 2.3, p = 0.02 — VSUP users accepted worse expected value | EVIDENCE [12] |

**Read that plainly: VSUP does not make the table easier to read. It makes readers discount thin
evidence.** That is exactly the claim in BRIEF.md — the blend "makes high-score-thin-evidence cells
recede" — and it now has a citation and an effect size instead of an anecdote. But the base is
n = 24 crowdworkers, one synthetic Battleship-style task, one lab. Grade the claim **moderate**.
Do not write "research shows the blended encoding improves decisions" in marketing copy; write
"in the study that introduced this technique, participants using it avoided the most uncertain
options and accepted worse expected value to do so."

**One limitation that does *not* bite us, which is worth stating because it is the paper's own
biggest caveat.** [12] warns that VSUPs "are also highly sensitive to the binning scheme used …
a particular item's encoding in a VSUP cannot be used as a proxy for a test of statistical
significance", because continuous values near a bin boundary get large colour differences. Our
confidence is *already* an ordinal variable with 3 declared levels — the binning is exact, not a
discretisation of a continuum. The boundary artefact largely disappears. Say so in the ADR; it is
one of the few places our constraints make a published technique work *better* than it does
generally.

---

#### B.2 Alternative uncertainty channels — which survive a dense table

The test is a matrix cell: roughly 24–40 px tall, several hundred of them, and it must also carry
the value as text (ADR-0010).

| Technique | Survives a dense table? | Verdict |
|---|---|---|
| **Bivariate colour (2-D square)** | Yes | Superseded. Equal on accuracy, worse on the decision measure [12]. Use VSUP. |
| **Texture / hatching** | Partly | **Ship, ≤3 levels, as the secondary channel.** See below. |
| **Glyph size** | No | A shrinking square inside a cell reads as a second grid. Also colour and size are perceptually integral, and [12] states plainly that VSUPs over size × colour need a perceptual interaction model where "experimental work remains to be done". |
| **Blur** | No | Semiotically apt [14] but hard to *estimate* [15]; bleeds across 1 px cell borders and destroys the grid; and it destroys the in-cell text we are required to keep. |
| **Sketchiness / fuzziness** | No, in cells | Evaluated as a genuine ordered variable for qualitative uncertainty [15], but it needs stroke to sketch, and a dense grid of filled rectangles has none. Possible later for a row *outline* in narrative mode. |
| **Hypothetical outcome plots (HOPs)** | No, in the matrix | Animation per mark × hundreds of marks; and the standalone HTML file must work when printed and mailed (ADR-0013). Evidence for HOPs is decent for a *single* distribution [16, 17]. Reasonable in the **detail panel** for one multi-rater cell, post-v1. |
| **Quantile dotplots** | N/A in cells; **yes in the detail panel** | Quantile dotplots (and CDFs) improved transit decision-making over interval displays [26]. Note [16] evaluates HOPs, error bars and line ensembles — *not* quantile dotplots — so it is not a warrant for this row. This converges with view A.1 — same component, same reason. |

**On hatching specifically.** MacEachren et al. [14] is the empirical ranking of visual variables
for *intuitiveness* as uncertainty signifiers, and texture ranks well there (EVIDENCE). But I could
**not find a controlled study of hatch discriminability at table-cell sizes**; the practical
guidance that pattern fills "are not suited to small shapes" is craft, not evidence [18] (marked).
So: ship hatching as a **coarse channel with at most three densities aligned to the VSUP layers**,
whose real jobs are (a) forced-colors mode and print, where every computed colour is discarded,
(b) colour-vision deficiency, and (c) satisfying ADR-0010's "never colour alone". Do not ask it to
carry five distinguishable levels; it cannot, and pattern moiré at small sizes is its own
accessibility problem.

---

#### B.3 Do people actually read uncertainty encodings correctly?

The brief expected this literature to be less encouraging than the design literature implies. It
is, and in a more specific way than "people are bad at uncertainty".

1. **The field's own evaluation practice is overconfident.** Hullman et al. [19] surveyed 86 user
   studies of uncertainty visualisations and found evaluation practice "focuses on Performance and
   Satisfaction-based measures that assume more predictable and statistically-driven judgment
   behavior than is suggested by research on human judgment and decision making", with a bias
   toward accuracy over decision quality (EVIDENCE).
2. **The results conflict, and the reason is definitional.** Mason et al. [1] (2024) find that the
   field lacks a shared definition of uncertainty and of what representing it means, and that this
   "results in a significant amount of conflicting results in the literature, especially in
   experiments that assess the effectiveness of different uncertainty representations"
   (EVIDENCE). Practical consequence: do **not** expect a stable published ranking of uncertainty
   encodings to exist. There isn't one.
3. **Even experts misread the most standardised uncertainty encoding there is.** Belia et al. [20]
   surveyed authors published in leading psychology, neuroscience and medical journals and found
   systematic misconceptions about error bars and confidence-interval overlap — most notably the
   widespread belief that just-touching 95% CIs correspond to p ≈ .05, when they correspond to
   p ≈ .006, and overlap of about a quarter of the average interval length is the p ≈ .05 case
   (EVIDENCE). If error bars are read wrongly by the people who publish them, a novel bivariate
   palette will not be read *precisely* by anyone.
4. **Encoding choice changes conclusions, not just accuracy.** Correll & Gleicher [21] showed the
   bar's containment boundary biases which values readers judge likely, and that visually symmetric
   encodings mitigate it. Hofman, Goldstein & Hullman [17] (CHI 2020) showed participants
   **overestimate a treatment effect and pay more for it** when shown inferential rather than
   outcome uncertainty — same data, different interval, different decision
   (EVIDENCE).

**What this means for how hard we lean on the blend.** Three concrete requirements, and they are
the honest answer to the brief's question:

- **The score stays as text in every cell.** ADR-0010 already says this. The literature above is
  the reason it is not negotiable: the text is the channel that is read *correctly*, and the blend
  is the channel that changes *decisions*. They do different jobs and we need both.
- **Keep a single-measure `confidence` encoding one click away.** Superimposition beats
  juxtaposition for *fusing* value and uncertainty (58% vs 51% [12]) — but [12] itself concedes
  that "if the analyst … wishes to quickly and orthogonally analyze the distributions of
  uncertainty and value, other strategies, such as juxtaposed maps, may be more appropriate."
  "Where is the evidence thin across this whole analysis?" is a different question from "how good
  is this cell?", and the blend cannot answer it. Ship both; ship neither alone.
- **The legend must state the aliasing in words.** "At low confidence, all scores are shown as one
  colour" is a claim about what the reader *cannot* see, and no colour ramp communicates it. This
  is the single cheapest honesty feature in the whole design, and the ordinal merge tree (B.1) is
  what makes those words nameable.

---

#### B.4 Contrast: computing ink from the actually-rendered background

BRIEF.md's lesson — "text colour must be computed from the actual rendered background" — is right,
and the interesting failures are in the word *actual*.

**Step 0 — obtain the background that is really painted.** This is where implementations go wrong,
before any contrast maths happens.

- **Composite every layer.** Cell fill, row stripe, hover/selection overlay, focus backdrop — in
  paint order, each `rgba(c, α)` over what is below as `α·c + (1−α)·below`, in **gamma-encoded
  sRGB**, because that is how browsers composite by default. Do not composite in Lab.
- **Clamp before measuring.** The VSUP suppression interpolates in CIELAB. Convert the result back
  to sRGB and gamut-clamp it, then compute luminance from the **clamped** value. Measuring the
  pre-clamp colour measures a colour the screen never showed.
- Never assume white, and never take one element's computed background colour as final — an
  ancestor may be showing through.

**Step 1 — WCAG 2.x relative luminance and contrast ratio** (normative, quoted from [22]):

    cs      = c8bit / 255
    c_lin   = cs ≤ 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ^ 2.4
    L       = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
    ratio   = (L_lighter + 0.05) / (L_darker + 0.05)          // 1:1 … 21:1

**The linearisation detail people get wrong**, in order of frequency: (a) using a plain `^2.2` or
`^2.4` power and skipping the piecewise linear segment below 0.04045 — this is wrong for dark
colours, which is precisely the dark-theme suppressed region; (b) forgetting the `/255`
normalisation before the transfer function; (c) the threshold was 0.03928 before May 2021 —
WCAG notes the change "has no practical effect on the calculations" [22], so either constant is
acceptable, but be consistent across the codebase.

Verified: this implementation returns 21.00 for #000/#fff, 4.478 for #777777/#fff and 4.542 for
#767676/#fff — matching the published values that are commonly used to illustrate the threshold's
arbitrariness.

**Step 2 — APCA Lc**, if used (constants from the W3-licensed reference implementation [23]):

    Ys      = 0.2126729·(R/255)^2.4 + 0.7151522·(G/255)^2.4 + 0.0721750·(B/255)^2.4
    clamp   : if Y ≤ 0.022 then Y += (0.022 − Y)^1.414          // applied to BOTH text and bg
    if |Ybg − Ytxt| < 0.0005 → Lc = 0
    BoW (Ybg > Ytxt):  S = (Ybg^0.56 − Ytxt^0.57)·1.14 ; Lc = (S <  0.1 ? 0 : S − 0.027)·100
    WoB (Ybg ≤ Ytxt):  S = (Ybg^0.65 − Ytxt^0.62)·1.14 ; Lc = (S > −0.1 ? 0 : S + 0.027)·100

Positive Lc means dark text on light background; **negative is not an error, it is the polarity**
and must be preserved. Verified: 106.0 for black on white, −107.9 for white on black — matching
the reference implementation's documented outputs.

**The detail people get wrong here is different and more dangerous:** APCA's linearisation is a
**plain 2.4 exponent with no piecewise toe**, and its luminance coefficients carry more digits than
WCAG's (0.2126729 / 0.7151522 / 0.0721750 vs 0.2126 / 0.7152 / 0.0722). The two are *not*
interchangeable, and reusing one linearisation for both silently produces wrong numbers in both.
Write two functions, name them `relativeLuminanceWcag()` and `screenLuminanceApca()`, and never
share code between them.

**Step 3 — which standard, in 2026. Decisive: gate on WCAG 2.x, tie-break on APCA.**

- **APCA is not the WCAG 3 method.** It was removed from the WCAG 3 working draft in July 2023
  after failing to gain working-group support, and as of the **8 April 2026 editor's draft the
  working group still states that "the contrast algorithm used in WCAG 3 is yet to be determined"**
  [24] (EVIDENCE). WCAG 3 is realistically years away. WCAG 2.1/2.2 Level AA remains the operative
  benchmark, including for the US ADA Title II web rule, which mandates **WCAG 2.1 Level AA**; its
  compliance date for public entities with a population of 50,000 or more was extended by the
  Department of Justice's 20 April 2026 interim final rule to **26 April 2027** [27] (EVIDENCE) —
  so it is a live obligation, not a passed one. Shipping to an APCA-only threshold means shipping
  something that fails the standard we can actually be held to.
- **But WCAG 2's ratio is documented to behave badly in the dark region** — it is not perceptual
  when the background is darker than roughly `#aaa`, which is exactly where a dark-theme VSUP puts
  its most-suppressed cells [25] (EVIDENCE, though note the widely-quoted "50% of WCAG-passing
  pairs are not actually accessible" figure comes from the APCA author's own testing and I found no
  independent replication — treat it as motivating, not as proof).
- Therefore: **filter candidates by the WCAG ratio, then pick the survivor with the larger |Lc|.**
  Tie-breaking *within* a conforming set cannot cause a conformance failure, so this is free.

**A worked example showing why the ordering of gate and tie-break matters.** On a mid-tone
suppressed cell `#6a8f7a`:

| Ink | WCAG ratio | APCA \|Lc\| |
|---|---|---|
| `#000000` | **5.82** | 40.4 |
| `#1a1a1a` | 4.83 | 38.7 |
| `#ffffff` | 3.61 | **69.1** |
| `#f5f5f5` | 3.31 | 62.5 |

The two metrics **disagree outright**: WCAG prefers dark ink, APCA prefers light ink, on the same
background. This is not a corner case — mid-tone intermediate colours are what a blended encoding
produces, which is exactly the situation BRIEF.md flagged. With the gate applied first, only the
dark inks survive and we pick `#000000`. If the design wants light ink on mid-tones for visual
coherence, the fix is **not** to weaken the gate; it is to **darken the palette's mid-tones at build
time** until light ink passes.

**The function, and the half that matters more:**

```ts
type Rgb  = readonly [number, number, number];
type Ink  = { color: string; wcag: number; lc: number };

/** renderedBg MUST already be composited over all layers and gamut-clamped. */
export function pickInk(
  renderedBg: Rgb,
  candidates: readonly Rgb[],            // theme inks, e.g. [inkStrong, inkInverse]
  { minRatio = 4.5 }: { minRatio?: number } = {},
): Ink {
  const scored = candidates.map(c => ({
    color: toCss(c),
    wcag: wcagContrastRatio(c, renderedBg),
    lc:   Math.abs(apcaLc(c, renderedBg)),
  }));
  const passing = scored.filter(s => s.wcag >= minRatio);
  const pool    = passing.length ? passing : scored;   // fallback is a BUG signal, see below
  return pool.reduce((a, b) => (b.lc > a.lc ? b : a));
}
```

**The important half: this should almost never run at render time.** The palette is finite — 9
colours for the ordinal merge tree, × 2 themes, × a small set of overlays (hover, selection, row
stripe, focus). That is on the order of a hundred (background, ink) pairs, all knowable before the
app starts. So:

```ts
/** Build-time invariant, run as a unit test over the encoding registry. */
export function assertPaletteLegible(
  encoding: Encoding, theme: Theme, overlays: readonly Overlay[],
): void;   // throws, naming the offending swatch, if any composited background
           // admits no candidate ink at ≥ minRatio
```

If `passing` is ever empty, that is a **palette bug, not a runtime condition**. The correct repair
moves the *background*: pull the most-suppressed swatch further from the surface, or reduce the
suppression fraction at the root layer, until every swatch admits a passing ink. Resolving that at
render time by silently accepting a failing ink is how the original prototype's theme-dependent
legibility bug happens again. Precompute the table, assert it in CI, and keep the render path free
of colour maths entirely.

**Forced-colors mode discards all of it.** Under `@media (forced-colors: active)` the OS replaces
every computed colour. What survives is the value text and the hatch/glyph. That is a mechanical
reason for ADR-0010's "never colour alone", not merely a principled one — and it is worth a CI
check of its own.

---

## What this means for the schema / the view / the agent

**Nothing here changes the schema.** Every recommendation lands in the view layer or in the
encoding registry, which is the intended consequence of the domain model's Correction 1 (measures
stored, encodings derived) and is a useful confirmation that the boundary was drawn correctly.

**View layer — components to build, in build order:**

1. `MatrixView` (decided elsewhere).
2. `DotPanels` — small multiples, one panel per criterion, shared alternative order with the
   matrix, discrete labelled level ticks (**not** a continuous axis), explicit missing lane per
   panel keyed by reason code, one dot per rater assertion when multi-rater data is present.
   Doubles as the multi-rater view for ADR-0011.
3. `ParetoScatter` — two criteria, beeswarm/binned layout with counts for ordinal ties,
   `frontier(a, b)` marked, `globallyDominated` carried as a second mark channel, unplaceable
   alternatives listed beside the plot with reason codes.
4. `RankFlow` — n ranking columns joined by slope lines; `weights` prop; two columns is the slope
   chart, more is the bump chart. Connect **rank positions**, not values. Gated behind the
   ADR-0015 weighted-aggregation opt-in and inheriting its ordinal warning. Evaluate `lineupjs`
   [4] against the standalone bundle-size budget before building.
5. `RaterSpreadBar` — diverging stacked bar, detail panel only, centred on the declared neutral
   level.

**Encoding registry (ADR-0010) — `uncertainty-suppressed` parameters:**

```ts
interface UncertaintySuppressedParams {
  scoreLevels:      readonly string[];      // ordinal, low → high
  confidenceLevels: readonly string[];      // ordinal, high confidence → low
  mergeTree:        readonly (readonly (readonly number[])[])[];  // layer 0 = 1 bin (least confident)
  ramp:             (t: number) => Rgb;     // sequential, reserves lightness headroom
  surface:          Rgb;                    // the ACTUAL theme cell surface — never hardcoded white
  suppressionSpace: 'lab' | 'oklab';        // default 'lab', matching [12]/[13]
  hatchLevels:      1 | 2 | 3;              // secondary channel, ≤3
}
```

Functions: `buildMergeTree(k, m)` (default: leaf = k levels, merge adjacent upward);
`vsupSwatches(params): Swatch[]` (enumerable, and the input to the build-time contrast test);
`vsupColor(score, confidence): Swatch`; `describeBin(swatch): string` — the human-readable
"2 or 3, low confidence" that the legend and tooltip both use.

Defaults for the common case (`k = 5, m = 3`): merge tree `[[[0,1,2,3,4]], [[0,1],[2],[3,4]],
[[0],[1],[2],[3],[4]]]` → **9 colours**.

**Contrast module:** `relativeLuminanceWcag()`, `wcagContrastRatio()`, `screenLuminanceApca()`,
`apcaLc()`, `compositeOver()`, `pickInk()`, `assertPaletteLegible()`. Threshold `minRatio = 4.5`
(configurable, never below 4.5 for cell text). `assertPaletteLegible` runs in CI, not at runtime.

**Legend:** wedge/arc for `uncertainty-suppressed`, plus a **sentence** naming the aliasing.

**For `rubricator` (the agent side):** nothing new is required in the emitted document, which is
the point — but two things become *more* valuable to emit well:

- **Confidence must be a declared ordinal level, not a float.** The whole ordinal-merge-tree design,
  and the escape from [12]'s bin-boundary limitation, depend on it. Emitting `0.73` forces a
  discretisation we cannot justify.
- **`missing` reason codes are load-bearing for the views, not just the matrix.** `DotPanels`,
  `ParetoScatter` and `RankFlow` each need to *display* the reason, not merely skip the cell. An
  analysis that emits bare gaps degrades three views, not one.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0010 | **amend** | Name the VSUP tree parameters and the ordinal merge tree; state that suppression targets the **theme surface**, not white; require the legend to state the aliasing in words; require the value ramp to reserve lightness headroom (a stated exception to "sequential means one hue, light to dark"); specify WCAG-gate + APCA-tiebreak and make the palette contrast check a **build-time test**. |
| ADR-0015 | **confirm** | Dominance, veto and sensitivity analysis all hold up. Amend only to name the views that realise them (`ParetoScatter`, `RankFlow`) and to record that a 2-D frontier must be labelled as partial. |
| ADR-0009 | **confirm** | Unchanged — and note that it is what disqualifies radar outright, which is a useful precedent for future view requests. |
| ADR-0011 | **amend** | Fix the visual form of the `disagreement` encoding: per-rater dots on the shared axis of `DotPanels` at matrix scale, diverging stacked bar in the detail panel. Stacked bars must not appear in matrix cells. |
| — | **new ADR** | *"Views shipped in v1, and the ones deliberately declined."* Record the ranked list, and record radar and parallel coordinates as **declined with reasons**, so the request does not get re-litigated every six months. This is the ADR whose absence guarantees radar eventually ships. |
| ADR-0008 | **confirm** | Out of scope for this section, but note for the seriation work: a parallel-coordinates axis ordering optimises a *different* objective (dissimilar dimensions adjacent) from matrix seriation (similar rows/columns adjacent) [8]. If a PCP is ever added it needs its own ordering and its own decision record. |

---

## Open questions

1. **Hatch discriminability at cell size.** I found no controlled study of how many hatch densities
   are distinguishable in a 24–40 px cell that also carries text. Settled by a 20-minute internal
   test with the real palette at real size, including a CVD simulation pass; that is cheaper than
   more searching.
2. **Whether the ordinal merge tree preserves VSUP's measured decision effect.** [12]'s result is
   for uniform binning of continuous data. Our merge tree is within the paper's stated design space
   but is not the thing that was tested. Settled by a small A/B on a real analysis, measuring
   whether readers set aside high-score-low-confidence alternatives — not whether they read colours
   accurately, since [12] found no accuracy difference to begin with.
3. **Radar against a dot plot.** The literature does not contain the head-to-head comparison. Not
   worth running: the ADR-0009 argument (radar cannot represent a qualified missing) settles the
   decision without it, and I would rather record that reasoning than pretend a study exists.
4. **`lineupjs` bundle cost.** [4] is the closest prior art and is maintained TypeScript, but
   ADR-0013 requires a mailable single HTML file. Settled by measuring the gzipped tree-shaken
   cost of the ranking view alone against the standalone budget.
5. **Whether the `value` and `uncertainty-suppressed` encodings can share a ramp.** [12] wants a
   ramp that avoids lightness extremes; ADR-0010 wants light-to-dark for `value`. Settled by
   building both and running `assertPaletteLegible` over each — if a shared ramp passes for both,
   share it; if not, declare two.

---

## REFERENCES

1. [The Noisy Work of Uncertainty Visualisation Research: A Review — Mason, Cook, Goodwin, Tanaka, VanderPlas (2024)](https://arxiv.org/abs/2411.10482)
2. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — Cleveland & McGill (1984)](https://www.jstor.org/stable/2288400)
3. [Visualization-aided Multi-Criteria Decision-Making using Interpretable Self-Organizing Maps — Yadav, Nagar, Ramu & Deb (2023)](https://www.egr.msu.edu/~kdeb/papers/c2023011.pdf)
4. [LineUp: Visual Analysis of Multi-Attribute Rankings — Gratzl, Lex, Gehlenborg, Pfister, Streit (2013)](https://data.jku-vds-lab.at/papers/2013_infovis_lineup.pdf)
5. [Colorslope: a balanced visualization of overview and details on ranks over time — Wang, Jiang, Nagarajan, Guo, Ding, Wan, Zhao, Chen (2023), Visual Intelligence](https://link.springer.com/article/10.1007/s44267-023-00008-9)
6. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — Heiberger & Robbins (2014), Journal of Statistical Software 57(5)](https://www.jstatsoft.org/article/view/v057i05)
7. [The efficacy of stacked bar charts in supporting single-attribute and overall-attribute comparisons — Indratmo, Howorko, Boedianto, Daniel (2018), Visual Informatics](https://www.sciencedirect.com/science/article/pii/S2468502X18300287)
8. [Evaluating Reordering Strategies for Cluster Identification in Parallel Coordinates — Blumenschein et al. (2020), Computer Graphics Forum](https://onlinelibrary.wiley.com/doi/10.1111/cgf.14000)
9. [Pargnostics: Screen-Space Metrics for Parallel Coordinates — Dasgupta & Kosara (2010), IEEE TVCG 16(6):1017-1026](https://kosara.net/papers/2010/Dasgupta-InfoVis-2010.pdf)
10. [Off the Radar: Comparative Evaluation of Radial Visualization Solutions for Composite Indicators — Albo, Lanir, Bak, Rafaeli (2016), IEEE TVCG 22(1):569-578](https://pubmed.ncbi.nlm.nih.gov/26529525/)
11. [Multidimensional mechanics: Performance mapping of natural biological systems using permutated radar charts — Porter & Niksiar (2018), PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0204309)
12. [Value-Suppressing Uncertainty Palettes — Correll, Moritz, Heer (2018), CHI 2018](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
13. [vsup — reference implementation, MIT licence (UW Interactive Data Lab)](https://github.com/uwdata/vsup)
14. [Visual Semiotics & Uncertainty Visualization: An Empirical Study — MacEachren, Roth, O'Brien, Li, Swingley, Gahegan (2012), IEEE TVCG 18(12):2496-2505](https://dl.acm.org/doi/abs/10.1109/TVCG.2012.279)
15. [Evaluating Sketchiness as a Visual Variable for the Depiction of Qualitative Uncertainty — Boukhelifa, Bezerianos, Isenberg, Fekete (2012), IEEE TVCG 18(12)](https://dl.acm.org/doi/10.1109/TVCG.2012.220)
16. [Hypothetical Outcome Plots Help Untrained Observers Judge Trends in Ambiguous Data — Kale, Nguyen, Kay, Hullman (2018), IEEE TVCG](https://users.eecs.northwestern.edu/~jhullman/hops_jobs_pfs.pdf)
17. [How Visualizing Inferential Uncertainty Can Mislead Readers About Treatment Effects in Scientific Results — Hofman, Goldstein, Hullman (2020), CHI 2020](http://www.jakehofman.com/pdfs/visualizing-inferential-uncertainty.pdf)
18. [On Patterns and Textures — Kolosko (design guidance, not a study)](https://kerrykolosko.com/on-patterns-and-textures/)
19. [In Pursuit of Error: A Survey of Uncertainty Visualization Evaluation — Hullman, Qiao, Correll, Kale, Kay (2019), IEEE TVCG](https://users.eecs.northwestern.edu/~jhullman/uncertainty_vis_eval.pdf)
20. [Researchers Misunderstand Confidence Intervals and Standard Error Bars — Belia, Fidler, Williams, Cumming (2005), Psychological Methods](http://www.edmeasurement.net/5245/Belia-2005-CIs-SEs.pdf)
21. [Error Bars Considered Harmful: Exploring Alternate Encodings for Mean and Error — Correll & Gleicher (2014), IEEE TVCG 20(12)](https://graphics.cs.wisc.edu/Papers/2014/CG14/Preprint.pdf)
22. [Web Content Accessibility Guidelines (WCAG) 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/)
23. [apca-w3 — W3-licensed APCA reference implementation, Beta 0.1.9 — Somers (2022)](https://github.com/Myndex/apca-w3)
24. [WCAG3 Contrast as of April 2026 — Roselli (2026)](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)
25. [It's time for a more sophisticated color contrast check for data visualizations — Muth (2022), Datawrapper Blog](https://www.datawrapper.de/blog/color-contrast-check-data-vis-wcag-apca)
26. [Uncertainty Displays Using Quantile Dotplots or CDFs Improve Transit Decision-Making — Fernandes, Walls, Munson, Hullman, Kay (2018), CHI 2018](https://dl.acm.org/doi/10.1145/3173574.3173718)
27. [Fact Sheet: New Rule on the Accessibility of Web Content and Mobile Apps Provided by State and Local Governments (ADA Title II) — US Department of Justice](https://www.ada.gov/resources/2024-03-08-web-rule/)
