# Research

This folder is the project's research record: the questions comparanda asked before any schema or
view code was written, the working notes that answered them, and the synthesis each answer
produced. **A research question is not done until it has an entry in a `findings-*.md` file and a
recommended ADR action** — an answer with no decision attached is a note, not a finding, and the
next session re-asks the question.

## How this works

    briefs (the questions)  ->  sections/ (the working notes, one per question)
                            ->  findings-*.md (the synthesis)
                            ->  ADR actions (the decisions)

Three rules make the chain trustworthy:

- **Evidence and reasoning are marked separately.** Every claim in a findings file is labelled
  **EVIDENCE** (literature, cited) or **(reasoning, not evidence)**. Sources that could not be
  reached are marked, not quietly dropped.
- **No ADR is edited here.** ADRs are immutable once accepted (ADR-0001). Research recommends; a
  human settles. All round-1 actions have been applied; the settled set is indexed at [`../adr/README.md`](../adr/README.md).
- **Sections stay as the evidence of record.** A findings file is a synthesis and will be shorter
  than its evidence; when a claim needs its full chain, read the section it came from.

New-ADR numbers below use the **consolidated allocation proposed in
[`../adr/README.md`](../adr/README.md)**, not the per-document numbers used
inside the findings files — the two research rounds were written in parallel and collided on
0017–0025. The mapping is in that file.

## Ledger

