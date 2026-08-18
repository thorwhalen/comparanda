# Findings — visualisation and interaction

**Brief:** [visualisation.md](./visualisation.md). **Status:** research complete; ADR actions
proposed, not settled (ADRs are immutable — a human allocates and writes them).

This is the synthesis. The working notes stay where they are and should be read whenever a claim
here needs its full chain of evidence:

| Section | Covers | Evidence grade |
|---|---|---|
| [c5-seriation](./sections/c5-seriation.md) | Bertin's reorderable matrix; seriation families; the distance | **strong** |
| [c6-views-and-uncertainty](./sections/c6-views-and-uncertainty.md) | which views to ship; VSUP; contrast | **moderate** |
| [c7-interaction-a11y](./sections/c7-interaction-a11y.md) | reorder a11y; grid semantics; sticky; disclosure | **strong** |
| [c8-prior-art-and-stack](./sections/c8-prior-art-and-stack.md) | prior art; framework; bundle; anchoring | **strong** (Part B), moderate (Part A) |

Two findings from the *terminology* brief's sections land squarely on views specified here and are
carried across explicitly, with attribution: the incomplete-matrix dominance result in
[c3-missingness](./sections/c3-missingness.md) / [c2-measurement-and-aggregation](./sections/c2-measurement-and-aggregation.md),
and the missing direction-of-preference in [c1-terminology](./sections/c1-terminology.md). See §2.2.

Throughout: claims the literature supports are marked **EVIDENCE** and cited; inferences are marked
**(reasoning, not evidence)**. Vocabulary is the project's — **alternatives** (rows), **criteria**
(columns), **subject**, **measure** (stored), **encoding** (derived), **missing** (always with a
reason).

---

## Summary of decisions

An implementer should be able to read only this table and start work.

| # | Question | Recommendation | Evidence | ADR action |
|---|---|---|---|---|
| 1 | Which seriation algorithm? | **One**: optimal leaf ordering (OLO) over hierarchical clustering, per axis **independently**. Plain sort is the same code path with a single-criterion input. | strong [3][5][7][9][10] | ADR-0008 amend; **new ADR-0021** |
| 2 | Which distance? | Missingness-aware **Gower** with the δ mechanism; ordinal levels scored by *declared* level index, never sample rank; `minOverlap` guard, exclude-and-park what fails it. | strong [8][11] | **new ADR-0021** |
| 3 | Spectral / MDS / PCA ordering? | **Reject the whole eigen family.** Gower proves missing values can cost the similarity matrix its positive semi-definiteness; ADR-0009 guarantees we have missing cells. | strong [4][8] | **new ADR-0021** |
| 4 | Automatic vs manual reorder | **One feature, not two.** Pins and locked runs are *inputs* to OLO (distance inflation; collapse-and-re-expand), never post-hoc overrides. Never seriate on load. | strong [3][4] | ADR-0008 amend |
| 5 | What does view state store for order? | `AxisOrder = { order, provenance, constraints }`. A bare permutation cannot distinguish "seriated" from "hand-arranged". Dirty-state compares `order` + `constraints`, ignores `provenance`. | reasoning on [3] | ADR-0007 amend |
| 6 | Which views ship in v1? | Matrix + seriation; **small-multiple dot plots**; **two-criterion scatter with a dominance overlay**; **rank-flow**, gated behind the weights opt-in; **diverging stacked bar in the detail panel only**. | moderate [14][15][18][19] | **new ADR-0022** |
| 7 | Parallel coordinates? | **Decline for v1.** 1–5 ordinal collapses every polyline onto five heights per axis, and PCP axis ordering optimises the *opposite* objective from matrix seriation. | moderate [20] | **new ADR-0022** |
| 8 | Radar / spider? | **Decline outright — not with a caveat.** Area is quadratic in the values; the same 6-criterion profile spans **1.58×** in area across axis permutations; and it cannot render a qualified `missing` without lying (ADR-0009). | strong (arithmetic + ADR) [16][17] | **new ADR-0022** |
| 9 | Blended encoding construction | Implement the **VSUP** tree exactly as published, with two deliberate deviations: suppress toward the **theme surface**, not white; and use an **ordinal merge tree** (9 colours for 5 scores × 3 confidence levels) instead of uniform binning. | strong for the spec [23][24] | ADR-0010 amend |
| 10 | What does the blend actually buy? | **Not readability — decisions.** The originating study found *no* accuracy benefit over an ordinary bivariate map (F(1,70)=1.4, p=0.24); the measured effect is that readers avoided high-uncertainty options (KS D=0.5, p=0.03) and accepted worse expected value to do so (t=2.3, p=0.02), n=24, one synthetic task. | **moderate** [23] | ADR-0010 amend |
| 11 | Contrast standard | **Gate on WCAG 2.x (≥4.5:1 text, ≥3:1 graphics), tie-break on APCA.** They disagree outright on the mid-tones a blend produces. | strong [30][31][32][34][52] | ADR-0010 amend |
| 12 | Where does contrast get computed? | **Build time, as a palette test in CI** — the palette is ~9 colours × 2 themes × a few overlays. An empty passing set is a palette bug fixed by moving the background, never a runtime fallback. | reasoning on [23][30] | ADR-0010 amend |
| 13 | Drag-and-drop library | **Not `dnd-kit`** — stable line unreleased since 2024-12-05, successor pre-1.0 for two years. Keyboard/menu path is the reference implementation over `moveTo(axis, from, to)`; pointer drag is a thin second path; adopt `@atlaskit/pragmatic-drag-and-drop` for that path only when auto-scroll is needed (it is). | strong [35][36][37] | ADR-0008 amend |
| 14 | Is the keyboard path optional? | **No — it is normative.** WCAG 2.2 SC 2.5.7 makes a non-drag single-pointer route a Level AA requirement, so the move menu must exist for pointer users too, not only keyboard users. | strong [38] | ADR-0008 amend |
| 15 | ARIA pattern for the matrix | A real `<table role="grid">`, roving `tabindex`, **never** `aria-activedescendant`, **no virtualisation** in v1. `role="grid"` on a `<div>` tree is where the documented failures live. | strong [39][40][42][43][44] | **new ADR-0023** |
| 16 | Sticky headers | `position: sticky` on the `<th>`s, `border-collapse: separate`, separators as `box-shadow`, plus `scroll-padding-*` on the container — omitting it fails SC 2.4.11 on the first arrow press. | strong [45][46] | **new ADR-0023** |
| 17 | Progressive disclosure | Cell → tooltip → side panel, with a hard boundary: **a tooltip may never contain focusable content**. Evidence links are focusable, so the detail panel is load-bearing, not optional. | strong [47][48] | **new ADR-0023**; ADR-0014 confirm |
| 18 | The non-colour channel | **The foreground.** `background-image` computes to `none` under `forced-colors: active`, so gradient hatching and the colour ramp vanish together. Texture is inline SVG with `stroke="currentColor"`. | strong [49][50] | **new ADR-0024** |
| 19 | Two non-colour channels, not one | Hatch **density** (≤3 levels) carries confidence; glyph **shape** carries the missingness reason. Never overload one channel with both. | reasoning on [25][49] | **new ADR-0024** |
| 20 | CVD checking | Machado 2009 or Viénot 1999 for protan/deutan, **Brettel 1997 for tritan**; always sRGB-decode before applying the matrix; run it on a *rendered screenshot* so the composited blend is tested. | strong [53][54][55] | **new ADR-0024** |
| 21 | Accessibility enforcement | Promote the 20-check list to a **merge gate**. "Accessibility is not a later pass" needs a mechanism, not an aspiration. | — | **new ADR-0025** |
| 22 | View framework | **Preact.** Measured on one machine, one bundler, one day: React 19 + `react-dom/client` = 193,327 raw bytes for a trivial component; Preact 10 + hooks = 12,781. The mailed file is opened over `file://`, where **raw bytes are what travel**. | strong (measured) [62] | **new ADR-0020** |
| 23 | Runtime schema | `zod/mini` (15,250 raw) not the classic `z` namespace barrel (310,946 raw). JSON Schema emission is a **Node-only build step**. | strong (measured) | **new ADR-0020**; ADR-0004 confirm+note |
| 24 | Encoding registry | **Registered explicitly by the composition root.** Demonstrated: with `"sideEffects": false`, esbuild deleted a self-registering encoding module *from the bundle that needs it*, shipping an empty registry with no error. | strong (demonstrated) | ADR-0010 amend; **new ADR-0020** |
| 25 | Standalone build | Vite + `vite-plugin-singlefile`; analysis inlined as `<script type="application/json">`; a CSP meta tag with `default-src 'none'; connect-src 'none'` makes ADR-0013's no-network property **browser-enforced**; the check runs in `comparanda build`, not only in CI. | strong [64][65] | ADR-0013 amend |
| 26 | Persistence port shape | ADR-0006 is factually wrong: there is no key-value "zodal store". `@zodal/store` provides `DataProvider<T>` (collection CRUD), and its `getCapabilities()` is exactly the graceful-degradation mechanism ADR-0013 asks for and does not name. | strong (source read) | ADR-0006 amend; ADR-0013 amend |
| 27 | Annotation anchoring | **A tuple of stable opaque ids. Never a position, never a label.** Google Docs' revision-and-position anchor is a defeat forced by text having no identity; alternatives and criteria are entities we mint. | strong [68][69][70] | ADR-0011 amend |
| 28 | Grouping | Adopt `@zodal/groups-core` with the `labels` profile — many-to-many membership, nested trees, `scopeFilter`, fractional-index ordering per membership edge, at 16.1 kB raw. Build the two gaps (global axis order; group-pair inapplicability) ourselves. | strong (source read + measured) | ADR-0008 amend |

**If you had half the time:** ship the matrix, the dot panels and the Pareto scatter, and cut
rank-flow and the detail-panel spread bar. Those three cover overview, value reading and reduction,
which is the whole argument a comparison usually needs.

---

## 1. The reorderable matrix, properly

Full notes: [c5-seriation](./sections/c5-seriation.md).

### 1.1 What Bertin actually claimed, and why it changes the interaction design

**EVIDENCE.** The reorderable matrix is not a chart type. It is stage **S2b** of a three-stage
method of *graphic information processing* — S1 frame the question and compile the table, S2
construct and work the image, S3 interpret, **name** the groups, communicate [1][2], reconstructed
from Bertin's texts and correspondence by Perin, Dragicevic and Fekete [3]. Two things in that
structure are usually lost in the folklore version:

- **The framing and the naming bracket the reordering.** The permutation is meaningless without the
  group-naming step that follows it. That is the same shape as elicit-the-frame-before-scoring in
  the companion agent repo.
- **Bertin had no algorithm and was sceptical of the ones he saw.** Asked how he reordered, he
  referred to the "painter's eye"; stage S2b "could take weeks … because no systematic procedure was
  known" [3]. He reviewed three automatic reordering algorithms and "pointed out that none of them
  was satisfactory", concluding that automation **saves time but must be interlaced with manual
  tweaking** [3].

One further Bertin constraint is load-bearing and is not in ADR-0008: he argues for ordering rows
and columns **independently** [3], which eliminates biclustering — the family that is hardest to
steer interactively anyway — from a Bertin-faithful tool.

**(reasoning, not evidence)** If permuting is the analytical act, the permutation is a *finding*,
and a finding needs the apparatus of any other finding here: nameable (a saved view, ADR-0007),
attributable (who, or which algorithm, with which parameters), reversible. Hence decision 5 in the
summary table.

### 1.2 The algorithm: OLO, and the reason it is not a speed argument

**Recommendation: ship exactly one automatic ordering — OLO over hierarchical clustering of a
missingness-aware Gower distance, per axis independently — and implement plain sort as its
degenerate single-criterion case.**

Three independent lines converge on it.

1. **The R `seriation` package's own default for the input type that resembles our matrix.**
   **EVIDENCE, read from the package source, not from summaries.** Its default for a `dist` object
   is `"Spectral"` *and it hard-errors on missing values* (`stop("NAs not allowed in distance
   matrix x!")`); its default for a `data.frame` is `"Heatmap"`, defined as: compute a distance per
   axis, then seriate each axis independently with `OLO_complete` [7]. **Copying the package default
   would be exactly wrong for us; copying the right one of its two defaults is exactly right.**
2. **The visual-quality result.** Behrisch et al., surveying with visualisation rather than criterion
   values as the yardstick: "we observed that Optimal-Leaf-Ordering tends to produce visually
   coherent and well organized block-diagonal forms", and for cluster identification they recommend
   hierarchical clustering approaches because they "explicitly detect clusters and order each one
   individually, placing them at the matrix diagonal" [4] (EVIDENCE).
