# Bertin's reorderable matrix and seriation algorithms

**Research question(s):** What did Bertin actually claim about the reorderable matrix, and what does
that imply for our interaction design? What are the seriation algorithm families, with their
assumptions and failure modes? What does the R `seriation` package implement, and what is a sensible
default for a small ordinal matrix with missing cells? What distance is appropriate for ordinal rows
with missing cells? How do you present an automatic ordering so it invites manual adjustment? Which
algorithm(s) ship in v1?

**Brief section:** `docs/research/visualisation.md` §1 — "The reorderable matrix, properly".

**Evidence grade:** **strong** — every algorithmic and historical claim below is anchored in a
primary source read in full (Gower 1971, Bar-Joseph 2001/2003, Hahsler 2008/2017, Perin 2014,
Behrisch 2016) or in package source read directly. Two weak links. Liiv's survey is paywalled; I
cite it only for claims quoted verbatim inside sources I did read, and say so. Bertin's own volumes
[1][2] were likewise **not** read directly — every Bertin claim here reaches us through Perin et
al. [5], except the "once and for all" epigraph below, which I could not source at all and have
marked UNVERIFIED. The
recommendation itself combines that evidence with reasoning about our specific data shape, and the
reasoning steps are marked.

---

## Bottom line

Ship **one** seriation algorithm in v1: **optimal leaf ordering (OLO) over hierarchical clustering of
a missingness-aware Gower distance, applied to each axis independently**, with plain single-criterion
sort implemented as its degenerate case. This is not the fast choice and that is the point — our
matrices are tens × tens, OLO is O(n³) [10] (the 2001 algorithm [9] was O(n⁴); [10] is the improved
form), and at n = 100 that is roughly 10⁶ operations, which is
milliseconds in JavaScript. Do **not** reach for spectral seriation, which is what the R `seriation`
package defaults to for a distance matrix [11]: spectral methods rest on an eigendecomposition, Gower
himself proved that missing values can destroy the positive semi-definiteness that decomposition
assumes [3], and the reordering survey names missing values explicitly as something eigenvector
methods are "very sensitive to" [6]. We have missing cells by design (ADR-0009), so we should choose
the family that never needs a well-behaved embedding. OLO also composes with human constraints more
readily than the other families considered here (reasoning) — the dendrogram restricts the
permutation space, which is exactly the hook
that lets a user's pins and locked runs be *inputs* to the next run rather than overrides applied
after it, and that is the whole ballgame for Bertin-faithful interaction. Bertin's own recorded
procedure — pick a row with a distinctive aspect, move it to an extremity, gather similar rows to it,
repeat, then do the columns [5] — should become a named action ("arrange by similarity to this
alternative"), because it is the documented method and it is one line of code on top of the same
function. Finally: the order that lands in view state must carry a record of how it was derived —
method, measure, distance, excluded alternatives — or a saved view (ADR-0007) cannot distinguish
"seriated" from "hand-arranged", and no analysis can state its assumptions at the point of use as
ADR-0015 requires.

---

## Findings

### 1. What Bertin actually said

**EVIDENCE.** The reorderable matrix is not a chart type. It is stage S2b of a three-stage method of
*graphic information processing* that Bertin developed after *Sémiologie graphique* (1967) and set
out in *La graphique et le traitement graphique de l'information* (1977; English translation 1981)
[1][2]. Perin, Dragicevic and Fekete reconstruct the method from Bertin's own texts and from personal
correspondence with him [5]:

- **S1** — convert research questions into a table: (a) frame the questions, (b) compile data
  relevant to them.
- **S2** — construct and process the image: (a) choose encodings and condition the data, (b)
  *manipulate the image in order to simplify without destroying and reveal hidden patterns*.
- **S3** — interpret, decide, communicate: identify and **name** meaningful groups, annotate for
  publication.

Two things in that structure matter more than the permutation itself, and both are usually lost in
the folklore version of "Bertin invented the sortable heatmap".

First, **the framing and the naming bracket the reordering**. S1a is elicitation; S3 is naming the
groups you found. Bertin's method is not "sort the table"; it is "ask a question, build an image,
work the image until it answers, then name what you found." That is the same shape as the
elicit-the-frame-before-scoring stance in the companion agent repo, and it means the reorder action
is meaningless without the group-naming action that follows it.

Second, **Bertin was explicit that the analyst drives it, and equally explicit that he did not have
an algorithm.** Asked how exactly he reordered his tables, he referred to the "painter's eye" [5, and
Bertin, personal communication cited therein]. Stage S2b "could take weeks because of the
manipulations involved and because no systematic procedure was known" [5]. What he did offer was a
heuristic, illustrated by example [5, summarising Bertin 1977/1981]:

> i) choose a row with a particular aspect (e.g. high values) and move it to an extremity of the
> matrix. ii) Move similar rows close to this reference row, and opposite rows to the bottom. This
> will create two opposite groups, with a third group in the middle. iii) Do the same for columns.
> iv) Iterate.

And the governing principle:

> "A graphic is not 'drawn' once and for all; it is 'constructed' and reconstructed until it reveals
> all the relationships constituted by the interplay of the data" [1, p. 16 of the 1983 English
> translation] *(UNVERIFIED — could not locate source. This quotation is widely attributed to*
> Semiology of Graphics *p. 16, but it appears in none of the sources read for this section, and
> neither Bertin volume was read directly. Do not rely on the exact wording or page.)*