| # | Question | Brief | Status | Findings | Evidence | ADR action |
|---|---|---|---|---|---|---|
| 1 | Is the MCDA vocabulary right — alternatives, criteria, subject, "decision matrix"? | [terminology](terminology.md) §1 | answered | [findings-terminology](findings-terminology.md) §1 | strong | ADR-0003 **amend** (drop "decision matrix" for *performance matrix* / *consequence table*; default display alias "options"); new **0018** |
| 2 | Do criteria carry a direction of preference and a declared range? | [terminology](terminology.md) §1, §3 | answered — **they must**; the schema modelled a bare attribute | [findings-terminology](findings-terminology.md) §1–2 | strong | new **0018** — *blocks Phase 1* |
| 3 | Is "1–5 ratings are ordinal, do not average them" defensible? | [terminology](terminology.md) §2 | answered — defensible, but on the wrong grounds: lead with non-compensation, keep Stevens as secondary and record the robustness counter-case | [findings-terminology](findings-terminology.md) §2 | strong | ADR-0003 **amend** (rationale); ADR-0015 **amend** |
| 4 | Which aggregation methods do we ship? | [terminology](terminology.md) §3 | answered — weighted sum only, opt-in, over *declared* ranges; TOPSIS, AHP, PROMETHEE, ELECTRE III rejected | [findings-terminology](findings-terminology.md) §3.2 | strong | ADR-0015 **amend**; new **0018**, **0020** |
| 5 | Is our "veto criterion with a threshold" ELECTRE's veto threshold? | [terminology](terminology.md) §3 | answered — **no; ADR-0015's claim is factually wrong.** It is conjunctive (non-compensatory) screening; ELECTRE's `v_j` bounds a *pairwise difference* | [findings-terminology](findings-terminology.md) §3.1 | strong | ADR-0015 **amend** (rename the field `acceptability`) |
| 6 | How is Pareto dominance defined when cells are missing? | [terminology](terminology.md) §3–4 | answered — necessary/possible dominance over interval completions, on a **fixed** comparison basis; the per-pair rule is non-transitive [3] | [findings-terminology](findings-terminology.md) §3.3, §7 conflict G | strong | new **0019** — *blocks Phase 1* |
| 7 | Are the five missingness reason codes right, and should the set be extensible? | [terminology](terminology.md) §4 | answered — rename `unknown`→`indeterminate`, `pending`→`deferred`, add `not-evidenced`; open set, closed core, mandatory `structural`/`terminal` flags | [findings-terminology](findings-terminology.md) §4 | strong (rendering: moderate) | ADR-0009 **amend** |
| 8 | May we aggregate over a sparse matrix at all, and how is completeness reported? | [terminology](terminology.md) §4 | answered — coverage gate (point aggregate at 1.0, interval to 2/3, nothing below); five counts, three rates | [findings-terminology](findings-terminology.md) §4 | strong (ISO wording caveated) | ADR-0015 **amend**; ADR-0009 **amend** |
| 9 | Is a value's *disclosure* the same thing as its *absence*? | [terminology](terminology.md) §4 | answered — no; redaction must be a projection, not an edit | [findings-terminology](findings-terminology.md) §7 conflict B | strong | new **0021** |
| 10 | Which agreement statistic for multi-rater ordinal data with missing cells? | [terminology](terminology.md) §5 | answered — Krippendorff's alpha [4], **per criterion**, never per cell; reproduced against the published dataset | [findings-terminology](findings-terminology.md) §5 | strong | ADR-0011 **confirm**; new **0022** |
| 11 | Should Delphi-style rounds be schema data? | [terminology](terminology.md) §5 | answered — yes, in Phase 1 (~15 lines now vs a migration through every stored analysis later) | [findings-terminology](findings-terminology.md) §5 | moderate | new **0023** |
| 12 | How is disagreement displayed without implying a mean? | [terminology](terminology.md) §5 | answered — a rater dot strip; no mark where a mean would be | [findings-terminology](findings-terminology.md) §5 | moderate | new **0024**; ADR-0011 **amend** |
| 13 | What do we steal from prior art, and how does an annotation survive reorder and rename? | [terminology](terminology.md) §6 | answered — anchors are tuples of stable opaque ids; never a position, never a label | [findings-terminology](findings-terminology.md) §6.1–6.2 | strong (anchoring), moderate (product sweep) | ADR-0007 **amend**; ADR-0011 **amend** |
| 14 | Which seriation algorithm, and which distance? | [visualisation](visualisation.md) §1 | answered — optimal leaf ordering [8] over a missingness-aware Gower distance [7], per axis independently; the eigen family rejected | [findings-visualisation](findings-visualisation.md) §1 | strong | ADR-0008 **amend** (consider supersede); new **0025** |
| 15 | Which views ship in v1, and which are declined? | [visualisation](visualisation.md) §2 | answered — matrix + dot-plot small multiples + Pareto scatter + gated rank-flow; parallel coordinates deferred, radar declined outright | [findings-visualisation](findings-visualisation.md) §2 | moderate | new **0026** |
| 16 | How is uncertainty encoded honestly, and what does the blend actually buy? | [visualisation](visualisation.md) §3 | answered — VSUP [5] as published, with two documented deviations; the measured effect is on *choices*, not on reading accuracy | [findings-visualisation](findings-visualisation.md) §3 | strong (construction), moderate (effect) | ADR-0010 **amend** |
| 17 | How is reorder made genuinely accessible, and what is the right ARIA pattern? | [visualisation](visualisation.md) §4 | answered — keyboard-and-menu path is the reference implementation and is **normative** [6]; a real `<table role="grid">` with roving tabindex | [findings-visualisation](findings-visualisation.md) §4.1–4.4 | strong | ADR-0008 **amend**; new **0027** |
| 18 | Which channel survives colour-vision deficiency, forced-colors and print at once? | [visualisation](visualisation.md) §5 | answered — the **foreground**; `background-image` computes to `none` under forced colors, so hatching and the ramp vanish together | [findings-visualisation](findings-visualisation.md) §4.5 | strong | new **0028** |
| 19 | What stops "accessibility is not a later pass" being an aspiration? | [visualisation](visualisation.md) §5 | answered — promote the checklist to a merge gate | [findings-visualisation](findings-visualisation.md) §4.6 | reasoning on the checks | new **0029** |
| 20 | Which framework and schema library survive the mailed-file constraint? | [visualisation](visualisation.md) §5 (stack); [terminology](terminology.md) §6 | answered — Preact and `zod/mini`, measured; registries populated by the composition root | [findings-visualisation](findings-visualisation.md) §5; [findings-terminology](findings-terminology.md) §6.3 | strong (measured) | new **0017**; ADR-0004/0005 **confirm with note**; ADR-0013 **amend** |
| 21 | Does the persistence port exist as ADR-0006 describes it? | [terminology](terminology.md) §6 | answered — **no.** There is no key-value "zodal store"; `@zodal/store` provides `DataProvider<T>`, and its `getCapabilities()` is the graceful-degradation mechanism ADR-0013 asks for and does not name | [findings-terminology](findings-terminology.md) §6.3; [findings-visualisation](findings-visualisation.md) §5.4 | strong (source read) | ADR-0006 **amend**; ADR-0013 **amend** |

Each findings file also carries a finer-grained decision table — 32 rows in
[findings-terminology](findings-terminology.md), 28 in
[findings-visualisation](findings-visualisation.md) — intended to be read on its own before starting
work. This ledger indexes the questions; those tables index the answers.

**Three findings block Phase 1 schema work**: rows 2 (direction of preference), 2 again (declared
range) and 6 (dominance semantics). Nothing in ADR-0015 is implementable correctly without them.

## Briefs

The questions, written before the answers existed.

- [`terminology.md`](terminology.md) — vocabulary, levels of measurement, aggregation, missingness,
  multi-rater agreement, prior art. Phase 0, before schema code.
