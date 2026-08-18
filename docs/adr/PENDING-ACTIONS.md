# Pending ADR actions — a working list, not a decision

**Nothing in this file has been applied. No ADR has been edited.** ADRs are immutable once accepted
(ADR-0001); research recommends and a human settles. This file consolidates every ADR action the
Phase 0 research recommends for *this* repository, ordered by how much downstream work each one
unblocks.

**Delete this file once its actions are applied.** It is scaffolding. Its content belongs in the
ADRs it names; leaving it behind creates a second, drifting source of truth for decisions the
`docs/adr/` directory is supposed to own.

Provenance: [`../research/README.md`](../research/README.md) is the ledger; the reasoning and the
citations behind every line here live in
[`../research/findings-terminology.md`](../research/findings-terminology.md) and
[`../research/findings-visualisation.md`](../research/findings-visualisation.md). Citation numbers
in the draft bodies below refer to the REFERENCES section of whichever findings file the draft came
from, and must be re-numbered against the ADR's own reference list when the ADR is written.

---

## First: allocate the numbers, once

The two research rounds were written in parallel and both claimed 0017 onward. The terminology round
allocated 0017–0024; the visualisation round allocated 0020–0025 believing 0017–0019 were taken.
They also both proposed the *same* stack ADR under two numbers.

Recommended consolidated allocation — 13 new ADRs, 0017–0029, keeping the terminology round's block
intact because its own draft bodies cross-reference those numbers:

| Proposed | Title | Was, in the findings |
|---|---|---|
| **0017** | Stack: Preact for the view, `zod/mini` for the schema, explicit registries | terminology 0017 **and** visualisation 0020 — one ADR, not two |
| **0018** | Criteria carry a direction of preference, a declared range, and optional thresholds | terminology 0018 |
| **0019** | Dominance semantics over incomplete and mixed-level data | terminology 0019 |
| **0020** | Two kinds of weight, never one field | terminology 0020 |
| **0021** | Disclosure is orthogonal to presence | terminology 0021 |
| **0022** | Agreement statistics: unit of analysis, and no threshold ever gates | terminology 0022 |
| **0023** | Rounds, attribution policy and feedback policy | terminology 0023 |
| **0024** | The disagreement encoding is a rater dot strip | terminology 0024 |
| **0025** | Seriation: algorithm, distance, and missingness policy | visualisation 0021 |
| **0026** | Views shipped in v1, and the ones deliberately declined | visualisation 0022 |
| **0027** | Matrix accessibility semantics | visualisation 0023 |
| **0028** | Non-colour channels: texture, forced colors, print | visualisation 0024 |
| **0029** | Accessibility acceptance criteria | visualisation 0025 |

Numbers in the working sections (`docs/research/sections/`) are **not** reserved and should be
ignored. Nothing in any recommendation depends on a number.

---

## The list

### Tier 1 — blocks Phase 1 (schema). Settle these before any schema code.

#### 1. New ADR-0018 — Criteria carry a direction of preference, a declared range, and optional thresholds

**Action:** new. **Why first:** ADR-0015's two flagship analyses — dominance and screening — are
*undefined* without a direction of preference, and the schema currently models a bare attribute. A
declared range is load-bearing three separate times. Every other Phase 1 field decision waits on
this one.

> # ADR-0018: Criteria carry a direction of preference, a declared range, and optional thresholds
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0003 adopted the word "criterion", which in the MCDA tradition it cites means an attribute
> *plus a direction of preference* [1, 4] — while the domain model describes a bare attribute. The
> gap is not cosmetic. ADR-0015's dominance analysis requires "performs at least as well as"
> [1 §4.5], which has no meaning without a direction; and its screening rule's "falls below"
> silently assumes higher-is-better on every criterion, which any cost column breaks. Separately,
> nothing in the schema declares the *range* a criterion is measured over, and three different
> mechanisms need one.
>
> ## Decision
> Each `(criterion, measure)` declares, beside its level of measurement:
>
> 1. a **`preference`** of `increasing` / `decreasing` / `target` / `ordered` / `none`. `none`
>    excludes the criterion from dominance, screening and the datum encoding, and **must be named in
>    the result wherever an analysis reports one**.
> 2. a **`range`** — required on ordinal, interval and ratio. It supplies the interval bounds for
>    dominance over missing cells (ADR-0019); it is the *declared* normalisation that keeps weighted
>    sum free of the rank reversal that afflicts relatively-normalised methods [28]; and it is the
>    range without which an elicited weight has no meaning [34].
> 3. optional **`indifference`** (`q`) and **`preferenceThreshold`** (`p`), adopting the
>    ELECTRE/PROMETHEE names and semantics [24, 26], interpreted by the criterion's level: a count of
>    levels on ordinal, a quantity in the criterion's units on interval/ratio, invalid on nominal.
>
> `direction` is deliberately **not** a field of `range`: it would duplicate `preference` and the two
> would drift.
>
> An aggregation **refuses to run** over a criterion with no declared range rather than substituting
> observed extrema. That refusal is the value of shipping it.
>
> ## Consequences
> Authoring a criterion costs two more fields, and a criterion that means nothing directional (a
> descriptive column) has to say so explicitly. In exchange, dominance, screening, the datum
> encoding and normalisation all become well-defined, and the tooling can decline an illegal
> operation with a specific reason instead of producing a plausible wrong number.
>
> ## Alternatives considered
> - *Infer direction from the criterion name or from data.* Guessing the sign of "cost" is exactly
>   the failure this ADR exists to prevent.
> - *Normalise against observed extrema instead of a declared range.* This is what makes methods
>   rank-reversal-prone [28]; adding an alternative would silently move every other score.
> - *Put `direction` inside `range`.* Two sources of truth for one fact.

#### 2. New ADR-0019 — Dominance semantics over incomplete and mixed-level data

**Action:** new. **Why:** ADR-0015 names Pareto filtering as "the strongest defensible reduction
available", and the obvious implementation of it over a matrix with missing cells is provably
broken. This is the single easiest way to implement ADR-0015 incorrectly while believing you
followed the research.

