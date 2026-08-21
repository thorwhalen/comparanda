# ADR-0025: Seriation — algorithm, distance, and missingness policy

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0008 identifies reordering as Bertin's reorderable matrix and its algorithmic form as
seriation, and offers automatic ordering as a first-class action without naming an algorithm. Two
facts about this repository close that choice far more sharply than the general literature does.

Our matrices are small. ADR-0002 puts the target at tens to low hundreds of alternatives, so the
runtime-versus-quality tradeoffs that organise the seriation literature were measured under a
constraint we do not have, and adopting their conclusion without their constraint would be
cargo-culting.

And ADR-0009 guarantees missing cells. That is not a data-quality nuisance here, it is the
product. Gower's own appendix demonstrates by counterexample that missing values can cost a
similarity matrix its positive semi-definiteness [3]; a matrix with no Euclidean embedding has no
meaningful eigen-decomposition. That single fact disqualifies a whole algorithm family, on
correctness rather than on speed.

## Decision
**One automatic ordering ships:** optimal leaf ordering (OLO) over agglomerative hierarchical
clustering of a **missingness-aware Gower distance**, applied to **each axis independently**.
Plain single-criterion sort is the same code path on a single-criterion input, not a second
implementation. Per-axis independence is Bertin's own constraint [1], and it rules out
biclustering — the family that is hardest to steer interactively in any case.

**Linkage is measured, not guessed.** Run `single`, `average` and `complete`, and keep the order
with the lowest Hamiltonian path length. OLO minimises path length *subject to* a given dendrogram
[4, 5], so the best of three dendrograms is the best achievable among them — a strictly better
answer than picking one, at three times a negligible cost. Above a configurable size limit, fall
back to `complete`.

**Ordinal levels are scored by their declared level index, normalised to [0,1] — never by sample
rank.** This is the standard scoring `cluster::daisy` uses [7]. Sample rank is forbidden because it
is non-local: the distance between two alternatives would change when a third alternative is added
or removed, so an order would silently re-derive itself differently in a document people re-open.
The resulting equal-spacing assumption is real and is declared rather than hidden — it is stated in
the UI alongside the order, per ADR-0015's rule that every analysis states its assumptions at the
point of use. It is confined to a view-layer ordering heuristic that produces no number anyone
reports, and it is **not** a licence to average scores anywhere else.

**Missingness enters through Gower's δ mechanism** [3] — `S_ij = Σ_k s_ijk·δ_ijk / Σ_k δ_ijk`,
where δ is 1 when a criterion can be compared for the two alternatives and 0 otherwise, so the
similarity is the average over comparisons that were actually possible. The policy keys on
ADR-0009's `structural` flag and **never on a literal reason code**:

- **structural absence** — `δ = 1, s = 1` when both alternatives are structurally absent, and
  `δ = 1, s = 0` when one has a value. Structural agreement is real similarity: two alternatives
  a criterion does not apply to *are* alike in a way readers care about, and scoring it that way
  makes inapplicable blocks cluster and become visible as blocks, which is the point of reordering.
- **contingent absence** — `δ = 0`. The cell drops out of both sums. Nobody has looked yet is not
  evidence of similarity.

Ship this as `missingPolicy: 'structural-matches' | 'skip-all'`, defaulting to the former, because
the structural row is a derivation and the choice to abandon it is a preference.

**A `minOverlap` guard excludes and visibly parks.** δ-normalisation silently equates a distance
computed from twelve comparisons with one computed from two — a variance problem that is invisible
in the output. Require a minimum comparable-criteria count (default
`max(3, ceil(0.3 × comparableCriteria))`); an alternative that fails it is excluded from the
seriation and parked at the end, flagged. The per-pair overlap count is carried out of the distance
computation rather than discarded, so the honesty is available to the view. This is ADR-0009's
stance applied to an algorithm: a qualified "we could not place this" beats a confident wrong
position.

**The eigen-based families — spectral/Fiedler, metric MDS, PCA ordering — are rejected outright**,
not on speed but on the Gower result above [3], corroborated by Behrisch et al.'s report that
eigenvectors are highly sensitive to missing values [2]. Hierarchical clustering and OLO never need
the matrix to be embeddable: agglomeration compares distances, and OLO's dynamic program sums
distances between adjacent leaves [4, 5].

**Manual and automatic reordering are one feature, not two.** ADR-0008 treats them as two
features that must not fight, which gets the intent right by the wrong mechanism. Pins and locked
runs are **inputs** to the algorithm — pins by inflating distances to the pinned vector, locked runs
by collapsing a run to its endpoints and re-expanding afterwards [1] — never a permutation applied
to the algorithm's output. **Never seriate on load.** A drag is an
*offer* to become a pin, and every automatic arrangement is a starting point the human adjusts.

**View state records an explained order,** not a bare permutation:
`AxisOrder = { order, provenance, constraints }`. `provenance` discriminates `authored`, `manual`,
`sorted` and `seriated`, and the seriated case carries method, linkage, measure, distance, missing
policy, `minOverlap`, the achieved path length and the parked alternatives — enough to answer "why
is it in this order" and to re-derive it. `constraints` (pins, locked runs) sits **beside** `order`
rather than inside `provenance`, because it survives re-runs and outlives any single method.
Dirty-state comparison (ADR-0007) compares `order` and `constraints` and ignores `provenance`;
otherwise re-running seriation to the identical order would mark a saved view modified.

## Consequences
One algorithm to implement, test and explain, and a UI that can always account for an arrangement.
A user's manual adjustment survives a re-run because it is an input to the run rather than a
correction applied after it.

