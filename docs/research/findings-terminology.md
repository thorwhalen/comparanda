# Findings — terminology, measurement, missingness, agreement, prior art

**Deliverable for** [`terminology.md`](terminology.md) (research brief §§1–6).
**Synthesises** five working sections, which remain the evidence of record:

| § of the brief | Working notes | Evidence grade |
|---|---|---|
| §1 vocabulary | [c1 — MCDA vocabulary, Pugh matrices, consequence tables](sections/c1-terminology.md) | strong |
| §2–3 measurement and aggregation | [c2 — Levels of measurement, Likert averaging, aggregation](sections/c2-measurement-and-aggregation.md) | strong |
| §4 missingness | [c3 — Missingness vocabularies and incomplete matrices](sections/c3-missingness.md) | strong (rendering: moderate) |
| §5 multi-rater agreement | [c4 — Inter-rater agreement, Delphi, displaying disagreement](sections/c4-agreement.md) | strong (Delphi and encoding: moderate) |
| §6 prior art and the stack | [c8 — Prior art sweep, and the view framework](sections/c8-prior-art-and-stack.md) | strong (part B), moderate (part A) |

This document does not repeat the sections. It states what was decided, resolves the places where
two sections recommend incompatible things, and lists the ADR actions a human must settle. Claims
are marked **EVIDENCE** (literature, cited) or **(reasoning)** (inference from it). Nothing here
edits an ADR; ADRs are immutable once accepted.

---

## Summary of decisions

An implementer should be able to read only this table and start work.

| # | Question | Recommendation | Evidence | ADR action |
|---|---|---|---|---|
| 1 | Is "criterion" the right word? | **Yes, keep it** — and earn it by adding a direction of preference, which the word implies in the tradition we cite [1, 4] | strong | ADR-0003 confirm; new ADR-0018 |
| 2 | Is "decision matrix" the right name for the grid? | **No. Drop it.** Document the grid as **performance matrix (MCDA) / consequence table (decision analysis)** [1, 8]; keep `matrix` as the internal key | strong | ADR-0003 amend |
| 3 | What should the UI call alternatives? | Internal `alternatives`; **default display alias "options"** [1, 5, 7, 15] | strong | ADR-0003 amend |
| 4 | Do criteria carry a direction of preference? | **They must.** `preference: increasing / decreasing / target / ordered / none` per `(criterion, measure)`. Without it, dominance and veto screening are undefined [1 §4.5, 4] | strong | **new ADR-0018** (blocking) |
| 5 | Do criteria carry a declared range? | **Required** on ordinal/interval/ratio. It is load-bearing three times: dominance bounds, rank-reversal-free normalisation [28], and the range without which elicited weights are meaningless [34] | strong | **new ADR-0018** |
| 6 | Is "averaging a 1–5 rating is a category error" the right justification for no-total-column? | It is the **weakest** available one. Lead with **non-compensation** [24], which nobody disputes; keep Stevens [16] as secondary and record the robustness counter-case [18, 19] fairly | strong | ADR-0003 amend |
| 7 | Should we ship a total column? | **No default total.** Ship the **datum-relative encoding** (Pugh) instead: better/same/worse against a chosen alternative, four counts, **never a net** [11] | strong | ADR-0010 amend; ADR-0015 amend |
| 8 | Even-swaps? | **Reject.** Experimentally path-dependent [13]; requires cardinal tradeable scales and mutating cells. Ship its two by-products: practical dominance and non-discriminating-criterion detection | strong | ADR-0015 amend |
| 9 | Is our "veto criterion with a threshold" ELECTRE's veto threshold? | **No — the ADR-0015 claim is factually wrong.** ELECTRE's `v_j` bounds a *pairwise difference* [24]; ours is an absolute floor, i.e. **conjunctive (non-compensatory) screening** [36]. Rename the field `acceptability`; reserve `veto` for the ELECTRE sense | strong | ADR-0015 amend |
| 10 | Which aggregation methods do we ship? | **Weighted sum only**, opt-in, normalised against *declared* ranges. Reject TOPSIS, AHP, PROMETHEE, ELECTRE III — all rank-reversal-afflicted or unusable at our elicitation cost [27, 28, 29] | strong | ADR-0015 amend |
| 11 | How is Pareto dominance defined over missing cells? | **Necessary / possible dominance over interval completions** [44], three tiers. The obvious "compare on commonly-known criteria" rule is **non-transitive and cyclic** and can empty the front [32, 51] | strong | **new ADR-0019** |
| 12 | Is strict dominance enough? | **No — it "is rare"** [1 §5.5.2.1] and will usually return nothing. Support a per-criterion **indifference tolerance** `q` (practical dominance), labelled, with cycle reporting | strong | ADR-0015 amend; new ADR-0019 |
| 13 | Are the five missingness codes right? | Close. **Rename `unknown` → `indeterminate`** (in HL7/FHIR the bare word is the branch *root*, i.e. the catch-all ADR-0009 exists to abolish [40, 41]), `pending` → `deferred`, and **add `not-evidenced`** | strong | ADR-0009 amend |
| 14 | Should the code set be extensible? | Yes — **open, but every code declares `broader` into a closed core plus mandatory `structural` and `terminal` flags** [39, 40]. No `switch` on a code anywhere | strong | ADR-0009 amend |
| 15 | Do we store MCAR/MAR/MNAR? | **No — category error as schema content** (no population, no sample, and we record the actual reason). **Cite it** as the reason the default is never to impute [45, 46] | strong | ADR-0009 amend (rationale) |
| 16 | May we aggregate over sparse data? | Only under a coverage gate: point aggregate at 100% weight coverage; **interval aggregate down to 2/3** [49]; below that, dominance and completeness only. **Weight renormalisation is mean imputation** and must be labelled as such [48, 49] | strong | ADR-0015 amend |
| 17 | How is completeness reported? | Five counts, three rates — **`assessedRate`, `settledRate`, `silenceRate`** — keyed on the `structural` flag, always as a fraction, never a bare percentage | strong (ISO wording caveated) | ADR-0009 amend |
| 18 | Krippendorff's alpha — confirmed? | **Yes, and it is per-criterion, never per-cell.** Reproduced against Krippendorff's own dataset (0.7434 / 0.8154 / 0.8491 vs published 0.743 / 0.815 / 0.849) [54]. No npm implementation is worth depending on [64] — own ~80 lines | strong | ADR-0011 confirm; **new ADR-0022** |
| 19 | Do agreement thresholds gate anything? | **Never.** Display the 0.800 / 0.667 bands, act on none of them — disagreement is a finding, not measurement error | strong (bands) + reasoning | **new ADR-0022** |
| 20 | Cohen / Fleiss / ICC / Gwet? | Reject Cohen (2 raters, paradox [57]), Fleiss (equal rater counts, nominal), ICC (assumes interval [60]). Offer **Gwet's AC2** as a labelled secondary for skewed criteria only — it has **no published interpretive scale** [58] | strong | new ADR-0022 |
| 21 | Per-cell disagreement statistic? | `n` + multiset + `span` + `polarised`, plus **van der Eijk's A** if a scalar is needed [72]. **Reject Tastle–Wierman**: it internally averages the ordinal codes [75, 76] | strong | new ADR-0022 |
| 22 | How is disagreement displayed? | A **rater dot strip** — K ordinal slots, one dot per assertion, ties stacked, **no mark at the centroid** — with a dispersion-only ramp as the zoom-out companion [70, 69] | moderate | **new ADR-0024** |
| 23 | Should rounds be schema data? | **Yes, in Phase 1.** ~15 lines; retrofitting is a migration through every stored analysis. Carries an **attribution policy** (`blind-until-close`) and a feedback policy | moderate | **new ADR-0023** |
| 24 | Is "activity is legible" (ADR-0011 §7) safe? | Not for round-1 rating. Anonymous rating is the best-evidenced structural claim in the Delphi literature [65, 66]. Author is always *stored*; the **view redacts until the round closes** | moderate | new ADR-0023 |
| 25 | Framework for the view? | **Preact.** Measured on one machine, same bundler, same day: React 19 = 193,327 raw bytes for a trivial component; Preact 10 = 12,781. Raw bytes govern, because the artifact is mailed and opened over `file://` | strong (measured) | **new ADR-0017** |
| 26 | Schema authoring? | **`zod/mini`** (15,250 raw vs 310,946 for the `z` barrel). **JSON Schema emission is a Node-only build step** | strong (measured) | new ADR-0017; ADR-0004 confirm+note |
| 27 | Does the persistence port exist as ADR-0006 describes? | **No.** There is no key-value "zodal store"; `@zodal/store` provides `DataProvider<T>` (collection CRUD). Its `getCapabilities()` is exactly ADR-0013's graceful-degradation mechanism and should be the single source of truth for editability | strong (source read) | ADR-0006 amend; ADR-0013 amend |
| 28 | `dnd-kit` for reorder? | **Withdraw the recommendation.** React-only, and drag libraries sell a pointer abstraction, not an accessible reorder [77]. Keyboard path is the reference implementation | strong | ADR-0008 amend |
| 29 | How are annotations anchored? | **Tuples of stable opaque ids, never a position, never a label.** Google Docs' own API disclaims its anchors [78]; Figma's name-and-hierarchy matching is the bug to avoid [86]. Tombstone, never hard-delete, anything carrying an annotation | strong | ADR-0011 amend |
| 30 | Self-registering encoding modules? | **Forbidden.** Demonstrated: with `"sideEffects": false`, esbuild deleted a self-registering module *from the bundle that needs it* — empty registry, no error | strong (demonstrated) | ADR-0010 amend; new ADR-0017 |
| 31 | Zero-network for the standalone bundle? | Upgrade from a CI test to a **CSP-enforced property** (`default-src 'none'; connect-src 'none'`) baked into the artifact, checked in `comparanda build` and not only in CI | strong | ADR-0013 amend |
| 32 | Anything else about the mailed file? | Yes, and it is not about size: enterprise mail filters can block `.html` attachments by true type regardless of extension [93]. The CLI must say so | strong | ADR-0013 amend |

Three findings block Phase 1 schema work: **#4** (direction of preference), **#5** (declared range),
and **#11** (dominance semantics). Nothing in ADR-0015 is implementable correctly without them.

---

## 1. Vocabulary — what we got right, what to rename

Working notes: [c1](sections/c1-terminology.md).

**Confirmed.** `alternatives`, `criteria`, `subject`, `measure`, `encoding`, `missing`, `cell`,
`matrix` all stand. The measures-vs-encodings split (ADR-0003 decision 2) is vindicated twice over
below — the datum encoding and three of the four new encodings cost zero schema.

**EVIDENCE — "criterion" is correct, and it obliges a schema change.** The UK government MCDA
manual settles the word directly: "In this manual we use the word criterion rather than attribute"
[1 §2.1]. But the divergence has a shape. "Attribute" belongs to the *measurement* question —
Keeney and Gregory define attributes as what measures the achievement of an objective [2], and
`MADM` is Hwang and Yoon's name for the discrete-alternatives case [3]. **"Criterion" belongs to
the *preference* question**: in the Roy tradition a criterion is an attribute *plus a direction of
preference*, and dominance-based methods make this operational — dominance exists only once "to
each attribute q ∈ Q there is associated a preference relation ≽q" [4 §3].

comparanda adopted the word "criterion" while modelling an attribute. That is the single most
important finding in this section, because ADR-0015 ships two analyses that are **not definable**
without a direction: dominance, which the manual defines as performing "at least as well as another
on all criteria and strictly better ... on at least one" [1 §4.5]; and veto screening, whose "falling
below a threshold" silently assumes higher-is-better everywhere. A cost criterion breaks it. See §2
for the merged field design.

**EVIDENCE — drop "decision matrix".** The manual's definitional sentence gives both surviving
names at once: "A standard feature of multi-criteria analysis is a performance matrix, or
consequence table, in which each row describes an option and each column describes the performance
of the options against each criterion" [1 §4.3.2]. The structured-decision-making community uses the
second name [8]; 1000minds uses the first [6]. "Decision matrix" is the outlier we adopted, it is
the popular-press term, and its most-read definition puts criteria on the **rows** — the transpose
of ours [10]. It also asserts the wrong thing: that the artefact *is* the decision, which ADR-0002
and ADR-0015 both deny. "Consequence table" says the cells hold consequences, which is exactly
ADR-0015's stance.

Two bonuses fall out. First, the manual explicitly blesses stopping at the table: "In a basic form
of MCA this performance matrix may be the final product of the analysis" [1 §4.3.2] — a government
methodology standard endorsing comparanda's default presentation, and the strongest external
validation of ADR-0015 available. Quote it in the README. Second, the SDM guidance says that
"there will normally be supporting information about every cell in the table", carrying context,
the significance of differences, and uncertainty [8]. **Per-cell justification plus evidence links
is the consequence-table convention, not a comparanda invention.** One deliberate departure to own:
SDM keeps uncertainty *out* of the cell and in the backing material; our blended encoding puts it
in the cell. That is a claim, and we should make it as one.

**EVIDENCE — orientation is genuinely unstandardised.** DCLG puts options in rows [1]; SDM [8],
Pugh [11, 12] and the popular definition [10] all transpose. Frey et al.: "The columns of the Pugh
matrix are labeled with a description ... of design concepts. The rows ... with concise statements
of the criteria" [11]. Pugh's reason is practical — a concept column needs vertical room for a
sketch — and it applies to anyone pasting a long justification into a cell (reasoning). Therefore
`transposed: boolean` belongs in view state next to row and column order. It is a pure render flip
over an orientation-neutral model and removes a class of "this tool is backwards" objection.

**EVIDENCE — Pugh's datum column is the missing feature, and it is free.** In Pugh Controlled
Convergence one alternative is designated the **datum** and every cell holds `+`, `−` or `S`,
meaning the concept is "clearly better than, clearly worse than, or roughly the same as the datum
concept as judged according to the criterion of that row" [11]. Frey et al. built executable models
and found "Pugh's method, under a substantial range of assumptions, results in better design
outcomes" than a single summary criterion or a Borda count [11].

Three things follow.

- **It is an encoding, not a measure.** It reads existing values and emits a mark; by ADR-0003
  decision 2 that is definitionally view-layer. Zero schema change.