> # ADR-0019: Dominance semantics over incomplete and mixed-level data
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0009 guarantees that cells are missing, with a reason. The published incomplete-data skyline
> rule — compare two alternatives only on the criteria both have — is non-transitive, admits cycles,
> and can report that *every* alternative is dominated [32, 51]. It was reproduced numerically
> (~1,900 transitivity violations and ~69 three-cycles per 200,000 random triples). The same defect
> appears in the innocuous-looking rule "drop a criterion from the comparison when one side is
> `not-applicable`", which is the same rule wearing a different hat.
>
> ## Decision
> Every cell becomes an interval. An observed value gives `[v, v]`; a contingently missing value
> gives the criterion's declared range (ADR-0018) [50]; a structurally missing value leaves the
> comparison altogether.
>
> - `a` **necessarily dominates** `b` iff `lo_a[j] >= hi_b[j]` on every criterion in the comparison
>   basis, with strict inequality somewhere.
> - `a` **possibly dominates** `b` iff `hi_a[j] >= lo_b[j]` with strict inequality somewhere [44].
>
> Necessary dominance is a strict partial order (verified: 0 violations, 0 cycles over the same
> 200,000 triples). Possible dominance is not transitive and is used only as a filter, never to build
> a front.
>
> **The comparison basis is the set of criteria applicable to every alternative in the current
> scope, and it is named in every result** — "dominance computed over the 9 criteria applicable to
> all 12 options; 3 excluded as inapplicable". A per-pair basis reintroduces exactly the
> non-transitivity this ADR exists to avoid. The natural scope is an alternatives group, where
> group-pair inapplicability makes applicability homogeneous; this makes ADR-0008's grouping
> load-bearing for ADR-0015's flagship analysis.
>
> Results have three tiers: dominated, provisionally surviving, robustly non-dominated. The gap
> between the necessary and possible sets is reported as a measure of what the missing data costs the
> decision, together with a value-of-information ranking of which blank to fill first (a deliberately
> crude pair-counting proxy for an expected-value-of-information calculation we are not doing).
>
> Nominal criteria, criteria with `preference: none`, and criteria with no declared range are
> excluded by construction and reported. `explainDominance(a, b)` may report a per-pair comparison
> — "at least as good on 9 of 12; 3 not applicable" — as an **explanation**, never as an input to
> the front. A per-criterion indifference tolerance ("practical dominance") is supported as an
> explicitly labelled relaxation which **must report cycles** rather than assume acyclicity, because
> strict dominance "is rare" [1 §5.5.2.1] and will otherwise usually return nothing.
>
> The algorithm is the naive O(n^2 * m) pairwise scan, chosen because it produces the full pairwise
> relation the view needs in order to explain *why* an alternative was set aside, and because at
> ADR-0002's stated scale it costs microseconds.
>
> ## Consequences
> The front is harder to compute and honest about what it does not know. Users see two tiers rather
> than one clean answer, which is the correct representation of a matrix with gaps. Grouping becomes
> a prerequisite for the flagship analysis rather than a convenience.
>
> ## Alternatives considered
> - *Compare on commonly-known criteria.* Forbidden: non-transitive, cyclic, can empty the front.
> - *Impute missing cells and compute one front.* Produces a confident answer from data we do not
>   have; contradicts ADR-0009's whole premise.
> - *Refuse dominance on incomplete matrices.* Would disable the analysis on essentially every real
>   comparison.

#### 3. ADR-0009 — amend

**Action:** amend. **Why:** the reason codes are Phase 1 schema content, they are an input to the
seriation distance, to completeness reporting and to the agreement mapping, and they are what
`rubricator`'s prompts instruct an agent to emit. Renaming later is a migration through every stored
analysis *and* a prompt change in the companion repo.

The amendment: rename `pending` -> `deferred` and `unknown` -> `indeterminate` (in HL7/FHIR the bare
word is the branch *root*, i.e. the catch-all ADR-0009 exists to abolish); add `not-evidenced`;
replace the closed-set-versus-extensible tension with a flagged-and-parented model where every code
declares `broader` into a closed core plus mandatory `structural` and `terminal` flags, so no code
in the system ever `switch`es on a literal code; key completeness exclusion on the `structural` flag
rather than on the literal `not-applicable`; specify the five counts and three rates
(`assessedRate`, `settledRate`, `silenceRate`), always as a fraction, never a bare percentage;
declare a precedence so a group-pair inapplicability rule beats an author-set contingent code; and
record MCAR/MAR/MNAR as *rationale for never imputing by default*, never as stored schema content.

Add nothing view-side here — the glyph-per-reason-code requirement belongs in new ADR-0028.

#### 4. New ADR-0017 — Stack: Preact for the view, `zod/mini` for the schema, explicit registries

**Action:** new. **Why here rather than at Phase 3:** it names the library the Phase 1 schema is
authored in, and it forbids a module pattern (self-registration) that is easy to adopt in Phase 1
and expensive to unwind later.