The cost is O(n³) optimal leaf ordering [5], which ADR-0002's stated scale makes irrelevant and
which must be re-examined the day that scale moves.

Missingness reason codes become **load-bearing rather than cosmetic**: emitting a contingent code
where a structural one is meant changes the arrangement, so this is a constraint on the agent
contract and not only on the renderer. An ordinal `(criterion, measure)` pair must declare its
ordered levels or the ordinal branch degrades silently to nominal.

Seriation is an analysis over the data a given reader can see, so ADR-0021 applies unchanged: an
order computed with cells withheld from that reader is labelled as such at the point of use.

No change to the stored analysis is required. Seriation reads measures and reason codes ADR-0009
already mandates and writes only view state. A dendrogram cut may *suggest* groups; it never writes
them, because groups are data (ADR-0008).

## Alternatives considered
- *Spectral ordering, metric MDS, PCA.* Fast, standard, and unsound on a matrix with missing cells
  [3]. This is the strongest rejection in the ADR and the only one that is a correctness argument.
- *Several algorithms behind a picker.* Multiplies the explanation burden without changing what a
  small ordinal matrix needs, and asks users to choose between orderings they have no way to
  evaluate.
- *Automatic ordering as a mode that overrides manual drags.* Fights the user. Bertin reviewed the
  automatic reordering algorithms of his day, found none satisfactory, and concluded that
  automation saves time but must be interlaced with manual tweaking [1].
- *Sample-rank scoring of ordinal levels.* Non-local, as above.
- *Post-hoc override — seriate, then re-apply the user's manual moves.* Rejected: the pins are then
  a lie the next re-run discards, and the provenance record cannot say what produced the order.
- *Other seriation families* — BEA, ARSA/QAP/genetic search, unrestricted TSP, biclustering. Each
  is declined with its reason in `docs/research/findings-visualisation.md` § 1.4; the disqualifiers
  that matter here are non-determinism (the same analysis must arrange identically twice or people
  stop trusting it) and having no natural place to inject pins.
- *Depending on `reorder.js`.* The right API shape and a useful cross-check oracle for tests, but
  we must supply our own distance regardless, and OLO plus agglomerative clustering is a few
  hundred lines of pure, DOM-free, highly testable code — exactly what belongs in `core`.

## Amendments

### 2026-08-21 — An unusable ordinal criterion is excluded and reported, never silently degraded

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

The Consequences say "an ordinal `(criterion, measure)` pair must declare its ordered levels or the
ordinal branch degrades silently to nominal". **That degradation is unreachable and must not be
implemented.** ADR-0018 makes the declaration *required* on ordinal, interval and ratio and enforces
it at the schema boundary, and `validateMeasurement` in `src/core/schema/measurement.ts` does so —
refusing both a missing range on any ordered level and a missing level list on a nominal or ordinal
one. A pair that fails that check never reaches a seriation run. ADR-0018 wins; this sentence
overstated what could still go wrong.

Where it could nonetheless arise — a caller seriating an analysis it never validated — **the criterion
is excluded from the Gower distance and named in the result**, exactly as ADR-0019 clause 7 names the
criteria a dominance basis left out, and exactly as this ADR's `minOverlap` guard already parks an
alternative visibly rather than placing it wrongly. Nothing in this repository degrades a level of
measurement silently: a quiet fall-through to nominal would change the arrangement while leaving the
`AxisOrder` provenance that exists to explain the arrangement unable to say so.

## References
The evidence and the full derivation are in `docs/research/findings-visualisation.md` § 1, with
working notes and the eight interaction rules in `docs/research/sections/c5-seriation.md` § 5. The
R `seriation` package's `data.frame` default — distance per axis, then each axis seriated
independently with `OLO_complete` — is the prior art this follows; its `dist` default is spectral
and hard-errors on missing values, which is the one to copy from and the one to avoid [6].

1. [Revisiting Bertin Matrices: New Interactions for Crafting Tabular Visualizations — Perin, Dragicevic & Fekete, IEEE TVCG 20(12) (2014)](https://aviz.fr/wiki/uploads/Bertifier/bertifier-authorversion.pdf)
2. [Matrix Reordering Methods for Table and Network Visualization — Behrisch, Bach, Henry Riche, Schreck & Fekete, Computer Graphics Forum 35(3), EuroVis STAR (2016)](https://hal.science/hal-01326759/document)
3. [A General Coefficient of Similarity and Some of Its Properties — J. C. Gower, Biometrics 27(4) (1971)](https://mathematics.foi.hr/Rprojekti/BDP%20concept/Gover_metric.pdf)
4. [Fast optimal leaf ordering for hierarchical clustering — Bar-Joseph, Gifford & Jaakkola, Bioinformatics 17(suppl_1) (2001)](https://people.csail.mit.edu/tommi/papers/BarGifJaa-ismb01.pdf)
5. [K-ary Clustering with Optimal Leaf Ordering for Gene Expression Data — Bar-Joseph, Demaine, Gifford, Srebro, Hamel & Jaakkola, Bioinformatics 19(9) (2003)](https://home.ttic.edu/~nati/Publications/BarJosephEtalWABI03.pdf)
6. [seriation: Infrastructure for Ordering Objects Using Seriation — R package source and reference manual, Hahsler et al.](https://github.com/mhahsler/seriation)
7. [daisy: Dissimilarity Matrix Calculation — R `cluster` package documentation](https://stat.ethz.ch/R-manual/R-devel/library/cluster/html/daisy.html)