> "The best graphic operations are those carried out by the decision-maker himself" [2, via 5].

**EVIDENCE, and it cuts against naive automation.** Bertin knew automation was coming and welcomed
it in principle — automatic reordering is, like manual reordering, non-destructive. But he reviewed
the output of three automatic reordering algorithms and "pointed out that none of them was
satisfactory," concluding that automatic reordering **saves time but must be interlaced with manual
tweaking** [5, citing Bertin's later editions]. Semi-automatic approaches have been argued for ever
since [5][6].

**One more constraint from Bertin, easy to miss and load-bearing for us.** Bertin argues for ordering
rows and columns **independently**, which is incompatible with methods that order both axes
simultaneously — biclustering, Siirtola's approach [5]. That single sentence eliminates an entire
algorithm family from consideration for a Bertin-faithful tool, and it happens to be the family that
is hardest to make interactively steerable anyway (reasoning).

**REASONING.** The implication for our interaction design is sharper than "add a sort button". If
permuting is the analytical act, then the permutation is a *finding*, and a finding needs the same
apparatus as any other finding in this project: it must be nameable (a saved view, ADR-0007), it must
be attributable (who arranged it, or which algorithm), and it must be reversible. An arrangement that
appears without being asked for, cannot be explained, and cannot be undone is not a finding; it is
noise dressed as one.

### 2. The algorithm families, with assumptions and failure modes

Seriation is "an exploratory combinatorial data analysis technique to reorder objects into a sequence
along a one-dimensional continuum so that it best reveals regularity and patterning among the whole
series" — Liiv's definition [4], quoted verbatim in [5]; Liiv's survey cites 171 articles and traces
the technique through archaeology (Petrie 1899), sociology, psychometrics, ecology, bioinformatics
and operations research [4]. *(I could not read [4] directly — paywalled. Every Liiv claim here is
one quoted inside [5] or [7], both of which I read in full.)*

The formal target for most of these methods is the **Robinson form** [15]: a similarity matrix whose
largest values sit on the diagonal and decrease monotonically away from it [5][7]. A dissimilarity
matrix can be brought into perfect anti-Robinson form by permutation *whenever* it is an ultrametric
or has an exact one-dimensional Euclidean representation (a sufficient condition, not a necessary
one); for most real data only an approximation exists [7]. **This is the shared assumption of the whole field, and the shared failure mode: if your data's
structure is not one-dimensional — if it is cyclic, or genuinely two-dimensional — no permutation
helps, and the algorithms return artefacts rather than admitting defeat** [6, on Wilkinson's
circumplex form].

Behrisch et al. group implementations into six families [6]. Reorganised around the brief's list:

| Family | Optimises | Assumption | Failure mode |
|---|---|---|---|
| **Spectral / eigenvector** (Fiedler vector of the Laplacian) | 2-Sum criterion, via continuous relaxation [7] | Structure recoverable from a few dominant dimensions; well-behaved (p.s.d.) similarity | "eigenvectors are very sensitive to data corrupted with outliers, **missing values**, and non-normal distributions" [6]. Fails inherently on cyclic/multi-dimensional structure, producing salt-and-pepper anti-patterns [6] |
| **Optimal leaf ordering (OLO)** over hierarchical clustering | Hamiltonian path length, *restricted to orders consistent with the dendrogram* [7][9][10] | A hierarchical cluster structure exists and is worth respecting | Path length is a **local** criterion — it optimises only between adjacent neighbours and can miss global structure [7]. Inherits the linkage's biases. Clustering mostly facilitates "a data separation into exclusive groups" [6] (only biclustering generalises to overlapping clusters), whereas our groups are many-to-many |
| **TSP-based** (exact or heuristic, via a dummy city [7]) | Hamiltonian path length, **unrestricted** | As above, minus the dendrogram constraint | Best raw path length in Hahsler's comparison [8], but "the TSP only optimizes distances locally between two neighboring objects" and produces visibly worse block structure than OLO for the same data [7]. Exact solvers are non-trivial to ship; heuristics are non-deterministic |
| **Barycentre / crossing minimisation** | Edge crossings in a bipartite layout [6] | The matrix is a sparse bipartite graph whose crossings mean something | Degenerate on a dense value matrix where every alternative has a value on every criterion — there is nothing to un-cross. Classed by [6] among problem-simplification heuristics that "suffer inherently from this restriction. If a dataset is not of the expected form, the results will be inappropriate" |
| **Bond energy algorithm (BEA)** [16] | Measure of effectiveness (ME): each cell numerically close to its four neighbours [7] | Greedy insertion; the ME is a meaningful objective | **Arabie and Hubert argue the ME "only serves its intended purpose of finding an arrangement which is close to Robinson form for binary data and should therefore only be used for binary data"** [17, as reported in 7]. Also: BEA is provably a *suboptimal TSP heuristic* on the distance dᵢⱼ = −Σₖ xᵢₖxⱼₖ, so any TSP solver strictly dominates it [7, citing Lenstra 1974] |
| **Metaheuristics** (ARSA simulated annealing, QAP, genetic) | Anti-Robinson events, linear seriation, 2-Sum | — | Best quality on gradient criteria [8], but ~O(n⁴) [8] and **non-deterministic**: they need random restarts, so the same analysis can reorder differently twice |
| **Dimension reduction** (PCA, MDS, rank-two ellipse) | Least-squares / unidimensional scaling | A low-dimensional embedding exists | Same eigen-sensitivity as spectral [6] |

**EVIDENCE — the empirical result that matters most.** Hahsler's experimental comparison [8] finds
that methods cluster into three groups producing mutually similar orders, and that *methods which
perform equally well on a criterion also have similar complexity*. His practical conclusion, verbatim:

> "we found that for practical applications spectral seriation and metric MDS provide a good tradeoff
> between seriation quality and runtime for gradient condition and rank/dissimilarity
> agreement-based criteria, while hierarchical clustering with optimal leaf ordering provides a good
> tradeoff for path length." [8]

Note what a "tradeoff between quality and runtime" recommendation *is*: it is a recommendation for
people with thousands of objects. Hahsler's scalability experiment runs to 10,000 objects with a
five-minute budget [8]. **We have tens.** Adopting his default without adopting his constraint is the
reflex the brief warns about (reasoning).

**EVIDENCE — the visual-quality result.** Behrisch et al., surveying with visualisation rather than
criterion values as the yardstick:

> "we observed that Optimal-Leaf-Ordering tends to produce visually coherent and well organized
> block-diagonal forms." [6]

> "For scenarios where identifying clusters is essential, we recommend selecting (hierarchical)
> clustering approaches, since they explicitly detect clusters and order each one individually,
> placing them at the matrix diagonal." [6]

They also warn that Robinsonian quality is "essentially influenced by two choices: (i) the measure of
distance (or similarity) and (ii) the enumeration approach", and that "even if the data contains
inherent groupings, the similarity function has to be selected with caution, since an inappropriate
choice will disturb grouping patterns" [6]. **The distance is not a detail. It is half the algorithm.**
Which brings us to the part implementers get wrong.

### 3. What the R `seriation` package implements, and what its defaults actually are

**EVIDENCE, read from the package source and reference manual, not from summaries.** The package
[7][11] provides several dozen methods behind one `seriate()` interface — counting registrations in
the v1.5.8 sources, 64 distinct method names (54 accepting `dist` input, 15 `matrix`, 3 `array`),
of which 53 are registered unconditionally and 11 only when optional packages are present
(`R/register_*.R`). A separate `criterion()` function scores an order against 17 loss/merit
functions on dissimilarities and 4 on raw matrices in the core sources, rising to 21 and 5 once the
optional registrations load [11, `R/criterion.dist.R`, `R/criterion.matrix.R`].
Methods include `ARSA` (simulated annealing), `BBURCG`/`BBWRCG` (branch-and-bound), `TSP`, `OLO` /
`OLO_single` / `OLO_average` / `OLO_complete`, `GW*` (Gruvaeus–Wainer), `MDS*`, `Spectral` /
`Spectral_norm`, `QAP_2SUM` / `QAP_LS` / `QAP_BAR` / `QAP_Inertia`, `GA`, `DendSer`, `HC*`, `R2E`,
`SPIN_*`, `VAT`, `BEA` / `BEA_TSP`, `PCA` / `PCA_angle`, `CA`, `Heatmap`.

The defaults — the interesting part — differ by input type:

| Input | Default method | Source |
|---|---|---|
| `dist` (one-mode) | **`"Spectral"`**, and the function hard-errors: `stop("NAs not allowed in distance matrix x!")` | `R/seriate.dist.R` [11] |
| `matrix` | `"PCA"` | `R/seriate.matrix.R` [11] |
| `data.frame` | **`"Heatmap"`** | `R/seriate.data.frame.R` [11] |
| contingency `table` | `"CA"` | `R/seriate.table.R` [11] |

And `"Heatmap"` — the default for the input type that most resembles our matrix — is defined as:
compute distances between rows and between columns, then **seriate each axis independently**, with
control defaults `dist_fun = dist` (Euclidean) and `seriation_method = "OLO_complete"` for both axes
[11, `R/seriate_heatmap.R`].

**So the package's own answer to "what is a sensible default for a rectangular data matrix" is: a
per-axis distance, then optimal leaf ordering over complete-linkage hierarchical clustering, each
axis independent.** That is exactly the Bertin-compatible shape (rows and columns ordered
independently [5]), and it is what I recommend below.

**Two things the package will not do for us.** It offers **no missing-value handling at all** — it
refuses `NA` in the distance matrix and delegates the entire question to whatever produced the
distance [11]. And its `dist`-level default (`Spectral`) is the one method whose core assumption our
data breaks. Both are arguments for owning the distance step ourselves rather than mimicking a
default.

### 4. The distance: ordinal rows with missing cells

This is where implementations go wrong, so here it is concretely.

**Euclidean distance on a matrix of 1–5 ratings is wrong twice over.** It treats an ordinal scale as
interval — the category error ADR-0003 exists to prevent — and it has no defined behaviour when a
cell is missing. Listwise deletion (drop any alternative with any missing cell) throws away exactly
the alternatives an incomplete analysis most needs to place. Imputation invents values, which
contradicts ADR-0009 outright.

**EVIDENCE — the right tool is Gower's coefficient [3], and specifically its δ mechanism.** Gower
defines similarity between objects *i* and *j* over *v* characters as

> S_ij = Σₖ s_ijk δ_ijk / Σₖ δ_ijk

where **δ_ijk = 1 when character *k* can be compared for *i* and *j*, and 0 otherwise** [3, §2]. When
δ_ijk = 0 the character contributes to neither numerator nor denominator: the similarity is the
average over *comparisons that were actually possible*. If δ_ijk = 0 for every *k*, S_ij is
undefined — Gower says so explicitly [3]. For quantitative characters s_ijk = 1 − |xᵢ − xⱼ| / R_k,
where R_k is the range of character *k*; for qualitative characters s_ijk = 1 on agreement, 0
otherwise [3].

**Ordinal characters.** Gower's original does not treat ordinal specially [3][12]. Two extensions
exist. `cluster::daisy` in R applies "standard scoring": ordinal variables "are replaced by their
integer codes 1:K. Note that this is not the same as using their ranks (since there typically are
ties)" [13] — the integer codes are then normalised to [0,1] and handled as quantitative. Podani
(1999) proposes the rank-based s_ijk = 1 − |rᵢ − rⱼ| / (max r − min r) [12]. **For us, integer codes
are the right choice, not ranks** (reasoning): our ordinal levels are *declared* by the criterion
(a 1–5 rating, a three-level confidence), so the level set and its extremes are known a priori and do
not depend on which alternatives happen to be present. Rank transformation would make the distance
between two alternatives change when a third alternative is added, which is unacceptable for a
document people re-open and compare.

Note the honest caveat: mapping ordinal level *k* of *K* to (k−1)/(K−1) does assume equal spacing
between adjacent levels. That is a real interval-scale assumption smuggled into a similarity
computation. It is defensible here — it is confined to a view-layer ordering heuristic, produces no
number anyone reports, and is what `daisy` does [13] — but it must be stated in the UI alongside the
order, per ADR-0015. It is emphatically **not** a licence to average scores elsewhere.

**Rank correlation is the wrong tool here** (reasoning, with evidence for the mechanism). Kendall's
τ or Spearman's ρ between two alternatives' score vectors measures whether they *rank the criteria*
similarly — which is a statement about within-row shape, not about the alternatives being alike.
Two alternatives scoring (5,4,3,2,1) and (2,1.8,1.6,1.4,1.2) have τ = 1 and are not remotely similar
in the sense a reader of the matrix cares about. Rank correlation across criteria is also
scale-blind in the direction we do not want: we *want* "scores 5 everywhere" to sit far from "scores
1 everywhere". Use rank correlation for a different question — inter-rater agreement (ADR-0011) —
where measuring agreement about ordering is precisely the point.

**Pairwise-complete correlation is a trap with a documented failure mode.** R's own `cor`
documentation states that `pairwise.complete.obs` "can result in covariance or correlation matrices
which are not positive semi-definite, as well as NA entries if there are no complete pairs for that
pair of variables" [14]. Each pairwise value is computed from a different subset of observations, so
the resulting matrix can encode combinations that no complete dataset could produce.

**And Gower's δ mechanism has the same disease — Gower proved it in the original paper.** Section 3
of [3] establishes that S is positive semi-definite when there are no missing values, and then
demonstrates by a four-character, three-individual counterexample that **"Missing values may cause
the similarity matrix to lose its p.s.d. property"** [3, Appendix], exhibiting a matrix whose
determinant is negative.

**REASONING — and this is the load-bearing inference of this whole section.** That single fact
selects our algorithm family. A distance matrix that is not p.s.d. has no Euclidean embedding. Every
method that decomposes it — spectral seriation via the Laplacian's Fiedler vector, metric MDS,
PCA-based ordering — is operating outside its assumptions and can return an eigenvector that means
nothing, which is exactly the "sensitive to missing values" behaviour [6] reports empirically.
Hierarchical clustering and optimal leaf ordering, by contrast, consume the pairwise numbers
directly: agglomeration compares distances, and OLO's dynamic program sums the distances between
adjacent leaves [9][10]. Neither ever needs the matrix to be embeddable. **Given ADR-0009 guarantees
we will have missing cells, the eigen-based families are structurally the wrong choice for
`comparanda`, independent of any speed argument.**

**The overlap problem, and a concrete guard.** Gower's δ-normalisation silently equates a distance
computed from twelve comparisons with one computed from two. That is a variance problem, not a bias
problem, and it is invisible in the output. Concretely: require a minimum comparable-criteria count
before a pair's distance is trusted. Default `minOverlap = max(3, ceil(0.3 × comparableCriteria))`.
An alternative that fails the threshold against most others is **excluded from the seriation and
parked at the end of the order, visibly flagged**, rather than being placed on evidence that does not
exist. This is the ADR-0009 stance applied to an algorithm: a qualified "we could not place this"
beats a confident wrong position.

**Missingness reasons carry similarity information, and we should use them.** This is the one place
where `comparanda`'s domain model gives us something the seriation literature does not have
(reasoning). ADR-0009's reason codes split cleanly into *structural* and *contingent* absence, and
they should be treated differently in δ:

| Cells being compared | δ | s | Rationale |
|---|---|---|---|
| both `not-applicable` | 1 | 1 | Structural agreement is real information. Two alternatives that are both out of scope for a criterion *are* alike in a way readers care about — and it makes inapplicable blocks (domain-model "group pair inapplicable") cluster and become visible as blocks, which is the whole point of reordering |
| one `not-applicable`, other has a value | 1 | 0 | They differ in kind, maximally. Gower's asymmetric-character handling |
| either is `not-assessed`, `pending`, `unknown` or `withheld` | 0 | — | Contingent absence carries no information about the alternative. Skip the comparison |

The second row deserves a flag: it is a design choice, not a derivation, and a deployment where
`not-applicable` is common and uninteresting will want it configurable. Ship it as
`missingPolicy: 'structural-matches' | 'skip-all'`, defaulting to the table above.

### 5. Presenting an ordering so it invites adjustment

**EVIDENCE — the best prior art is Bertifier [5], and its design is directly transferable.** Its
central contribution beyond the UI is *visual reordering*: "a semi-interactive reordering approach
that lets users apply and tune automatic reordering algorithms in a WYSIWYG manner" [5]. Concretely,
it does four things worth copying:

1. **It builds a richer API on top of OLO rather than post-processing OLO's output.** "The API allows
   to specify a first and/or last vector as limits that will remain at the end(s) and the remaining
   vectors will be optimally ordered. Finally, one or several ranges of vectors can be protected
   against reordering (rows or columns that are glued)" [5]. Limits are implemented by inflating
   distances to the pinned vectors so clustering places them last (Bertifier adds the matrix's
   maximum distance *m* to every distance to the starting vector, and 2×*m* for the ending vector);
   a protected range is collapsed to just its first and last vectors with a distance of 0 set
   between them, so OLO always glues them together, and the in-between indices are re-inserted
   afterwards [5]. (Collapsing to a *single* representative is a different Bertifier step — its
   handling of duplicate identical vectors.) The corresponding
   published JavaScript API is `reorder.js`'s `.limits()` and `.except()` — which sit on its
   `order()` builder (whose default ordering *is* `optimal_leaf_order`), not on
   `optimal_leaf_order` itself [18, `dist/reorder.esm.js`].
2. **Manual drag is framed as tuning, not as overriding.** Drag-and-drop is "the first level of
   integration between automatic and manual reordering, and allows to tweak the results of automatic
   reordering", and gluing rows together — which the algorithm then preserves — is "a second level of
   integration" [5].
3. **The drag axis is locked by initial direction.** "Following previous findings that reordering
   rows and columns concurrently can be confusing to users, we lock the reordering on the row or
   column based on the initial dragging direction," with animated transitions during the drag [5].
4. **Data conditioning is the tuning surface, not algorithm parameters.** Because reordering runs on
   the *conditioned* values, adjusting a row's range or brightness reweights it in the algorithm
   without exposing any internal parameter: "rows that are made brighter will be given a lower weight
   by the reordering algorithm. Rows that are made entirely white will be ignored. A specific case of
   this is making all rows white except one, which enables a regular sorting operation" [5]. And
   correspondingly: "standard sorting is just a particular case of the reordering algorithm when the
   list of rows contain exactly one column, and vice versa" [5].

Behrisch et al. corroborate the direction and note it is under-explored: they split interactive
reordering into *interactive* (Bertifier, TableLens, InfoZoom — manual) and *semi-assisted / steering*
(MatrixExplorer, PermutMatrix — the user steers the algorithm), observe that Bertifier "uses
extensively this flexibility to allow interactively specified preferences to influence the reordering
algorithm", and conclude "these systems are still in their infancy and rather rare in practice. We
believe some of the most exciting advances for matrix reordering will occur in this space" [6].

**REASONING — the interaction recommendation, in eight rules.**

1. **Never seriate on load.** The order that appears is the authored order. Seriation is an action a
   person takes, named in the analyst's language: **"Arrange to reveal structure"** (ADR-0008 already
   uses this phrasing — keep it).