> # ADR-0017: Stack — Preact for the view, `zod/mini` for the schema, explicit registries
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0013 makes a single self-contained HTML file a first-class output, and that file is mailed and
> opened over `file://`, where no transport compression applies and mail encoding adds roughly 33%.
> **Raw bytes are therefore the governing figure**, not gzip. Measured on one machine with one
> bundler on one day: React 19 plus `react-dom/client` is 193,327 raw bytes for a trivial component
> against Preact 10 plus hooks at 12,781; the classic Zod `z` namespace barrel is 310,946 raw against
> `zod/mini`'s 15,250. Separately, a self-registering module pattern was demonstrated to break under
> `"sideEffects": false` — esbuild deleted a self-registering encoding module *from the bundle that
> needs it*, shipping an empty registry with no error.
>
> ## Decision
> The view is built on **Preact**; `preact/compat` remains an escape hatch at +5,810 raw. The runtime
> schema is authored in **`zod/mini`**. **JSON Schema emission is a Node-only build step** — the
> classic Zod import that provides `toJSONSchema` costs 61.8 kB gzip / 310.9 kB raw and must never
> appear in a browser entry point, enforced by an ESLint `no-restricted-imports` rule.
>
> **Registries are populated explicitly by the composition root.** Encodings, analyses and adapters
> are plain named exports; no module registers itself at module scope. This is a correctness
> requirement under `"sideEffects": false`, demonstrated, not a style preference.
>
> `comparanda/react` is not published in v1; the public mounting contract is
> `mountMatrix(el, props) => { update, destroy }`.
>
> The standalone build is Vite plus `vite-plugin-singlefile`, with the analysis inlined as
> `<script type="application/json">` and a CSP meta tag (`default-src 'none'; connect-src 'none'`)
> that makes ADR-0013's no-network property browser-enforced. The zero-network check fails the
> **build**, not only CI.
>
> ADR-0005's condition of acceptance is verified met, so the package is not split.
>
> ## Consequences
> The mailed artifact starts from a ~50 kB dependency floor rather than a ~500 kB one, which is the
> difference between a file that survives a mail gateway and one that does not. The cost is a smaller
> ecosystem than React's and a hard rule about registries that every contributor must know. Set a
> byte budget at Phase 3 (suggested 200 kB raw excluding the analysis payload) and fail CI on it, so
> the number is discovered under pressure rather than late.
>
> ## Alternatives considered
> - *React.* 15x the raw bytes for the same trivial component, against the one constraint that
>   governs the artifact.
> - *Svelte or Solid.* Not measured, and no primary comparable figure was located; both plausibly
>   land near Preact, and the compiler-coupling argument is expected to decide it regardless — but
>   that expectation is reasoning, not evidence.
> - *Classic Zod in the browser.* 20x the raw bytes for a capability only the build step uses.
> - *Self-registering modules.* Demonstrated to be deleted by the bundler.

#### 5. New ADR-0021 — Disclosure is orthogonal to presence

**Action:** new. **Why:** it is a schema-shape decision. If `withheld` exists only as a missingness
reason, rendering a redacted view requires *destroying data*, and an aggregate computed for a
restricted reader silently depends on values that reader cannot see.

> # ADR-0021: Disclosure is orthogonal to presence
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> A value may be present in the authoring store and withheld from a particular reader. ADR-0009 puts
> `withheld` in the missingness reason set, which conflates "there is no value" with "there is a
> value you may not see". SDMX keeps these apart deliberately, as `CONF_STATUS` beside `OBS_STATUS`
> [38, 39].
>
> ## Decision
> Model disclosure as an orthogonal, **view-time** property of a value, so redaction is a
> **projection** rather than an edit. `withheld` remains in the reason set, because it genuinely is
> the reason a reader sees nothing.
>
> A reader without access computes dominance over the **widened** interval (ADR-0019) and is
> **told**: "computed with 3 cells withheld from you". Two readers with different access may
> legitimately see different fronts. That is the honest outcome — provided the difference is
> announced rather than discovered.
>
> ## Consequences
> Redaction never mutates the analysis, so an owner and a reviewer read the same document. Every
> analysis result must carry a count of cells widened by disclosure, and the view must surface it.
> Aggregates over partially-disclosed data are labelled, or suppressed.
>
> ## Alternatives considered
> - *`withheld` as a missingness reason only.* Requires destroying data to render a restricted view.
> - *Deriving `withheld` entirely at render time and removing it from the reason set.* More correct
>   and more work; revisit if no deployment needs an analysis in which nobody may store the value.

#### 6. New ADR-0023 — Rounds, attribution policy and feedback policy

**Action:** new. **Why:** roughly fifteen optional schema lines now, versus a migration through every
stored analysis later, because round boundaries would otherwise have to be inferred from timestamps.
It also reconciles a real tension inside ADR-0011.

> # ADR-0023: Rounds, attribution policy and feedback policy
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0011's multi-rater loop — rate, discuss, revise — is close to the Delphi method, and ADR-0011
> point 7 requires that "activity is legible". The best-evidenced structural claim in the Delphi
> literature is that round-one rating should be **anonymous**, to reduce inhibition [65]; the
> RAND/UCLA design has round-one ratings made individually with no interaction among panellists, and
> round-two feedback that is distributional and personal but not attributed [66]. Legible activity
> and anonymous round-one rating are in direct tension as stated.
>
> ## Decision
> A `round?: RoundId` on every assertion, plus a small `rounds` collection, enters the schema in
> **Phase 1** — optional, and free for a single-round analysis. Each round declares:
>
> - an `attribution` policy: `attributed` | `blind-until-close`;
> - a `feedback` policy: `none` | `distribution` | `distribution-and-rationales`.
>
> **The author is always stored; the view redacts until the round closes.** ADR-0011 point 7 is
> qualified by round scope, not withdrawn.
>
> Stopping is a stability **trace**, not a consensus threshold: consensus is assessed *within* a
> round and stability *between* rounds, and the literature has no agreed stopping criterion [65]. The
> between-round statistic is churn and must never be conflated with alpha (ADR-0022).
>
> v1 stores the field, computes the trace, and redacts by policy. Round locking, deadlines and
> transition workflow are deliberately out of scope and can be added later without a migration —
> which is the entire point of adding the field now.
>
> ## Consequences
> Multi-round elicitation becomes possible without a schema change, and the anonymity requirement is
> a policy on data rather than a feature of one UI. The cost is that the view must know how to redact
> an author it can see, which is a rule that has to be enforced in one place and tested.
>
> ## Alternatives considered
> - *Infer rounds from timestamps.* Fragile, and unrecoverable once assertions interleave.
> - *Add rounds in Phase 4 when multi-rater ships.* A migration through every stored analysis.
> - *Anonymise by not storing the author.* Destroys attribution, which ADR-0012 requires.

#### 7. New ADR-0020 — Two kinds of weight, never one field

**Action:** new. **Why:** a field-naming decision that is nearly free in Phase 1 and a migration
afterwards.