- [`visualisation.md`](visualisation.md) — the reorderable matrix and seriation, which views to
  ship, uncertainty encoding, interaction and accessibility. Phase 0, before view code.

## Findings

The synthesis. Each states what was decided, resolves the places where two working sections
recommend incompatible things, lists recommended ADR actions, and ends with what it did **not**
settle.

- [`findings-terminology.md`](findings-terminology.md) — 32 decisions, eight resolved conflicts,
  eight recommended new ADRs, 19 open questions. Headline results: criteria need a direction of
  preference and a declared range; ADR-0015's ELECTRE claim is wrong; dominance over missing cells
  must be necessary/possible on a fixed basis; Krippendorff's alpha confirmed and belongs per
  criterion.
- [`findings-visualisation.md`](findings-visualisation.md) — 28 decisions, eight resolved conflicts,
  six recommended new ADRs, 18 open questions. Headline results: one seriation algorithm (OLO over
  missingness-aware Gower); radar declined outright; VSUP implemented as published with two
  documented deviations; the keyboard reorder path is normative, not a courtesy; Preact and
  `zod/mini` on measured bytes.

## Sections (working notes)

One per research question, and the evidence of record. Read these when a claim in a findings file
needs its full chain.

- [`sections/c1-terminology.md`](sections/c1-terminology.md) — MCDA vocabulary, Pugh matrices and
  the datum column, consequence tables, even-swaps, and what comparable products call these things.
- [`sections/c2-measurement-and-aggregation.md`](sections/c2-measurement-and-aggregation.md) — what
  arithmetic is legal on this data; weighted sum, TOPSIS, AHP, PROMETHEE, ELECTRE, dominance and
  sensitivity analysis, each with its assumptions and failure modes.
- [`sections/c3-missingness.md`](sections/c3-missingness.md) — SDMX, HL7/FHIR and survey
  vocabularies for observation status; MCAR/MAR/MNAR as rationale not content; incomplete decision
  matrices; completeness reporting; rendering absence without colour.
- [`sections/c4-agreement.md`](sections/c4-agreement.md) — Krippendorff's alpha verified
  numerically, why kappa and ICC are wrong here, what Delphi says about running rounds well, and
  how to show disagreement in a 40 x 30 px cell.
- [`sections/c5-seriation.md`](sections/c5-seriation.md) — what Bertin actually claimed, the
  seriation algorithm families, the R `seriation` package's defaults, and the distance for ordinal
  rows with missing cells.
- [`sections/c6-views-and-uncertainty.md`](sections/c6-views-and-uncertainty.md) — which secondary
  views earn their place, the exact VSUP construction, which uncertainty channels survive a dense
  table, and computing ink from the actually-rendered background.
- [`sections/c7-interaction-a11y.md`](sections/c7-interaction-a11y.md) — accessible reordering,
  real screen-reader behaviour of grid semantics, sticky headers, progressive disclosure, and the
  channel that survives forced colors and print.
- [`sections/c8-prior-art-and-stack.md`](sections/c8-prior-art-and-stack.md) — the prior-art sweep
  (best idea / worst mistake each), annotation anchoring, and the framework and bundle measurements
  under the mailed-file constraint.

## Review

- [`phase0-review.md`](./phase0-review.md) — an adversarial review of the round-1 *recommendations*
  (their citations were audited separately). Covers both repositories. **Read its calibration
  section first**: a refutation-biased first round refuted 21 of 21 and was worthless; a fair
  second round found 7 confirmed, 22 partly real, 27 refuted — and downgraded **every one** of the
  twelve candidates that claimed `blocking`. Treat severity claims as upper bounds.
- [`phase0-review-candidates.md`](./phase0-review-candidates.md) — the superseded interim file,
  written when the review was half-finished. Kept for the calibration record; do not act on it.

## Open questions

Carried forward. The two findings files hold 37 between them; these are the ones that gate work or
that a human must personally settle. The rest — including the acknowledged evidence gaps, recorded
so nobody re-derives them — are in
[findings-terminology §9](findings-terminology.md) and
[findings-visualisation §9](findings-visualisation.md).

**Gates a schema decision (Phase 1).**