- **It is the ordinal-legal substitute for the total column ADR-0015 forbids** (reasoning, on the
  domain model's own legality table): better/same/worse is a *ranking* comparison, and ranking is
  legal on ordinal data. It gives the reader the compressed at-a-glance reading a total is usually
  a bad proxy for, without committing the illegal operation.
- **Show four counts, never a net.** Frey et al. name the trap: the tallies "are sometimes
  interpreted as a means by which to choose the single winning design. This misconception is
  reflected in terminology — Pugh's method is most often referred to ... as 'Pugh Concept
  Selection' whereas Pugh emphasized 'Controlled Convergence'" [11]. A `net = plus − minus` field is
  a compensatory aggregate over ordinal comparisons wearing a disguise. If it exists at all it goes
  through ADR-0015's opt-in-and-labelled path.

Pugh also hands ADR-0009 external corroboration: his `S` is overloaded — it can mean the experts
agree the merit is similar, or that the difference "cannot be determined yet" — and Pahl and Beitz
proposed a distinct `i` or `?` symbol "to more strongly encourage investigation" [11]. **The cost of
an ambiguous blank is a documented defect of the most famous version of this tool, observed in 1984.**

**EVIDENCE — reject even-swaps.** The technique — a sequence of swaps that changes one
alternative on two criteria so as to leave it preferentially equivalent, until a criterion becomes
irrelevant or an alternative becomes dominated [9, 13] — is the distinctive contribution of the
accessible decision-analysis tradition we otherwise borrow from. Lahtinen and Hämäläinen ran experiments and found the method
path-dependent: "When the subjects go through the Even Swaps process and use money as the measuring
stick ... they end up favoring those alternatives which are good in the monetary attribute. When two
alternatives are compared such that the same alternative is modified in every swap, the subjects
favor the modified alternative" [13] — accumulated scale-compatibility and loss-aversion bias.
Beyond the bias, it needs cardinal tradeable values (illegal on most of our data), mutable
hypothetical alternatives, a recorded and replayable swap path, and the direction of preference we
do not yet have. Ship its two computational by-products instead: **practical dominance** [14] and
**detection of non-discriminating criteria** — the latter is exactly what the Pugh case study did
between rounds, dropping criteria "because they did not discriminate among the alternatives" [11].

**Product vocabulary.** The database/no-code tools have no decision vocabulary to borrow
(record/field, page/property, row/column) and confirm only that grid tools do not name the grid to
users. The decision tools split on one word: the specialist literature says *alternatives* [6, 8],
the user-facing material says *options* [1, 5, 7, 15]; CBA's own definition concedes it —
alternatives are "often called options" [5]. Hence: internal `alternatives`, default display alias
**"options"**, columns `criteria` with `factors` and `objectives` as alias presets, and the grid
aliased to something nobody has to learn ("comparison").

One hazard to document rather than "fix": *Choosing By Advantages* assigns these words incompatible
meanings — its **factor** is our criterion, its **attribute** is our cell value, and its
**criterion** is a decision rule closest to our acceptability threshold [5]. A CBA practitioner will
look for our columns under "factors". The alias mechanism handles it; the docs should name the
collision so nobody renames things to "correct" it.

---

## 2. Levels of measurement, and the averaging question

Working notes: [c2 Part A](sections/c2-measurement-and-aggregation.md).

**The position survives; its stated reason does not.** ADR-0003 says averaging a 1–5 rating is a
category error. That is the *weakest* available justification, and the research found the strongest
counter-argument to be genuinely compelling — and, on close reading, an argument *against* our total
column rather than for it.

**EVIDENCE — the counter-case, stated fairly.** Norman argues that "many studies dating back to the
1930s consistently demonstrate that parametric statistics are robust with respect to violations of
these assumptions" [18]. Carifio and Perla make the sharper point: the debate conflates a *response
format* with a *measurement scale*. Verbatim: "Many studies have shown that Likert Scales (as
opposed to single Likert response format items) produce interval data ... but not on an
item-by-item 'shotgun' basis, which is simply a current research and analysis practice that must
stop" [19]. They are explicit that a scale is an emergent property of "a minimum group of such
observations (i.e., 8 items at a minimum usually)" measuring one construct, on which reliability
and validity are established [19]; the follow-up restates the argument for a practitioner audience
[20]. Practitioner guidance already encodes the split: analyse a
Likert-type *item* with frequencies, mode and median; a Likert *scale* with mean and SD [22].

**Why it does not license a total column** (reasoning, on that evidence):

1. **We are not doing inference.** Norman defends the t-test, ANOVA and Pearson correlation over
   samples of respondents [18]. A total column is a descriptive statistic over ~12 numbers with
   n = 1. No sampling distribution exists, so "the F-test is robust" is not a claim about it.
2. **A row of criteria is not a scale, in exactly Carifio and Perla's sense.** A scale is ≥8 items
   deliberately written to measure *one* construct, and that redundancy is what makes the composite
   behave like an interval quantity [19]. comparanda's criteria are chosen to be **non-redundant**,
   and the whole point of the tool is that the shape across them carries information. Averaging them
   is the "shotgun" practice they say must stop, applied across *different* constructs.
3. **Averaging does not rescue it anyway.** Liddell and Kruschke demonstrate systematic inversions —
   "treating ordinal data as metric indicates the opposite ordering of means than the true ordering
   of means" — and state verbatim: "We demonstrate that averaging across multiple ordinal
   measurements does not solve or even ameliorate these problems", adding that "there is no
   sure-fire way to detect these problems by treating the ordinal values as metric" [21]. **The
   failure is silent. A tool cannot warn you when your mean is inverted.**
4. **The uncontested argument is non-compensation.** Set measurement theory aside entirely: a
   weighted sum is *fully compensatory* — a loss on one criterion is always redeemable by a gain on
   another. The outranking literature treats the unacceptability of that trade as one of the named
   conditions under which these methods are the right family, alongside the condition that actions
   are "evaluated (for at least one criterion) on an ordinal scale ... not suitable for the
   comparison of differences" [24]. Nobody in the Likert debate disputes this.

**Recommendation: amend ADR-0003 to a two-part argument** — Stevens's invariance [16], recorded as
contested [17, 18, 19], *plus* non-compensation [24], which is not. Make non-compensation
ADR-0015's primary justification.

**One affordance the item/scale distinction earns:** a criteria **group** may declare
`composite: true`, asserting its members measure one construct. A within-group mean is then the
composite case the literature actually defends, and the tooling may offer it without a warning
[19] (reasoning). Across groups, and across a whole row, it is not. This is sequenced after
multi-rater data exists, because endorsing a composite honestly needs a reliability statistic.

**EVIDENCE — how real tools communicate this: do not warn, gate.** Vega-Lite requires every encoded
field to declare a `type` and documents the consequence at the point of declaration — ordinal
"represents ranked order (1st, 2nd, …)" with no meaningful comparison of magnitude [23]. JMP
attaches a *modeling type* (Continuous, Nominal, Ordinal, None) to every column and surfaces it as a
clickable icon in the Columns panel, which then drives which analyses are offered [25]. The lesson:
**the level of measurement is a visible property of the column that silently changes the menu.** A
tooltip teaches; a modal on "Total" teaches nobody and gets dismissed.

### The merged field design (resolves a conflict — see §7, Conflict F)

c1 and c2 independently proposed overlapping and incompatible criterion metadata. Merged:

```ts
type Level = 'nominal' | 'ordinal' | 'interval' | 'ratio';

type Preference =
  | { kind: 'increasing' }                  // gain criterion: higher is better
  | { kind: 'decreasing' }                  // cost criterion: lower is better
  | { kind: 'target'; ideal: Value }        // closest to ideal is better
  | { kind: 'ordered'; best: Value[] }      // explicit order over nominal-looking levels
  | { kind: 'none' };                       // descriptive column; excluded from all screening

interface CriterionMeasureSpec {
  level: Level;
  preference: Preference;                   // default { kind: 'none' }
  range?: { lo: Value; hi: Value };         // REQUIRED for ordinal/interval/ratio
  levels?: readonly Value[];                // ordered levels, ordinal only
  indifference?: number;                    // q — steps on ordinal, units on interval/ratio
  preferenceThreshold?: number;             // p, reserved (PROMETHEE/ELECTRE sense)
  acceptability?: Value;                    // absolute floor for conjunctive screening (§3)
}
```

`direction` is **not** a field of `range`; it duplicates `preference` and the two would drift.
Validation rules, all cheap and all worth writing on day one:

- `level: 'nominal'` with `preference.kind === 'increasing' | 'decreasing'` is invalid — a nominal
  scale has no order to increase along. Use `'ordered'` or `'none'`.
- `preference.kind === 'none'` **excludes** the criterion from dominance, screening and the datum
  encoding, and the UI must name the excluded columns wherever it reports a result. A dominance
  claim computed over four of nine columns is a different claim.
- A criterion with no declared `range` is **refused** by weighted aggregation rather than silently
  normalised against observed extrema — that refusal is the whole value of shipping the aggregation
  at all (§3).

---

## 3. Aggregation and reduction — what to ship, and one factual correction

Working notes: [c2 Part B](sections/c2-measurement-and-aggregation.md), plus
[c3 §3](sections/c3-missingness.md).

### 3.1 ADR-0015's ELECTRE claim is wrong

**EVIDENCE.** ELECTRE's three per-criterion thresholds are `q` (indifference), `p` (preference) and
`v` (veto), with `q ≤ p ≤ v`. Figueira, Mousseau and Roy define the veto: "Veto thresholds express
the power attributed to a given criterion to be against the assertion 'a outranks b', when the
difference of the evaluation between g(b) and g(a) is greater than this threshold" [24 §2.4].

**`v_j` bounds a difference between two alternatives. ADR-0015 describes an absolute floor on an
alternative's own value.** These are different fields answering different questions:

| | Conjunctive screening (what ADR-0015 means) | ELECTRE's `v_j` (what it claims) |
|---|---|---|
| Operand | one alternative's own value | the difference between two alternatives |
| Question | "which alternatives are outright unacceptable?" | "is b's advantage on j so large that a's majority should not carry?" |
| Needs | one threshold per screening criterion | a full compensatory outranking construction |
| Established name | conjunctive / non-compensatory screening, Tversky's family [36] | veto threshold [24] |

The established name for what we actually built is a **conjunctive (non-compensatory) screening
rule** [36]. Rename the schema field **`acceptability`** and reserve `veto` for the ELECTRE sense;
"veto criterion" may remain a display alias. Note also (reasoning) that ELECTRE's veto is
**meaningless on top of Pareto dominance** — a dominating alternative is never worse anywhere, so
there is nothing for a veto to object to. This matters because it explains why we can adopt one and
not the other without loss.

Two things worth taking from ELECTRE regardless of rejecting the method: **`aRb` — incomparability
as a first-class outcome**, distinct from indifference, which is exactly what our dominance analysis
produces and should be rendered as itself rather than as a tie; and the fact that ELECTRE weights
are *voting power*, explicitly "not ... substitution rates as in compensatory aggregation
procedures" and independent of scale range [24]. That is the opposite of weighted-sum weights, which
is why **the two kinds of weight must never share a field name** (new ADR-0020).

### 3.2 Method-by-method verdicts

| Method | Assumes | Fails by | Ship? |
|---|---|---|---|
| **Weighted sum (SAW/WSM)** | interval-or-better on a common normalised scale; preferential independence; full compensation; weights as scaling constants tied to ranges | weights elicited without ranges are meaningless [34]; compensation hides shape [24]; rank reversal *if normalised relatively* [28]; silently wrong on ordinal data [21] | **Yes — the only one.** Opt-in, labelled, warns on ordinal criteria, normalises against **declared** ranges, and **refuses** if any participating criterion has no declared range |
| **TOPSIS** | meaningful Euclidean distance in normalised criterion space | rank reversal from the norm and from the ideal/anti-ideal choice; both relative and absolute normalisation affected [29] | No — strictly more assumption than weighted sum, for no extra insight |
| **AHP** | consistent pairwise ratio judgements on 1–9 | contested at the level of its axioms since 1990 [27, 91]; the most rank-reversal-afflicted method in a 130-article review [28]; and O(n²) pairwise judgements per criterion is unusable at our scale (reasoning) | No |
| **PROMETHEE** | a per-criterion preference function, up to three thresholds | rank reversal [28]; the six-function menu is an elicitation burden that gets defaulted away | No — but **steal the `q`/`p` vocabulary** [26] |
| **ELECTRE III** | `w`, `q`, `p`, `v` per criterion, a cutting level, a credibility index, distillation | high implementation and explanation cost; threshold choice is itself a research topic | No — ship the vocabulary and the concepts |
| **Pareto dominance** | only an order per criterion **and a direction** | strict dominance "is rare" [1 §5.5.2.1]; and the naive missing-data rule is cyclic [32] | **Yes — the default reduction** (§3.3) |
| **Sensitivity** | — | a one-at-a-time weight analysis understates joint sensitivity | **Yes, both**: closed-form weight-flip margin [33] and Monte-Carlo rank acceptability — the acceptability index and central weight vector are SMAA's [35], the per-rank indices are SMAA-2's [37] |

Do not export `topsis`, `ahp`, `promethee`, `electre`. If a consumer asks, the answer is
`paretoFront` + `weightedSum` + `rankAcceptability`, which dominates all four on assumptions per
unit of insight.

One addition prior art forces: if weighted aggregation is offered, the sensitivity analysis must
include an **add/remove-an-alternative perturbation**, because that is precisely the perturbation
the rank-reversal literature says breaks these methods [28, 91].

### 3.3 Dominance over incomplete data — the algorithmic core

**EVIDENCE — the obvious implementation is published, and broken.** Khalefa, Mokbel and Levandoski
give the standard incomplete-data definition — compare only on dimensions both points have — and
then prove it unusable: "incomplete data suffer from non-transitive dominance relation which may
lead to a cyclic dominance behavior", with a worked three-point counterexample in which
"none of the three points can be considered a skyline as all of them are dominated" [32]. The
skyline survey restates it and gives a second counterexample [51]. Reproduced numerically during
the research: over 200,000 random triples on a 1–5 ordinal scale with missing cells, the
common-dimensions rule produced ~1,900 transitivity violations and ~69 three-cycles.

**A tool whose flagship reduction can report that every alternative is dominated is worse than no
tool.** ADR-0015 currently calls this filter "the strongest defensible reduction available".

**EVIDENCE + reasoning — the fix.** Robust ordinal regression already supplies the shape: over a set
of compatible models, **necessary** weak preference holds "if and only if for all compatible value
functions a is preferred to b", **possible** weak preference "if and only if for at least one" [44].
Apply that split to missing *performance* data, using the standard device of substituting the
attribute range for a missing consequence [50]:

- every cell becomes an interval — an observed value gives `[v, v]`; a **contingently** missing
  value gives the criterion's declared `range`; a **structurally** missing value gives no interval
  at all and leaves the comparison (see Conflict G, §7);
- `a` **necessarily dominates** `b` ⟺ for every applicable criterion `j`, `lo_a[j] ≥ hi_b[j]`, strict
  somewhere. Holds under every completion;
- `a` **possibly dominates** `b` ⟺ for every applicable criterion `j`, `hi_a[j] ≥ lo_b[j]`, strict
  somewhere. Holds under at least one completion.

Necessary dominance is a strict partial order — if `lo_a ≥ hi_b` and `lo_b ≥ hi_c` componentwise
then, since `hi_b ≥ lo_b`, `lo_a ≥ hi_c` — verified by brute force over 200,000 random triples with
0 violations and 0 cycles. Possible dominance is *not* transitive (~5,600 violations, ~6,600 cycles
in the same run) and must be used only as a filter, never to build a front.

This yields three tiers rather than one, and the middle tier is the product:

| Tier | Definition | What the reader does |
|---|---|---|
| **dominated** | something necessarily dominates it | set it aside; no further work needed |
| **provisionally surviving** | not necessarily dominated, but possibly dominated | **these blanks are load-bearing** — filling them may eliminate it |
| **robustly non-dominated** | nothing even possibly dominates it | on the front whatever the blanks turn out to be |

**The gap between the two sets measures what the missing data is costing the decision** — and it
yields the best analysis in this whole report: for each contingently missing cell, count how many
possibly-dominated pairs would resolve if it were known. That is a **value-of-information ranking**
answering "which blank should we fill first?", it costs one extra pass, and no spreadsheet can do
it. Flag the deliberate crudeness: a proper treatment is an expected-value-of-information
calculation needing a prior over the missing cell, and we are choosing the cheap proxy knowingly.

**Algorithm.** The naive O(n²·m) pairwise scan. At our stated scale (ADR-0002: tens to low hundreds
of alternatives) that is ~1.2M comparisons at n = 200, m = 30 — microseconds — and it has the
decisive advantage of producing the **full pairwise relation**, which the view needs anyway to
explain *why* an alternative was set aside. Block-nested-loops and its descendants [31] exist for
disk-resident data and buy us nothing.

**Two exclusions by construction, both reported rather than silent.** Nominal criteria cannot
participate in dominance (there is no order to dominate along) and neither can criteria with
`preference.kind === 'none'` or no declared range. The result object names them.

**Practical dominance.** Strict dominance "is rare. The extent to which it can help to discriminate
between options and so to support real decisions is correspondingly limited" [1 §5.5.2.1]. Without
a tolerance, ADR-0015's flagship analysis will usually return "nothing is dominated" and look
broken. Support a per-criterion indifference tolerance `q` — on a 1–5 ordinal criterion, `q = 1`
says one step is noise — as an **explicitly labelled relaxation** that **reports cycles** rather
than assuming acyclicity, because the relaxed relation is not guaranteed to be a partial order.
Default `q = 0` (strict); raising it is a visible user act.

---

## 4. Missingness

Working notes: [c3](sections/c3-missingness.md).

**The five codes are ancestrally sound.** `not-applicable` is exactly Codd's I-mark [43] and HL7's
`NA` [40]; `not-assessed` is FHIR's `not-asked` [41]; `withheld` is HL7's `MSK`. Codd's 1986 paper
is titled, literally, *Missing information (applicable and inapplicable) in relational databases*
and distinguishes an A-mark (missing but applicable) from an I-mark (missing but inapplicable) [43].
**comparanda's structural-vs-contingent axis is forty years old and SQL's single `NULL` is the
counterexample.** ADR-0009 is not fussiness.

But there is one bad name and one substantive hole.

**EVIDENCE — `unknown` is a naming defect, not a nuance.** In HL7 v3, `UNK` ("A proper value is
applicable, but not known") is the *parent* of the whole not-known branch, whose leaves include
`ASKU` ("Information was sought but not found") and `NASK` ("This information has not been sought")
[40]; FHIR R4 flattens the same structure with `unknown` beside `asked-unknown` and `not-asked`
[41]. comparanda defines `unknown` as "someone looked and could not determine it" — that is `ASKU`,
a *leaf* — while using the word both vocabularies reserve for the catch-all. Anyone who has touched
a clinical, statistical or database schema will read `unknown` as the fallback and use it as one,
which is exactly the silent blank ADR-0009 exists to abolish (reasoning). The risk is highest in the
runtime where it matters most: an agent under instruction-following pressure reaches for the vaguest
legal code.

**The hole is `not-evidenced`** — "we searched the sources and they are silent on this". ADR-0014
currently routes this to `unknown`, collapsing two very different findings:

- *we searched and the sources do not address this criterion* — a fact **about the alternative and
  its documentation**, and frequently the finding itself;
- *we found material but could not resolve it to a score* — a fact **about the criterion definition
  and the evidence**, usually meaning the criteria discussion is not finished.

Split them. `not-evidenced` must be countable and encodable: a column of it down one alternative is
a finding about that alternative; a row of it across one criterion is a finding about the criterion.

**The recommended core set:**

| code | `structural` | `terminal` | `informative` | reads as |
|---|---|---|---|---|
| `not-applicable` | **true** | true | true | "correctly nothing" |
| `not-assessed` | false | **false** | false | "a gap" |
| `deferred` (was `pending`) | false | **false** | false | "a gap, on purpose, for now" |
| `not-evidenced` (**new**) | false | true | **true** | "we looked; the sources are silent" |
| `indeterminate` (was `unknown`) | false | true | true | "we looked; we could not tell" |
| `withheld` | false | true | false | "known, not shown here" |

**Extensibility, resolving ADR-0009's internal tension** ("closed, schema-declared set … and
analyses may extend it"). The set is **open, but every code — core or custom — is a first-class
object** declaring `broader` (an ancestor in the closed core, so an unknown code degrades
gracefully), `structural`, `terminal`, an advisory `informative`, and display fields. Two flags are
enough to drive every completeness computation and every rendering decision **without a `switch` on
the code**, which is what makes a downstream deployment's custom code unable to break the
completeness report. This is the "decomposition" answer SDMX itself judged strongest —
"Conceptually the 'Decomposition' approach is definitely the strongest of the two" — and rejected
only on implementation-cost grounds that do not apply to a greenfield schema [39]. Constraints:
`structural: true` requires `broader === 'not-applicable'`; no custom code may be a schema default;
codes travel inside the document so a standalone bundle needs no registry.

Also from SDMX: **declare a precedence.** A group-pair inapplicability rule can collide with an
author-set contingent code, and structural absence must win [39].

**EVIDENCE — MCAR/MAR/MNAR: a category error as schema content, load-bearing as rationale.** Rubin's
taxonomy classifies the *mechanism* generating missingness in a probabilistic model, to decide when
it is ignorable for likelihood-based inference about a population [45]. Every premise fails here:
alternatives are purposively chosen, not sampled; the matrix is one document authored once; there is
no estimator whose bias the classification characterises; and **we already record the reason
directly**. Asking an author to additionally classify a blank as MAR vs MNAR is asking for an
unfalsifiable claim about a data-generating process that does not exist (reasoning).

Cite it, though, in exactly one place — the point-of-use copy ADR-0015 requires: the sentence
justifying why the aggregation dialog defaults to "do not impute" is that imputation "require[s] a
missing at random mechanism", there is "no statistical test for NMAR and often no basis on which to
judge", and where the pattern is non-random it "must be explicitly modelled ... [which] could imply
ad hoc assumptions that are likely to influence the result of the entire exercise" [46].

The MNAR *insight* is nonetheless the most important idea in this area, and the engineering response
is the **missing-indicator method** — keep missingness as a first-class inspectable feature rather
than smoothing it away; recent theory finds it "improves performance for informative missing values"
and "does not hurt linear models asymptotically for uninformative missing values" [47]. Our three
equivalents: the `informative` flag, the `not-evidenced` code, and a **`missingness` encoding**
registered under ADR-0010 that colours the grid by reason instead of by measure.

**The trap in "just aggregate over what we have".** Renormalising weights across observed criteria
is mean imputation. COINr states it flatly: excluding an `NA` from a mean "is mathematically
equivalent to assigning the mean to that missing value ... This is sometimes known as 'shadow
imputation'" [48]. A live production index whose team "has always opted not to estimate missing
data" was audited as doing exactly this, so that "the available data (indicators) in the incomplete
pillar may dominate, sometimes biasing the ranks up or down" [49]. **ADR-0015's no-default-aggregation
stance does not by itself protect against this** — the opt-in path needs an explicit label saying
"this assumes each missing criterion performs at this alternative's average".

**The coverage gate.** Define **weight coverage** for an alternative as the sum of weights over
criteria where it has an observed value, divided by the sum over criteria **applicable** to it.

| weight coverage | what the tool offers |
|---|---|
| **1.0** | point aggregate (still opt-in, labelled, warned on ordinal data) |
| **≥ 2/3, < 1.0** | interval aggregate `[lo, hi]` only. No point value anywhere. Ranking only between non-overlapping intervals; overlapping pairs render "not separable on the available data" |
| **< 2/3** | **no aggregate.** Necessary/possible dominance, conjunctive screening and the completeness report only |

**EVIDENCE for 2/3:** a live production index includes an economy only if "data availability is at
least 66 percent within each of the two sub-indices", to "ensure that economy scores ... are not
overly sensitive to missing values" [49]; COINr's screening default is the same [48]. Adopt it as
the **default of a configurable parameter**, not a literal. **One caveat we own:** both sources
measure availability as a *count*, we apply it to *weight* coverage. The transfer is deliberate — an
unweighted count is the wrong denominator once criteria carry unequal weights — but it is our
extension. Two mandatory rules: an alternative excluded by the gate **stays visible**, labelled "not
scored — insufficient coverage" (silently dropping it is case deletion through the back door); and
`withheld` never masquerades as sparsity (§7, Conflict B).

**Completeness reporting.** ISO/IEC 25012 defines completeness as having values for all **expected**
attributes **in a specific context of use** [52] — the two qualifiers do the work, and every
vocabulary surveyed puts structural absence outside the count [39, 40, 42, 43]. **ADR-0009 is
correct as written; the only amendment is to key the exclusion on the `structural` flag rather than
on the literal string `not-applicable`.**

Report five counts (`applicable`, `inapplicable`, `valued`, `resolved-absent`, `outstanding`) and
three rates, per **measure**, because the tensor is `alternatives × criteria × measures` and a cell
routinely has a `score` and no `confidence`:

- **`assessedRate` = valued / applicable** — how much carries a value;
- **`settledRate` = (valued + resolved-absent) / applicable** — how much has been *looked at*. This
  is the number that answers "is the analysis finished", and it is what makes ADR-0009's
  "complete-as-specified rather than half-broken" requirement literal: an analysis deliberately full
  of qualified blanks reaches `settledRate = 1.0` while `assessedRate` stays low. **Ship both. Never
  ship only one.**
- **`silenceRate`** — the share of the applicable matrix where we looked and the absence is itself a
  statement about the subject. This is the MNAR signal made into a number, and at criterion level it
  is the strongest available evidence that a criterion is badly framed.

Four reporting rules: always render the fraction, never a bare percentage ("34 / 51 applicable" is
auditable; "67%" hides whether the denominator dropped because work was done or because a block was
declared inapplicable); report whole-row and whole-column emptiness separately from scattered blanks
(the survey-research unit/item nonresponse distinction); report against a declared **round scope**
by default with the full-matrix figure always shown second; and disclose how many cells were
withheld from *this reader*.

**Rendering, without colour** (moderate evidence — one supporting source could not be reached at
audit time, so treat the pattern-reservation rule as reasoning constrained by WCAG SC 1.4.1 [53]).
One rule carries the whole distinction:

> **Structural absence is the absence of ink. Contingent absence is the presence of a placeholder.**

`not-applicable` should not look like an empty cell; it should look like there is no cell there.
That reads correctly in greyscale, in forced-colors mode, in print, and to a colour-blind reader,
because the channel is figure-versus-ground rather than hue. Three independent non-hue channels:
**border encodes `terminal`** (dashed = work remains, solid = this is the answer), **glyph encodes
the specific reason**, **fill pattern encodes `informative`**. Plus: never take the "missing" colour
from the sequential value ramp (an inverted ramp passes through mid-greys and will collide in one
theme); every missing cell exposes its reason as text in the accessible name, because an em dash is
not an accessible name; the missingness key is always in the legend with counts; structural blocks
collapse and contingent blocks never do — a rectangle of `not-assessed` is the work queue.

---

## 5. Multi-rater agreement, Delphi, and displaying disagreement

Working notes: [c4](sections/c4-agreement.md).

**EVIDENCE — ADR-0011 point 4 is right about the coefficient and wrong about where to put it.**
Krippendorff states alpha's applicability directly: "any number of observers, not just two", "any
metric or level of measurement (nominal, ordinal, interval, ratio, and more)", "incomplete or
missing data", and "large and small sample sizes alike" [54]. That is our case in four bullets, and
an independent survey reaches the same conclusion via a decision table [59].

But **alpha's unit of analysis is the criterion, over alternatives as units** — Krippendorff: "α
evaluates reliability one variable at a time" [54]. With two to five raters in a single cell there
is nothing to chance-correct against; the expected-disagreement term would be estimated from the
same handful of numbers as the observed one (reasoning). ADR-0011 point 4 implies a per-cell
statistic. **Compute alpha once per criterion, with an interval, and never gate anything on it.**

Two implementation facts that matter more than they look:

- **The ordinal difference function is the standard bug.** It is *not* `(c−k)²`; it is a rank
  distance measured in observed marginal mass, `(Σ_{g=c..k} n_g − (n_c+n_k)/2)²`, which depends on
  the data, so no fixed distance table can be precomputed [54]. A mature Python package returned
  0.789 where R returned 0.815 on Krippendorff's own example [62].
- **A from-scratch implementation was verified during the research** against his published dataset C
  (4 raters × 12 units, 7 missing, `m_u` from 1 to 4), returning **0.7434 / 0.8154 / 0.8491** against
  his stated 0.743 / 0.815 / 0.849 [54]. **That dataset should be the golden fixture** — it exercises
  missing data, variable rater counts, an unpairable lone value and all three difference functions at
  once, and it is exactly the fixture a mature library failed.

There is no maintained, ordinal-capable, missing-data-capable Krippendorff implementation on npm
worth a runtime dependency; the one TypeScript package is a single-commit, zero-star side project
[64]. Given the "prefer boring, maintained dependencies" rule and the bundle constraint, **own it in
`core`** — roughly 80 lines, ported from the Python implementation that spells the ordinal metric out
explicitly [61] and validated against the fixture below.

**Thresholds: display, never enforce.** The conventional bands are Krippendorff's own — rely on
α ≥ 0.800, tentative conclusions between 0.800 and 0.667, discard below [55]. Those exist to certify
a coding *instrument*, where disagreement is measurement error to be eliminated. comparanda's thesis
is the opposite: disagreement is a finding, and a low alpha on a criterion usually means the
criterion is under-defined — which ADR-0011 point 1 already identifies as where the most valuable
threads live (reasoning). **Show the number, show the interval, name the band, link its source, and
let no threshold ever gate, warn on, or suppress data.** Note also that at 22 alternatives the
interval is the whole story: the smallest published simulation is n = 50 and coverage only
approached nominal at n = 200 [56], so applying it at n ≈ 20 is an extrapolation downward; use the
jackknife, which "offers a very substantial improvement over the bootstrap interval" at small
samples [63].

**Rejections, with reasons that hold.** Cohen's kappa: two raters only, complete data, and the
origin of the prevalence paradox — high observed agreement can be driven to a low kappa by marginal
imbalance [57]. Fleiss's kappa: requires the same number of ratings per unit (our normal case is 2
here and 4 there) and is nominal-only, throwing away the one useful thing about an ordinal scale.
ICC: assumes interval data [60] — using it would reintroduce ordinal averaging through the back door
of the agreement statistic — and has ten forms whose choice must be reported. **Gwet's AC2: offer,
never default.** It genuinely solves the paradox, but a peer-reviewed comparison finds AC1 is not a
substitute for kappa — for fixed observed agreement it moves *opposite* to kappa as prevalence
departs from 0.5, and the authors specifically warn the standard verbal bands must not be applied to
it [58]. A number with no published interpretive scale cannot be "the" agreement number in a tool
whose job is making numbers trustworthy.