> # ADR-0020: Two kinds of weight, never one field
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> "Weight" names two different quantities in the MCDA literature. A compensatory
> **substitution weight** is a scaling constant tied to a criterion's range and is meaningless
> without it [34]. An outranking **voting weight** is voting power, explicitly "not ... substitution
> rates", and is independent of the range and encoding of the scale [24]. They have different
> elicitation procedures and different failure modes.
>
> ## Decision
> Name them separately in the schema. Ship `substitutionWeight` only for now, but name it explicitly
> so `votingWeight` can be added later without a migration. A `substitutionWeight` is invalid on a
> criterion with no declared range (ADR-0018). If weights are ever elicited in the product, elicit
> them from choices rather than from numbers [90].
>
> ## Consequences
> One more word to type, and it becomes impossible to elicit one quantity and consume it as the
> other — which a single `weight` field guarantees somebody eventually does.
>
> ## Alternatives considered
> - *A single `weight` field.* The failure mode is silent and produces a plausible ranking.

#### 8. ADR-0015 — amend

**Action:** amend. **Why:** it contains one factual error and is the specification for most of Phase
2. Depends on ADR-0018 and ADR-0019 being settled first.

- **(a) Correct the ELECTRE claim.** The veto-criterion-with-a-threshold is a **conjunctive
  (non-compensatory) screening rule** [36], not ELECTRE's `v_j`, which thresholds a *pairwise
  difference* [24]. Rename the field `acceptability`; reserve `veto` for the ELECTRE sense.
  *(See the citation caveat at the end of this file before amending on the strength of [24]'s
  wording.)*
- **(b)** Dominance is necessary/possible over interval completions and the common-dimensions rule is
  forbidden — defer to new ADR-0019.
- **(c)** Support a per-criterion **indifference tolerance** (practical dominance), because strict
  dominance "is rare" [1 §5.5.2.1].
- **(d)** Add the **coverage gate**: point aggregate at 100% weight coverage, interval aggregate down
  to 2/3 [49], dominance and completeness only below that. Weight renormalisation **is** mean
  imputation and must be labelled as such [48, 49].
- **(e)** Add **value-of-information ranking** of missing cells as a shipped analysis.
- **(f)** Add `findNonDiscriminatingCriteria`. Record that **even-swaps is rejected** — experimentally
  path-dependent [13], requires cardinal tradeable scales, and mutates cells — while shipping its two
  useful by-products.
- **(g)** Add the **datum-relative** analysis (Pugh): better/same/worse counts against a chosen
  alternative, four separate counts, **never a net**, because a net is a compensatory aggregate over
  ordinal comparisons [2, 11]. Legend copy must say what it is not.
- **(h)** Sensitivity analysis must include an **add/remove-an-alternative** perturbation [28, 91].
- **(i)** Agreement statistics are reported, never enforced, and a single matrix-wide agreement
  number is not a legal output.
- **(j)** Name the views that realise the analyses (`ParetoScatter`, `RankFlow`), and require a
  two-criterion frontier to be labelled as **partial**.

#### 9. ADR-0003 — amend

**Action:** amend. **Why:** it is the vocabulary the whole repo and `rubricator`'s prompts are
written in, and one of its justifications is the weakest available one.

- Drop "**decision matrix**". Document the grid as **performance matrix** (MCDA) / **consequence
  table** (decision analysis) [1, 8]; keep `matrix` as the internal key.
- Record that the **default display alias for alternatives is "options"** [1, 5, 7, 15].
- Replace "averaging a 1–5 rating is a category error" with the two-part argument: Stevens's
  invariance [16], recorded fairly as **contested** [17, 18, 19], **plus non-compensation** [24],
  which nobody disputes and which is the argument that actually carries the no-total-column stance.
- Note that decision 2 (measures versus encodings) has now paid for itself four times over: the
  datum, missingness, disagreement and consensus-suppressed encodings all cost zero schema.

### Tier 2 — blocks Phase 2 (core logic).

#### 10. ADR-0006 — amend

**Action:** amend. **Why:** factually wrong as written, and it is the port every adapter is built
against.

There is no key-value "zodal store". `@zodal/store` provides `DataProvider<T>` (collection CRUD).
Restate the port in those terms and model the analysis as a degenerate one-item provider. Add that
**`getCapabilities()` is the single source of truth for what the UI offers** — it is exactly the
graceful-degradation mechanism ADR-0013 asks for and does not name. Keep the fallback chain, the
feature-detected `localStorage` write, the visible in-memory notice and the migration harness
unchanged; only the port's shape is wrong.

#### 11. New ADR-0022 — Agreement statistics: unit of analysis, and no threshold ever gates

**Action:** new. **Why:** it settles what ADR-0011 point 4 left as "confirm in research", and it is
~80 lines of `core` with a golden fixture.

> # ADR-0022: Agreement statistics — unit of analysis, and no threshold ever gates
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0011 requires an agreement statistic and names Krippendorff's alpha, pending confirmation.
> Alpha was confirmed by reproducing Krippendorff's own published example numerically
> (0.7434 / 0.8154 / 0.8491 against published 0.743 / 0.815 / 0.849) [54]. Two traps surfaced:
> alpha computed *per cell* over two to five assertions has nothing to chance-correct, and the
> published interpretive bands exist to certify a coding instrument — a purpose comparanda does not
> share, since its thesis is that disagreement is a finding.
>
> ## Decision
> Krippendorff's alpha is the coefficient — any number of observers, any level of measurement,
> incomplete data, small samples [54] — computed **per criterion, over alternatives as units**, never
> per cell. Always reported with a jackknife interval [63].
>
> Per cell, report the **shape** instead: `n`, the level multiset, `min`, `max`, `span`, mode(s), a
> `polarised` flag, and optionally van der Eijk's A — which must never be displayed without `n`,
> because it is a shape statistic that does not know the count [72, 74].
>
> **No threshold gates, warns on, suppresses or excludes anything.** The 0.800 / 0.667 bands are
> displayed with their source and act on nothing. A single matrix-wide agreement number is not a
> legal output.
>
> Implementation is owned in `core` and gated on Krippendorff's published dataset C as a golden
> fixture, because that is the fixture a mature library got wrong [62]; no npm implementation is
> worth depending on [64]. The missingness-to-alpha mapping is the table in the findings: structural
> absence is excluded entirely, and `not-evidenced`, `indeterminate` and `withheld` are absent but
> **counted separately**, because a searched-and-silent cell, an assessor who could not determine, and
> a cell a reader may not see are three different observations and none of them is a point on the
> ordinal scale.
>
> ## Consequences
> The number that appears is defensible and small in scope. Users who want "the agreement score" for
> the whole matrix are told why there isn't one. Rejected: Cohen's kappa (two raters, prevalence
> paradox [57]), Fleiss's kappa (equal rater counts, nominal), ICC (assumes interval [60]);
> Gwet's AC2 is offered as a labelled secondary for skewed criteria only, never as "the" number,
> because it has no published interpretive scale [58]. Tastle and Wierman's consensus measure is
> rejected outright because it internally averages the ordinal codes [75, 76].
>
> ## Alternatives considered
> - *Per-cell alpha.* Nothing to chance-correct at n <= 5.
> - *Gate the analysis on an alpha threshold.* Would suppress precisely the cells this tool exists
>   to surface.