| Question | Interim position | Settled by |
|---|---|---|
| Dominance over a `target` criterion needs a distance metric, which smuggles a cardinal assumption back in | ship `target` in the schema, exclude it from strict dominance in v1, say so in the UI | writing the messy ADR-0016 example with a target criterion and seeing what the report can honestly say |
| What interval does a missing cell take on a *nominal* criterion? There is no `[min, max]`, so necessary dominance is undefined | exclude nominal criteria from dominance when missing, and report the exclusion | a Phase 2 decision; needs no new evidence |
| Is renaming `unknown` worth the churn on an accepted, published code set? | rename | writing both code sets into `rubricator`'s prompts, running one real analysis each way, counting reaches for the catch-all |
| Should `withheld` live in the reason set at all, or only in the disclosure layer? | both; mild duplication accepted | whether any deployment needs an analysis in which nobody may store the value |
| Is 2/3 the right coverage floor for matrices of *this* size? The sources are a 133-economy index; ours are ~22 x 12 | 2/3, provisionally | a simulation over the example datasets, before the default is fixed — cheap, and worth doing first |
| Is a Pugh round the same object as a Delphi round? | one `rounds` collection serves both | a Phase 4 decision once rounds exist |

**Gates a view decision (Phase 3), and is cheap to settle by building rather than reading.**

- How many hatch densities are distinguishable in a 24–40 px cell that also carries text.
- Whether the composited `uncertainty-suppressed` palette stays CVD-separable at the confidence
  extremes — run the check **before the palette is frozen**; if steps collapse, the fix is fewer
  value steps, not a different hue.
- Whether `value` and `uncertainty-suppressed` can share a ramp, given that they pull in opposite
  directions on lightness.
- Which measure drives the arrangement by default: the score, `confidence`, or the active encoding.
- Whether the dot strip beats the spread ramp for "find the contested cell". Interim position: ship
  both, make switching one keystroke.
- Whether the dashed-vs-solid `terminal` border reads at cell scale, in both themes, in greyscale
  and under forced colors.

**Needs a human, not more research.**

- **The ADR number allocation.** Two research rounds proposed overlapping blocks. A consolidated
  allocation is recommended in [`../adr/README.md`](../adr/README.md); nothing in
  the content depends on the numbers, but they must be assigned once, in one pass, before any ADR
  is written.
- ~~**Re-verify the ELECTRE chapter's wording.**~~ **Settled 2026-08-22 — no longer needs a human.**
  All four quotations underpinning row 5 were re-verified verbatim against a retrievable full-text
  copy (§2.1, §2.2, §2.4 ×2), together with a fifth passage at §3.1.2 that independently corroborates
  the correction. Section numbers are recorded in the reference entries in place of a URL, because
  the copy is a third-party mirror and the last one rotted. ADR-0015 carries the record as its
  2026-08-22 amendment; issue #36 is closed.
- **Two further sources could not be reached at audit time** (a data-visualisation style guide
  behind the texture-reservation rule, and the ISO/IEC 25012 normative text). Both arguments survive
  without them; no ADR should quote them.

**Deferred deliberately.**

- Confidence *about* a missing value ("how sure are we the sources really are silent?") is
  meaningful and doubles the cell state space. `Missing.note` and `Missing.evidence` are the cheap
  version and ship in Phase 1.
- Svelte and Solid were not measured, and no primary comparable figure was located. Both plausibly
  land near Preact and the compiler-coupling argument is expected to decide it regardless — but that
  expectation is reasoning, not evidence.
- The realistic total bundle size and the size of a real analysis payload inlined. Both are
  discovered by building the messy example once Phase 1 exists, under a byte budget set at Phase 3
  rather than measured late.

## REFERENCES

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [The Pugh Controlled Convergence Method: Model-Based Evaluation and Implications for Design Theory — Frey, Herder, Wijnia, Subrahmanian, Katsikopoulos & Clausing, Research in Engineering Design 20 (2009)](https://dspace.mit.edu/handle/1721.1/49448)
3. [Skyline Query Processing for Incomplete Data — Khalefa, Mokbel & Levandoski, ICDE 2008](https://dmlab.cs.umn.edu/new/papers/ICDE08_Skyline.pdf)
4. [Computing Krippendorff's Alpha-Reliability — Klaus Krippendorff (2011, literature updated 2013)](https://www.asc.upenn.edu/sites/default/files/2021-03/Computing%20Krippendorff's%20Alpha-Reliability.pdf)
5. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer, CHI 2018](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
6. [Understanding SC 2.5.7: Dragging Movements (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
7. [A General Coefficient of Similarity and Some of Its Properties — J. C. Gower, Biometrics 27(4) (1971)](https://mathematics.foi.hr/Rprojekti/BDP%20concept/Gover_metric.pdf)
8. [Fast optimal leaf ordering for hierarchical clustering — Bar-Joseph, Gifford & Jaakkola, Bioinformatics 17(suppl_1) (2001)](https://people.csail.mit.edu/tommi/papers/BarGifJaa-ismb01.pdf)