**EVIDENCE — Delphi, and a direct conflict with ADR-0011 point 7.** Delphi is characterised by
anonymity, iteration and controlled feedback; "Anonymity offered by Delphi can reduce the inhibition
normally occurring in decision-making as individuals will be more open with their answers" [65]. The
best-documented operationalisation runs two rating rounds: "In the first round, the ratings are made
individually at home, with no interaction among panellists", then the panel meets and re-rates, with
each panellist's round-2 form showing "the frequency of responses for each indication, as well as
the individual panellist's own response" — group visible, individuals not [66]. Its stated rationale
for the discussion is diagnostic: to "sort out whether discrepant ratings are due to real clinical
disagreement ... or to fatigue or misunderstanding" [66].

**ADR-0011 point 7 ("activity is legible — what moved, who moved it") makes anonymous round-1 rating
impossible.** The two are reconcilable only if anonymity is *scoped and temporary*: the author is
always stored, and the **view** redacts it until the round closes. That requires rounds to be schema
data.

**Rounds cost ~15 lines and buy four things immediately** — a computable stability trace, somewhere
for the anonymity policy to live (it is a property of a round, not of an analysis), controlled
feedback as a *declared policy* rather than an emergent property of what the UI happened to show,
and round-scoped annotation filtering, which is what makes "why did this score move" answerable.
Retrofitting means *inferring* round boundaries from timestamps, which is unreliable the moment
anyone edits late. **Skip enforcement in v1** — no round locking, no deadlines, no transition
workflow. Store the field, compute the trace, redact by policy.

**Stopping is a trace, not a threshold.** Consensus is assessed *within* a round, stability
*between* rounds; there "is no general agreement in the literature that defines specific criteria to
use to determine when consensus has been achieved" [65]. That is a gift: "stop when the trend
flattens" is a chart, not a magic number, which suits both ADR-0015's stance and the project's
no-magic-numbers principle. The between-round statistic is **churn** (the fraction of raters who
changed, plus the change in spread), and it must not be conflated with alpha, which is the
within-round number.

**Displaying disagreement without implying a mean.** The design brief is a ~40 × 30 px cell holding
2–5 assertions on a K-level ordinal scale — roughly 10 × 8 mm, *smaller* than the stimuli in the
closest available glanceable-reading study [71]. Cleveland and McGill's ordering puts position along
a common scale first and shading/saturation last [70]. So: at this size, **position survives; area,
angle and saturation degrade.**

Ship a **rater dot strip**: the criterion's K ordinal levels as fixed slots across the cell, one
filled dot per rater assertion, ties stacked. It wins on five counts — position on a common scale
[70]; `n` is *countable*, not encoded; bimodality is a literal gap, so the "2 and 5" cell ADR-0011
names becomes the most visually distinctive one with no statistic in the loop; **nothing sits where
a mean would be**, so the requirement is met structurally rather than by convention; and its text
alternative is the exact multiset ("3 raters: 2, 2, 5"), which satisfies "never colour alone"
trivially and survives forced-colors, print and every colour-vision deficiency. It is the same
discrete-outcomes idea validated as quantile dotplots for small screens [69], except that at n ≤ 5
the dots *are* the data.

Ship alongside it a **`disagreement-spread`** ramp whose domain is a dispersion statistic **and
nothing else** — the zoom-out, sort-by and thumbnail mode, honest precisely because value never
enters the mapping. Rejections: gradient/violin cells are displays of *mean and error* by
construction [67] — a rejection on fit, not quality, and a KDE from three integers is fabricated
data; diverging stacked bars are right for Likert data [68] but need a declared midpoint (which
ADR-0010 forbids on ordinal data) and n large enough for proportions to mean something, so they
belong in the column summary and detail panel, never in a cell; jitter is random displacement that
carries no information at n ≤ 5 and changes between renders.

**Per-cell statistic.** Store or derive the shape: `n`, the level multiset, `min`, `max`, `span`,
mode(s), and a `polarised` flag — all ordinal-legal, none requiring a coefficient. If a scalar is
needed for the ramp and for sorting, use **van der Eijk's A**, purpose-built for ordered rating
scales, ranging over [−1, +1] with +1 unanimity, 0 uniform, −1 perfect bimodality [72, 74]. Two
caveats: A is a **shape** statistic that does not know `n`, so **never display it without `n`
beside it**; and it is sensitive to the *distance* between modes, so a bimodal distribution with
close modes may not be flagged [74] — arguably a feature here, since a 4-vs-5 split is a smaller
problem than a 1-vs-5 split, but it must be documented.

**Reject Tastle and Wierman's consensus measure** — the other obvious candidate — because it
internally computes the arithmetic mean of the ordinal codes, confirmed in the R reference source as
`mx = mean(expand(V))` [75, 76]. Adopting a per-cell disagreement statistic that averages ordinal
codes, in a tool whose thesis is that you must not, would be indefensible the first time anyone read
the source. **This is a case where an accepted ADR earned its keep by disqualifying a plausible
choice.**

---

## 6. Prior art, and the stack

Working notes: [c8](sections/c8-prior-art-and-stack.md).

### 6.1 What to steal, what to avoid

| Prior art | Steal | Avoid |
|---|---|---|
| Airtable / Notion / Coda | **Locked** as a third view mode beside personal and shared [79, 80] — no-autosave protects a view from *accidental* mutation; locking protects it from *deliberate* mutation by someone who does not realise it is load-bearing | Grouping as configuration rather than as an annotatable object — which is why ADR-0008's "groups are data" is the right correction |
| Google Docs | Threads that **resolve** without deleting; per-suggestion **and bulk** accept/reject [83] — a reviewer who leaves forty cell proposals is unusable without "accept all from this reviewer" | Position-and-revision anchors, disclaimed by the vendor itself [78]; and letting deletion of the anchored content delete the argument |
| Loomio | A stance is inseparable from its short reason, and **block** as a first-class stance [84] — our `justification` field is the same idea one level down, and block is ADR-0015's screening expressed as a rater's position | Reasoning that attaches to a decision *event* rather than to the structure: six months later you find the vote and not the criterion |
| Polis | Report **group-informed consensus** — what the disagreeing camps nonetheless agree on [85, 95] — which is the form the `disagreement` encoding's *analysis* should take, as distinct from its *glyph* | Algorithmic grouping a participant cannot contest; hence every automatic arrangement is a starting point, and every analysis states its method at the point of use |
| Figma | "Modified" as a **computed, always-visible** state, and **per-property revert** [86] — add "revert just the column order, keep my grouping" to ADR-0007's whole-view Save/Save-as/Revert | Name-and-hierarchy as the identity mechanism: a rename silently orphans the override, with no diagnostic |
| Miro | **Frames** — a named, ordered, re-enterable walk through the artifact [87]. An ordered *sequence of saved views* is a narrative mode and is nearly free once saved views exist. Highest-value cheap feature found | Layout that carries meaning the data model cannot express; resist any arrangement affordance that is not a permutation or a grouping |
| Observable / Quarto | The **build-time/run-time split** — everything expensive, credentialed or networked happens at build; the shipped artifact is inert [88, 89]. This settles that JSON Schema emission must never be in the browser bundle | Reproducibility that depends on a hosted runtime — our version is a "standalone" file that quietly wants a font from a CDN |
| MCDA tools | **Never ask for a weight; ask for a choice** (PAPRIKA) [90] — if opt-in weighting is ever built, elicit from revealed preference; and frame agreement as *a check on whether the exercise is trustworthy*, the way consistency checking is framed | A single ranked number whose axioms are contested since 1990 [91] — which is why ADR-0015's refusal is a correct response, not squeamishness |
| Bertifier | **Crossets** — one control at each header intersection carrying that axis's whole operation set [92]; and **optimal leaf ordering** as the seriation default, the choice a peer-reviewed human-evaluated Bertin tool made | An authoring tool with no persistence for the *reasoning*: craft the matrix, export the image, lose the argument. That is the difference between this project and a good visualisation library |

### 6.2 Annotation anchoring — the decisive observation

**EVIDENCE.** Google's Drive API models a comment anchor as a revision id plus a region and then
disclaims it: "Anchors are immutable, and their position relative to the content of a document
cannot be guaranteed between revisions. Consequently, we recommend you use anchors in documents
where the position doesn't change, such as image files or read-only documents" [78]. The robust
anchoring literature's answer is redundancy — multiple descriptors resolved strongest-first [96] —
standardised by the W3C Web Annotation Data Model, whose `TextPositionSelector` the spec itself
calls brittle and whose normative rule is that "Multiple Selectors SHOULD select the same content
... Consuming user agents MUST pick one of the described segments, if they are different" [81].
Hypothesis implements exactly that, using the position selector purely as a hint to bound a fuzzy
search [82].

**All of that machinery exists because text has no identity.** comparanda is not in that situation:
an alternative, a criterion, a group and a measure are entities we mint, reordering is view state,
and renaming changes an attribute rather than a key (reasoning). Therefore:

> **An annotation anchor is a tuple of stable opaque ids. Never a position, never a label.**

Reorder and rename become free — a genuine advantage over every text-anchoring system above. Three
operations still break it and each needs a designed answer: **split** (record `supersededBy: Id[]`,
resolve to all successors, render flagged); **delete/merge** (never hard-delete an entity carrying
annotations — tombstone it and surface an **orphaned annotations** tray); and **re-import** (ids are
minted once from a slug at creation then frozen, with `aliases: string[]` of former slugs, so a
`rubricator` re-run that renames a criterion still resolves). Borrow the redundancy *idea* without
the machinery: store a `repairHint: { labelAtAnchorTime, axisIndexAtAnchorTime }` that is **never
consulted for resolution** and exists only to generate a human-readable repair suggestion.

**The strongest single design instruction in this area:** deleting a criterion must never delete the
argument about whether that criterion should exist. In Docs, deleting the anchored text is the moment
you most want to keep the argument and the moment the anchor dies. Invert it.

### 6.3 The stack

All figures measured on one machine on one day with esbuild 0.27.4, `--bundle --minify --format=esm
--platform=browser`, and `gzip -9`, so the columns are mutually comparable.

| Entry | Raw bytes | gzip -9 |
|---|---:|---:|
| React 19 + `react-dom/client`, one trivial component | 193,327 | 60,146 |
| **Preact 10 + `preact/hooks`**, same component | **12,781** | **5,331** |
| `preact/compat` escape hatch, same component | 18,591 | 7,456 |
| `import { z } from 'zod'` + a comparanda-shaped schema | 310,946 | 61,756 |
| Named imports from classic `zod`, same schema | 68,204 | 19,032 |
| **`import * as z from 'zod/mini'`**, same schema | **15,250** | **5,491** |
| `@zodal/core` `defineCollection` alone | 10,819 | 3,785 |
| `@zodal/groups-core` `defineGroups` | 16,063 | 5,701 |

**Raw bytes are the governing figure**, not gzip: the artifact is a file mailed as an attachment and
opened over `file://`, where no transport applies compression and mail encoding adds about a third.
The whole dependency floor on the recommended stack is ~51 kB raw against ~504 kB for React plus the
classic Zod barrel.

Three consequences:

- **Preact for the view.** It is also the boring choice — no compiler, no bundler plugin, which is
  what "must still build in three years" asks for. Svelte and Solid couple the source to a compiler;
  Lit's shadow DOM complicates the four things this project cares about most (computed contrast
  against a rendered background, forced-colors, print, and one coherent `role="grid"` tree). Vanilla
  saves at most ~13 kB and costs us a hand-written renderer that must preserve DOM identity and
  keyboard focus across reorder — the fiddliest requirement we have.
- **`zod/mini` for the runtime schema, and JSON Schema emission as a Node-only build step.**
  `@zodal/core`'s `defineCollection` works on `zod/mini` schemas unchanged (verified by execution),
  and classic Zod's `toJSONSchema` accepts them (verified). The `z` namespace barrel is the single
  most expensive line of code in the project, because a namespace object's properties cannot be
  dead-code-eliminated. Add an ESLint `no-restricted-imports` rule: it is a 296 kB mistake that looks
  like a style preference.