3. **Prior art with a human evaluation.** Bertifier — a peer-reviewed, user-evaluated Bertin tool —
   chose OLO as its automatic ordering [3]. Independent corroboration reached from a different
   direction in [c8](./sections/c8-prior-art-and-stack.md#a8).

Note what Hahsler's experimental comparison [6] actually recommends, and what it does not. Its
conclusion is a *runtime/quality tradeoff* recommendation ("spectral seriation and metric MDS
provide a good tradeoff … while hierarchical clustering with optimal leaf ordering provides a good
tradeoff for path length"), with a scalability experiment running to 10,000 objects on a five-minute
budget [6]. **We have tens.** OLO is O(n³) in the improved form [10] (the 2001 algorithm [9] was
O(n⁴)); at n = 100 that is ~10⁶ operations, i.e. milliseconds in JavaScript. Adopting a tradeoff
recommendation without adopting the constraint that produced it is the reflex the brief warns about
(reasoning).

**Linkage: run all three and keep the best.** At n ≤ ~200, run `single`, `average` and `complete`
and keep the order with the lowest Hamiltonian path length. This is principled rather than shotgun:
OLO minimises path length *subject to* a given dendrogram [9], so the best of three dendrograms is
the best achievable among them — a strictly better answer than guessing, at three times a negligible
cost. Fall back to `complete` above a configurable limit, matching [7].

### 1.3 The distance, and the finding that selects the algorithm family

Euclidean distance over 1–5 ratings is wrong twice: it treats ordinal as interval (the category
error ADR-0003 exists to prevent) and has no defined behaviour on a missing cell. Listwise deletion
discards exactly the alternatives an incomplete analysis most needs to place; imputation invents
values, contradicting ADR-0009 outright.

**EVIDENCE — the right tool is Gower's coefficient and specifically its δ mechanism** [8]:
`S_ij = Σ_k s_ijk·δ_ijk / Σ_k δ_ijk`, where `δ_ijk = 1` when criterion *k* can be compared for the
two alternatives and 0 otherwise. The similarity is the average over *comparisons that were actually
possible*. Ordinal levels are scored by their **declared** level index normalised to [0,1] — the
standard-scoring approach `cluster::daisy` takes [11] — and **not** by sample rank, because rank
transformation would make the distance between two alternatives change when a third alternative is
added, which is unacceptable in a document people re-open (reasoning). The honest caveat: mapping
level *k* of *K* to (k−1)/(K−1) assumes equal spacing, a real interval assumption smuggled into a
similarity computation. It is confined to a view-layer ordering heuristic, produces no number anyone
reports, and must be stated in the UI alongside the order per ADR-0015. It is **not** a licence to
average scores anywhere else.

**And here is the load-bearing finding of the whole section. EVIDENCE:** Gower's own appendix
demonstrates, by a four-character three-individual counterexample with a negative determinant, that
**"missing values may cause the similarity matrix to lose its p.s.d. property"** [8]. Behrisch et al.
independently report that eigenvectors are "very sensitive to data corrupted with outliers, **missing
values**, and non-normal distributions" [4].

**(reasoning, on that evidence)** A distance matrix that is not positive semi-definite has no
Euclidean embedding. Every method that decomposes it — spectral seriation via the Fiedler vector,
metric MDS, PCA-based ordering — is then operating outside its assumptions and can return an
eigenvector that means nothing. Hierarchical clustering and OLO never need the matrix to be
embeddable: agglomeration compares distances, and OLO's dynamic program sums distances between
adjacent leaves [9][10]. **Because ADR-0009 guarantees missing cells, the eigen-based families are
structurally the wrong choice for `comparanda`, independent of any speed argument.** This is a much
stronger rejection than the usual quality/runtime story and it is not in the brief.

Two guards fall out:

- **`minOverlap`.** Gower's δ-normalisation silently equates a distance computed from twelve
  comparisons with one computed from two — a variance problem, invisible in the output. Require a
  minimum comparable-criteria count (default `max(3, ceil(0.3 × comparableCriteria))`); an
  alternative that fails it is **excluded from the seriation and parked at the end, visibly
  flagged**. That is ADR-0009's stance applied to an algorithm: a qualified "we could not place this"
  beats a confident wrong position.
- **Missingness reasons carry similarity information.** Two alternatives both `not-applicable` on a
  criterion *are* alike in a way readers care about, and treating them so makes inapplicable blocks
  cluster and become visible as blocks — the entire point of reordering. Structural absence gets
  `δ=1, s=1` when both agree and `δ=1, s=0` when one has a value; contingent absence
  (`not-assessed`, `pending`, `unknown`, `withheld`) gets `δ=0`. Ship it as
  `missingPolicy: 'structural-matches' | 'skip-all'`, defaulting to the former, because the second
  row of that table is a design choice rather than a derivation.

**Consequence for the agent contract:** the reason codes are load-bearing, not cosmetic — emitting
`not-assessed` where `not-applicable` is meant changes the arrangement — and an ordinal
(criterion, measure) pair must declare its ordered `levels` or the ordinal branch silently degrades
to nominal.

### 1.4 Presenting an ordering so it invites adjustment

**EVIDENCE — Bertifier's design is directly transferable [3].** Its contribution beyond the UI is
*visual reordering*: "a semi-interactive reordering approach that lets users apply and tune automatic
reordering algorithms in a WYSIWYG manner". Concretely, it builds a richer API **on top of** OLO
rather than post-processing its output — first/last limits implemented by *inflating* distances to
pinned vectors, protected ranges implemented by collapsing a run to its endpoints with distance 0
between them and re-inserting afterwards [3]. It frames manual drag as *tuning*, locks the drag axis
by initial direction, and — the sentence that collapses three planned mechanisms into one — notes
that "standard sorting is just a particular case of the reordering algorithm when the list of rows
contain exactly one column, and vice versa" [3].

**This corrects ADR-0008's framing.** ADR-0008 treats manual reorder and automatic seriation as two
features that must not fight. They are **one feature**: pins and locked runs are *parameters* of OLO,
and plain sort is OLO on a single-column input. The eight interaction rules (never seriate on load;
constraints are inputs; a drag is an *offer* to become a pin; animate and always offer undo; explain
the result in one line at the point of use; ship Bertin's own "arrange by similarity to this
alternative" as a named action; offer the dendrogram cut as *suggested* groups a human accepts,
never as automatic groups; lock the drag axis and give the keyboard the identical model) are set out
in full in [c5 §5](./sections/c5-seriation.md).

**Build, do not depend.** `reorder.js` has the right API shape and is a usable cross-check oracle for
tests, but its ESM build is ~98 kB unminified plus a dependency, and we must supply our own distance
regardless [12]. OLO + agglomerative clustering is a few hundred lines of pure, dependency-free,
highly testable code — exactly what belongs in `core`.

**Not shipping in v1, with reasons on the record:** spectral/Fiedler and metric MDS/PCA (§1.3);
**BEA**, whose measure of effectiveness is argued to be valid only for binary data [13, via 5] and
which is a provably suboptimal TSP heuristic [5]; barycentre/crossing minimisation (degenerate on a
dense value matrix); ARSA/QAP/genetic (best on anti-Robinson criteria [6] but ~O(n⁴) and
**non-deterministic** — the same analysis must arrange identically twice or people stop trusting it);
unrestricted TSP (better raw path length [6], visibly worse block structure [5], no natural place to
inject pins); biclustering (Bertin argues against it explicitly [3]).

---

## 2. Which views to ship

Full notes: [c6-views-and-uncertainty](./sections/c6-views-and-uncertainty.md).

### 2.1 The selection criterion

**EVIDENCE.** Cleveland & McGill's ranking of elementary perceptual tasks by decoding accuracy puts
*position along a common scale* first and *shading / colour saturation* last [14]. The matrix encodes
its measures in colour. So the matrix is, by construction, the **least** accurate available encoding
for reading a value, and its virtue lies entirely elsewhere: every (alternative, criterion) pair at
once, and block structure under seriation.

That fixes the rule (reasoning, on that premise): **a secondary view earns its place only if it
repairs a specific weakness of the matrix.** Not by being popular, not by looking analytical. The
matrix is weak at (1) reading and comparing values on one criterion; (2) answering "which
alternatives can I stop considering"; (3) showing whether a conclusion is *stable*; (4) showing the
spread between raters inside a cell. Four holes, four views, one each.

A second filter runs through all of it, and it disqualifies more candidates than any perceptual
argument: our scores are **ordinal**. Any view whose visual variable invites arithmetic the level of
measurement does not license — area, length ratios, slope magnitude, polygon size — commits the same
category error as the total column ADR-0015 exists to prevent.

### 2.2 The ranked recommendation

| Rank | View | v1 | Fills | Chief risk to manage |
|---|---|---|---|---|
| 1 | Matrix + seriation | **yes** (decided) | overview, block structure | colour is the least accurate channel [14] |
| 2 | Small multiples of dot plots | **yes** | value reading; multi-rater spread | panel count; tie overplotting; the missing lane |
| 3 | Two-criterion scatter + dominance overlay | **yes** | "what can I stop considering" | a 2-D frontier is not *the* frontier — must be labelled |
| 4 | Rank-flow / bump under weight change | **yes, gated** | stability of conclusions | presupposes an aggregation; degrades past ~30 [21] |
| 4= | Slope chart (two columns) | **yes** (same component) | rater vs rater | angle reads as magnitude — connect **ranks**, not values |
| 5 | Diverging stacked bar, **detail panel only** | **yes, scoped** | shape of disagreement in one cell | only one segment shares a baseline [15] — never at matrix scale |
| 6 | Parallel coordinates | **no** | — | ordinal collapse; a second, conflicting axis ordering [20] |
| 7 | Radar / spider | **no** | — | quadratic area; 1.58× area swing from reordering; cannot show `missing` |

**Dot plots (rank 1).** They convert the matrix's worst channel into its best [14]. The brief's claim
that this is "often the most honest view of ordinal data" is **partly confirmed, with one correction
the folklore misses**: a dot has no length, so it does not invite "twice as good" (a ratio statement
illegal at ordinal level) — but the dot plot still places levels at *equal spacing* along the axis,
which is an interval assumption smuggled in through geometry. The mitigation is cheap and nobody
does it: **render the axis as discrete labelled ticks carrying the criterion's own level names**,
with no continuous rule between them, so the spacing reads as ordering rather than distance
(reasoning). Each panel needs an explicit **missing lane** keyed by reason code, or it silently drops
exactly the alternatives ADR-0009 exists to keep visible. Bonus, and why it ranks first: one dot per
rater assertion on the same axis makes disagreement a *visible gap on a common scale*, so this one
component fills hole 1 and hole 4.

**Pareto scatter (rank 2) — and two blocking dependencies carried from the terminology brief.**
Dominance requires only the ≥ relation, so it is legal on ordinal data, and ADR-0015 already ships
it as an analysis; this is its visual form, and the pairing matters because an analysis returning a
set of names is far less persuasive than one that shows the frontier. Three things must be designed
in, not bolted on:

- **The 2-D frontier is not the frontier.** An alternative non-dominated on (startup time, memory
  safety) may be dominated across all twelve criteria. Label it "non-dominated **on these two
  criteria**" *in the view* (ADR-0015's assumptions-at-point-of-use rule) and carry the
  full-criteria dominance status as a second mark channel.
- **BLOCKING, carried from [c1](./sections/c1-terminology.md): criteria currently have no direction
  of preference.** Dominance is undefined without one — ADR-0015's "falling below a threshold"
  silently assumes higher-is-better everywhere. The `ParetoScatter` view cannot be built before the
  schema carries gain/cost/target per criterion.
- **BLOCKING, carried from [c2](./sections/c2-measurement-and-aggregation.md) and
  [c3](./sections/c3-missingness.md): the obvious dominance rule over an incomplete matrix is
  non-transitive.** Comparing only on criteria where both alternatives have a value is the published
  definition in the incomplete-data skyline literature *and* is proven there to admit cycles in which
  every alternative is dominated and the skyline is **empty** [79]. So the view must render
  **necessary (certain) and possible dominance as two tiers**, not one frontier — which is better
  anyway, because the gap between the tiers measures what the missing data is costing the decision.

**Rank-flow (rank 3, gated).** LineUp is the closest prior art and is strong: an interactive
multi-attribute ranking view where "through integration of slope graphs, LineUp can also be used to
compare multiple alternative rankings on the same set of items" [15]; its own requirement "R VII:
Handle missing values … 'downgrading' or omitting an item because of missing values might not be
acceptable for certain tasks" [15] is ADR-0009 arrived at independently. The honest tension: a
rank-flow view *presupposes a ranking*, which presupposes an aggregation. Resolve it by being strict
about the direction of the claim — **defensible:** "this ranking is not stable; a 5% weight change
moves three alternatives past each other"; **not defensible:** "this is the best alternative." Ship
it behind ADR-0015's weighted-aggregation opt-in, inheriting its ordinal warning, and phrase the
default caption as a stability finding. Scale limit, EVIDENCE: bump charts are reported as "not
suitable for the visualization of too many data items (e.g., > 30), even for users to carry out basic
tasks" [21] — right at our boundary; mitigate by ranking only the current selection.

**Diverging stacked bars (rank 5, scoped).** Heiberger & Robbins is the standard design reference for
Likert-style diverging bars, but it is a design paper arguing from perceptual principles, not a
controlled experiment — cite it as consensus, not as measured superiority [18]. The one controlled
comparison found is equivocal: 30 participants, and for *single-attribute* comparisons all three
chart types performed similarly [19]. LineUp names the structural problem plainly — stacked bars
"complicate the comparison of individual attribute scores across multiple items, as only the first
one is aligned to the baseline" [15]. **Conclusion, which splits the question in two:** within one
cell, a diverging bar centred on the declared neutral level is right and belongs in the detail panel;
across alternatives, the per-rater dot plot wins because every dot shares one axis. Stacked bars
never appear in matrix cells.

### 2.3 The two declines

**Parallel coordinates — decline for v1.** With 1–5 ordinal scores every polyline lands on one of
five heights per axis; twenty-two alternatives across twelve criteria coincide over long runs and
become individually untraceable — the segment-identity problem in its worst case. And the axis-order
problem is *not* the same problem as matrix seriation: only adjacent axis pairs are readable,
optimising the ordering is NP-hard, over 30 automatic strategies have been proposed with no consensus
default, and crucially a PCP ordering wants **dissimilar** dimensions adjacent to make clusters
salient [20], whereas matrix seriation wants **similar** rows and columns adjacent to make blocks
solid. Shipping both means maintaining two orderings of the same criteria and then explaining why
"arrange to reveal structure" gave different answers in two views of one document. Revisit only if
ratio-scale criteria become common.

**Radar — decline outright, not with a caveat.** The brief allowed shipping it caveated. There is no
caveat that fixes it, and two of the three arguments are arithmetic rather than opinion (verified
numerically in [c6 §A.6](./sections/c6-views-and-uncertainty.md), not repeated from folklore):

1. **Area is quadratic in the values.** For n equally spaced axes, `A = ½·sin(2π/n)·Σ r_i·r_(i+1)`.
   A flat 3 on six criteria encloses 23.383; a flat 4 — *one ordinal step better everywhere* —
   encloses 41.569, i.e. **1.78× the area**, exactly (4/3)². The reader perceives a difference nearly
   twice the size of the one in the data, on a scale where the difference is not even a ratio.
2. **The same data has many different areas.** Area depends on products of *adjacent* radii, so it
   changes when the axes are permuted, and axis order is an arbitrary authoring choice. Over the
   cyclic orders of one 6-criterion profile the area ranges 13.423 … 21.218 — a **1.58× spread from
   reordering alone**. This is not theoretical: a published paper using "permutated radar charts"
   explicitly searches the permutations and selects "the one that yields a maximal total area" [17].
   A view whose headline visual property can be inflated 58% by reordering the columns has no place
   in a tool whose premise is auditability.
3. **It cannot render a qualified `missing`.** A missing axis either collapses to the centre — which
   renders "nobody has looked yet" as "scores worst possible", a lie — or breaks the polygon.
   ADR-0009 requires that `not-applicable` and `not-assessed` be distinguishable and that neither read
   as a value. Radar structurally cannot comply. This argument alone is sufficient.

An honest correction in the other direction, because the folklore overclaims too: I could not locate
a controlled study comparing radar against a dot-plot small-multiple on ordinal profile tasks. The
strongest direct experiment compares radar only against **other radial designs** and finds it least
effective and least liked [16] — a genuine result that refutes "radar is the natural display for a
composite indicator", but not by itself a licence to say "radar is worse than a dot plot".

**When the request arrives** — and it will — the job radar is asked to do is "show me the shape of
this alternative and let me compare it to that one". Answer it with the dot-plot small multiple, two
alternatives highlighted on the shared axis. Same question, honest encoding, handles missings.

### 2.4 `lineupjs`: prior art to read, not a dependency to adopt

[c6](./sections/c6-views-and-uncertainty.md) leaves this open — "evaluate `lineupjs` against the
standalone bundle-size budget". [c8](./sections/c8-prior-art-and-stack.md) settles the currency it
would be evaluated in: the artifact is mailed and opened over `file://`, so **raw bytes govern**, and
the entire measured dependency floor (Preact + `zod/mini` + `@zodal/core` + `@zodal/groups-core`) is
51 kB raw. **(reasoning, on those measurements)** A general ranking-visualisation library is not going
to fit under that budget for one gated, optional view. **Decline `lineupjs` as a dependency; read the
paper [15] and build `RankFlow` as an SVG of ranking columns joined by slope lines.** If someone
contests it, the measurement that settles it is the gzipped *and raw* tree-shaken cost of the ranking
view alone — but the burden is on adoption, not on rejection.

---

## 3. Uncertainty, encoded honestly

Full notes: [c6 Part B](./sections/c6-views-and-uncertainty.md).

### 3.1 The VSUP construction, exactly

**EVIDENCE, from the paper and the MIT-licensed reference implementation [23][24].** A traditional
bivariate map is a 2-D square: every (value, uncertainty) pair gets its own output. A VSUP is a
**tree**: as uncertainty rises, values map to fewer and fewer outputs, "culminating in a singularity
where all inputs are mapped to an identical, highly uncertain mark regardless of data value" [23].
The saving is spent where it helps.

The quantisation, lookup and colour construction are specified line by line in
[c6 §B.1](./sections/c6-views-and-uncertainty.md#b1-value-suppressing-uncertainty-palettes--the-implementable-spec)
and should be implemented from there rather than paraphrased. Four points carry decisions:

- **⚠️ We store *confidence*, not uncertainty.** `û = 1 − normalise(confidence)`. Getting this
  backwards inverts the entire encoding and it will look plausible. Unit-test the corners.
- **Deviation 1 — suppress toward the theme surface, not white.** The reference implementation
  hardcodes `#fff`. On a dark surface, interpolating toward white would make the least-trustworthy
  cells the **brightest things on the page** — the exact inverse of the intent. Parameterise it.
  (reasoning, but a direct consequence of the mechanism.) Note this contradicts ADR-0010's
  instruction to "follow [the literature] rather than improvising": the deviation is deliberate and
  must be documented as such, not discovered later.
- **Deviation 2 — an ordinal merge tree instead of uniform binning.** Our data is not continuous: a
  score has *k* declared levels (commonly 5) and confidence has *m* (commonly 3). Uniform binning
  wastes bins and aliases unevenly. The paper explicitly opens this door — "non-uniform binning would
  allow the designer to target particular distributions or important subregions of the data" [23]. So
  the leaf layer is exactly the *k* score levels and each higher layer merges adjacent groups:
  `{1}{2}{3}{4}{5}` → `{1,2}{3}{4,5}` → `{1,2,3,4,5}` = **9 colours**, well under the ≤16 ceiling
  [23]. Every colour now corresponds to a **nameable set of levels**, so the legend and tooltip can
  say "**2 or 3, low confidence**" in words instead of asking the reader to invert a ramp. That is a
  real gain in a tool whose product claim is auditability.
- **Do not "fix" the root.** At the top layer the representative `û` is (L−1)/L — the most-uncertain
  colour sits partway to the surface, **not at it**. That is what keeps a maximally uncertain cell
  distinguishable from an **empty** cell, which matters enormously here because empty means something
  specific (ADR-0009). Preserve the property explicitly and test it.

One published limitation does **not** bite us, and it is worth recording because it is the paper's own
biggest caveat: VSUPs are "highly sensitive to the binning scheme used", because continuous values
near a bin boundary get large colour differences [23]. Our confidence is already ordinal with declared
levels — the binning is exact, not a discretisation of a continuum. This is one of the few places our
constraints make a published technique work *better* than it does generally.

**Legend:** the wedge/arc form, root at the narrow end — chosen for communication, not for measured
performance. The paper found **no significant effect of legend shape** on identification accuracy
(F(1,70)=0.04, p=0.84) or on decision-making (F(1,61)=0.01, p=0.92), and recommends the wedge only
because "it makes the conceptual differences between the two more apparent" [23]. Say so internally so
nobody later defends it as an empirical result.

### 3.2 The honest warrant — this corrects BRIEF.md

BRIEF.md calls the blended encoding "the one that changes minds" and "the most valuable single
feature". The evidence supports the product claim and **not** the readability claim [23]:

| Comparison | Result |
|---|---|
| Superimposed vs juxtaposed (identification accuracy) | 58% vs 51%, F(1,166)=5.5, p=0.02 — superimposed wins |
| Discrete vs continuous bins (identification accuracy) | 63% vs 47%, F(1,166)=30, p<0.01 — discrete wins |
| **VSUP vs traditional discrete bivariate (identification accuracy)** | **F(1,70)=1.4, p=0.24 — no significant difference** |
| VSUP vs traditional (distribution of choice uncertainty) | KS D=0.5, p=0.03 — VSUP users avoided the most uncertain regions |
| VSUP vs traditional (danger/value accepted) | M=0.32 vs 0.29, t=2.3, p=0.02 — VSUP users accepted worse expected value |

**Read plainly: the blend does not make the table easier to read. It makes readers discount thin
evidence.** That *is* BRIEF.md's claim — "makes high-score-thin-evidence cells recede" — and it now
has a citation and an effect size instead of an anecdote. But the base is n=24 crowdworkers, one
synthetic task, one lab. **Grade the claim moderate**, restate it as "changes decisions" rather than
"reads better", and never write "research shows the blended encoding improves decisions"; write "in
the study that introduced this technique, participants using it avoided the most uncertain options
and accepted worse expected value to do so."

### 3.3 Do people read uncertainty encodings correctly? Less well than the design literature implies

Four results, all EVIDENCE, and they are more specific than "people are bad at uncertainty":

1. **The field's evaluation practice is overconfident.** A survey of 86 user studies found evaluation
   "focuses on Performance and Satisfaction-based measures that assume more predictable and
   statistically-driven judgment behavior than is suggested by research on human judgment and
   decision making" [26].
2. **The results conflict, and the reason is definitional.** A 2024 review finds the field lacks a
   shared definition of uncertainty, which "results in a significant amount of conflicting results in
   the literature" [27]. **Practical consequence: do not expect a stable published ranking of
   uncertainty encodings to exist. There isn't one.**
3. **Even experts misread the most standardised uncertainty encoding there is.** Authors published in
   leading psychology, neuroscience and medical journals hold systematic misconceptions about error
   bars and CI overlap [28].
4. **Encoding choice changes conclusions, not just accuracy.** Participants overestimated a treatment
   effect and paid more for it when shown inferential rather than outcome uncertainty — same data,
   different interval, different decision [29].

**Three requirements follow, and they are the answer to the brief's question:**

- **The score stays as text in every cell.** ADR-0010 already says this; the literature above is why
  it is not negotiable. The text is the channel read *correctly*; the blend is the channel that
  changes *decisions*. Different jobs, both needed.
- **Keep a single-measure `confidence` encoding one click away.** Superimposition beats juxtaposition
  for *fusing* value and uncertainty (58% vs 51% [23]) — but the paper itself concedes that an
  analyst who "wishes to quickly and orthogonally analyze the distributions of uncertainty and value"
  may be better served by juxtaposed maps [23]. "Where is the evidence thin across this whole
  analysis?" is a different question from "how good is this cell?"
- **The legend must state the aliasing in words.** "At low confidence, all scores are shown as one
  colour" is a claim about what the reader *cannot* see, and no colour ramp communicates it. The
  ordinal merge tree is what makes those words nameable. Cheapest honesty feature in the design.

### 3.4 Which other uncertainty channels survive a dense table

The test is a matrix cell: 24–40 px tall, several hundred of them, also carrying text. Bivariate 2-D
colour is superseded by VSUP (equal on accuracy, worse on the decision measure [23]). **Glyph size,
blur, sketchiness and hypothetical outcome plots all fail in the matrix** — size reads as a second
grid and is perceptually integral with colour [23]; blur bleeds across 1 px borders and destroys the
in-cell text; sketchiness needs stroke, and a grid of filled rectangles has none [25]; HOPs need
animation per mark and the artifact must print and mail (ADR-0013). Quantile dotplots and HOPs are
reasonable in the **detail panel** for one multi-rater cell [22], which converges on the same
component as view rank 1.

**Hatching is the one to ship, as a coarse channel with at most three densities.** Texture ranks well
as an intuitive uncertainty signifier [25], but I could **not** find a controlled study of hatch
discriminability at table-cell size; the practical guidance that pattern fills are unsuited to small
shapes is craft, not evidence, and is marked as such in [c6](./sections/c6-views-and-uncertainty.md).
So hatching's real jobs are forced-colors and print, colour-vision deficiency, and satisfying
ADR-0010's "never colour alone" — not carrying five distinguishable levels, which it cannot.

### 3.5 Contrast: computing ink from the *actually rendered* background

BRIEF.md's lesson is right and the interesting failures are in the word *actual*.

**Step 0 — get the background that is really painted.** Composite every layer (cell fill, row stripe,
hover/selection overlay, focus backdrop) in paint order in **gamma-encoded sRGB**, because that is how
browsers composite; do not composite in Lab. The VSUP suppression interpolates in CIELAB — convert
back to sRGB and **gamut-clamp before measuring**, or you measure a colour the screen never showed.
Never assume white; never take one element's computed background as final.

**Steps 1–2 — two luminance functions that must never share code.** WCAG 2.x relative luminance uses a
**piecewise** transfer function with a linear segment below 0.04045 (skipping it is wrong for dark
colours, which is precisely the dark-theme suppressed region) and coefficients 0.2126/0.7152/0.0722
[30]. APCA uses a **plain 2.4 exponent with no toe** and coefficients carrying more digits
(0.2126729/0.7151522/0.0721750), plus a low-luminance clamp applied to both text and background [31].
Name them `relativeLuminanceWcag()` and `screenLuminanceApca()` and share nothing. APCA's negative
`Lc` is the polarity, not an error.

**Step 3 — which standard, decisively: gate on WCAG 2.x, tie-break on APCA.**

- **APCA is not the WCAG 3 method.** It was removed from the WCAG 3 working draft in 2023, and as of
  the April 2026 editor's draft the working group still states that "the contrast algorithm used in
  WCAG 3 is yet to be determined" [32] (EVIDENCE). WCAG 2.1/2.2 AA remains the operative benchmark —
  including for the US ADA Title II web rule, whose compliance date for larger public entities was
  extended to 26 April 2027 [34], so it is a live obligation.
- **But WCAG 2's ratio behaves badly in the dark region** — exactly where a dark-theme VSUP puts its
  most-suppressed cells [33]. (Note the widely-quoted "50% of WCAG-passing pairs are not actually
  accessible" figure comes from the APCA author's own testing with no independent replication found;
  treat it as motivating, not as proof.)
- Therefore filter candidates by the WCAG ratio, then pick the survivor with the larger |Lc|.
  Tie-breaking *within* a conforming set cannot cause a conformance failure, so it is free.

**Why the order matters — a worked example.** On a mid-tone suppressed cell `#6a8f7a`, WCAG prefers
black (5.82 vs 3.61 for white) while APCA prefers white (|Lc| 69.1 vs 40.4). **The two metrics
disagree outright**, and mid-tone intermediate colours are exactly what a blended encoding produces —
the situation BRIEF.md flagged. With the gate first, only the dark inks survive. If the design wants
light ink on mid-tones for coherence, the fix is **not** to weaken the gate; it is to darken the
palette's mid-tones at build time until light ink passes.

**The half that matters more: this should almost never run at render time.** The palette is finite —
9 colours × 2 themes × a small set of overlays, on the order of a hundred (background, ink) pairs, all
knowable before the app starts. Precompute the table and assert it in CI via
`assertPaletteLegible(encoding, theme, overlays)`; keep the render path free of colour maths.
**If the passing set is ever empty, that is a palette bug, not a runtime condition** — the repair
moves the *background* (pull the most-suppressed swatch further from the surface, or reduce the root
suppression fraction), never silently accepts a failing ink. Accepting a failing ink at render time is
how the original prototype's theme-dependent legibility bug happens again.

This is a change of *kind* from BRIEF.md's framing, which describes contrast as computed at render
time. (reasoning, on the finiteness of the palette.)

---

## 4. Interaction and accessibility

Full notes: [c7-interaction-a11y](./sections/c7-interaction-a11y.md).

### 4.1 Reordering: a maintenance question with a clear answer, and a normative requirement

**EVIDENCE (npm registry + GitHub API, retrieved 2026-08-18) [35].** `@dnd-kit/core@6.3.1` and
`@dnd-kit/sortable@10.0.0` were both published in early December 2024 with no stable release in the
~20 months since; the successor line (`@dnd-kit/react`, `@dnd-kit/dom`) has sat at `0.5.0` for two
years. The maintainer's own answer on the 2025 "is this maintained?" issue is that all development is
on the pre-1.0 branch and "there may be breaking API changes before the `1.0.0` release" [58]. Read
straight, that answer *is* the risk. BRIEF.md asks for dependencies that "must still build in three
years"; a frozen 6.x plus an indefinite 0.x is the opposite shape of risk. **This amends ADR-0008,
which names `dnd-kit` as the first library to evaluate.** `dnd-kit` is also React-only, which the
framework decision (§5) independently rules out.

**And the accessibility premise behind "pick a drag library" is wrong anyway.** The leading
framework-agnostic alternative's own README says its packages "are unopinionated about visual language
or accessibility" [36], and its guidance states that the core package "does not enable accessible
controls automatically, as there is no one pattern that works well for all situations" [37]. Drag
libraries sell you a **pointer abstraction**, not an accessible reorder. You write the keyboard path
and the announcements either way. (reasoning, on the cited documentation.)

**The keyboard path is not an "equivalent" — it is normative.** WCAG 2.2 SC **2.5.7 Dragging Movements
(AA)** requires a non-drag single-pointer route, and the Understanding document names exactly our
pattern: "a sortable list of elements may, after tapping or clicking on a list element, provide
adjacent controls for moving the element up or down in the list" [38]. **So the move menu is a
conformance obligation, and it must exist for pointer users too, not only keyboard users.** ADR-0008's
"keyboard-accessible equivalent" framing understates this.

**Specification.** Every alternative header and criterion header carries one
`<button class="reorder-handle">` that is both a menu trigger and a grab-mode entry point.

- **Route A — explicit move commands (the guaranteed, self-documenting path):** Move to start / earlier
  / later / to end / before… / Group with…
- **Route B — grab mode (the fast path):** `Space`/`Enter` pick up and put down; arrows move; **`Tab`
  and `Shift+Tab` also move**; `Home`/`End` jump; `Escape` cancels and restores.

The dual `Tab` binding is not redundant: in NVDA and JAWS browse mode, bare arrow keys can be consumed
by the screen reader's reading cursor and never reach our handler. Atlassian gives the mode problem as
a reason to avoid arrow keys outright — "Directional arrow movements require JAWS screen reader users
to change screen reader mode to use it" [37] — and React Aria independently made `Tab` the
drop-target key [57]. Binding both costs nothing and removes a class of "works for me" failure.
(reasoning; the browse-mode interception is inferred, not measured here.)

**Do not bind bare `Alt+Arrow`** — it is browser Back/Forward on Windows and Linux. And do not emit
`aria-grabbed` or `aria-dropeffect`: both carry "Deprecated in ARIA 1.1" in the specification [61],
and native HTML5 drag and drop, which they were meant to describe, is not keyboard operable at all. (This overrides the
`Alt`+arrows sketch in [c8 §B.6](./sections/c8-prior-art-and-stack.md); see §7.)

**Announcements** go through one `assertive` region for the drag lifecycle and one `polite` region for
results, from a single `describeMove()` in `core` so that the menu path, the grab path and the drag
path say identical things. Phrasing is position-of-total in project vocabulary — *"Criterion Memory
safety moved to column 4 of 12, after Startup time."* [37]. **Focus stays on the moved header's handle
at its new location**, restored by id after commit if the framework remounts it [37]; this is the
single most commonly broken thing in reorder implementations and deserves its own interaction test.
Seriation announces politely and **leaves focus where it was** — an automatic reorder that steals focus
is what makes automatic reordering feel like a mode that fights you.

### 4.2 The ARIA pattern: a real `<table role="grid">`

**Use `grid`, and use it on a `<table>`.** The APG's justification for `grid` is traversal efficiency:
a `grid` "always contains multiple focusable elements" of which "only one … is included in the page tab
sequence" [43]. A 22 × 12 matrix is 264 openable cells — 264 tab stops as a plain table, one as a grid.
Higley's decision rule fits us on both halves: grid when "the primary purpose is to enable user
interaction" and "efficiency is more important than a low barrier to entry" [41].

Roselli's counter-argument is real and must be honoured rather than dismissed: `grid` is routinely
applied to things that are not grids, it strips native semantics when it does, and "as of now `grid`
semantics are only exposed to screen reader users … a keyboard-only user will have no idea" [42]. But
his documented failures were against **`<div>`-based** examples, not against `<table role="grid">`
[42], and the published compatibility matrix supports the distinction: a real data table with
`role="grid"` is announced correctly by every NVDA tested from 2012.3 to 2025.3, by JAWS 15 and later,
and by VoiceOver macOS 10.10 onward [44]. **`role="grid"` on a `<table>` is safe; `role="grid"` on a
`<div>` tree is where the failures live.** Roselli's objection is answered with product, not markup: a
visible, persistent keyboard-help affordance so the interaction model is not screen-reader-only
knowledge.

- **Roving `tabindex`, never `aria-activedescendant`.** It is not focus, receives no keyboard events,
  and has no DOM query; with NVDA or Narrator the referenced element "will not update to match the
  screen reader's cursor location", and mobile screen readers largely ignore it [39]. Persist the
  roving position in view state so returning from the detail panel lands in the same cell.
- **No virtualisation in v1.** ADR-0002 caps us at tens to low hundreds of alternatives.
  `aria-rowindex`/`aria-colindex` "will affect what a screen reader says … but will not change any
  other behavior or navigation", producing a disorienting mismatch with DOM order, and where a library
  recycles and visually reorders rows "the screen reader accessibility is entirely broken" [40]. The
  rule is scoped, not thresholded: those attributes exist for lazy-loaded content, which we do not
  have. Documented trigger: revisit past ~500 rows, and if you virtualise, keep DOM order identical to
  visual order without exception.
- **Not `treegrid`.** Groups are many-to-many tags, not a partition (ADR-0008), so `treegrid` would be
  a lie about the structure.
- **A cell carrying both a score and a confidence uses visually-hidden text inside the cell**, not
  `aria-label` (which overrides the visible text, diverges from what a sighted colleague reads aloud in
  a meeting, and is routinely missed by translation workflows [59]) and not a dynamically-changing
  `aria-describedby`. Target: **"Memory safety, Rust, 5 of 5, confidence low."** For a missing cell:
  **"Memory safety, Rust, not applicable."** Never a bare silence, never "blank".

### 4.3 Sticky headers: four traps, one configuration

Use `position: sticky` on the `<th>` elements with **`border-collapse: separate; border-spacing: 0`**
and separators drawn as `box-shadow`. Collapsed borders belong to the table, not the cell, so they do
not travel with a sticky cell in any engine — the CSSWG issue has been open since 2018 and is still
labelled "Needs Design / Proposal" [45]. Watch the other three traps: any ancestor with `overflow:
hidden|auto|scroll` becomes the sticky containing block (the most common "sticky doesn't work" cause);
sticky elements need `z-index` to create a stacking context, and the corner cell must paint above both
axes; sticky cells must be opaque.

**The part everyone omits is the part that is normative.** Set `scroll-padding-block-start` and
`scroll-padding-inline-start` on the scroll container equal to the sticky extents. SC **2.4.11 Focus
Not Obscured (Minimum, AA)** says a focused component must not be entirely hidden by author content,
and the Understanding document names sticky headers as a typical cause resolved by scroll padding [46].
With roving tabindex and arrow navigation, a cell that scrolls under the sticky header on `.focus()`
is a **conformance failure**, not a polish issue.

**Not CSS Grid over `<div>`s**, even though it is easier to reason about: a `<div>` tree with
`role="grid"` is exactly the configuration that produced the documented failures [42]; `<thead>` is the
only route to repeated headers across printed pages [51]; and native table rendering degrades
predictably under forced colors and zoom where a JS-sized grid does not.

### 4.4 Progressive disclosure, and the constraint that makes the detail panel load-bearing

| Tier | Carries | Constraint |
|---|---|---|
| **Cell** | score as text or glyph; confidence as foreground texture; missing reason as a distinct glyph | legible with colour removed entirely |
| **Tooltip** | the one-line justification, confidence in words, reason code in words | **no focusable content, ever** [47] |
| **Side panel** | full justification, evidence links (ADR-0014), author and timestamp, per-rater values and spread (ADR-0011), annotations | `Enter` opens, `Escape` closes, focus returns to the originating cell |

The boundary between tiers 2 and 3 is the APG's: "Tooltip widgets do not receive focus. A hover that
contains focusable elements can be made using a non-modal dialog" [47]. **Evidence links are
focusable. Therefore evidence links may never appear in a tooltip** — which makes the detail panel not
optional but the only accessible home for the capability that distinguishes an agent-produced analysis
from a spreadsheet. This is a real consequence for ADR-0014 that neither ADR anticipates.

The tooltip must satisfy all three legs of SC **1.4.13 Content on Hover or Focus**: dismissible with
`Escape` without moving focus, hoverable (no gap, grace timeout), and persistent — **no auto-dismiss
timer, ever** [48]. Never use the `title` attribute for the justification. Open on **focus** as well as
hover, since the cell is focusable; on touch, skip the tooltip and go straight to the panel. The panel
is a non-modal `<aside role="complementary" aria-labelledby>` — not `role="dialog"` — because the whole
point is that the matrix stays readable beside it.

### 4.5 The channel that survives colour-vision deficiency, forced colors and print

**EVIDENCE, and it is the single most consequential technical fact in this area.** Under
`forced-colors: active` the UA overrides background, border, text, fill, stroke and outline colours
with system colours, `box-shadow` computes to `none`, and —

> `background-image` computes to `none` unless the original value contains a `url()` function [49]

That deletes `repeating-linear-gradient()` hatching, which is the obvious and near-universal way to
implement a texture channel in CSS. **In forced-colors mode a heatmap built from background colours
plus gradient hatching loses both channels simultaneously and renders as a grid of identical
Canvas-coloured boxes.** ADR-0010 requires "a secondary channel (hatching)" and is very likely to be
implemented exactly that way.

| Mechanism | CVD-safe | forced-colors | print (backgrounds off) |
|---|---|---|---|
| `background-color` ramp | ✗ alone | ✗ forced to Canvas | ✗ omitted by default |
| `repeating-linear-gradient` hatch | ✓ | ✗ computes to `none` [49] | ✗ background |
| **foreground `<svg>` with `stroke="currentColor"`** | ✓ | ✓ forced to `CanvasText`, stays visible | ✓ foreground, always printed |
| **text (the numeral, the reason word)** | ✓ | ✓ | ✓ |
| `border` / `outline` | ✓ | ✓ forced but visible | ✓ |

**The answer is: the foreground.** Render confidence hatching, missingness glyphs and any pattern as an
inline `<svg>` **inside the cell** with `stroke="currentColor"`, never as a background.

Three rules follow:

- **Two non-colour channels, not one** (reasoning, reconciling §3.4 with the above): hatch **density**
  carries confidence, ≤3 levels aligned to the VSUP layers; glyph **shape** carries the missingness
  reason, because shape is the only channel with no degradation path and `not-applicable` vs
  `not-assessed` must never depend on hatch density or colour (ADR-0009).
- Add a `@media (forced-colors: active)` block that restores explicit borders on every cell (the ramp
  is gone, so the grid needs structure), swaps the colour legend for the text legend, and sets
  `forced-color-adjust: none` **only** on the small legend swatches that demonstrate the palette.
- Print: set `print-color-adjust: exact` as a *hint* only — MDN is blunt that "there isn't any
  guarantee that `print-color-adjust` will do anything" [50] — and design the print stylesheet to be
  legible without it.

**CVD checking belongs in CI, on a rendered screenshot.** The canonical physiologically-based model is
Machado, Oliveira & Fernandes (2009), which is what Chromium and Firefox use for their built-in
emulation [53][54]. For protan/deutan, Viénot 1999, Brettel 1997 and Machado 2009 are all reliable;
**for tritanopia only Brettel 1997** — the others were not designed for it; and **never** the Coblis
V1/"ColorMatrix" matrices, disowned by their own author [54]. The common failure is not picking the
wrong paper, it is applying the right matrix to gamma-encoded sRGB: decode to linear light, apply,
re-encode [54]. Prefer DaltonLens's published SVG `feColorMatrix` filters applied to a rendered
screenshot [55], because that tests the *composited* blend rather than palette tokens in isolation.
For palette *design* rather than checking, Okabe & Ito's Color Universal Design set is the practical
reference, and its central instruction — redundant coding and direct labels rather than a colour-coded
key — applies directly to our legend [56].

**Thresholds as named constants:** `TEXT_CONTRAST_MIN = 4.5` (SC 1.4.3) and `GRAPHIC_CONTRAST_MIN = 3`
for the texture stroke, cell borders, focus ring and any meaning-bearing glyph, per SC **1.4.11
Non-text Contrast**, whose Understanding document glosses "graphical objects" as covering "the
important parts of a more complex diagram such as each line in a graph" [52]. Our confidence hatch is
exactly such a part.

### 4.6 Acceptance: promote the checklist to a merge gate

[c7](./sections/c7-interaction-a11y.md#v1-accessibility-acceptance-checklist) specifies 20 automated
checks (A1–A20) and 8 manual ones (B1–B8). The automated set is the enforcement mechanism BRIEF.md's
"accessibility is not a later pass" currently lacks. The highest-value ones, because they catch the
failures specific to *this* design rather than generic ones: A3/A4 (no cell is announced as blank; every
missing cell's text matches its reason code), A6–A8 (keyboard reorder round-trip preserves focus; the
`Tab` route gives the identical order; `Escape` restores), A10 (SC 2.4.11 geometry — a focused edge cell
is not under the sticky header), A12 (zero focusable elements inside any tooltip), A13 (composited
contrast per encoding per theme), A15/A16 (forced-colors still shows numeral and glyph; no
`background-image` used as a meaning-bearing channel), A19 (zero network). Most of these are one
Playwright assertion each, since `page.emulateMedia()` covers `colorScheme`, `forcedColors`,
`reducedMotion` and `print` in one API [60] — but confirm which engines honour `forcedColors` at the
version you pin, because the documentation lists the option without stating engine coverage. Note
honestly that axe-core (A1) catches a minority of real defects — it is a floor, not the value.

---

## 5. The stack, under the standalone-bundle constraint

Full notes: [c8 Part B](./sections/c8-prior-art-and-stack.md). All figures were measured on one machine
with one bundler (esbuild 0.27.4, `--bundle --minify --format=esm --platform=browser`, `gzip -9`) on one
day, so the columns are mutually comparable — the property published third-party size tables usually
lack.

### 5.1 Raw bytes are the governing figure

**EVIDENCE + reasoning.** The standalone artifact is a file on disk that gets attached to an email and
opened over `file://`. No transport applies gzip to a saved attachment, and mail encodes attachments in
base64, which *adds* about 33%. So the column that governs whether the file is mailable is the **raw**
one — and the raw gap is the larger of the two.

| Entry | Raw | gzip -9 |
|---|---:|---:|
| React 19.2.6 + `react-dom/client`, trivial component | 193,327 | 60,146 |
| **Preact 10.29.1 + `preact/hooks`, same component** | **12,781** | **5,331** |
| `preact/compat` escape hatch, same component | 18,591 | 7,456 |
| `import { z } from 'zod'` + a comparanda-shaped schema | 310,946 | 61,756 |
| **`import * as z from 'zod/mini'`, same schema** | **15,250** | **5,491** |
| `zod/mini` + `@zodal/core` `defineCollection` | 22,369 | 7,969 |
| `@zodal/groups-core` `defineGroups` | 16,063 | 5,701 |

React + the classic Zod namespace barrel is **504 kB raw before a single line of `comparanda`**;
Preact + `zod/mini` + `@zodal/core` + `@zodal/groups-core` is **51 kB**. At 12.8 kB Preact disappears
into the noise of a realistic analysis payload; at 193 kB React would be the largest single thing in
the file and bigger than the data it exists to show.

The `z` namespace barrel is the single most expensive line of code in the project: importing `z` as a
namespace object keeps the entire classic surface alive (inspection of the output confirms
`toJSONSchema`, the locale table, `emoji`, `ipv6`, `base64url`, `jwt`, `duration` all present) because a
namespace object's properties cannot be dead-code-eliminated. Named imports recover 4.6×; `zod/mini`
recovers **20×**. And `zod/mini` schemas still emit JSON Schema correctly (verified), so **JSON Schema
emission is a Node-only build step** and classic Zod must never appear in a browser entry point. Enforce
with an ESLint `no-restricted-imports` rule, because it is a 296 kB mistake that looks like a style
preference.

Secondary reasons for Preact over the alternatives (reasoning, on those measurements): it is boring and
maintained with no compiler and no bundler plugin, which is what BRIEF.md's "must still build in three
years" asks for; `preact/compat` is a real escape hatch at a measured +2.1 kB gzip; Svelte and Solid
couple the source to a compiler and its plugin, a build-toolchain bet the brief asks us not to make;
Lit's [63] shadow DOM complicates the four things this project cares about most — computed text contrast
against a rendered background, `forced-colors`, print, and one coherent `role="grid"` tree; and vanilla
TS saves at most ~13 kB raw at the cost of hand-rolling the DOM-identity preservation that keeps
keyboard focus and the roving `tabindex` stable while rows are being reordered, which is the fiddliest
requirement in the whole brief.

**`comparanda/react` should not ship in v1.** It doubles the interaction-test matrix for a wrapper that
adds no behaviour, and with Preact chosen it means either shipping `preact/compat` to consumers who
already have React or maintaining a second renderer. The public contract is
`mountMatrix(el, props) => { update, destroy }`; document a ~15-line React wrapper in the README and
revisit when two real consumers ask.

### 5.2 The demonstrated tree-shaking bug in ADR-0010's registry

**EVIDENCE — demonstrated, not predicted.** A fixture package with `"sideEffects": false` and subpath
exports, bundled with esbuild:

| Package config | Core-only consumer | View consumer |
|---|---|---|
| `sideEffects: false`, encoding **self-registers** at module scope | 43 B, marker absent ✅ | **65 B, marker absent — the encoding was silently deleted** ❌ |
| No `sideEffects` field, encoding self-registers | 43 B, marker absent ✅ | 176 B, marker present ✅ |
| `sideEffects: false`, encoding registered **explicitly by the consumer** | 43 B, marker absent ✅ | 180 B, marker present ✅ |

Row 1 is the finding: with the declaration you must make to get good tree-shaking, esbuild removed a
module whose only purpose was its module-scope `register(...)` call **from the bundle that needs it**.
The view shipped, the encoding registry was empty, nothing errored. `"sideEffects": false` is a promise
to the bundler that importing a module for its side effects is never necessary, and a self-registering
encoding module breaks that promise.

ADR-0010 says encodings are "registered against the view rather than hard-coded", and self-registration
is the natural way to write that. **Binding rule: registries are populated by the composition root,
explicitly; no module registers itself at module scope.** This also improves the product — a consumer
who wants two encodings ships two.

**And ADR-0005's condition of acceptance is met:** core-only isolation held in all three rows, including
with no `sideEffects` field at all, because a subpath export is a separate module graph. **Do not split
the package.** Verify continuously with an esbuild `--metafile` input-path assertion (which names the
offending import chain on failure, where a size budget does not), per-fixture byte budgets checked into
the repo, `publint` and `@arethetypeswrong/cli` on the published tarball, and a no-DOM Node test
environment plus an ESLint `no-restricted-globals` rule for `src/core/**`.

### 5.3 The standalone build, and turning ADR-0013 from a convention into a property

Use **Vite with `vite-plugin-singlefile`** rather than a hand-rolled esbuild inliner [64]. Its stated
limitations are all acceptable here (one HTML file only; no `public` folder; SVG must be an inline
`<svg>` element in source, never a `.svg` import — worth an ESLint rule). Quarto reached the same
conclusion for the same artifact shape with `embed-resources: true` [65], which is corroboration that
this is the settled way to build this kind of file. And the deeper pattern to take from
Observable/Quarto is the **build-time/run-time split** [66]: everything expensive, credentialed or
networked happens at build; the artifact that ships is inert.

```
comparanda build <analysis.json> [--out report.html] [--view <saved-view-id>]
  1. validate  against the published JSON Schema        (fail loudly, cite the path)
  2. inline    as <script type="application/json" id="comparanda-analysis">
  3. vite build (viteSingleFile)
  4. inject    a CSP meta tag
  5. assert    zero network — the BUILD fails, not only CI
  6. report    raw bytes, gzip bytes, and the mail-gateway warning
```

**Step 4 is the upgrade.** Injecting `default-src 'none'; connect-src 'none'; img-src data:; font-src
data:; form-action 'none'; base-uri 'none'` makes `fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`
and `sendBeacon` **fail at runtime** rather than merely being absent. That turns ADR-0013's "no
component may reach past its port" from a code-review convention into a property enforced by the
browser. Keep the Playwright detection too — they are not redundant, one enforces and one detects — and
make the Playwright test **exercise the view** (sort, reorder, switch encoding, open the detail panel),
because a `fetch()` inside a cell renderer only fires when that renderer runs, and a load-and-assert
test misses precisely the bug ADR-0013 names. Assert the absence of console errors as well, since a CSP
violation surfaces there. Add a static grep pre-filter so failures name the offending string.

**Step 5 must be part of `build`, not only of CI** — a check that only runs in CI does not protect
someone who builds locally and mails the result.

**A constraint on the mailed file that is not about size at all.** Microsoft Defender for Office 365's
common attachments filter lists `htm` and `html` among the selectable additional file types, and its
true-type matcher recognises HTML **regardless of the filename extension**, so renaming does not evade
it [67]. Note the exact status: they are on the *opt-in* list, not the default blocked set — but the
option exists because HTML attachments are a common phishing vector. **Expect the mailed file to be
rejected or quarantined at some recipients regardless of its size** (reasoning, on that mechanism).
This changes what the CLI prints and what the docs say, not the architecture.

### 5.4 zodal: one factual correction, and one gift

**ADR-0006 is factually wrong.** It says persistence goes through "a **zodal store** interface — a
key-value mapping the caller supplies". **No such interface exists in zodal.** `@zodal/store` exports
`DataProvider<T>`, which is collection CRUD (`getList / getOne / create / update / updateMany / delete /
deleteMany`, plus optional `upsert`, `getCapabilities`, `subscribe`, `getContent`, `setContent`,
`getUrl`). An implementer writing against ADR-0006 as worded would be coding to an API that is not
there. The fit is good for three of four ports (saved views, annotations, rater assertions are all
genuinely collection-shaped) and poor for the fourth (the analysis is one versioned aggregate, not a
queryable set) — model it as a **degenerate one-item provider**, the pattern `zodal-dials` already
established for a settings document.

**And the gift: `getCapabilities()` is precisely the mechanism ADR-0013 asks for and does not name.**
ADR-0013 requires that "standalone shows saved views working locally while annotations are read-only,
and says so, rather than presenting controls that silently do nothing". `ProviderCapabilities` already
carries `canCreate / canUpdate / canDelete / … / realtime / bifurcated` with a documented default
fallback, and the package's own comment calls capability discovery "zodal's novel contribution over
react-admin/Refine". **The view must derive every enable/disable from it, and `comparanda` must never
invent a parallel "is this read-only?" flag** — a second source of truth for editability is exactly how
the failure ADR-0013 warns about happens.

Two more zodal findings, both from reading source: **adopt `@zodal/core`** for `defineCollection` and
its `explain()` trace (verified by execution to work unchanged on `zod/mini` schemas — the enabling fact
for the whole recommendation), remembering `affordanceRegistry.register()` for anything wrapped in
`z.optional(...)`, which is every optional measure. **Adopt `@zodal/groups-core` with the `labels`
profile** for grouping on both axes: many-to-many membership as reified edges, nested group trees,
`scopeFilter`, intensional groups (`unfiled`, `multiHomed` — "which criteria has nobody grouped yet"),
and fractional-index `orderBetween()` so a reorder writes one record rather than renumbering siblings,
with the rank on the **membership edge** because an item in three groups needs three ranks. It matches
ADR-0008's "groups are tags, not a partition" almost line for line, for 16.1 kB raw. Inherit its
documented sharp edge verbatim into our own docs: locale-aware string comparison silently corrupts
fractional-index ordering, so compare by code unit, never `localeCompare`. Two gaps we fill ourselves:
the **global axis order** in view state (a different object from within-group order — use fractional
indices there too) and **group-pair inapplicability**, a relation between two group spaces that
`zodal-groups` does not model. **Do not depend on `@zodal/ui`** — its generators map *schema fields* to
columns, and our columns are criteria, which are runtime data; but copy its `createRendererRegistry`
scored-predicate pattern for the encoding registry, subject to §5.2.

---

## 6. Prior art: what to steal, and the one design instruction that outranks the others

Full notes: [c8 Part A](./sections/c8-prior-art-and-stack.md).

### 6.1 Annotation anchoring — we are not in the situation that forces the machinery

**EVIDENCE.** The Google Drive API models a comment anchor as a JSON string carrying a **revision id and
a region**, and then states the limitation plainly: "Anchors are immutable, and their position relative
to the content of a document cannot be guaranteed between revisions. Consequently, we recommend you use
anchors in documents where the position doesn't change, such as image files or read-only documents"
[68]. The robust-anchoring literature's answer is redundancy — carry multiple descriptors and resolve
strongest-first [78] — which the W3C Web Annotation Data Model standardised as multiple selectors, with
`TextPositionSelector` carrying its own warning that character offsets are "very brittle with regards
to changes to the resource", and the normative rule that consuming agents must pick one when they differ
[69]. Hypothesis implements exactly that, using the position selector purely as a *hint* to bound a
fuzzy search over stored prefix/suffix snippets [70].

**(reasoning, on that evidence)** All of it exists because **text has no identity**. `comparanda` is not
in that situation: an alternative, a criterion, a group and a measure are entities we mint; reordering
is view state and renaming changes an attribute, not a key. Therefore:

> **An annotation anchor is a tuple of stable opaque ids. Never a position, never a label.**

Under that model reorder and rename are *free* — a genuine advantage over every text-anchoring system
above. Three operations still break it and each needs a designed answer:

1. **Split** — record `supersededBy: Id[]` on the retired criterion; resolve the annotation to *all*
   successors, rendered flagged.
2. **Delete / merge** — never hard-delete an entity carrying annotations. Tombstone it and surface its
   annotations in an **orphaned annotations tray**, in a domain where orphaning should be rare enough to
   deserve a human's attention each time.
3. **Re-import** — a fresh `rubricator` run must not mint fresh ids and orphan the entire discussion.
   Ids are minted **once**, from a slug at creation, then frozen; the entity keeps `aliases: string[]`
   so a re-run using a renamed label still resolves. **This is the single place a label participates in
   identity, and it does so exactly once.** It is a cross-repo contract requirement, not an
   implementation detail.

Borrow the redundancy *idea* without the machinery: store a **repair hint**
(`{ labelAtAnchorTime, axisIndexAtAnchorTime }`) that is **never consulted for resolution** and exists
only to generate a human-readable repair suggestion when an id fails.

**The strongest single design instruction in this whole review:** in Google Docs, deleting the anchored
text is the moment you most want to keep the argument, and it is the moment the anchor dies.
`comparanda` must invert this — **deleting a criterion must never delete the argument about whether that
criterion should exist.**

### 6.2 The steal/avoid table

| Prior art | Steal | Avoid |
|---|---|---|
| Airtable / Notion / Coda | Personal / shared / **locked** as three modes of one saved view [71]. Locking is the missing complement to ADR-0007's no-autosave: no-autosave protects against *accidental* mutation, locking against *deliberate* mutation by someone who does not realise the arrangement is load-bearing | Grouping as configuration rather than as an annotatable object — the reasoning behind a grouping then has nowhere to live |
| Google Docs | Threads that **resolve** without deleting; per-suggestion **and bulk** accept (a reviewer who leaves forty cell proposals is unusable without "accept all from this reviewer") | Position-and-revision anchors, disclaimed by the vendor [68] |
| Figma | "Modified" as a **computed, always-visible** state — proof that ADR-0007's dirty-state requirement is learnable — plus **per-property revert** ("revert just the column order, keep my grouping") [72] | **Name-and-hierarchy as identity** [72]. The exact bug §6.1 exists to prevent |
| Miro | **Frames**: a named, ordered walk through the artifact [73]. An ordered *sequence of saved views* is a narrative mode and is close to free once saved views exist — the highest-value cheap feature in this review | Layout carrying meaning the data model cannot express — resist any arrangement affordance that is not a permutation or a grouping |
| Loomio | A stance is inseparable from its short reason; **block** as a first-class stance [74], which is ADR-0015's veto expressed as a rater position and should be reconciled with it in the UI vocabulary | Reasoning that attaches to a decision *event* rather than to the structure |
| Polis | Report **group-informed consensus** — what the disagreeing camps nonetheless agree on — rather than an average [75]. This is the form ADR-0011's `disagreement` encoding should take | Algorithmic grouping the participant cannot contest |
| Observable / Quarto | The **build-time/run-time split** [65][66] | Reproducibility that depends on a hosted runtime |
| Dedicated MCDA tools | **Elicit weights from choices, not numbers** (PAPRIKA) [77]; present consistency checking as *a check on whether the exercise is trustworthy*, not as a statistic | A single ranked number whose axioms are contested — the rank-reversal critique [76] has been unresolved since 1990, which makes ADR-0015's refusal correct rather than squeamish |
| Bertifier | **Crossets** — one control at each header intersection carrying that axis's whole operation set [3] — with the keyboard equivalent as the *primary* implementation | No persistence for the reasoning: craft the matrix, export the image, lose the argument. That is the exact failure `comparanda` exists to prevent and it belongs in the README |

One addition to ADR-0015 falls out of the AHP critique: **if weighted aggregation is offered, the
sensitivity analysis must include an add/remove-an-alternative perturbation**, because that is the
perturbation the literature says breaks these methods [76].

---

## 7. Conflicts between sections, resolved

Where two sections recommend incompatible things, the pick and the reason.

**7.1 The drag-and-drop dependency. [c7] adopt `@atlaskit/pragmatic-drag-and-drop`; [c8] adopt
nothing.** Both agree `dnd-kit` is out, for independent reasons (frozen stable line [35]; React-only).
They disagree on the replacement: c7 wants the 4.7 kB framework-agnostic library for the pointer path;
c8 wants no library at all, on the grounds that raw bytes govern and the hard part (keyboard,
announcements) is ours either way.

**Resolution — take both halves in the order c8 gives and the destination c7 gives.** The keyboard and
menu path is the reference implementation, written first against `core`'s `moveTo(axis, from, to)`, and
it is the conformance path (SC 2.5.7 [38]). The pointer path is a **thin second path over the same
core, deletable without touching the keyboard path**. For that path, adopt
`@atlaskit/pragmatic-drag-and-drop`: c8 itself names auto-scroll and cross-container dragging as the
trigger for adopting it, and our matrix is a scroll container in both axes with sticky headers, so
dragging an alternative from position 40 to position 2 *requires* auto-scroll (reasoning, not evidence
— nobody has measured this on our layout). Charge it against the byte budget explicitly and re-examine
if it exceeds it. c8's underlying point stands regardless and should be written into the ADR: a drag
library buys a pointer abstraction, never an accessible reorder [36][37].

**7.2 The reorder keybinding. [c8] `Alt`+arrows; [c7] never bare `Alt+Arrow`.** **c7 wins outright** —
`Alt+Arrow` is browser Back/Forward on Windows and Linux, which is a concrete conflict, and c8's mention
is an aside in a section about bundle size rather than a researched choice. Use c7's two-route
specification (§4.1).

**7.3 `lineupjs`. [c6] evaluate it against the bundle budget; [c8] raw bytes govern and the whole
dependency floor is 51 kB.** **Decline it as a dependency** (§2.4). Read the paper as prior art [15];
build `RankFlow` ourselves. This resolves one of c6's own open questions rather than leaving it.

**7.4 The value ramp. ADR-0010 says "sequential means one hue, light to dark"; the VSUP paper requires
a ramp that avoids lightness extremes** because the suppression channel *is* lightness, and a ramp that
already spends its lightness range collides with it [23]. **Resolution: declare the ramp per encoding.**
ADR-0010's rule is right for the `value` encoding and wrong for `uncertainty-suppressed`. Settle
empirically by building both and running `assertPaletteLegible` over each — if one ramp passes for both,
share it; if not, declare two.

**7.5 "Follow the literature rather than improvising" vs suppressing toward the theme surface.**
ADR-0010 instructs the implementation to follow the published technique; the reference implementation
hardcodes `#fff`, which on a dark surface makes the least-trustworthy cells the brightest on the page.
**Resolution: a deliberate, documented deviation**, recorded in the ADR rather than discovered in a diff.
The same applies to the ordinal merge tree, which is *within* the paper's stated design space [23] but
is not the thing that was tested.

**7.6 Hatching's job. [c6] ≤3 hatch densities aligned to the VSUP layers; [c7] `not-applicable` vs
`not-assessed` must be carried by glyph shape, not hatch density.** Not a contradiction but an easy
collision in implementation. **Resolution: two distinct non-colour channels** — density for confidence,
shape for missingness reason — and neither is ever overloaded with the other's job (§4.5).

**7.7 ADR numbering. [c4] claims 0017/0018/0019; [c7] claims 0017/0018/0019; [c8] claims 0017.** The
sections were written in parallel and collide. **Resolution: this document allocates 0020–0025 and
leaves 0017–0019 to the terminology findings, which claimed them first (c1–c4).** A human must allocate
numbers once, in one pass, across both findings documents before any ADR is written. Nothing in the
content depends on the numbers.

**7.8 What ADR-0008 is, once settled.** ADR-0008 currently frames manual reorder and automatic
seriation as two features that must not fight, and evaluates `dnd-kit` first. Both halves change: they
are **one feature** with constraints as algorithm inputs [3], and the library recommendation is
withdrawn. Settling ADR-0008 therefore touches its Decision section substantively enough that a human
should consider whether it is an amendment or a supersession; the content is the same either way.

---

## 8. Recommended ADR actions

Consolidated. **Do not edit an accepted ADR in place** (ADR-0001) — a human settles these.

| ADR | Action | Reason |
|---|---|---|
| ADR-0002 | **confirm** | The "tens to low hundreds of alternatives" cap is what licenses no virtualisation in v1 and makes the O(n³) optimal seriation affordable. It earned its keep twice. |
| ADR-0003 | **confirm** | The ordinal/interval distinction is what forced Gower over Euclidean (§1.3) and what disqualifies area-based views (§2.1). Working exactly as intended. |
| ADR-0004 | **confirm, with a note** | Schema-first on zodal is confirmed by reading the source. Add: **JSON Schema emission is a build-time, Node-only concern**, since the classic Zod import that provides `toJSONSchema` costs 61.8 kB gzip / 310.9 kB raw in a browser bundle. |
| ADR-0005 | **confirm, with a note** | Its condition of acceptance is verified met — subpath exports isolate core-only consumers in every tested configuration. Record the standing CI verification (esbuild `--metafile` input-path assertion + byte budgets + `publint`/`attw` + a no-DOM core test environment). Nothing in the a11y work required a DOM API in `core`, which is independent confirmation of the boundary. |
| ADR-0006 | **amend** | Factually wrong: there is no key-value "zodal store". `@zodal/store` provides `DataProvider<T>` (collection CRUD). Restate the port in those terms; model the analysis as a degenerate one-item provider; add that **`getCapabilities()` is the single source of truth for what the UI offers**. |
| ADR-0007 | **amend** | (a) Order becomes `AxisOrder = { order, provenance, constraints }`; dirty-state compares `order` and `constraints` and **ignores `provenance`**, or re-running seriation to the identical order marks the view modified. (b) Add **locked** as a third view mode alongside personal and shared. (c) Add **per-dimension revert**. (d) Add an ordered **sequence of saved views** as a narrative mode. |
| ADR-0008 | **amend** (consider supersede — see §7.8) | Settle it: name **OLO over a missingness-aware Gower distance, per axis independently**, with plain sort as its degenerate case; require pins and locked runs to be **inputs** to the algorithm; add "arrange by similarity to this alternative" and `suggestGroups` (which proposes, never writes); withdraw the `dnd-kit` recommendation; upgrade "keyboard-accessible equivalent" to **keyboard-and-menu primary path**, citing SC 2.5.7 as normative; adopt `@zodal/groups-core` (`labels` profile) with the two named gaps. |
| ADR-0009 | **confirm** | Strongly vindicated from three directions: reason codes are an *input* to the seriation distance (a bare null would have been uncomputable); they are what disqualifies radar outright; and they drive a glyph with no colour fallback. Add the view-side requirement (a glyph shape per reason code, no colour dependence) to the new ADR-0024 rather than editing this one. |
| ADR-0010 | **amend** | (a) Name the VSUP tree parameters and the **ordinal merge tree**; (b) suppression targets the **theme surface**, not white, as a documented deviation from the reference implementation; (c) the legend must state the aliasing **in words**; (d) the value ramp reserves lightness headroom — a stated per-encoding exception to "sequential means one hue, light to dark"; (e) **WCAG gate + APCA tie-break**, and the palette contrast check is a **build-time test**, not a render-time computation; (f) `texture` becomes a **required** field of an encoding registration and registration fails without it; (g) encodings are plain named exports **registered explicitly by the composition root** — a correctness requirement under `"sideEffects": false`, demonstrated, not a style preference. |
| ADR-0011 | **amend** | (a) Fix the visual form of the `disagreement` encoding: **per-rater dots on the shared axis** at matrix scale, diverging stacked bar in the **detail panel only**; stacked bars never in matrix cells. (b) Anchors are tuples of **stable opaque ids** only; entities carrying annotations are tombstoned, never hard-deleted; `supersededBy` handles splits; `repairHint` is stored but never used for resolution; orphaned annotations get a visible tray. (c) Add bulk accept/reject to suggestion mode. (d) Frame disagreement reporting as group-informed consensus, not spread. |
| ADR-0013 | **amend** | Upgrade zero-network from a CI test to a **CSP-enforced property** baked into the artifact, plus the browser test *and* a static grep; require the check to run in `comparanda build`, not only in CI; name `getCapabilities()` as the graceful-degradation mechanism; record the **mail-gateway constraint on `.html` attachments** as a documented limitation. |
| ADR-0014 | **confirm, with two notes** | (1) Evidence links are focusable and **a tooltip may never contain focusable content**, so the detail panel is load-bearing rather than optional — the disclosure tier boundary is an architectural constraint. (2) Model embedded excerpts as zodal **content fields**, so the standalone-embedded / resolver-fetched split falls out of existing bifurcation machinery. |
| ADR-0015 | **confirm, with additions** | Dominance, veto, seriation and sensitivity all hold up, and the AHP rank-reversal critique makes the no-default-aggregation stance correct rather than squeamish. Add: name the views that realise the analyses (`ParetoScatter`, `RankFlow`); require a 2-D frontier to be **labelled as partial**; include an **add/remove-an-alternative** perturbation in sensitivity analysis. *(The terminology brief additionally proposes amendments to the dominance definition itself — see §2.2.)* |
| **ADR-0020** (new) | **new** | *The view framework and the standalone bundle.* |
| **ADR-0021** (new) | **new** | *Seriation: algorithm, distance, and missingness policy.* |
| **ADR-0022** (new) | **new** | *Views shipped in v1, and the ones deliberately declined.* |
| **ADR-0023** (new) | **new** | *Matrix accessibility semantics.* |
| **ADR-0024** (new) | **new** | *Non-colour channels: texture, forced colors, print.* |
| **ADR-0025** (new) | **new** | *Accessibility acceptance criteria.* |

### Draft bodies for the new ADRs

**ADR-0020 — The view framework and the standalone bundle.** The view is built on **Preact**, and the
runtime schema is authored in **`zod/mini`**. The artifact is mailed and opened over `file://`, where no
transport compression applies and mail encoding adds ~33%, so **raw bytes are the governing figure**;
measured on one machine with esbuild 0.27.4 on one day, React 19 + `react-dom/client` is 193,327 raw
bytes for a trivial component against Preact's 12,781, and the classic Zod `z` namespace barrel is
310,946 raw against `zod/mini`'s 15,250. `preact/compat` remains an escape hatch at +5,810 raw. **JSON
Schema emission is a Node-only build step** — classic Zod must never appear in a browser entry point,
enforced by an ESLint `no-restricted-imports` rule. `comparanda/react` is not published in v1; the
public contract is `mountMatrix(el, props) => { update, destroy }`. **Registries are populated
explicitly by the composition root** and no module registers itself at module scope, because with
`"sideEffects": false` declared esbuild was demonstrated to delete a self-registering module from the
bundle that needs it, shipping an empty registry with no error. The standalone build is Vite +
`vite-plugin-singlefile`, with the analysis inlined as `<script type="application/json">` and a CSP meta
tag (`default-src 'none'; connect-src 'none'`) that makes ADR-0013's no-network property enforced by the
browser; the zero-network check fails the **build**, not only CI. ADR-0005's condition of acceptance is
verified met, so the package is not split.

**ADR-0021 — Seriation: algorithm, distance, and missingness policy.** One automatic ordering ships:
**optimal leaf ordering over agglomerative hierarchical clustering of a missingness-aware Gower
distance, applied to each axis independently**, with plain single-criterion sort implemented as the same
code path. Linkage is chosen by running `single`, `average` and `complete` and keeping the lowest
Hamiltonian path length below a configurable size limit. Ordinal levels are scored by their **declared**
level index normalised to [0,1] — never by sample rank, because rank makes a pair's distance depend on
which third alternative is present — and the resulting equal-spacing assumption is stated in the UI
alongside the order and is **not** a licence to average scores anywhere. Missing cells enter Gower's δ:
structural absence (`not-applicable`) counts as agreement when both agree and as maximal difference when
one has a value; contingent absence is skipped. A `minOverlap` guard excludes and visibly parks any
alternative with too few comparable criteria. **The eigen-based families — spectral, metric MDS, PCA —
are rejected outright**, not on speed but because Gower proved missing values can cost the similarity
matrix its positive semi-definiteness, and ADR-0009 guarantees missing cells. Pins and locked runs are
**inputs** to the algorithm (distance inflation; collapse-and-re-expand), never post-hoc overrides. The
order recorded in view state carries its provenance and its constraints.

**ADR-0022 — Views shipped in v1, and the ones deliberately declined.** A secondary view earns its place
only by repairing a specific weakness of the matrix, whose colour channel is the least accurately
decoded. **Ship:** the matrix with seriation; small-multiple dot plots with discrete labelled level
ticks and an explicit missing lane per panel (which doubles as the multi-rater view); a two-criterion
scatter with a dominance overlay, labelled as partial and carrying full-criteria dominance as a second
mark channel; rank-flow/slope, gated behind the ADR-0015 weighted-aggregation opt-in and captioned as a
*stability* finding, never as a winner; and a diverging stacked bar in the **detail panel only**.
**Decline parallel coordinates** for v1: ordinal scores collapse every polyline onto five heights per
axis, and PCP axis ordering optimises the opposite objective from matrix seriation, so shipping it means
maintaining two conflicting orderings of the same criteria. **Decline radar outright, not with a
caveat**: its enclosed area is quadratic in the values, the same six-criterion profile spans 1.58× in
area across axis permutations with no change to the data, and it cannot render a qualified `missing`
without reading "nobody has looked yet" as "worst possible", which ADR-0009 forbids. When radar is
requested, answer the underlying question with the dot-plot small multiple. This record exists so the
decline is not re-litigated every six months.

**ADR-0023 — Matrix accessibility semantics.** The matrix is a real `<table>` carrying
`role="grid"`, not a `<div>` tree and not a plain table: the grid role turns 264 tab stops into one, and
the published compatibility evidence shows `role="grid"` on a `<table>` is announced correctly across
NVDA, JAWS and VoiceOver while `role="grid"` on `<div>`s is where the documented failures live.
Navigation uses **roving `tabindex`**, never `aria-activedescendant`, with the roving position persisted
in view state. **No virtualisation in v1**, with a documented trigger at roughly 500 rows and the rule
that DOM order must equal visual order without exception if it is ever added. `treegrid` is rejected
because groups are many-to-many tags, not a partition. A cell's measures are announced through
**visually-hidden text inside the cell**, not `aria-label` and not a dynamically-changing description;
a missing cell announces its reason in words and is never silent. Sticky headers use `position: sticky`
on the `<th>`s with separated borders and `box-shadow` separators, and the scroll container carries
`scroll-padding-*` equal to the sticky extents, because a focused cell scrolling under the header is a
WCAG 2.4.11 failure. Disclosure has three tiers — cell, tooltip, side panel — with a hard boundary: **a
tooltip may never contain focusable content**, so evidence links live in the panel, and the panel is
therefore load-bearing rather than optional. The panel is a non-modal `<aside role="complementary">`.
Reordering has two routes on one handle — an explicit move menu (normative under SC 2.5.7, and available
to pointer users) and a grab mode binding `Space`/`Enter`, arrows, **`Tab`**, `Home`/`End` and `Escape`
— never bare `Alt+Arrow`, and every announcement comes from one `describeMove()` in `core`.

**ADR-0024 — Non-colour channels: texture, forced colors, print.** Every meaning-bearing non-colour
channel is drawn in the **foreground**, as inline SVG with `stroke="currentColor"`, never as a
`background-image`: under `forced-colors: active` a `background-image` computes to `none` unless it
contains a `url()`, so gradient hatching and the colour ramp disappear together and the matrix renders
as identical Canvas-coloured boxes. Two distinct channels are maintained and never overloaded: hatch
**density** (at most three levels, aligned to the encoding's uncertainty layers) carries confidence, and
glyph **shape** carries the missingness reason code, because shape has no degradation path. Every
registered encoding must declare its `texture`; registration fails without it. A
`@media (forced-colors: active)` block restores explicit cell borders, swaps the colour legend for a
text legend, and uses system colour keywords. `print-color-adjust: exact` is a hint only, and the print
stylesheet must be legible without it. Colour-vision-deficiency simulation runs in CI against a rendered
screenshot — Machado 2009 or Viénot 1999 for protan/deutan, **Brettel 1997 for tritan**, never the
Coblis V1 matrices, always sRGB-decoded before the matrix is applied. Contrast thresholds are named
constants: 4.5:1 for cell text, 3:1 for the texture stroke, borders, focus ring and any meaning-bearing
glyph.

**ADR-0025 — Accessibility acceptance criteria.** The twenty automated checks and eight manual checks
specified in the interaction research become a **merge gate**: the automated set must be green to merge,
and the manual pass is run once per release and recorded in the release notes. BRIEF.md's "accessibility
is not a later pass" is otherwise an aspiration with no enforcement mechanism. The gate deliberately
does not rest on axe-core, which catches a minority of real defects and is a floor rather than the
value; the checks that carry it are the ones specific to this design — no cell announced as blank, every
missing cell's text matching its reason code, keyboard reorder round-trips preserving focus, the `Tab`
route producing the identical order, `Escape` restoring, focused edge cells not obscured by sticky
chrome, zero focusable elements inside any tooltip, composited contrast per encoding per theme,
forced-colors still showing numeral and glyph, no `background-image` used as a meaning-bearing channel,
and zero network requests from the standalone bundle.

---

## 9. Open questions

What the research did not settle, and what would settle it.

**Cheap to settle, and worth settling before Phase 3.**

1. **How many hatch densities are distinguishable in a 24–40 px cell that also carries text?** No
   controlled study found. *Settled by:* a 20-minute internal test with the real palette at real size,
   including a CVD simulation pass. Cheaper than more searching.
2. **Does the composited `uncertainty-suppressed` palette stay CVD-separable at the confidence
   extremes?** The value ramp and the suppression pull interact, and a value-suppressing palette
   compresses toward the surface exactly where discrimination is hardest. *Settled by:* running the CVD
   check against the actual palette **before it is frozen**. If steps collapse, the fix is fewer value
   steps, not a different hue.
3. **Can `value` and `uncertainty-suppressed` share a ramp?** They pull in opposite directions (§7.4).
   *Settled by:* building both and running `assertPaletteLegible` over each.
4. **Do bare arrow keys reach a grab-mode handler in NVDA and JAWS browse mode when focus is on a
   `<button>` inside a `role="grid"`?** Not settleable from published sources. *Settled by:* one hour
   with NVDA + Firefox and JAWS + Chrome. Until then the dual `Tab` binding makes the answer not matter,
   which is why it is in the spec.
5. **Does `<thead>` repeat across printed pages in current Chrome and Safari?** The normative hook
   exists; the available write-ups are old enough to be unreliable. *Settled by:* printing to PDF with
   background graphics off, recorded per browser.
6. **Is a non-modal side panel right at 320 px?** At small viewports it must become modal or a
   full-screen sheet, which changes the focus-trap answer. *Settled by:* the 400% zoom / 320 px manual
   check, with the outcome recorded in ADR-0023.

**Requires a decision or a prototype.**

7. **Which measure drives the arrangement by default?** The primary score is the obvious answer, but
   arranging by `confidence` answers "where is the evidence thin?", and arranging by the *active
   encoding* is closest to Bertin's visual reordering, since he reordered what he could see. The cost is
   that the order then depends on the view, which complicates the provenance record. *Settled by:* a
   prototype, not by argument.
8. **Does `structural-matches` help or hurt in practice?** The claim that both-`not-applicable` counts
   as agreement is reasoning, not evidence; it should make inapplicable blocks visible as blocks, but it
   could dominate the distance where `not-applicable` is common. *Settled by:* running both policies on
   the messy ADR-0016 example and looking.
9. **Does the ordinal merge tree preserve VSUP's measured decision effect?** The published result is for
   uniform binning of continuous data; our tree is within the paper's stated design space but is not the
   thing that was tested. *Settled by:* a small A/B on a real analysis measuring whether readers set
   aside high-score-low-confidence alternatives — **not** whether they read colours accurately, since
   the paper found no accuracy difference to begin with.
10. **How large is a real analysis payload, inlined?** This determines whether the mailed-file size story
    is dominated by code or by data, and therefore how much the framework choice matters at the margin.
    *Settled by:* building the messy example once Phase 1 exists, and setting a byte budget at Phase 3
    (suggested: 200 kB raw for the bundle excluding the payload) so the number is discovered under
    pressure rather than late.
11. **How do multi-rater cells enter the seriation distance?** Reduce first (median) and treat as one
    ordinal value, or treat disagreement as an extra dimension. Not urgent (Phase 4), but the
    `measure` parameter must not foreclose it.

**Blocked on the terminology brief, and blocking work here.**

12. **Criteria have no direction of preference.** Carried from [c1](./sections/c1-terminology.md).
    Dominance is undefined without it, so the `ParetoScatter` view and ADR-0015's flagship analysis both
    wait on a schema decision. *Settled by:* that findings document and a Phase 1 schema field.
13. **Dominance over an incomplete matrix must be necessary/possible, not a single frontier.** Carried
    from [c2](./sections/c2-measurement-and-aggregation.md) / [c3](./sections/c3-missingness.md); the
    naive rule is non-transitive and can empty the front [79]. The *view* consequence is settled here
    (render two tiers), the *analysis* definition is not settled here.

**Acknowledged gaps in the evidence, recorded so nobody re-derives them.**

14. **Bertin's own volumes were not read directly** — every Bertin claim reaches us through [3], and one
    widely-quoted epigraph could not be sourced at all and is marked UNVERIFIED in
    [c5](./sections/c5-seriation.md). Nothing in the recommendation rests on it.
15. **Liiv's seriation survey is paywalled** and is cited only for claims quoted verbatim inside sources
    that were read in full.
16. **No head-to-head radar-vs-dot-plot study exists.** Not worth running: the ADR-0009 argument settles
    the decision without it, and recording that reasoning is better than pretending a study exists.
17. **Three vendor pages ([73] and two others in [c8](./sections/c8-prior-art-and-stack.md)) refused
    automated fetching** and were not content-verified. The claims resting on them are stated as
    mechanisms only and should be re-checked by a human before being relied on.
18. **Svelte and Solid were not measured** and no primary comparable figure was located; both plausibly
    land near Preact, and the compiler-coupling argument is expected to decide it regardless — but that
    expectation is not evidence.

---

## REFERENCES

1. [Sémiologie graphique — Jacques Bertin (1967); English: *Semiology of Graphics*, University of Wisconsin Press (1983)](https://historyofinformation.com/detail.php?id=3361) — *not read directly; cited via [3]*
2. [La graphique et le traitement graphique de l'information — Jacques Bertin (1977); English: *Graphics and Graphic Information Processing*, de Gruyter (1981)](https://doi.org/10.1515/9783110854688) — *not read directly; cited via [3]*
3. [Revisiting Bertin Matrices: New Interactions for Crafting Tabular Visualizations — Perin, Dragicevic & Fekete, IEEE TVCG 20(12) (2014)](https://aviz.fr/wiki/uploads/Bertifier/bertifier-authorversion.pdf)
4. [Matrix Reordering Methods for Table and Network Visualization — Behrisch, Bach, Henry Riche, Schreck & Fekete, Computer Graphics Forum 35(3), EuroVis STAR (2016)](https://hal.science/hal-01326759/document)
5. [Getting Things in Order: An Introduction to the R Package seriation — Hahsler, Hornik & Buchta, Journal of Statistical Software 25(3) (2008)](https://cran.r-project.org/web/packages/seriation/vignettes/seriation.pdf)
6. [An experimental comparison of seriation methods for one-mode two-way data — Hahsler, European Journal of Operational Research 257(1) (2017)](https://michael.hahsler.net/research/paper/EJOR_seriation_2016.pdf)
7. [seriation: Infrastructure for Ordering Objects Using Seriation — R package source and reference manual, Hahsler et al.](https://github.com/mhahsler/seriation)
8. [A General Coefficient of Similarity and Some of Its Properties — J. C. Gower, Biometrics 27(4) (1971)](https://mathematics.foi.hr/Rprojekti/BDP%20concept/Gover_metric.pdf)
9. [Fast optimal leaf ordering for hierarchical clustering — Bar-Joseph, Gifford & Jaakkola, Bioinformatics 17(suppl_1) (2001)](https://people.csail.mit.edu/tommi/papers/BarGifJaa-ismb01.pdf)
10. [K-ary Clustering with Optimal Leaf Ordering for Gene Expression Data — Bar-Joseph, Demaine, Gifford, Srebro, Hamel & Jaakkola, Bioinformatics 19(9) (2003)](https://home.ttic.edu/~nati/Publications/BarJosephEtalWABI03.pdf)
11. [daisy: Dissimilarity Matrix Calculation — R `cluster` package documentation](https://stat.ethz.ch/R-manual/R-devel/library/cluster/html/daisy.html)
12. [reorder.js — a JavaScript library to reorder matrices, Fekete et al. (BSD-2)](https://github.com/jdfekete/reorder.js)
13. [The bond energy algorithm revisited — Arabie & Hubert, IEEE Transactions on Systems, Man and Cybernetics 20(1) (1990)](https://ieeexplore.ieee.org/abstract/document/47829/) — *cited via [5]; not read directly*
14. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — Cleveland & McGill (1984)](https://www.jstor.org/stable/2288400)
15. [LineUp: Visual Analysis of Multi-Attribute Rankings — Gratzl, Lex, Gehlenborg, Pfister & Streit, IEEE InfoVis (2013)](https://data.jku-vds-lab.at/papers/2013_infovis_lineup.pdf)
16. [Off the Radar: Comparative Evaluation of Radial Visualization Solutions for Composite Indicators — Albo, Lanir, Bak & Rafaeli, IEEE TVCG 22(1) (2016)](https://pubmed.ncbi.nlm.nih.gov/26529525/)
17. [Multidimensional mechanics: Performance mapping of natural biological systems using permutated radar charts — Porter & Niksiar, PLOS ONE (2018)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0204309)
18. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — Heiberger & Robbins, Journal of Statistical Software 57(5) (2014)](https://www.jstatsoft.org/article/view/v057i05)
19. [The efficacy of stacked bar charts in supporting single-attribute and overall-attribute comparisons — Indratmo, Howorko, Boedianto & Daniel, Visual Informatics (2018)](https://www.sciencedirect.com/science/article/pii/S2468502X18300287)
20. [Evaluating Reordering Strategies for Cluster Identification in Parallel Coordinates — Blumenschein et al., Computer Graphics Forum (2020)](https://onlinelibrary.wiley.com/doi/10.1111/cgf.14000)
21. [Colorslope: a balanced visualization of overview and details on ranks over time — Wang et al., Visual Intelligence (2023)](https://link.springer.com/article/10.1007/s44267-023-00008-9)
22. [Uncertainty Displays Using Quantile Dotplots or CDFs Improve Transit Decision-Making — Fernandes, Walls, Munson, Hullman & Kay, CHI 2018](https://dl.acm.org/doi/10.1145/3173574.3173718)
23. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer, CHI 2018](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
24. [vsup — reference implementation, MIT licence (UW Interactive Data Lab)](https://github.com/uwdata/vsup)
25. [Visual Semiotics & Uncertainty Visualization: An Empirical Study — MacEachren, Roth, O'Brien, Li, Swingley & Gahegan, IEEE TVCG 18(12) (2012)](https://dl.acm.org/doi/abs/10.1109/TVCG.2012.279)
26. [In Pursuit of Error: A Survey of Uncertainty Visualization Evaluation — Hullman, Qiao, Correll, Kale & Kay, IEEE TVCG (2019)](https://users.eecs.northwestern.edu/~jhullman/uncertainty_vis_eval.pdf)
27. [The Noisy Work of Uncertainty Visualisation Research: A Review — Mason, Cook, Goodwin, Tanaka & VanderPlas (2024)](https://arxiv.org/abs/2411.10482)
28. [Researchers Misunderstand Confidence Intervals and Standard Error Bars — Belia, Fidler, Williams & Cumming, Psychological Methods (2005)](http://www.edmeasurement.net/5245/Belia-2005-CIs-SEs.pdf)
29. [How Visualizing Inferential Uncertainty Can Mislead Readers About Treatment Effects in Scientific Results — Hofman, Goldstein & Hullman, CHI 2020](http://www.jakehofman.com/pdfs/visualizing-inferential-uncertainty.pdf)
30. [Web Content Accessibility Guidelines (WCAG) 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/)
31. [apca-w3 — W3-licensed APCA reference implementation, Beta 0.1.9 — Somers (2022)](https://github.com/Myndex/apca-w3)
32. [WCAG3 Contrast as of April 2026 — Adrian Roselli (2026)](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)
33. [It's time for a more sophisticated color contrast check for data visualizations — Lisa Charlotte Muth, Datawrapper (2022)](https://www.datawrapper.de/blog/color-contrast-check-data-vis-wcag-apca)
34. [Fact Sheet: New Rule on the Accessibility of Web Content and Mobile Apps Provided by State and Local Governments (ADA Title II) — US Department of Justice](https://www.ada.gov/resources/2024-03-08-web-rule/)
35. [npm registry metadata for `@dnd-kit/*`, `@atlaskit/pragmatic-drag-and-drop`, `sortablejs`, `@react-aria/dnd` (retrieved 2026-08-18)](https://registry.npmjs.org/)
36. [Pragmatic drag and drop — README — Atlassian](https://github.com/atlassian/pragmatic-drag-and-drop)
37. [Pragmatic drag and drop — Accessibility guidelines — Atlassian Design System](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)
38. [Understanding SC 2.5.7: Dragging Movements (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
39. [Aria-activedescendant is not focus — Sarah Higley (2024)](https://sarahmhigley.com/writing/activedescendant/)
40. [Grids Part 2: Semantics — Sarah Higley (2021)](https://sarahmhigley.com/writing/grids-part2/)
41. [Grids Part 1: To grid or not to grid — Sarah Higley (2020)](https://sarahmhigley.com/writing/grids-part1/)
42. [ARIA Grid As an Anti-Pattern — Adrian Roselli (2020, updated 2022)](https://adrianroselli.com/2020/07/aria-grid-as-an-anti-pattern.html)
43. [ARIA Authoring Practices Guide — Grid Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
44. [Data table with `role=grid` — Screen reader compatibility tests — PowerMapper Software](https://www.powermapper.com/tests/screen-readers/tables/table-role-grid/)
45. [\[css-tables\] Collapsed table borders don't follow sticky rows/cells when they stick — csswg-drafts issue #3136 (open since 2018)](https://github.com/w3c/csswg-drafts/issues/3136)
46. [Understanding SC 2.4.11: Focus Not Obscured (Minimum) (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
47. [ARIA Authoring Practices Guide — Tooltip Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
48. [Understanding SC 1.4.13: Content on Hover or Focus (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
49. [CSS Color Adjustment Module Level 1 — Forced Colors Mode — W3C](https://www.w3.org/TR/css-color-adjust-1/)
50. [print-color-adjust — MDN Web Docs, Mozilla](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)
51. [CSS Table Module Level 3 — §6.2 Repeating headers across pages — W3C](https://www.w3.org/TR/css-tables-3/)
52. [Understanding SC 1.4.11: Non-text Contrast (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
53. [A Physiologically-based Model for Simulation of Color Vision Deficiency — Machado, Oliveira & Fernandes, IEEE TVCG 15(6) (2009)](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)
54. [Review of Open Source Color Blindness Simulations — DaltonLens (2021)](https://daltonlens.org/opensource-cvd-simulation/)
55. [Accurate SVG filters for color blindness simulation — DaltonLens](https://daltonlens.org/cvd-simulation-svg-filters/)
56. [Color Universal Design — How to make figures and presentations friendly to colorblind people — Okabe & Ito](https://jfly.uni-koeln.de/color/)
57. [Taming the dragon: Accessible drag and drop — Devon Govett, React Aria / Adobe (2022)](https://react-aria.adobe.com/blog/drag-and-drop)
58. [\[Question\] Active Maintenance Status and Suitability for Production Use? — dnd-kit issue #1830 (2025)](https://github.com/clauderic/dnd-kit/issues/1830)
59. [Sortable Table Columns — Adrian Roselli (2021)](https://adrianroselli.com/2021/04/sortable-table-columns.html)
60. [`page.emulateMedia()` — Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media)
61. [ARIA: aria-grabbed attribute (deprecated in ARIA 1.1) — MDN Web Docs, Mozilla](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-grabbed)
62. [Preact — Fast 3kB alternative to React](https://preactjs.com/)
63. [Lit — simple, fast web components](https://lit.dev/)
64. [vite-plugin-singlefile — Richard Tallent](https://github.com/richardtallent/vite-plugin-singlefile)
65. [HTML Basics — Quarto documentation](https://quarto.org/docs/output-formats/html-basics.html)
66. [Data loaders — Observable Framework documentation](https://observablehq.com/framework/data-loaders)
67. [Anti-malware protection for email in Microsoft 365 — common attachments filter, Microsoft Learn](https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-about)
68. [Manage comments and replies — Google Drive API, Google Workspace](https://developers.google.com/workspace/drive/api/guides/manage-comments)
69. [Web Annotation Data Model — Sanderson, Ciccarese & Young, W3C Recommendation (2017)](https://www.w3.org/TR/annotation-model/)
70. [Fuzzy Anchoring — Hypothesis (2013)](https://web.hypothes.is/blog/fuzzy-anchoring/)
71. [Getting started with Airtable views — Airtable Support](https://support.airtable.com/docs/getting-started-with-airtable-views)
72. [Apply overrides to instances — Figma Help Center](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)
73. [Presentation mode — Miro Help Center](https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode) — *resolves but refused automated fetching (HTTP 403); not content-verified*
74. [Proposals — Loomio User Manual](https://www.loomio.com/docs/en/user_manual/polls/proposals)
75. [Group informed consensus — The Computational Democracy Project / Polis](https://compdemocracy.org/Group-Informed-Consensus/)
76. [Remarks on the Analytic Hierarchy Process — J. S. Dyer, Management Science 36(3) (1990)](https://doi.org/10.1287/mnsc.36.3.249) — *cited for the standing of the rank-reversal critique; full text not obtained*
77. [What is the PAPRIKA method? — 1000minds; after Hansen & Ombler, Journal of Multi-Criteria Decision Analysis 15 (2008)](https://www.1000minds.com/paprika)
78. [Robust intra-document locations — Phelps & Wilensky, WWW9 / Computer Networks 33 (2000)](https://www.semanticscholar.org/paper/bf3a9da17f9dbeb2d2d09f4d562c903e4e9b2f2e) — *record verified; full text not obtained*
79. [Skyline Query Processing for Incomplete Data — Khalefa, Mokbel & Levandoski, ICDE 2008](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf) — *carried from the terminology-brief sections c2/c3, which read it directly; not re-verified for this document*