#### 12. New ADR-0025 — Seriation: algorithm, distance, and missingness policy

**Action:** new. **Why:** ADR-0008 names seriation as a first-class action without naming an
algorithm. This is a `core` analysis with no DOM, so it belongs to Phase 2 rather than Phase 3.

> # ADR-0025: Seriation — algorithm, distance, and missingness policy
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0008 correctly identifies reordering as Bertin's reorderable matrix and its algorithmic form as
> seriation, and leaves the algorithm open. Our matrices are small (tens by tens), so the fast
> approximation is not required; and ADR-0009 guarantees missing cells, which disqualifies a whole
> algorithm family.
>
> ## Decision
> **One** automatic ordering ships: **optimal leaf ordering over agglomerative hierarchical
> clustering of a missingness-aware Gower distance, applied to each axis independently** [9, 10],
> with plain single-criterion sort implemented as the same code path. Linkage is chosen by running
> `single`, `average` and `complete` and keeping the lowest Hamiltonian path length, below a
> configurable size limit.
>
> Ordinal levels are scored by their **declared** level index normalised to [0,1] — never by sample
> rank, because rank makes a pair's distance depend on which third alternative happens to be present.
> The resulting equal-spacing assumption is stated in the UI alongside the order and is **not** a
> licence to average scores anywhere.
>
> Missing cells enter Gower's delta mechanism [8]: structural absence counts as agreement when both
> agree and as maximal difference when one has a value; contingent absence is skipped. A `minOverlap`
> guard excludes and *visibly parks* any alternative with too few comparable criteria.
>
> **The eigen-based families — spectral, metric MDS, PCA — are rejected outright**, not on speed but
> because missing values can cost the similarity matrix its positive semi-definiteness [8], and
> ADR-0009 guarantees missing cells.
>
> Manual and automatic reordering are **one feature, not two**: pins and locked runs are *inputs* to
> the algorithm (distance inflation; collapse-and-re-expand), never post-hoc overrides. Never seriate
> on load. View state records `AxisOrder = { order, provenance, constraints }`, because a bare
> permutation cannot distinguish "seriated" from "hand-arranged".
>
> ## Consequences
> One algorithm to implement, test and explain. The UI can always answer "why is it in this order",
> and a user's manual adjustment survives a re-run because it is an input. The cost is O(n^3) optimal
> leaf ordering, which ADR-0002's scale cap makes affordable and which must be re-examined if that cap
> ever moves.
>
> ## Alternatives considered
> - *Spectral ordering.* Fast, standard, and unsound on a matrix with missing cells.
> - *Several algorithms with a picker.* Multiplies the explanation burden without changing what a
>   small ordinal matrix needs.
> - *Automatic ordering as a mode that overrides manual drags.* Fights the user; contradicts Bertin.

### Tier 3 — blocks Phase 3 (view) and Phase 5 (standalone build).

#### 13. ADR-0010 — amend

**Action:** amend. **Why:** it is the encoding specification, and one of its clauses is a correctness
bug rather than a style question.

- **(a)** Add `missingness`, `datum`, `disagreement`, `disagreement-spread` and
  `consensus-suppressed` to the shipped encodings.
- **(b)** Name the VSUP tree parameters and adopt an **ordinal merge tree** (9 colours for 5 scores x
  3 confidence levels) rather than uniform binning; record it as a deliberate deviation, within the
  paper's stated design space but not the thing that was tested [23].
- **(c)** Suppression targets the **theme surface**, not white — the reference implementation
  hardcodes `#fff`, which on a dark surface makes the least-trustworthy cells the brightest on the
  page. A second documented deviation.
- **(d)** Record the **reserved-channel rule**: texture is reserved for uncertainty and absence, never
  a general categorical channel. `texture` becomes a **required** field of an encoding registration
  and registration fails without it.
- **(e)** The value ramp reserves lightness headroom — a stated per-encoding exception to "sequential
  means one hue, light to dark", because the suppression channel *is* lightness.
- **(f)** Contrast: **gate on WCAG 2.x** (>=4.5:1 text, >=3:1 graphics), **tie-break on APCA**, and
  compute it as a **build-time palette test**, not a render-time computation. The palette is ~9
  colours x 2 themes plus a few overlays. An empty passing set is a palette bug fixed by moving the
  background, never a runtime fallback.
- **(g)** Record structural-is-absence-of-ink versus contingent-is-a-placeholder, and the
  dashed-versus-solid `terminal` border.
- **(h)** **Encodings are plain named exports registered explicitly by the composition root; no
  module registers itself at module scope.** Demonstrated: under `"sideEffects": false`, esbuild
  deleted a self-registering module from the bundle that needs it, shipping an empty registry with no
  error. This is a correctness requirement, not a preference.
- **(i)** Record what the blend actually buys, honestly. The originating study found **no** accuracy
  benefit over an ordinary bivariate map (F(1,70)=1.4, p=0.24); the measured effect is that readers
  avoided high-uncertainty options (KS D=0.5, p=0.03) and accepted worse expected value to do so
  (t=2.3, p=0.02), n=24, one synthetic task [23]. This **corrects BRIEF.md's** "the blended encoding
  is the one that changes minds" from a readability claim to a decision claim.