- **No `comparanda/react` in v1.** The public mounting contract is
  `mountMatrix(el, props) => { update, destroy }`, which any framework wraps in a dozen lines.

**A factual correction to ADR-0006.** There is no key-value "zodal store" interface anywhere in
zodal. `@zodal/store` provides `DataProvider<T>` — collection CRUD. An implementer writing against
ADR-0006 as worded would be coding to an API that does not exist. The fit is good for saved views,
annotations and rater assertions (all genuinely collection-shaped) and poor for the analysis
document, which should be modelled as a degenerate one-item provider.

**And the find of the review:** `getCapabilities()` already implements exactly the mechanism ADR-0013
demands and does not name. `ProviderCapabilities` carries `canCreate / canUpdate / canDelete / …`
with a documented default fallback, and the package's own comments call capability discovery its
novel contribution over comparable frameworks. ADR-0013 requires that "standalone shows saved views
working locally while annotations are read-only, and says so, rather than presenting controls that
silently do nothing" — **that is capability discovery, and it should be named in the ADR as the
single source of truth for editability**, because a parallel is-this-read-only flag is precisely how
the failure ADR-0013 warns about happens.

**Two things that change existing decisions.**

1. **Withdraw the `dnd-kit` recommendation.** It is React-only, which contradicts the framework
   choice, and the accessibility premise is wrong anyway: the leading framework-agnostic
   alternative's own README says its packages "are unopinionated about visual language or
   accessibility" [77]. Drag libraries sell a pointer abstraction, not an accessible reorder — you
   write the keyboard path and the announcements either way (reasoning). **Write the keyboard path
   first and treat it as the reference implementation**; add pointer dragging as a thinner second
   path over the same `moveTo(axis, from, to)` core.
2. **Self-registering encoding modules are a live tree-shaking bug**, demonstrated rather than
   predicted: with `"sideEffects": false` declared, esbuild deleted a self-registering encoding
   module *from the view bundle* — renderer shipped, registry empty, no build error, no runtime
   warning. `"sideEffects": false` is a promise that importing a module for its side effects is never
   necessary, and a self-registering module breaks that promise. **Registries are populated by the
   composition root, explicitly.** This also improves the product: a consumer who wants two encodings
   ships two.

**ADR-0005's condition of acceptance is met.** Core-only isolation held in every tested
configuration, including with no `sideEffects` field, because a subpath export is a separate module
graph. Do not split the package. Verify continuously with an esbuild `--metafile` input-path
assertion (which names the offending import chain on failure, where a size budget does not), plus
per-fixture byte budgets, `publint` and `@arethetypeswrong/cli` on the published tarball, and a
no-DOM test environment for `core`.

**Build the single file with Vite plus `vite-plugin-singlefile` [94]**, not a hand-rolled
esbuild-and-inline script — otherwise we reimplement asset inlining, CSS extraction and data-URI
encoding and get the SVG and font cases wrong twice. Its stated limitations are all acceptable here
(one HTML file and no others; nothing in a `public` folder is inlined; `.svg` imports are not
inlined, so every icon must be an inline `<svg>` element in source — worth an ESLint rule). Inline
the analysis as `<script type="application/json">` rather than a JS literal: it avoids escaping bugs
and keeps the data inspectable by anyone who opens the file in an editor.

**Zero-network: enforce, do not only test.** Inject a CSP meta tag into the built artifact
(`default-src 'none'; connect-src 'none'; img-src data:; font-src data:; form-action 'none';
base-uri 'none'`). `connect-src 'none'` makes `fetch`, `XHR`, `EventSource`, `WebSocket` and
`sendBeacon` *fail at runtime* rather than merely be absent — turning ADR-0013's "no component may
reach past its port" from a code-review convention into a browser-enforced property. Keep the
browser test too, but make it **exercise the view** (a `fetch()` inside a cell renderer only fires
when that renderer runs, so a load-and-assert test misses exactly the bug ADR-0013 names) and assert
the absence of console errors, because a CSP violation surfaces as one. Add a cheap static grep as a
pre-filter so the failure message names the offending string. **Run the check in `comparanda build`,
not only in CI** — a CI-only check does not protect someone who builds locally and mails the result.

**A constraint on the mailed file that has nothing to do with size:** enterprise mail filtering lists
`htm`/`html` among selectable attachment types and matches them by true type regardless of the
filename extension, so renaming does not evade it [93]. It is opt-in rather than default, but the
option exists because HTML attachments are a common phishing vector. Expect rejection at some
recipients whatever the file weighs. This changes what the CLI prints, not the architecture.

---

## 7. Conflicts between sections, resolved

Seven places where the working sections recommend incompatible things, or where two of them
independently prescribe something their own evidence condemns. Each is resolved here, with the
reason for the pick.

### Conflict A — two names for the same dominance relation

**c2 §B.6** calls the relations `certainlyDominates` / `possiblyDominates`. **c3 §3.3** calls them
`necessarilyDominates` / `possiblyDominates`. The constructions are identical; the sections derived
them independently (c2 from the skyline literature and its own numerical verification, c3 from
robust ordinal regression).

**Resolved: use `necessary` / `possible`.** "Necessary" and "possible" are the published, attested
pair — Greco, Mousseau and Słowiński define necessary weak preference as holding "for all compatible
value functions" and possible as "for at least one" [44] — whereas "certain" is unattested and
invites confusion with `confidence`, which is a stored measure in this schema. c2's transitivity
proof and its 200,000-triple verification carry over verbatim; only the name changes.

### Conflict B — `withheld`: widen to the range, or treat as observed?

**c2 open question 1** recommends widening `withheld` to the full declared range for dominance,
"the safe choice", and asks whether two readers with different access should ever see different
fronts. **c3 §3.5** rules that `withheld` "counts as observed-but-unavailable-to-you, not as
absent", and that an aggregate depending on withheld cells must be disclosed or suppressed.

**Resolved: both, and the apparent conflict dissolves once disclosure is modelled as a projection.**
A reader who cannot see the value legitimately computes on the widened interval — their front is
conservative, which is correct, because they genuinely do not know. What is *not* acceptable is that
they cannot tell. So: `withheld` widens to the criterion's range **for a reader without access**,
the result object counts the widened cells, and the view states "computed with 3 cells withheld from
you". For a reader *with* access the same cell is a point value and the front may differ. **Yes, two
readers with different access see different fronts, and that is the honest outcome — provided the
difference is announced.** This is exactly why disclosure must be an orthogonal, view-time property
rather than a missingness reason alone (new ADR-0021), which is how SDMX separates `CONF_STATUS`
from `OBS_STATUS` [38, 39].

### Conflict C — c2 and c4 use the missingness codes c3 renames

c2's dominance rules and c4's alpha-mapping table are both written against `pending` and `unknown`.
c3 recommends renaming them to `deferred` and `indeterminate` and adding `not-evidenced`.

**Resolved in favour of c3's set**, because its argument is about a documented naming collision in
two production vocabularies [40, 41] rather than about taste, and both dependent tables restate
cleanly:

| Reason | In dominance (§3.3) | In alpha (§5) |
|---|---|---|
| `not-applicable` | no interval; leaves the comparison (Conflict G) | excluded entirely — no reliability question exists |
| `not-assessed`, `deferred` | widen to the declared range | absent; the alternative has fewer pairable values and may drop below `m_u = 2` |
| `not-evidenced` | widen to the declared range | absent, **counted separately** — a searched-and-silent cell is a real observation about the alternative |
| `indeterminate` | widen to the declared range | absent, **counted separately** — a rater who looked and could not determine has made an observation, but it is not a point on the ordinal scale and must not be forced onto one |
| `withheld` | widen for readers without access (Conflict B) | absent, counted and reported separately so the reader knows the number is partial |

One consequence for c1: it recommends `pending` as the agent's output for "high leverage, needs
investigation", the role Pahl and Beitz's `?` played in the Pugh matrix [11]. Under the renamed set
that mapping is too coarse — **`indeterminate` when the assessor looked and could not tell,
`deferred` when the assessment was postponed.** Both are legitimate `?` cases and they mean
different things about what to do next.

### Conflict D — does the datum tally reintroduce the total column?

**c1** proposes the Pugh datum encoding as "the answer to the total-column problem". **c2** argues
that the decisive objection to a total is **non-compensation**, not measurement level — and a
better/worse tally could be read as a compensatory aggregate.

**Resolved: they agree, provided the prohibition on a net is enforced.** Four separate counts assert
no trade-off between criteria: they are a *profile*, not a scalar. A `net = plus − minus` **is** a
compensatory aggregate over ordinal comparisons, and it is exactly the misreading Frey et al.
document — "Pugh's method is most often referred to in the design literature as 'Pugh Concept
Selection' whereas Pugh emphasized 'Controlled Convergence'" [11]. So the datum encoding is
permitted precisely and only in its four-count form; a net goes through ADR-0015's opt-in-and-labelled
aggregation path or does not exist. Legend copy must say what it is not: "counts of
better/same/worse against {datum}; not a score, and not comparable across different datums."

### Conflict E — may an ordinal criterion carry an indifference tolerance?

**c1** says `indifference` "is only meaningful at `interval`/`ratio`; on `ordinal` express tolerance
in levels, not in units". **c2** ships `q` on a 1–5 ordinal criterion, where "`q_j = 1` says one step
is noise".