2. **Constraints are inputs.** Pins ("keep this alternative first/last") and locks ("keep these three
   together") are stored in view state and passed into every subsequent run. A user who drags a row
   and re-runs must not see their drag undone. This is the single most important rule, and it is why
   the dendrogram-constrained family wins.
3. **A drag is an offer to become a pin.** After a manual drag, offer — do not force — "keep here?".
   Accepting converts the drag into a constraint; declining leaves it as a one-off. This is the
   cheapest possible bridge between Bertin's manual method and the algorithm.
4. **Animate the transition, and always offer both undo and "restore authored order."** The animation
   is not decoration: it is what lets a reader see *what the algorithm did*, which is the difference
   between a proposal and a fait accompli.
5. **Explain the result in one line, at the point of use** (ADR-0015): "Arranged by similarity across
   11 of 12 criteria (ordinal, Gower). 3 alternatives had too few comparable criteria and were placed
   at the end." Name the method; name the excluded.
6. **Ship Bertin's own procedure as a first-class action.** "Arrange by similarity to this
   alternative" = pin the selected alternative at position 0 and seriate the rest. This is literally
   step (i)–(ii) of the heuristic Bertin recorded [5], it is one parameter on the same function, and
   it is far more legible to a non-technical user than "seriate".
7. **Offer the dendrogram's cut as suggested groups, never as automatic groups.** Groups are data
   (ADR-0008); an algorithm must not write data. "Suggest groups from this arrangement" produces
   named-by-the-user candidates that the user accepts, edits or discards. This is Bertin's stage S3,
   and it is the step that converts a permutation into a finding.
8. **Lock the drag axis by initial direction, and give the keyboard the identical model** [5]:
   select header → arrow keys move → `p` pins / unpins. ADR-0008 already forbids drag-only reorder;
   this makes the keyboard path feature-equal rather than a lesser fallback.

---

## What this means for the schema / the view / the agent

### Ship in v1

**One seriation method, `olo`, plus its degenerate case.** Everything else is deferred.

- **`olo` (default and only automatic method).** Optimal leaf ordering [9][10] over agglomerative
  hierarchical clustering of a missingness-aware Gower distance [3], applied to **each axis
  independently** [5][11].
- **Linkage: run all three and pick the best.** At n ≤ ~200, run `single`, `average` and `complete`
  and keep the order with the lowest Hamiltonian path length. This is principled, not shotgun: OLO
  minimises path length *subject to* a given dendrogram [9], so the best of three dendrograms is the
  best path length achievable among them — a strictly better answer than guessing the linkage, at
  three times a cost that is already negligible. Report the winner. This is the concrete cash value
  of "we can afford the optimal method": three O(n³) runs at n = 100 is still milliseconds.
  Fall back to `complete` only above a configurable `exhaustiveLinkageLimit` (default 200), matching
  the R package's `OLO_complete` default [11].
- **`sortByCriterion` is `olo` with one column.** Implement plain sort as the same code path with a
  single-criterion input [5], so the pin/lock machinery works identically for both. This matters
  because sort is what people reach for first and it must not be a second, inconsistent mechanism.

### Do not ship in v1 — with reasons on the record

| Not shipping | Reason |
|---|---|
| **Spectral / Fiedler** | Eigen-based; Gower proved missingness can break p.s.d. [3], and [6] names missing values as a sensitivity. Its advantage is scalability to 10,000 objects [8], which we do not need |
| **Metric MDS / PCA ordering** | Same eigen-assumption, same objection |
| **BEA** | Its objective is argued to be valid only for binary data [17, via 7], and it is a provably suboptimal TSP heuristic [7]. Our data is ordinal |
| **Barycentre / crossing minimisation** | Designed for sparse bipartite layouts; degenerate on a dense value matrix, and [6] warns problem-simplification heuristics fail badly off their assumed form |
| **ARSA / QAP / genetic** | Best on anti-Robinson criteria [8] but ~O(n⁴) and **non-deterministic** — the same analysis must arrange identically twice or people stop trusting it. Revisit only if a criterion demand appears |
| **Unrestricted TSP** | Better raw path length than OLO [8], but visibly worse block structure [7] and no natural place to inject pins |
| **Biclustering** | Orders both axes at once, which Bertin explicitly argues against [5], and it is the least steerable family |

### Core API (no DOM — ADR-0005)

```ts
// comparanda/core/seriation

type MissingPolicy = 'structural-matches' | 'skip-all';

interface GowerOptions {
  measure: MeasureId;              // default: the analysis's primary score measure
  missingPolicy?: MissingPolicy;   // default 'structural-matches'
  minOverlap?: number | ((n: number) => number);  // default max(3, ceil(0.3 * n))
  criterionWeights?: Record<CriterionId, number>; // default: uniform
}

interface DistanceResult {
  readonly condensed: Float64Array;   // n*(n-1)/2 lower-triangle
  readonly overlap: Uint16Array;      // comparable criteria per pair — the honesty channel
  readonly insufficient: readonly EntityId[]; // failed minOverlap; excluded from seriation
}

function gowerDistance(
  analysis: Analysis, axis: 'alternatives' | 'criteria', opts: GowerOptions
): DistanceResult;

function hierarchicalCluster(
  d: DistanceResult, opts: { linkage: 'single' | 'average' | 'complete' }
): Dendrogram;

function optimalLeafOrder(
  tree: Dendrogram, d: DistanceResult,
  constraints?: { pinFirst?: EntityId[]; pinLast?: EntityId[]; lockedRuns?: EntityId[][] }
): EntityId[];

function pathLength(order: EntityId[], d: DistanceResult): number;
function antiRobinsonEvents(order: EntityId[], d: DistanceResult): number; // reporting only

// the facade — the only thing the view calls
function seriate(analysis: Analysis, opts: SeriateOptions): SeriationResult;

function suggestGroups(tree: Dendrogram, opts?: { maxGroups?: number }): GroupSuggestion[];
```

`optimalLeafOrder` implements the O(n³) binary-tree algorithm of [10] (the improved form of [9]).
`pinFirst`/`pinLast` follow Bertifier's distance-inflation trick and `lockedRuns` its
collapse-and-re-expand trick [5]; `reorder.js` [18] is a usable cross-check oracle for tests.

**Recommend implementing rather than depending.** `reorder.js` 2.2.6 (BSD-2, last published 2023)
exposes `optimal_leaf_order` with `.distance()`, `.linkage()` and `.distance_matrix()`, and a
separate `order()` builder carrying `.limits()` and `.except()` [18] — the right API shape, and
worth reading. But its ESM build is ~98 KB unminified
plus a `@sgratzl/science` dependency, we must supply our own distance regardless, and BRIEF.md's
standalone-bundle constraint asks us to justify runtime dependencies against what they replace.
OLO + agglomerative clustering is a few hundred lines of pure, highly testable code with no DOM and
no dependencies — exactly what belongs in `core`.

### The schema and view-state change this implies

**`order` in view state must become an explained order.** ADR-0007 lists "alternative order, criterion
order" among the snapshot contents. A bare permutation cannot answer "was this arranged or authored?"
and cannot be re-derived, so:

```ts
interface AxisOrder {
  order: EntityId[];
  provenance:
    | { kind: 'authored' }
    | { kind: 'manual' }                       // dragged / keyboard-moved
    | { kind: 'sorted'; criterion: CriterionId; measure: MeasureId; direction: 'asc' | 'desc' }
    | { kind: 'seriated'; method: 'olo'; linkage: Linkage; measure: MeasureId;
        distance: 'gower'; missingPolicy: MissingPolicy; minOverlap: number;
        pathLength: number; excluded: readonly { id: EntityId; reason: 'insufficient-overlap' }[] };
  constraints: { pinFirst: EntityId[]; pinLast: EntityId[]; lockedRuns: EntityId[][] };
}
```

`constraints` sits **beside** `order`, not inside `provenance`, because it survives re-runs and
outlives any single method. This is what makes rule 2 above implementable.

Dirty-state comparison (ADR-0007) should compare `order` and `constraints` structurally and ignore
`provenance` — otherwise re-running seriation and arriving at the identical order would mark the view
modified.

**No schema change to the stored analysis is required.** Seriation consumes measures and missing
reason codes that ADR-0009 already mandates; it writes only view state. `suggestGroups` proposes
groups but never writes them — groups are data, ADR-0008 — so nothing here weakens that boundary.

### For the agent side

Two consequences worth stating in the contract, because the agent's output determines whether
seriation works at all:

- **Missing reason codes are load-bearing, not cosmetic.** Emitting `not-assessed` where
  `not-applicable` is meant changes the computed distance and therefore the arrangement. The
  structural/contingent split feeds directly into δ.
- **`levels` on an ordinal (criterion, measure) pair must be declared and ordered.** The distance
  normalises level index *k* of *K* to (k−1)/(K−1); an undeclared or unordered level set makes the
  ordinal branch unusable and silently degrades the criterion to nominal.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0008 | **amend** | It is `proposed` and says only "implement at least one principled algorithm; see the research brief for candidates". Settle it: name OLO over Gower, per axis independently; require pins/locked runs to be *inputs* to the algorithm rather than post-hoc overrides; add the "arrange by similarity to this alternative" action; add `suggestGroups` as a proposal that never writes group data |
| — | **new ADR** | *Distance and missingness policy for seriation.* Gower's coefficient with δ-weighting [3], ordinal levels scored by declared level index (not sample ranks), the structural-vs-contingent missing table, `minOverlap` with exclude-and-park, and the explicit rejection of eigen-based methods on p.s.d. grounds. This is a cross-cutting decision that binds the agent's output format, so it deserves its own record rather than a paragraph inside ADR-0008 |
| ADR-0007 | **amend** | Saved views snapshot "alternative order, criterion order". Extend to the `AxisOrder` shape above — order + provenance + constraints — and specify that dirty-state comparison ignores `provenance` |
| ADR-0009 | **confirm** | No change needed. The reason codes turn out to be an input to the distance function, which is a strong independent vindication of the "no bare nulls" stance: a bare null would have been uncomputable here |
| ADR-0015 | **confirm** | It already lists seriation as an analysis and requires assumptions stated at the point of use. Interaction rule 5 above is that requirement made concrete; the equal-spacing assumption of the ordinal scoring is the specific thing that must be surfaced |
| ADR-0003 | **confirm** | The ordinal/interval distinction is what forced Gower over Euclidean. Working as intended |

---

## Open questions

- **Which measure drives the arrangement by default?** I assume the primary score measure. But
  arranging by `confidence` answers "where is the evidence thin?" and arranging by the blended
  encoding (ADR-0010) arranges by what is actually on screen — which is closest to Bertin's *visual*
  reordering [5], since he reordered what he could see. Settled by a prototype, not by argument; my
  guess (reasoning) is that arranging by the active encoding is the more Bertin-faithful default and
  the more surprising-in-a-good-way behaviour, but it makes the order depend on the view, which
  complicates the provenance record.
- **How should multi-rater cells (ADR-0011) enter the distance?** Options: reduce first (median) and
  treat as a single ordinal value, or treat disagreement as an additional dimension. Not urgent —
  Phase 4 — but the `GowerOptions.measure` parameter should not foreclose it.
- **Does `structural-matches` help or hurt in practice?** The claim that both-`not-applicable` should
  count as agreement is reasoning, not evidence. It should make inapplicable blocks visible as
  blocks, which is desirable; it could also dominate the distance in an analysis where `not-applicable`
  is very common. Settle by running both policies on the messy example dataset (ADR-0016) and looking.
- **Is a global-structure method ever worth adding?** OLO's criterion (path length) is local [7][8],
  and Hahsler's criterion groups sort from local to global structure [8]. If users report "the blocks
  look right up close but the overall gradient is wrong", the deterministic global option is
  branch-and-bound on the anti-Robinson criterion, which [7] reports is feasible to ~40 objects —
  within our range. Do not build it until the complaint appears.
- **Liiv's survey [4] read directly.** I worked from quotations inside [5] and [7]. Nothing in my
  recommendation rests on an unverified Liiv claim, but the taxonomy section would be firmer with the
  original in hand.

---

## REFERENCES

1. [Sémiologie graphique : les diagrammes, les réseaux, les cartes — Jacques Bertin, Gauthier-Villars, Paris (1967); English: *Semiology of Graphics*, trans. William J. Berg, University of Wisconsin Press (1983)](https://historyofinformation.com/detail.php?id=3361) — *not read directly; cited via [5] and for the UNVERIFIED epigraph in §1*
2. [La graphique et le traitement graphique de l'information — Jacques Bertin, Flammarion (1977; Perin et al. [5] date this edition 1975); English: *Graphics and Graphic Information Processing*, de Gruyter (1981)](https://doi.org/10.1515/9783110854688) — *not read directly; cited via [5]*
3. [A General Coefficient of Similarity and Some of Its Properties — J. C. Gower, *Biometrics* 27(4):857–871 (1971)](https://mathematics.foi.hr/Rprojekti/BDP%20concept/Gover_metric.pdf)
4. [Seriation and matrix reordering methods: An historical overview — Innar Liiv, *Statistical Analysis and Data Mining* 3(2):70–91 (2010)](https://onlinelibrary.wiley.com/doi/abs/10.1002/sam.10071) — *paywalled; cited only for claims quoted verbatim within [5] and [7]*
5. [Revisiting Bertin Matrices: New Interactions for Crafting Tabular Visualizations — Charles Perin, Pierre Dragicevic, Jean-Daniel Fekete, *IEEE TVCG* 20(12):2082–2091 (2014)](https://aviz.fr/wiki/uploads/Bertifier/bertifier-authorversion.pdf)
6. [Matrix Reordering Methods for Table and Network Visualization — Michael Behrisch, Benjamin Bach, Nathalie Henry Riche, Tobias Schreck, Jean-Daniel Fekete, *Computer Graphics Forum* 35(3):693–716, EuroVis STAR (2016)](https://hal.science/hal-01326759/document)
7. [Getting Things in Order: An Introduction to the R Package seriation — Michael Hahsler, Kurt Hornik, Christian Buchta, *Journal of Statistical Software* 25(3):1–34 (2008)](https://cran.r-project.org/web/packages/seriation/vignettes/seriation.pdf)
8. [An experimental comparison of seriation methods for one-mode two-way data — Michael Hahsler, *European Journal of Operational Research* 257(1):133–143 (2017)](https://michael.hahsler.net/research/paper/EJOR_seriation_2016.pdf)
9. [Fast optimal leaf ordering for hierarchical clustering — Ziv Bar-Joseph, David K. Gifford, Tommi S. Jaakkola, *Bioinformatics* 17(suppl_1):S22–S29 (2001)](https://people.csail.mit.edu/tommi/papers/BarGifJaa-ismb01.pdf)
10. [K-ary Clustering with Optimal Leaf Ordering for Gene Expression Data — Ziv Bar-Joseph, Erik D. Demaine, David K. Gifford, Nathan Srebro, Angèle M. Hamel, Tommi S. Jaakkola, *Bioinformatics* 19(9):1070–1078 (2003)](https://home.ttic.edu/~nati/Publications/BarJosephEtalWABI03.pdf)
11. [seriation: Infrastructure for Ordering Objects Using Seriation — R package source and reference manual, Michael Hahsler et al.](https://github.com/mhahsler/seriation)
12. [Gower's distance — Wikipedia, summarising Gower (1971), Kaufman & Rousseeuw (1990) and Podani (1999) ordinal extensions](https://en.wikipedia.org/wiki/Gower%27s_distance)
13. [daisy: Dissimilarity Matrix Calculation — R `cluster` package documentation, Maechler, Rousseeuw, Struyf, Hubert, Hornik](https://stat.ethz.ch/R-manual/R-devel/library/cluster/html/daisy.html)
14. [cor: Correlation, Variance and Covariance (Matrices) — R `stats` package documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/cor.html)
15. [A Method for Chronologically Ordering Archaeological Deposits — W. S. Robinson, *American Antiquity* 16(4):293–301 (1951)](https://doi.org/10.2307/276978)
16. [Problem Decomposition and Data Reorganization by a Clustering Technique — William T. McCormick Jr., Paul J. Schweitzer, Thomas W. White, *Operations Research* 20(5):993–1009 (1972)](https://pubsonline.informs.org/doi/10.1287/opre.20.5.993) — *cited via [7]; not read directly*
17. [The bond energy algorithm revisited — Phipps Arabie, Lawrence J. Hubert, *IEEE Transactions on Systems, Man and Cybernetics* 20(1):268–274 (1990)](https://ieeexplore.ieee.org/abstract/document/47829/) — *cited via [7]; not read directly*
18. [reorder.js — a JavaScript library to reorder matrices, Jean-Daniel Fekete et al. (BSD-2, npm 2.2.6)](https://github.com/jdfekete/reorder.js)