#### 14. New ADR-0027 — Matrix accessibility semantics

**Action:** new.

> # ADR-0027: Matrix accessibility semantics
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> A 22 x 12 matrix of interactive cells is 264 tab stops if built naively. The ARIA grid pattern
> collapses that to one, but published screen-reader compatibility testing shows `role="grid"` on a
> `<table>` announced correctly across NVDA, JAWS and VoiceOver while `role="grid"` on a `<div>` tree
> is where the documented failures live [42, 43, 44].
>
> ## Decision
> The matrix is a **real `<table>` carrying `role="grid"`** — not a `<div>` tree and not a plain
> table. Navigation uses **roving `tabindex`**, never `aria-activedescendant` [39], with the roving
> position persisted in view state.
>
> **No virtualisation in v1**, with a documented trigger at roughly 500 rows and an absolute rule that
> DOM order must equal visual order if it is ever added. `treegrid` is rejected because groups are
> many-to-many tags, not a partition (ADR-0008).
>
> A cell's measures are announced through **visually-hidden text inside the cell**, not `aria-label`
> and not a dynamically-changing description. **A missing cell announces its reason in words and is
> never silent.**
>
> Sticky headers use `position: sticky` on the `<th>`s with `border-collapse: separate` and
> `box-shadow` separators [45], and the scroll container carries `scroll-padding-*` equal to the
> sticky extents — omitting it fails SC 2.4.11 on the first arrow press [46].
>
> Disclosure has three tiers — cell, tooltip, side panel — with a hard boundary: **a tooltip may
> never contain focusable content** [47, 48]. Evidence links are focusable (ADR-0014), so they live
> in the panel, and the panel is therefore **load-bearing, not optional**. The panel is a non-modal
> `<aside role="complementary">`.
>
> Reordering has two routes on one handle: an explicit **move menu**, normative under SC 2.5.7 [38]
> and available to pointer users, and a grab mode binding `Space`/`Enter`, arrows, **`Tab`**,
> `Home`/`End` and `Escape` — never bare `Alt+Arrow`, which is browser Back/Forward on Windows and
> Linux. Every announcement comes from one `describeMove()` in `core`.
>
> ## Consequences
> The whole matrix is one tab stop and every operation has a keyboard route. The constraint that a
> tooltip carries no focusable content forces the detail panel into Phase 3 rather than Phase 4.
>
> ## Alternatives considered
> - *`role="grid"` on `<div>`s.* Maximum styling freedom, and where the documented failures are.
> - *A plain `<table>` with no grid role.* 264 tab stops.
> - *`aria-activedescendant`.* Focus and the announced position diverge.

#### 15. New ADR-0028 — Non-colour channels: texture, forced colors, print

**Action:** new.