**Resolved: a near-miss rather than a real conflict, but the schema must make it explicit.** Both
are saying that a *unit-valued* tolerance is illegal on ordinal data and a *step-count* tolerance is
legal — counting steps is a ranking operation, not a distance measurement. So `indifference` is
interpreted **by the criterion's declared `level`**: a count of levels on `ordinal`, a quantity in
the criterion's units on `interval`/`ratio`, and invalid on `nominal`. Validation enforces it; the
UI labels it accordingly ("treat differences of 1 level as noise" vs "treat differences under €500
as noise").

### Conflict F — two incompatible designs for criterion metadata

**c1** proposes `preference: increasing | decreasing | target | ordered | none` plus an
`indifference`. **c2** proposes `range: { lo, hi, direction: 'higher-is-better' | 'lower-is-better' }`
plus `q`/`p`/`v` thresholds. Both are load-bearing and they overlap on direction.

**Resolved by merging, with `direction` deleted from `range`** — see the field design in §2. c1's
union is strictly richer (it can express a target criterion, an explicitly ordered nominal-looking
scale, and a descriptive column excluded from all screening) and c2's `range` does a *different*
job that c1 does not cover at all: it supplies the interval bounds for dominance, the declared
normalisation that keeps weighted sum free of rank reversal [28], and the range without which
elicited weights are meaningless [34]. Neither field can do the other's work. Keeping `direction`
inside `range` would create two sources of truth for the same fact, which is the failure mode this
whole document keeps finding elsewhere.

### Conflict G — a gap both sections walk into: structural absence and non-transitivity

This one is not a disagreement between sections; it is a place where **c2 and c3 independently
prescribe a rule that their own shared counterexample condemns**, and neither notices.

Both say a structurally missing cell (`not-applicable`) yields no interval and the criterion "is
dropped from the comparison for that alternative" [c2 §B.6; c3 §3.3]. But dropping a criterion
because one side of a pair lacks it **is** the common-dimensions rule — the very rule proven
non-transitive [32, 51]. The same cycle reproduces (reasoning, by direct construction on the cited
counterexample's shape): with `a = (4, 2, NA)`, `b = (3, NA, 4)`, `c = (NA, 3, 2)` and
higher-is-better throughout, `a` dominates `b` on criterion 1, `b` dominates `c` on criterion 3, and
`c` dominates `a` on criterion 2. Every alternative is dominated; the front is empty.

**Resolution — compute dominance over a fixed criterion set, not a per-pair one.** The default
`paretoFront` restricts to the criteria applicable to **every alternative in the current scope**,
and names the excluded criteria in the result: "dominance computed over the 9 criteria applicable to
all 12 options; 3 excluded as inapplicable." A fixed set makes the relation a genuine partial order,
because transitivity was only ever lost through a varying comparison basis. Three supporting rules:

- **The natural scope is a group.** Where inapplicability comes from a declared group-pair block —
  the normal case in this schema — applicability is homogeneous *within* an alternatives group, so
  running the front per group loses nothing. This makes ADR-0008's grouping load-bearing for
  ADR-0015's flagship analysis, which is a good argument for both.
- **Per-pair explanations remain available and remain labelled as partial.** `explainDominance(a, b)`
  may report "a is at least as good on 9 of 12; 3 not applicable" — as an *explanation*, never as an
  input to the front.
- **If a caller insists on per-pair comparison, cycles must be detected and reported, not assumed
  away.** The same rule already applies to `q`-relaxed practical dominance.

This belongs in the new dominance ADR as a numbered clause, because it is the single easiest way to
implement ADR-0015 incorrectly while believing you followed the research.

### Conflict H — ADR numbering collides across research documents

c4 proposes ADR-0017, 0018 and 0019; c8 proposes ADR-0017 for the stack; c2 and c3 propose unnumbered
new ADRs; and the visualisation sections (c5, c6, c7) propose their own ADR-0017/0018/0019 for
seriation, non-colour channels and accessibility acceptance criteria.

**Resolved: numbers below are proposals, and must be allocated once, in one place, by whoever
settles both findings documents.** The mapping in §8 is internally consistent for the terminology
round; the visualisation findings will need the next free block. Do not treat a number in a section
file as reserved.

---

## 8. Recommended ADR actions

Consolidated. Nothing here has been applied — ADRs are immutable once accepted, and a human settles
these. Numbers for new ADRs are proposals (Conflict H).

| ADR | Action | Reason |
|---|---|---|
| **ADR-0002** | confirm | Strengthened by a government methodology standard: "In a basic form of MCA this performance matrix may be the final product of the analysis" [1 §4.3.2]. Worth quoting in the README |
| **ADR-0003** | **amend** | (a) Drop "decision matrix" for "performance matrix (MCDA) / consequence table (decision analysis)" [1, 8]; (b) record that the default display alias for alternatives is "options" [1, 5, 7, 15]; (c) replace "averaging a 1–5 rating is a category error" with the two-part argument — Stevens's invariance [16], recorded as contested [17, 18, 19], **plus** non-compensation [24], which is not; (d) note that ADR-0003 decision 2 (measures vs encodings) has now paid for itself four times: the datum, missingness, disagreement and consensus-suppressed encodings all cost zero schema |
| **ADR-0004** | confirm, with a note | Schema-first on zodal confirmed by reading the source. Note that **JSON Schema emission is a build-time, Node-only concern** — the classic Zod import that provides `toJSONSchema` costs 61.8 kB gzip in a browser bundle |
| **ADR-0005** | **amend** | Its condition of acceptance is verified met — subpath exports isolate core-only consumers in every tested configuration. Record the standing CI verification: esbuild `--metafile` input-path assertion, per-fixture byte budgets, `publint` + `@arethetypeswrong/cli` on the tarball, and a no-DOM test environment for `core` |
| **ADR-0006** | **amend** | Factually wrong as written: there is no key-value "zodal store". `@zodal/store` provides `DataProvider<T>` (collection CRUD); the analysis is a degenerate one-item provider. Add that `getCapabilities()` is the single source of truth for what the UI offers |
| **ADR-0007** | **amend** | Add **locked** as a third view mode [79]; add **per-dimension revert** [86]; add an ordered **sequence of saved views** as a narrative mode [87] |
| **ADR-0008** | **amend** | (a) Withdraw the `dnd-kit` recommendation — React-only, and the accessibility premise is wrong [77]; make the keyboard path the reference implementation; (b) adopt `@zodal/groups-core` (`labels` profile) for grouping on both axes, noting the two gaps we fill (global axis order; group-pair inapplicability); (c) name **optimal leaf ordering** as the seriation default [92]; (d) add `transposed: boolean` to view state — orientation is unstandardised and our convention is shared only by [1]; (e) record that dominance is computed **per group scope** where applicability is homogeneous (Conflict G) |
| **ADR-0009** | **amend** | Rename `pending` → `deferred` and `unknown` → `indeterminate`; add `not-evidenced`; replace the closed-set/extensible tension with the flagged-and-parented model (`broader`, `structural`, `terminal`, advisory `informative`); key completeness exclusion on the `structural` flag, not the literal code; specify the five counts and three rates including `settledRate` and round scope; declare a precedence so a group-pair rule beats an author-set contingent code [39]; cite MCAR/MAR/MNAR as rationale only, never as stored content [45, 46] |
| **ADR-0010** | **amend** | (a) Add `missingness`, `datum`, `disagreement`, `disagreement-spread` and `consensus-suppressed` to the shipped encodings; (b) record the **reserved-channel rule** — texture is reserved for uncertainty and absence, never a general categorical channel; (c) record structural-is-absence-of-ink / contingent-is-a-placeholder and the dashed-vs-solid `terminal` border; (d) **encodings are plain named exports registered by the composition root; no module registers itself at module scope** — a correctness requirement under `"sideEffects": false`, demonstrated |
| **ADR-0011** | **amend** | (a) Anchors are tuples of stable opaque ids only; entities carrying annotations are tombstoned, never hard-deleted; `supersededBy` handles splits; `repairHint` is stored but never consulted for resolution; orphaned annotations get a visible tray [78, 81, 82, 86]; (b) add bulk accept/reject to suggestion mode [83]; (c) point 4's agreement statistic is per-criterion, not per-cell — see new ADR-0022; (d) point 7 needs the round-scoped qualification — see new ADR-0023; (e) frame the disagreement *analysis* as Polis-style group-informed consensus [85, 95], distinct from the disagreement *glyph* |
| **ADR-0013** | **amend** | Upgrade zero-network from a CI test to a **CSP-enforced property** baked into the artifact, plus the browser test (which must exercise the view and assert no console errors) and a static grep; require the check to run in `comparanda build`, not only in CI; name `getCapabilities()` as the graceful-degradation mechanism; record the mail-gateway limitation on `.html` attachments [93] |
| **ADR-0014** | **amend** | Replace "an agent that cannot cite a span should be recording `unknown`" with the `not-evidenced` / `indeterminate` distinction; state that a `Missing` record may itself carry evidence references and provenance — "we searched these three sources and none addresses migration cost" is a citable finding; model embedded excerpts as zodal **content fields** so the standalone-embedded vs resolver-fetched split falls out of existing bifurcation |
| **ADR-0015** | **amend** | (a) **Correct the ELECTRE claim**: the veto-criterion-with-a-threshold is a **conjunctive screening rule** [36], not ELECTRE's `v_j`, which thresholds a *pairwise difference* [24]; rename the field `acceptability`; (b) dominance is **necessary/possible over interval completions** and the common-dimensions rule is forbidden [32, 51] — see new ADR-0019; (c) support a per-criterion **indifference tolerance** (practical dominance), because strict dominance "is rare" [1 §5.5.2.1]; (d) add the **coverage gate** (point aggregate at 1.0; interval to 2/3; nothing below) and require weight renormalisation to be labelled as imputation [48, 49]; (e) add **value-of-information ranking** of missing cells as a shipped analysis; (f) add `findNonDiscriminatingCriteria`; record that **even-swaps is rejected** with the path-dependence evidence [13]; (g) add the **datum-relative** analysis with a four-count tally and an explicit prohibition on a net [11]; (h) sensitivity analysis must include an **add/remove-an-alternative** perturbation [28, 91]; (i) agreement statistics are reported, never enforced, and a single matrix-wide agreement number is not a legal output |
| **ADR-0016** | confirm | Untouched by this round; the examples it prescribes are what the open questions below propose to test against |
| **new ADR-0017** | **new** | *Stack: Preact for the view, `zod/mini` for the runtime schema, explicit registries.* A full draft body exists in [c8](sections/c8-prior-art-and-stack.md#draft-adr-body--ready-to-become-adr-0017) and should be lifted with minimal edits |
| **new ADR-0018** | **new** | *Direction of preference, declared ranges, and per-criterion thresholds.* Draft below |
| **new ADR-0019** | **new** | *Dominance semantics over incomplete and mixed-level data.* Draft below |
| **new ADR-0020** | **new** | *Two kinds of weight.* Draft below |
| **new ADR-0021** | **new** | *Disclosure is orthogonal to presence.* Draft below |
| **new ADR-0022** | **new** | *Agreement statistics: unit of analysis, and no threshold ever gates.* Draft below |
| **new ADR-0023** | **new** | *Rounds, attribution policy and feedback policy.* Draft below |
| **new ADR-0024** | **new** | *The disagreement encoding is a rater dot strip.* Draft below |

ADR-0012 (identity) was not examined by this research round and carries no recommendation.

### Draft bodies for the new ADRs

**ADR-0018 — Criteria carry a direction of preference, a declared range, and optional thresholds.**
comparanda adopted the word "criterion", which in the tradition it cites means an attribute *plus a
direction of preference* [1, 4], while modelling a bare attribute. ADR-0015's two flagship analyses
are undefined without that direction: dominance requires "performs at least as well as" [1 §4.5],
and veto screening's "falls below" silently assumes higher-is-better on every criterion, which a
cost column breaks. Therefore each `(criterion, measure)` declares, beside its level of measurement,
a `preference` of `increasing` / `decreasing` / `target` / `ordered` / `none`, where `none` excludes
the criterion from dominance, screening and the datum encoding and **must be named in the result
wherever an analysis reports one**. Each ordinal, interval or ratio `(criterion, measure)`
additionally declares a `range`, which is load-bearing three times over — it supplies the interval
bounds for dominance over missing cells, it is the *declared* normalisation that keeps weighted sum
free of the rank reversal that afflicts relatively-normalised methods [28], and it is the range
without which an elicited weight has no meaning [34]. `direction` is deliberately **not** a field of
`range`; it would duplicate `preference` and the two would drift. Optional `indifference` (`q`) and
`preferenceThreshold` (`p`) adopt the ELECTRE/PROMETHEE names and semantics [24, 26] and are
interpreted by the criterion's level — a count of levels on ordinal, a quantity in units on
interval/ratio, invalid on nominal. An aggregation refuses to run over a criterion with no declared
range rather than substituting observed extrema; that refusal is the value of shipping it.

**ADR-0019 — Dominance semantics over incomplete and mixed-level data.** The published
incomplete-data skyline rule — compare only on the dimensions both alternatives have — is
non-transitive, admits cycles, and can report that every alternative is dominated [32, 51]; it was
reproduced numerically (~1,900 transitivity violations and ~69 three-cycles per 200,000 random
triples) and it is forbidden. Instead, every cell becomes an interval: an observed value gives
`[v, v]`, a contingently missing value gives the criterion's declared range [50], and a structurally
missing value leaves the comparison. `a` **necessarily dominates** `b` iff `lo_a[j] ≥ hi_b[j]` on
every criterion in the comparison basis with strict inequality somewhere; `a` **possibly dominates**
`b` iff `hi_a[j] ≥ lo_b[j]` with strict somewhere [44]. Necessary dominance is a strict partial
order (verified: 0 violations, 0 cycles in the same 200,000 triples); possible dominance is not
transitive and is used only as a filter, never to build a front. The result has three tiers —
dominated, provisionally surviving, robustly non-dominated — and the gap between the necessary and
possible sets is reported as a measure of what the missing data costs the decision, together with a
value-of-information ranking of which blank to fill first (a deliberately crude pair-counting proxy
for an expected-value-of-information calculation we are not doing). **The comparison basis is the
set of criteria applicable to every alternative in the current scope, and it is named in every
result**, because a per-pair basis reintroduces exactly the non-transitivity this ADR exists to
avoid; the natural scope is an alternatives group, where group-pair inapplicability makes
applicability homogeneous. Nominal criteria, criteria with `preference.kind === 'none'`, and criteria
with no declared range are excluded by construction and reported. The algorithm is the naive
O(n²·m) pairwise scan, chosen because it produces the full pairwise relation the view needs to
explain *why* an alternative was set aside, and because at ADR-0002's stated scale it is
microseconds. A per-criterion indifference tolerance ("practical dominance") is supported as an
explicitly labelled relaxation which **must report cycles** rather than assume acyclicity, because
strict dominance "is rare" [1 §5.5.2.1] and will otherwise usually return nothing.

**ADR-0020 — Two kinds of weight, never one field.** A compensatory `substitutionWeight` is a
scaling constant tied to a criterion's range and is meaningless without it [34]; an outranking
`votingWeight` is voting power, explicitly "not ... substitution rates" and independent of the range
and encoding of the scale [24]. They are different quantities with different elicitation procedures
and different failure modes, and a schema that gives them one field name guarantees that someone
will elicit one and consume it as the other. Ship `substitutionWeight` only for now, but name it
explicitly so `votingWeight` can be added without a migration. If weights are ever elicited in the
product, elicit them from choices rather than numbers [90].

**ADR-0021 — Disclosure is orthogonal to presence.** A value may be present in the authoring store
and withheld from a particular reader. If `withheld` is only a missingness reason, rendering a
redacted view requires destroying data, and an aggregate computed for a restricted reader silently
depends on values they cannot see. Model disclosure as an orthogonal, view-time property of a value,
so redaction is a **projection** rather than an edit — the separation SDMX makes between
`CONF_STATUS` and `OBS_STATUS` [38, 39]. Consequences: `withheld` remains in the reason set, because
it genuinely is the reason a reader sees nothing; a reader without access computes dominance over
the widened interval and is **told** how many cells were widened; two readers with different access
may legitimately see different fronts, and the difference must be announced rather than discovered.

**ADR-0022 — Agreement statistics: unit of analysis, and no threshold ever gates.** Krippendorff's
alpha is confirmed as the right coefficient — any number of observers, any level of measurement,
incomplete data, small samples [54] — and is computed **per criterion over alternatives as units**,
never per cell, because with two to five assertions in one cell there is nothing to chance-correct.
Per cell, report the shape: `n`, the level multiset, `min`, `max`, `span`, mode(s), a `polarised`
flag, and optionally van der Eijk's A, which must never be displayed without `n` because it is a
shape statistic that does not know the count [72, 74]. Tastle and Wierman's consensus measure is
rejected because it internally averages the ordinal codes [75, 76]. Cohen's and Fleiss's kappa
(two-raters-only / equal-rater-counts, nominal, prevalence paradox [57]) and ICC (assumes interval
[60]) are rejected; Gwet's AC2 is offered as a labelled secondary for skewed criteria only, never as
"the" number, because it has no published interpretive scale [58]. Alpha is always reported with a
jackknife interval [63], and **no threshold gates, warns on, suppresses or excludes anything** — the
0.800/0.667 bands are displayed with their source and act on nothing, because they exist to certify
a coding instrument and comparanda's thesis is that disagreement is a finding. Implementation is
owned in `core` (~80 lines), gated on Krippendorff's published dataset C as a golden fixture, because
that is the fixture a mature library got wrong [62]. The missingness-to-alpha mapping is the table in
§7 Conflict C.

**ADR-0023 — Rounds, attribution policy and feedback policy.** A `round?: RoundId` on every
assertion plus a small `rounds` collection enters the schema in Phase 1 — roughly fifteen lines,
optional, free for a single-round analysis, and a migration through every stored analysis if
retrofitted, because round boundaries would otherwise have to be inferred from timestamps. Each
round declares an `attribution` policy (`attributed` | `blind-until-close`) and a `feedback` policy
(`none` | `distribution` | `distribution-and-rationales`). This reconciles ADR-0011 point 7
("activity is legible") with the best-evidenced structural claim in the Delphi literature, that
round-one rating should be anonymous to reduce inhibition [65], and with the RAND/UCLA design in
which round-one ratings are made "individually at home, with no interaction among panellists" and
round-two feedback is distributional plus personal but not attributed [66]: **the author is always
stored; the view redacts until the round closes.** Stopping is a stability *trace*, not a consensus
threshold — consensus is assessed within a round and stability between rounds, and the literature
has no agreed stopping criterion [65] — so the between-round statistic is churn and must never be
conflated with alpha. v1 stores the field, computes the trace and redacts by policy; round locking,
deadlines and transition workflow are deliberately out of scope and can be added later without a
migration, which is the entire point of adding the field now.

**ADR-0024 — The disagreement encoding is a rater dot strip.** In a cell of roughly 40 × 30 px
holding two to five assertions on a K-level ordinal scale, the design problem is not compression but
**refusing to summarise**. Ship a rater dot strip: K fixed slots across the cell, one filled dot per
assertion at its level, ties stacked, degrading to a range bracket below a configurable width and to
the spread ramp below a second threshold. It uses position along a common scale, the most accurately
read channel [70]; `n` is countable rather than encoded; bimodality is a literal gap, so the cell
ADR-0011 calls the most decision-relevant becomes the most visually distinctive with no statistic in
the loop; **no mark sits where a mean would be**, meeting the requirement structurally; and its text
alternative is the exact multiset, so "never colour alone" is satisfied trivially and it survives
forced-colors, print and every colour-vision deficiency. Ship `disagreement-spread` as its zoom-out
companion — a sequential ramp whose domain is a dispersion statistic *and nothing else* — and
`consensus-suppressed` as a parameter change on the existing value-suppressing encoding [73]. Rejected:
gradient and violin cells, which are displays of mean-and-error by construction [67] and would be a
kernel density estimate over three integers; in-cell diverging stacked bars, which need a declared
midpoint ADR-0010 forbids on ordinal data and an `n` we do not have, and which therefore live in the
column summary and detail panel [68]; and jitter, which is random displacement carrying no
information at n ≤ 5.

---

## 9. Open questions

What the research did not settle, and what would settle it.

**Schema and semantics**

1. **The `target` preference kind.** "Closest to 12 people" is a real criterion shape, but dominance
   over a target criterion needs a distance metric, which smuggles a cardinal assumption back in.
   Recommend shipping `target` in the schema, excluding it from strict dominance in v1, and saying
   so in the UI. *Settled by:* writing the deliberately messy ADR-0016 example with a target
   criterion in it and seeing what the dominance report should honestly say.
2. **Default indifference tolerance.** No evidence for a number exists. Recommend defaulting to zero
   (strict) and making any tolerance an explicit labelled user act. *Settled by:* a survey of what
   tolerance makes dominance non-empty on realistic matrices, or user testing.
3. **Whether the `q`-relaxed relation is worth shipping at all.** Strictly more useful on a coarse
   1–5 scale, strictly less safe. *Settled by:* a week of use on the messy example — if the
   relaxation empties or tangles the front on realistic data, drop it.
4. **The right interval for a missing cell on a nominal criterion.** There is no `[min, max]`, so
   necessary dominance is undefined and only equality is available. Probably: nominal criteria are
   excluded from dominance when missing, and the exclusion is reported. Needs a Phase 2 decision.
5. **Is 2/3 the right coverage floor for *this* domain?** The sources are a 133-economy index with
   78 indicators; our matrices are ~22 × 12, and the threshold's sensitivity at small `n` is
   untested. *Settled by:* a simulation over the example datasets — how often does the interval
   aggregate's ranking change as coverage falls? Cheap, and it should be run before the default is
   fixed.
6. **Confidence about a missing value.** "How sure are we the sources really are silent?" is
   meaningful — a shallow search and an exhaustive one are different claims — and it doubles the
   cell state space. Deferred; `Missing.note` and `Missing.evidence` are the cheap version and
   should ship in Phase 1.
7. **Is renaming `unknown` worth the churn?** The argument is strong but it renames an accepted
   ADR's published set. *Settled by:* writing both code sets into `rubricator`'s prompts, running
   one real analysis each way, and counting how often the model reaches for the catch-all. If
   `unknown` is not over-used, the minimal amendment (keep the name, redefine it as the leaf, still
   add `not-evidenced`) suffices.
8. **Should `withheld` be in the reason set at all**, or only in the disclosure layer? Keeping it in
   both is mild duplication; deriving it at render time is more correct and more work. *Settled by:*
   whether any deployment needs an analysis in which nobody, including the owner, may store the
   value.

**Statistics**

9. **The van der Eijk layer decomposition.** Every secondary source states the formula; none reached
   states the semi-uniform layer decomposition procedurally, and the R implementation documents a
   revised algorithm distinct from the 2001 original [72]. *Settled by:* reading van der Eijk (2001)
   directly, diffing against the R source, and building an exhaustive fixture table — there are only
   126 distributions of n = 5 over K = 5, and 251 for all n ≤ 5.
10. **Jackknife vs bootstrap crossover.** The recommendation to prefer the jackknife "for smaller
    samples" names no unit count [63]. *Settled by:* a simulation over comparanda-sized matrices
    (10–50 alternatives, 2–5 raters, 5 levels, 0–40% missing) measuring interval coverage.
11. **Does the dot strip actually beat the spread ramp for the intended task?** The perceptual
    argument is strong but indirect; nobody has tested distribution glyphs at 40 × 30 px for a
    "find the contested cell" task. *Settled by:* a small within-subjects study once the view
    exists. Interim position: ship both, make switching one keystroke.
12. **How many raters comparanda actually gets.** Everything assumes 2–5. If real usage is
    overwhelmingly 2, van der Eijk's A is nearly degenerate and a `span`-based design would do.
    *Settled by:* usage — so parameterise the encoding over K and n rather than tuning for n = 3.

**Stack and product**

13. **Svelte and Solid output size for this specific view.** Not measured, and no primary comparable
    published figure was located. *Settled by:* building the same fixture in each and measuring with
    the same bundler. Expectation is that both land near Preact and the compiler-coupling argument
    decides it regardless — but that expectation is not evidence.
14. **The realistic total bundle size.** The measured figures are dependency floors; comparanda's own
    view code does not exist yet. *Settled by:* setting a byte budget at Phase 3 (suggested 200 kB
    raw excluding the analysis payload) and failing CI on it, so the number is discovered under
    pressure rather than late.
15. **How large is a real analysis payload, inlined?** Determines whether the mailed-file story is
    dominated by code or by data. *Settled by:* building the messy ADR-0016 example once Phase 1
    exists.
16. **Does the dashed-vs-solid border convention read at cell scale?** No study covers it; the
    rendering recommendation is design reasoning constrained by WCAG [53]. *Settled by:* a
    five-person screen-and-print check on the messy example, in both themes, greyscale, and
    forced-colors.
17. **Is a Pugh "round" a first-class concept?** Pugh is explicitly iterative — rerun with a new
    datum, drop criteria, invent hybrids [11] — and rounds are now entering the schema for Delphi
    reasons (ADR-0023). Whether a Pugh round *is* a Delphi round, or a saved view plus a new analysis
    version, is unresolved. Lean: the same `rounds` collection serves both.

**Citations that need a human**

18. **The ELECTRE chapter [24].** Its quotations underpin the most consequential correction in this
    document (§3.1), and the copy they were transcribed from is no longer online. The *substance*
    does not depend on them — the q/p/v triple is independently attested and Roy's foundational
    paper [30] is available — but someone with library access should re-verify the wording before
    ADR-0015 is amended on their authority.
19. **Two sources could not be reached at audit time**: the data-visualisation style guide
    underpinning the texture-reservation rule (§4) and the ISO/IEC 25012 normative text (§4). Both
    arguments survive without them, but the ADR should not quote them.

---

## REFERENCES

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [Selecting Attributes to Measure the Achievement of Objectives — Ralph L. Keeney & Robin S. Gregory, Operations Research 53(1):1–11 (2005)](https://pubsonline.informs.org/doi/10.1287/opre.1040.0158)
3. [Multiple Attribute Decision Making: Methods and Applications — Ching-Lai Hwang & Kwangsun Yoon, Springer-Verlag (1981)](https://www.semanticscholar.org/paper/Multiple-Attribute-Decision-Making:-Methods-and-A-Hwang-Yoon/a7862f4ac351c8f1caa563b288ac2a63412b6b8f)
4. [Dominance-based Rough Set Approach, basic ideas and main trends — J. Błaszczyński, S. Greco, B. Matarazzo & M. Szeląg, arXiv:2210.03233 (2022)](https://arxiv.org/pdf/2210.03233) — the "consistent family of criteria" properties are attributed there to Roy & Bouyssou (1993), not read directly.
5. [Choosing By Advantages (CBA) — Lean Construction Institute](https://leanconstruction.org/lean-topics/choosing-by-advantages/) — definitions originate with Jim Suhr, *The Choosing By Advantages Decisionmaking System* (1999), not read directly.
6. [Multi-Criteria Decision Analysis (MCDA/MCDM) — 1000minds](https://www.1000minds.com/decision-making/what-is-mcdm-mcda)
7. [Analytic Hierarchy Process: A Complete Guide — TransparentChoice](https://www.transparentchoice.com/analytic-hierarchy-process)
8. [The Consequence Table — StructuredDecisionMaking.org](https://www.structureddecisionmaking.org/the-steps/the-consequence-table/) — the page's prose never uses "row" or "column"; its orientation is read off its two worked-example images.
9. [Even Swaps: A Rational Method for Making Trade-offs — J. S. Hammond, R. L. Keeney & H. Raiffa, Harvard Business Review 76(2):137–149 (1998)](https://hbr.org/1998/03/even-swaps-a-rational-method-for-making-trade-offs) — existence, authorship and date confirmed; **full text not retrieved**. Its method content here comes via [13] and [14].
10. [Decision matrix — Wikipedia](https://en.wikipedia.org/wiki/Decision_matrix) — cited as the most widely-read definition of the term, and for its criteria-in-rows orientation.
11. [The Pugh Controlled Convergence Method: Model-Based Evaluation and Implications for Design Theory — D. D. Frey, P. M. Herder, Y. Wijnia, E. Subrahmanian, K. Katsikopoulos & D. P. Clausing, Research in Engineering Design 20 (2009)](https://dspace.mit.edu/handle/1721.1/49448) — open-access manuscript, read in full. Cites Pugh (1990); the Pahl & Beitz `i`/`?` suggestion is reported there from Pahl & Beitz (1984). Neither primary source read directly.
12. [Controlled convergence — Institute for Manufacturing, University of Cambridge](https://www.ifm.eng.cam.ac.uk/research/dmg/tools-and-techniques/controlled-convergence/)
13. [Biases and path dependency in the Even Swaps method — T. J. Lahtinen & R. P. Hämäläinen, Systems Analysis Laboratory, Aalto University (working paper)](https://sal.aalto.fi/publications/pdf-files/mlah14.pdf) — read in full. Published as *European Journal of Operational Research* 249(3):890–898 (2016), [doi:10.1016/j.ejor.2015.09.056](https://doi.org/10.1016/j.ejor.2015.09.056).
14. [A Preference Programming Approach to Make the Even Swaps Method Even Easier — J. Mustajoki & R. P. Hämäläinen, Decision Analysis 2(2):110–123 (2005)](https://doi.org/10.1287/deca.1050.0043) — the verifiable source for **practical dominance**; its abstract states that the model helps "identify practically dominated alternatives, and to find applicable candidate attributes for the next even swap".
15. [Polls — Loomio Help](https://www.loomio.com/docs/en/user_manual/polls/proposal_types) — cited for user-facing vocabulary ("options").
16. [On the Theory of Scales of Measurement — S. S. Stevens (1946)](https://www.science.org/doi/10.1126/science.103.2684.677)
17. [Nominal, Ordinal, Interval, and Ratio Typologies Are Misleading — P. F. Velleman & L. Wilkinson (1993)](https://www.tandfonline.com/doi/abs/10.1080/00031305.1993.10475938)
18. [Likert scales, levels of measurement and the "laws" of statistics — G. Norman (2010)](https://link.springer.com/article/10.1007/s10459-010-9222-y) — paywalled; the quoted sentence is from the abstract.
19. [Ten Common Misunderstandings, Misconceptions, Persistent Myths and Urban Legends about Likert Scales and Likert Response Formats and their Antidotes — J. Carifio & R. J. Perla (2007)](https://thescipub.com/abstract/jssp.2007.106.116) — read directly; quotations verbatim.
20. [Resolving the 50-year debate around using and misusing Likert scales — J. Carifio & R. J. Perla (2008)](https://asmepublications.onlinelibrary.wiley.com/doi/10.1111/j.1365-2923.2008.03172.x)
21. [Analyzing ordinal data with metric models: What could possibly go wrong? — T. M. Liddell & J. K. Kruschke (2018)](https://scholarworks.iu.edu/dspace/items/9bcd0f5e-7837-4f9c-ac07-a114e595e146)
22. [Analyzing Likert Data — H. N. Boone Jr. & D. A. Boone (2012)](https://commons.joe.org/joe/vol50/iss2/48/)
23. [Type — Vega-Lite documentation](https://vega.github.io/vega-lite/docs/type.html)
24. [Electre Methods (chapter, *Multiple Criteria Decision Analysis: State of the Art Surveys*, pp. 133–153) — J. Figueira, V. Mousseau & B. Roy (2005)](https://doi.org/10.1007/0-387-23081-5_4) — title, authors and page range verified via Crossref and OpenAlex. **Access caveat:** the copy the quotations were transcribed from is no longer online and the chapter is closed access, so the *wordings* cannot currently be re-verified; the substantive claims are independently corroborated by Roy's foundational statement of the outranking approach [30].
25. [About Modeling Types — JMP documentation](https://www.jmp.com/support/help/en/19.0/jmp/about-modeling-types.shtml)
26. [Note—A Preference Ranking Organisation Method: The PROMETHEE Method for Multiple Criteria Decision-Making — J. P. Brans & Ph. Vincke (1985)](https://pubsonline.informs.org/doi/10.1287/mnsc.31.6.647)
27. [Remarks on the Analytic Hierarchy Process — J. S. Dyer, Management Science 36(3):249–258 (1990)](https://doi.org/10.1287/mnsc.36.3.249) — companion primary source: Belton & Gear, ["On a short-coming of Saaty's method of analytic hierarchies"](https://doi.org/10.1016/0305-0483(83)90047-6), Omega 11(3):228–230 (1983). Neither full text obtained.
28. [The Rank Reversal Problem in Multi-Criteria Decision Making: A Literature Review — R. F. F. Aires & L. Ferreira (2018)](https://www.scielo.br/j/pope/a/BPwgsywPZqgctBDcfPXxczg/?lang=en) — read directly.
29. [On rank reversal and TOPSIS method — M. S. García-Cascales & M. T. Lamata (2012)](https://www.sciencedirect.com/science/article/pii/S0895717711007850)
30. [The outranking approach and the foundations of ELECTRE methods — B. Roy (1991)](https://link.springer.com/article/10.1007/BF00134132)
31. [The Skyline Operator — S. Börzsönyi, D. Kossmann & K. Stocker (2001)](https://doi.org/10.1109/ICDE.2001.914855)
32. [Skyline Query Processing for Incomplete Data — M. E. Khalefa, M. F. Mokbel & J. J. Levandoski, ICDE 2008](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf) — PDF retrieved; the definition, the non-transitivity result and the counterexample were checked character-for-character.
33. [A Sensitivity Analysis Approach for Some Deterministic Multi-Criteria Decision-Making Methods — E. Triantaphyllou & A. Sánchez (1997)](https://repository.lsu.edu/eecs_pubs/1396/) — paywalled; the closed-form weight-flip margin used here is a derivation verified numerically, not a quotation.
34. [Common Mistakes in Making Value Trade-Offs — R. L. Keeney (2002)](https://pubsonline.informs.org/doi/10.1287/opre.50.6.935.357) — abstract and title verified; full text paywalled.
35. [SMAA — Stochastic multiobjective acceptability analysis — R. Lahdelma, J. Hokkanen & P. Salminen, EJOR 106(1):137–143 (1998)](https://research.aalto.fi/en/publications/smaa-stochastic-multiobjective-acceptability-analysis/) — defines the acceptability index and the central weight vector; **not** the per-rank indices, for which see [37].
36. [Elimination by aspects: A theory of choice — A. Tversky (1972)](https://doi.org/10.1037/h0032955)
37. [SMAA-2: Stochastic Multicriteria Acceptability Analysis for Group Decision Making — R. Lahdelma & P. Salminen, Operations Research 49(3):444–454 (2001)](https://doi.org/10.1287/opre.49.3.444.11220) — the source for the **rank acceptability index**.
38. [CL_OBS_STATUS v2.3 — SDMX cross-domain code list for Observation Status, SDMX Global Registry (2025)](https://registry.sdmx.org/sdmx/v2/structure/codelist/SDMX/CL_OBS_STATUS/+/?format=sdmx-json&detail=full)
39. [Possible Ways of Implementing CL_OBS_STATUS Code List — SDMX Statistical Working Group / Technical Working Group (2014)](https://sdmx.org/wp-content/uploads/CL_OBS_STATUS_implementation_20-10-2014.pdf)
40. [CodeSystem: NullFlavor (HL7 v3) — HL7 Terminology v6.0.2 (2024)](https://terminology.hl7.org/6.0.2/CodeSystem-v3-NullFlavor.html)
41. [CodeSystem: DataAbsentReason — HL7 FHIR R4 v4.0.1 (2019)](https://hl7.org/fhir/R4/codesystem-data-absent-reason.html)
42. [DDI — Handling of missing values in the QDDT — DASISH / QDDT project wiki (2015)](https://github.com/DASISH/qddt-client/wiki/DDI---Handling-of-missing-values-in-the-QDDT)
43. [Missing information (applicable and inapplicable) in relational databases — E. F. Codd, ACM SIGMOD Record 15(4):53–78 (1986)](https://dl.acm.org/doi/10.1145/16301.16303) — bibliographic details confirmed via Crossref and dblp; the ACM landing page blocks automated fetches.
44. [Ordinal regression revisited: multiple criteria ranking using a set of additive value functions — S. Greco, V. Mousseau & R. Słowiński, EJOR 191(2):416–436 (2008)](https://researchportal.port.ac.uk/en/publications/ordinal-regression-revisited-multiple-criteria-ranking-using-a-se/)
45. [Inference and missing data — D. B. Rubin, Biometrika 63(3):581–592 (1976)](https://doi.org/10.1093/biomet/63.3.581)
46. [Handbook on Constructing Composite Indicators: Methodology and User Guide — OECD / JRC European Commission (2008)](https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf)
47. [The Missing Indicator Method: From Low to High Dimensions — M. Van Ness et al., arXiv:2211.09259 (2022)](https://arxiv.org/pdf/2211.09259)
48. [Composite Indicator Development and Analysis in R with COINr, Chapter 6: Missing data and Imputation — W. Becker (2022)](https://bluefoxr.github.io/COINrDoc/missing-data-and-imputation.html)
49. [Global Innovation Index 2024, Appendix II: JRC statistical audit — Joint Research Centre / WIPO (2024)](https://www.wipo.int/web-publications/global-innovation-index-2024/en/appendix-ii-joint-research-centre-jrc-statistical-audit-of-the-2024-global-innovation-index.html)
50. [Missing consequences in multiattribute utility theory — A. Jiménez, A. Mateos & S. Ríos-Insua, Omega 37(2):395–410 (2009)](https://ideas.repec.org/a/eee/jomega/v37y2009i2p395-410.html)
51. [A Survey of Skyline Query Processing — C. Kalyvas & T. Tzouramanis, arXiv:1704.01788 (2017)](https://arxiv.org/pdf/1704.01788)
52. [ISO/IEC 25012:2008 — Software engineering — SQuaRE — Data quality model](https://www.iso.org/standard/35736.html) — **the normative text is paywalled and was not read.** The completeness definition quoted is reproduced from secondary sources and is **UNVERIFIED against the normative text**; the argument does not depend on the exact wording.
53. [Understanding SC 1.4.1: Use of Color — W3C WCAG 2.2 (2023)](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
54. [Computing Krippendorff's Alpha-Reliability — Klaus Krippendorff (2011, literature updated 2013)](https://www.asc.upenn.edu/sites/default/files/2021-03/Computing%20Krippendorff's%20Alpha-Reliability.pdf)
55. [Krippendorff's alpha — Wikipedia](https://en.wikipedia.org/wiki/Krippendorff%27s_alpha) — secondary source for the 0.800 / 0.667 bands, which it attributes to Krippendorff, *Content Analysis*, 2nd ed. (2004), pp. 241–243.
56. [Measuring inter-rater reliability for nominal data – which coefficients and confidence intervals are appropriate? — Zapf, Castell, Morawietz & Karch (2016), BMC Medical Research Methodology](https://pmc.ncbi.nlm.nih.gov/articles/PMC4974794/)
57. [High agreement but low kappa: I. The problems of two paradoxes — Feinstein & Cicchetti (1990), Journal of Clinical Epidemiology 43:543–549](https://pubmed.ncbi.nlm.nih.gov/2348207/)
58. [Gwet's AC1 is not a substitute for Cohen's kappa – A comparison of basic properties — Vach & Gerke (2023), MethodsX 10:102212](https://doi.org/10.1016/j.mex.2023.102212)
59. [Counting on Consensus: Selecting the Right Inter-annotator Agreement Metric for NLP Annotation and Evaluation — Joseph James (2026), arXiv:2603.06865](https://arxiv.org/abs/2603.06865)
60. [A Guideline of Selecting and Reporting Intraclass Correlation Coefficients for Reliability Research — Koo & Li (2016), Journal of Chiropractic Medicine 15:155–163](https://pubmed.ncbi.nlm.nih.gov/27330520/)
61. [fast-krippendorff — pln-fing-udelar (Python; the ordinal metric spelled out)](https://github.com/pln-fing-udelar/fast-krippendorff/blob/main/krippendorff/krippendorff.py)
62. [fast-krippendorff issue #4: "Ordinal value seems off" — 0.789 vs R's 0.815 on Krippendorff's own example](https://github.com/pln-fing-udelar/fast-krippendorff/issues/4)
63. [confint.krippendorffsalpha — CRAN reference manual, `krippendorffsalpha`, John Hughes (2021)](https://search.r-project.org/CRAN/refmans/krippendorffsalpha/html/confint.krippendorffsalpha.html); package paper: [arXiv:2103.12170](https://arxiv.org/abs/2103.12170)
64. [max-schaefer/krippendorff — TypeScript implementation](https://github.com/max-schaefer/krippendorff) — one commit, zero stars, self-described side project; **do not depend on it.**
65. [An exploration of the use of simple statistics to measure consensus and stability in Delphi studies — Holey, Feeley, Dixon & Whittaker (2007), BMC Medical Research Methodology 7:52](https://pmc.ncbi.nlm.nih.gov/articles/PMC2216026/)
66. [The RAND/UCLA Appropriateness Method User's Manual — Fitch et al. (2001), RAND MR-1269](https://www.rand.org/content/dam/rand/pubs/monograph_reports/2011/MR1269.pdf)
67. [Error Bars Considered Harmful: Exploring Alternate Encodings for Mean and Error — Correll & Gleicher (2014), IEEE TVCG 20(12):2142–2151](https://graphics.cs.wisc.edu/Papers/2014/CG14/Preprint.pdf)
68. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — Heiberger & Robbins (2014), Journal of Statistical Software 57(5):1–32](https://www.jstatsoft.org/v57/i05/)
69. [When (ish) is My Bus? User-centered Visualizations of Uncertainty in Everyday, Mobile Predictive Systems — Kay, Kola, Hullman & Munson (2016), CHI](https://dl.acm.org/doi/10.1145/2858036.2858558)
70. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — Cleveland & McGill (1984), JASA 79(387):531–554](https://www.jstor.org/stable/2288400)
71. [Glanceable Visualization: Studies of Data Comparison Performance on Smartwatches — Blascheck, Besançon, Bezerianos, Lee & Isenberg (2018), IEEE InfoVis / TVCG](https://www.microsoft.com/en-us/research/wp-content/uploads/2018/08/GlanceableVis-InfoVis2018.pdf) — stimuli 28.73 mm square.
72. [Measuring Agreement in Ordered Rating Scales — van der Eijk (2001), Quality & Quantity 35(3):325–341](https://link.springer.com/article/10.1023/A:1010374114305) — **paywalled and not read directly**; the measure and its properties are taken from [74] and from the R implementation notes, [`agrmt::agreement`](https://search.r-project.org/CRAN/refmans/agrmt/html/agreement.html), which documents a revised algorithm distinct from the 2001 original.
73. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer (2018), CHI](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
74. [Quantifying Polarization: A Comparative Study of Measures and Methods — arXiv:2501.07473 (2025)](https://arxiv.org/abs/2501.07473) — source for the restated van der Eijk A / U formulas and the mode-distance sensitivity finding.
75. [Consensus and dissention: A measure of ordinal dispersion — Tastle & Wierman (2007), International Journal of Approximate Reasoning 45(3):531–545](https://www.sciencedirect.com/science/article/pii/S0888613X06001186)
76. [`agrmt` R package — `consensus.R` source, showing `mx = mean(expand(V))`](https://rdrr.io/rforge/agrmt/src/R/consensus.R)
77. [Pragmatic drag and drop — Atlassian, GitHub README](https://github.com/atlassian/pragmatic-drag-and-drop) — source of "These pieces are unopinionated about visual language or accessibility". The project publishes separate accessibility guidance, so this is a statement about what the core hands you for free.
78. [Manage comments and replies — Google Drive API, Google Workspace](https://developers.google.com/workspace/drive/api/guides/manage-comments)
79. [Getting started with Airtable views — Airtable Support](https://support.airtable.com/docs/getting-started-with-airtable-views)
80. [Database views, filters, sorts & groups — Notion Help Center](https://www.notion.com/help/views-filters-and-sorts)
81. [Web Annotation Data Model — R. Sanderson, P. Ciccarese & B. Young, W3C Recommendation (2017)](https://www.w3.org/TR/annotation-model/)
82. [Fuzzy Anchoring — Hypothesis (2013)](https://web.hypothes.is/blog/fuzzy-anchoring/)
83. [Suggest edits in Google Docs — Google Docs Editors Help](https://support.google.com/docs/answer/6033474)
84. [Proposals — Loomio User Manual](https://www.loomio.com/docs/en/user_manual/polls/proposals); the agree/abstain/disagree/**block** response set is on [Consensus — Loomio User Manual](https://www.loomio.com/docs/en/user_manual/polls/proposals/consensus)
85. [Algorithms — The Computational Democracy Project / Polis](https://compdemocracy.org/algorithms/)
86. [Apply overrides to instances — Figma Help Center](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)
87. [Presentation mode — Miro Help Center](https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode) — **UNVERIFIED:** the page refused automated fetching (HTTP 403) and was not content-verified; the mechanism should be re-checked by a human before it is relied on.
88. [HTML Basics — Quarto documentation](https://quarto.org/docs/output-formats/html-basics.html)
89. [Data loaders — Observable Framework documentation](https://observablehq.com/framework/data-loaders)
90. [What is the PAPRIKA method? — 1000minds; after P. Hansen & F. Ombler, Journal of Multi-Criteria Decision Analysis 15:87–107 (2008)](https://www.1000minds.com/paprika)
91. [The state of the art development of AHP (1979–2017): a literature review with a social network analysis — A. Emrouznejad & M. Marra, International Journal of Production Research 55(22):6653–6675 (2017)](https://doi.org/10.1080/00207543.2017.1334976) — secondary source, used for the standing of the rank-reversal critique; the primary is [27].
92. [Bertifier — C. Perin, P. Dragicevic & J.-D. Fekete, "Revisiting Bertin Matrices: New Interactions for Crafting Tabular Visualizations", IEEE TVCG 20(12):2082–2091, VIS (2014)](https://aviz.fr/bertifier); [open-access PDF](https://openaccess.city.ac.uk/id/eprint/16706/1/2014_VIS_bertifier.pdf) — the optimal-leaf-ordering choice is in the paper body, not the abstract.
93. [Anti-malware protection for email in Microsoft 365 — common attachments filter, Microsoft Learn](https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-about) — `htm`/`html` are on the *opt-in* additional list, not the default blocked set; the true-type matcher recognises them regardless of extension.
94. [vite-plugin-singlefile — Richard Tallent](https://github.com/richardtallent/vite-plugin-singlefile)
95. [Group informed consensus — The Computational Democracy Project / Polis](https://compdemocracy.org/Group-Informed-Consensus/)
96. [Robust intra-document locations — T. A. Phelps & R. Wilensky, WWW9 / *Computer Networks* 33:105–118 (2000), doi:10.1016/S1389-1286(00)00043-8](https://www.semanticscholar.org/paper/bf3a9da17f9dbeb2d2d09f4d562c903e4e9b2f2e) — record verified; **full text not obtained.** The principle it states is independently attested by [81] and [82].

**Verification note.** Every reference above is carried over from a working section that ran a
citation-integrity pass. Four are flagged in place as unverified or unretrieved and should not be
quoted in an ADR without a human re-checking them: [24] (ELECTRE chapter — the quotations underpin
§3.1 and their source copy is gone), [52] (ISO/IEC 25012 — paywalled), [87] (Miro — bot-gated), and
[96] (Phelps & Wilensky — full text not obtained). Two further sources relied on by the working
notes could not be reached at audit time and are therefore **not cited here at all**: the
data-visualisation style guide behind the texture-reservation rule (§4) and van der Eijk's original
paper, which is represented by [72]'s caveated entry plus the corroborating sources [74] and the R
implementation.