> # ADR-0028: Non-colour channels — texture, forced colors, print
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> ADR-0009 requires missingness to be distinguishable without colour and ADR-0010 forbids colour
> alone, but neither says *which* channel carries the meaning. Under `forced-colors: active` a
> `background-image` computes to `none` unless it contains a `url()` [49], so gradient hatching and
> the colour ramp disappear **together** and the matrix renders as identical Canvas-coloured boxes —
> the exact failure both ADRs exist to prevent.
>
> ## Decision
> Every meaning-bearing non-colour channel is drawn in the **foreground**, as inline SVG with
> `stroke="currentColor"`, never as a `background-image`.
>
> Two distinct channels are maintained and **never overloaded**: hatch **density** (at most three
> levels, aligned to the encoding's uncertainty layers) carries confidence; glyph **shape** carries
> the missingness reason code, because shape has no degradation path. Every registered encoding must
> declare its `texture`; registration fails without it.
>
> A `@media (forced-colors: active)` block restores explicit cell borders, swaps the colour legend for
> a text legend, and uses system colour keywords. `print-color-adjust: exact` is a hint only [50], and
> the print stylesheet must be legible without it.
>
> Colour-vision-deficiency simulation runs in CI against a **rendered screenshot**, so the composited
> blend is what gets tested: Machado 2009 or Viénot 1999 for protan and deutan, **Brettel 1997 for
> tritan**, never the Coblis V1 matrices, always sRGB-decoded before the matrix is applied [53, 54, 55].
>
> Contrast thresholds are named constants: 4.5:1 for cell text, 3:1 for the texture stroke, borders,
> focus ring and any meaning-bearing glyph [52].
>
> ## Consequences
> The matrix stays readable in forced-colors mode, in greyscale print and under every simulated CVD,
> because the information was never in the background to begin with. The cost is that every encoding
> author must supply a texture, and the registration refuses without one.
>
> ## Alternatives considered
> - *CSS gradient hatching.* Vanishes exactly when it is needed most.
> - *One channel carrying both confidence and missingness reason.* Two meanings, one visual variable,
>   guaranteed collision.

#### 16. New ADR-0029 — Accessibility acceptance criteria

**Action:** new. **Why:** BRIEF.md's "accessibility is not a later pass" is otherwise an aspiration
with no mechanism.

> # ADR-0029: Accessibility acceptance criteria
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> Three ADRs and the brief all state accessibility requirements. None of them fails a build.
>
> ## Decision
> The twenty automated checks and eight manual checks specified in the interaction research become a
> **merge gate**: the automated set must be green to merge; the manual pass runs once per release and
> is recorded in the release notes.
>
> The gate deliberately does not rest on axe-core, which catches a minority of real defects and is a
> floor rather than the value. The checks that carry it are the ones specific to this design: no cell
> announced as blank; every missing cell's text matching its reason code; keyboard reorder round-trips
> preserving focus; the `Tab` route producing the identical order; `Escape` restoring; focused edge
> cells not obscured by sticky chrome; zero focusable elements inside any tooltip; composited contrast
> per encoding per theme; forced-colors still showing numeral and glyph; no `background-image` used as
> a meaning-bearing channel; and zero network requests from the standalone bundle.
>
> ## Consequences
> Accessibility regressions become build failures rather than bug reports. Some checks require a real
> browser in CI, which is a slower pipeline and the price of the property.
>
> ## Alternatives considered
> - *A checklist in the contributing guide.* This is what "a later pass" looks like in practice.
> - *axe-core alone.* Green, and blind to every failure mode specific to this matrix.

#### 17. New ADR-0026 — Views shipped in v1, and the ones deliberately declined

**Action:** new. **Why:** the declines are the load-bearing half, and without a record they get
re-litigated every six months.

> # ADR-0026: Views shipped in v1, and the ones deliberately declined
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> The matrix's colour channel is among the least accurately decoded [14]. A secondary view therefore
> earns its place only by repairing a specific weakness of the matrix — not by being expected.
>
> ## Decision
> **Ship:** the matrix with seriation (ADR-0025); **small-multiple dot plots** with discrete labelled
> level ticks and an explicit missing lane per panel, which doubles as the multi-rater view; a
> **two-criterion scatter with a dominance overlay**, labelled as partial and carrying full-criteria
> dominance as a second mark channel; **rank-flow/slope**, gated behind ADR-0015's
> weighted-aggregation opt-in and captioned as a *stability* finding, never as a winner; and a
> **diverging stacked bar in the detail panel only** [18, 19].
>
> **Decline parallel coordinates for v1.** A 1–5 ordinal scale collapses every polyline onto five
> heights per axis, and PCP axis ordering optimises the *opposite* objective from matrix seriation
> [20], so shipping it means maintaining two conflicting orderings of the same criteria.
>
> **Decline radar outright, not with a caveat.** Its enclosed area is quadratic in the values; the
> same six-criterion profile spans **1.58x** in area across axis permutations with no change to the
> data [16, 17]; and it cannot render a qualified `missing` without reading "nobody has looked yet" as
> "worst possible", which ADR-0009 forbids. When radar is requested, answer the underlying question
> with the dot-plot small multiple.
>
> **If half the time were available:** ship the matrix, the dot panels and the Pareto scatter, and cut
> rank-flow and the detail-panel spread bar. Those three cover overview, value reading and reduction,
> which is the whole argument a comparison usually needs.
>
> ## Consequences
> A small, defensible set of views, each with a stated job. Users will ask for radar; this record is
> the answer, and it costs one link rather than one argument.
>
> ## Alternatives considered
> - *Ship radar with a caveat.* A caveat does not fix a quadratic area or an arbitrary axis order.
> - *Ship parallel coordinates anyway.* Two conflicting criterion orderings to maintain forever.

#### 18. New ADR-0024 — The disagreement encoding is a rater dot strip

**Action:** new. **Why:** it makes ADR-0011's "disagreement is an encoding" concrete, and it is the
one place a mean can sneak back in.

> # ADR-0024: The disagreement encoding is a rater dot strip
>
> - **Status:** proposed
> - **Date:** <date settled>
> - **Deciders:** <who>
>
> ## Context
> In a cell of roughly 40 x 30 px holding two to five assertions on a K-level ordinal scale, the
> design problem is not compression but **refusing to summarise**. ADR-0011 calls a cell where two
> experienced people scored 2 and 5 the most decision-relevant cell on the page, and a mean of 3.5 the
> one representation guaranteed to destroy that information.
>
> ## Decision
> Ship a **rater dot strip**: K fixed slots across the cell, one filled dot per assertion at its
> level, ties stacked; degrading to a range bracket below a configurable width, and to the spread ramp
> below a second threshold.
>
> It uses position along a common scale, the most accurately read channel [70]; `n` is **countable**
> rather than encoded; bimodality is a literal gap, so the most decision-relevant cell becomes the
> most visually distinctive with no statistic in the loop; **no mark sits where a mean would be**,
> meeting the requirement structurally; and its text alternative is the exact multiset, so "never
> colour alone" is satisfied trivially and it survives forced-colors, print and every colour-vision
> deficiency.
>
> Ship `disagreement-spread` as its zoom-out companion — a sequential ramp whose domain is a
> dispersion statistic **and nothing else** — and `consensus-suppressed` as a parameter change on the
> existing value-suppressing encoding [73]. The diverging stacked bar lives in the **detail panel
> only**, never in a matrix cell.
>
> ## Consequences
> Adding it costs an encoding registration, not a schema change (ADR-0003 decision 2 paying for itself
> again). Switching between the strip and the spread ramp must be one keystroke, because which one
> wins for the "find the contested cell" task is an open question.
>
> ## Alternatives considered
> - *Gradient or violin cells.* Displays of mean-and-error by construction [67]; a kernel density
>   estimate over three integers.
> - *In-cell diverging stacked bars.* Need a declared midpoint ADR-0010 forbids on ordinal data, and
>   an `n` we do not have.
> - *Jitter.* Random displacement carrying no information at n <= 5.

#### 19. ADR-0008 — amend (a human should consider supersede)

**Action:** amend, or supersede. **Why the choice matters:** both halves of its Decision section
change. Manual reorder and automatic seriation are **one feature** with constraints as algorithm
inputs, not two features that must not fight; and the `dnd-kit` recommendation is withdrawn. That is
substantive enough that a supersession may be more honest than an amendment. **Recommendation:
amend**, because new ADR-0025, ADR-0027 and ADR-0028 already carry the replaced substance and a
supersession would leave a mostly-empty ADR behind. The content is identical either way.

- Withdraw the `dnd-kit` recommendation: React-only, stable line unreleased since 2024-12-05,
  successor pre-1.0 for two years, and the premise is wrong — a drag library sells a pointer
  abstraction, never an accessible reorder [36, 37, 77].
- Upgrade "keyboard-accessible equivalent" to **keyboard-and-menu primary path**, citing SC 2.5.7 as
  **normative** [38]: a non-drag single-pointer route is a Level AA requirement, so the move menu must
  exist for pointer users too, not only for keyboard users. The pointer path is a thin second path
  over the same `core` `moveTo(axis, from, to)`, deletable without touching the keyboard path; adopt
  `@atlaskit/pragmatic-drag-and-drop` for it **only** when auto-scroll is needed (it is, in both
  axes), and charge it against the byte budget explicitly.
- Name **optimal leaf ordering** as the seriation default and defer the specification to ADR-0025;
  require pins and locked runs to be algorithm **inputs**.
- Add "arrange by similarity to this alternative" and `suggestGroups`, which **proposes and never
  writes**.
- Adopt `@zodal/groups-core` (`labels` profile) for grouping on both axes — many-to-many membership,
  nested trees, `scopeFilter`, fractional-index ordering per membership edge, 16.1 kB raw — and note
  the two gaps we fill ourselves: global axis order, and group-pair inapplicability.
- Add `transposed: boolean` to view state. Matrix orientation is unstandardised in the literature and
  our alternatives-as-rows convention is shared by only one of the sources surveyed [1].
- Record that dominance is computed **per group scope**, where applicability is homogeneous
  (ADR-0019).

#### 20. ADR-0013 — amend

**Action:** amend. **Why:** it turns a convention into a property the browser enforces.

Upgrade zero-network from a CI test to a **CSP-enforced property** baked into the artifact
(`default-src 'none'; connect-src 'none'`), plus the browser test — which must exercise the view and
assert no console errors — and a static grep. **The check runs in `comparanda build`, not only in
CI.** Name `getCapabilities()` as the graceful-degradation mechanism this ADR asks for and does not
name (ADR-0006). Record the **mail-gateway limitation**: enterprise mail filters can block `.html`
attachments by true type regardless of extension [93], and the CLI must say so rather than letting a
user discover it after sending.

#### 21. ADR-0007 — amend

**Action:** amend.

- **(a)** Order becomes `AxisOrder = { order, provenance, constraints }`. Dirty-state compares `order`
  and `constraints` and **ignores `provenance`** — otherwise re-running seriation to the identical
  order marks the view modified.
- **(b)** Add **locked** as a third view mode alongside personal and shared [79].
- **(c)** Add **per-dimension revert** — revert the order without reverting the grouping [86].
- **(d)** Add an ordered **sequence of saved views** as a narrative mode [87].

#### 22. ADR-0011 — amend

**Action:** amend. Phase 4, but the schema must accommodate it from Phase 1, which is why the anchor
model matters now.

- **(a) Anchors are tuples of stable opaque ids only** — never a position, never a label. Google Docs'
  own API disclaims its anchors [78], and Figma's name-and-hierarchy matching is the bug to avoid
  [86]. Entities carrying annotations are **tombstoned, never hard-deleted**; `supersededBy` handles
  splits; `repairHint` is stored but **never consulted** for resolution; orphaned annotations get a
  visible tray rather than silently disappearing [81, 82].
- **(b)** Point 4's agreement statistic is **per criterion, not per cell** — defer to ADR-0022.
- **(c)** Point 7's "activity is legible" needs the round-scoped qualification — defer to ADR-0023.
- **(d)** Fix the visual form of the `disagreement` encoding — defer to ADR-0024. Stacked bars never
  appear in matrix cells.
- **(e)** Add **bulk accept/reject** to suggestion mode [83].
- **(f)** Frame the disagreement *analysis* as Polis-style **group-informed consensus** [85, 95] —
  what do people who disagree elsewhere nonetheless agree on — distinct from the disagreement *glyph*.

#### 23. ADR-0014 — confirm, with two notes

**Action:** confirm. The span-not-document rule and the resolver indirection both hold up.

1. Evidence links are focusable and a tooltip may never contain focusable content, so **the detail
   panel is load-bearing rather than optional** — an architectural constraint, not a UI preference
   (ADR-0027).
2. Model embedded excerpts as zodal **content fields**, so the standalone-embedded versus
   resolver-fetched split falls out of existing bifurcation machinery rather than being special-cased.
3. Replace "an agent that cannot cite a span should be recording `unknown`" with the
   `not-evidenced` / `indeterminate` distinction (ADR-0009 amended), and state that **a `Missing`
   record may itself carry evidence references and provenance** — "we searched these three sources and
   none addresses migration cost" is a citable finding, not an absence.

#### 24. ADR-0005 — confirm, with a note

**Action:** confirm. Its stated condition of acceptance is **verified met**: subpath exports isolate
core-only consumers in every tested configuration, and nothing in the accessibility work required a
DOM API in `core`. Record the standing CI verification — esbuild `--metafile` input-path assertion,
per-fixture byte budgets, `publint` and `@arethetypeswrong/cli` on the tarball, and a no-DOM test
environment for `core`. The package is **not** split.

#### 25. ADR-0004 — confirm, with a note

**Action:** confirm. Schema-first on zodal is confirmed by reading the source. Add the note that
**JSON Schema emission is a build-time, Node-only concern**: the classic Zod import that provides
`toJSONSchema` costs 61.8 kB gzip / 310.9 kB raw in a browser bundle (ADR-0017).

#### 26. ADR-0002 and ADR-0016 — confirm; ADR-0012 — untouched

- **ADR-0002 confirm.** Strengthened, and its scale cap earned its keep twice: it is what licenses no
  virtualisation in v1 and what makes O(n^3) optimal leaf ordering affordable. A government
  methodology standard makes the stronger version of its case — "In a basic form of MCA this
  performance matrix may be the final product of the analysis" [1 §4.3.2] — and it is worth quoting in
  the README.
- **ADR-0016 confirm.** Untouched by this round. The examples it prescribes — the messy one in
  particular — are what several open questions propose to test against, so building it is now on the
  critical path for settling them.
- **ADR-0012** was not examined by this research round and carries no recommendation.

---

## Before amending ADR-0015 on the strength of a quotation

The ELECTRE chapter that the veto-threshold correction quotes is closed access and the copy the
wording was transcribed from is no longer online. The **substance** does not depend on it — the
q/p/v triple is independently attested and Roy's foundational paper is available — but ADR-0015
should not be amended *on the authority of a quotation nobody can currently check*. Either have
someone with library access re-verify the wording, or cite the foundational paper instead and drop
the quotation.

Two further sources could not be reached at audit time: the data-visualisation style guide behind the
texture-reservation rule (ADR-0028) and the ISO/IEC 25012 normative text (ADR-0009's completeness
wording). Both arguments survive without them. **No ADR should quote either.**
