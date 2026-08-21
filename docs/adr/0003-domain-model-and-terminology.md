# ADR-0003: Adopt MCDA terminology, and separate measures from encodings

- **Status:** accepted
- **Date:** 2026-08-18

## Context
The originating sketch used ad-hoc terms — "items", "features", "metric" — for concepts that
already have standard names in multi-criteria decision analysis. It also grouped `score`,
`confidence` and `blended` into a single dimension called "metric".

## Decision
1. Adopt MCDA vocabulary internally: **alternatives**, **criteria**, **decision matrix**,
   **subject**. Support per-analysis display aliases so the UI can say "directions" and "axes"
   without the data changing.
2. Separate **measures** (stored: `score`, `confidence`) from **encodings** (derived, view-layer:
   `score`, `confidence`, `blended`). The data tensor is `alternatives × criteria × measures`;
   encodings are named mappings from measures to visual channels.
3. Type every value by **level of measurement** (nominal / ordinal / interval / ratio), declared
   per `(criterion, measure)` with a per-criterion default.

See [../domain-model.md](../domain-model.md) for the full treatment and the reasoning.

## Consequences
- Adding a new way to *look* at existing data costs nothing in the schema.
- The tooling can refuse illegal operations — most importantly, it knows that a 1–5 rating is
  ordinal and that averaging it is a category error rather than a rounding concern.
- Anyone arriving from an MCDA background reads the codebase without translation, and the
  research phase can cite literature directly.

## Alternatives considered
- *Keep "items" and "features".* Friendlier, but disconnects the project from a literature it
  will need repeatedly, and collides with "feature" in the ML sense.
- *Treat `blended` as a stored measure.* Would require storing derived data and special-casing one
  member of a uniform dimension.

---

## Amendments

### 2026-08-21 — The grid is a performance matrix, and the no-total argument rests on non-compensation

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Phase 0 terminology research revisited this ADR's vocabulary and found one name wrong and one
justification weak. Four changes; the original Decision and Consequences above stand except where
this section names a replacement.

**1. "Decision matrix" is dropped.** Decision 1's list of adopted terms loses it. The grid is a
**performance matrix** (the MCDA name) or a **consequence table** (the decision-analysis name); the
internal key stays `matrix`, unchanged, and no schema key moves. The government MCDA manual gives
both names in one definitional sentence — "a performance matrix, or consequence table, in which
each row describes an option and each column describes the performance of the options against each
criterion" [1 §4.3.2] — and the structured-decision-making community uses the second [2]. "Decision
matrix" is the outlier we adopted: it is the popular-press term, its most-read definition puts
criteria on the **rows**, the transpose of ours [3], and it asserts the one thing ADR-0002 and
ADR-0015 both deny — that the artefact *is* the decision. "Consequence table" says the cells hold
consequences, which is ADR-0015's stance exactly. `docs/domain-model.md` and the README carry the
term only as a rejected alternative from here on.

The same sentence hands ADR-0015 its strongest external support: "In a basic form of MCA this
performance matrix may be the final product of the analysis" [1 §4.3.2]. A government methodology
standard endorsing our default presentation is worth quoting where users can see it.

**2. The default display alias for alternatives is "options".** This sets a default for the
aliasing slot Decision 1 already created; it renames nothing. The internal name stays
`alternatives`, aliases stay per-analysis settings, and any deployment may still say *directions*,
*vendors* or *candidates*. The split is real and consistent: specialist material says
*alternatives*, user-facing material says *options*, and the cost-benefit literature concedes the
overlap outright — alternatives are "often called options" [4]. The manual's own definitional
sentence says "each row describes an option" [1 §4.3.2], and the decision products written for
non-specialists say the same [5, 6]. Defaulting to the word people already use costs nothing,
because the internal name never changes.

**3. The averaging argument is replaced.** The Consequences bullet claiming that "averaging [a 1–5
rating] is a category error" overstates a contested position and rests the case on its weakest
support. It is replaced by a two-part argument, in this order:

- **Non-compensation, which nobody disputes.** A weighted sum is *fully compensatory*: a loss on
  one criterion is always redeemable by a gain on another. The outranking literature treats the
  unacceptability of that trade as one of the named conditions under which non-compensatory methods
  are the right family [7, 8]. Whether or not the arithmetic is legal, the *substitution it
  performs* is a value judgement the reader never made. This is what carries the no-total-column
  stance in ADR-0015, and it is the discriminator to apply to any future proposal: the question is
  whether a compensatory aggregate is being **reported as a value**, not whether arithmetic touches
  ordinal codes anywhere.
- **Stevens's invariance [9], recorded as contested.** The typology has been argued against for
  thirty years [10], parametric statistics are robust to violating it [11], and Carifio and Perla's
  sharper objection is that the debate conflates a response *format* with a measurement *scale*
  [12]. That counter-case is real and we record it rather than omit it. It does not reach us, for
  three reasons set out in `docs/research/findings-terminology.md` § 2: we are describing, not
  inferring, so robustness results about the F-test say nothing about a total over a dozen numbers
  with n = 1; a row of criteria is not a scale in Carifio and Perla's sense, because our criteria
  are chosen to be *non-redundant* and their emergent-interval argument needs redundancy; and
  averaging does not rescue ordinal data anyway — treating it as metric can invert the ordering of
  means, and "averaging across multiple ordinal measurements does not solve or even ameliorate
  these problems" [13]. That failure is silent, which is the point: a tool cannot warn you that
  your mean is inverted.

Decision 3 is unaffected — every value still declares its level of measurement, and the tooling
still uses it to shape what is on offer. What changes is the reason it gives when it declines.

**4. Decision 2 has paid for itself four times.** The measures-versus-encodings split was a bet that
new ways of *looking* at existing data would cost nothing in the schema. Four encodings arrived out
of Phase 0 — the Pugh **datum** mark, **missingness**, **disagreement**, and
**consensus-suppressed** — and all four are read-only mappings over measures already stored. Zero
schema change, four times. Recorded as confirmation, not as a change.

#### References for this amendment

Full reasoning and the complete literature: `docs/research/findings-terminology.md` §§ 1–2.

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [The Consequence Table — StructuredDecisionMaking.org](https://www.structureddecisionmaking.org/the-steps/the-consequence-table/) — its orientation is read off its worked-example images; the prose never says "row" or "column".
3. [Decision matrix — Wikipedia](https://en.wikipedia.org/wiki/Decision_matrix) — cited as the most widely-read definition of the term, and for its criteria-in-rows orientation.
4. [Choosing By Advantages (CBA) — Lean Construction Institute](https://leanconstruction.org/lean-topics/choosing-by-advantages/) — definitions originate with Jim Suhr, *The Choosing By Advantages Decisionmaking System* (1999), not read directly.
5. [Analytic Hierarchy Process: A Complete Guide — TransparentChoice](https://www.transparentchoice.com/analytic-hierarchy-process)
6. [Polls — Loomio Help](https://www.loomio.com/docs/en/user_manual/polls/proposal_types)
7. [The outranking approach and the foundations of ELECTRE methods — B. Roy, *Theory and Decision* 31:49–73 (1991)](https://link.springer.com/article/10.1007/BF00134132)
8. [Electre Methods — J. Figueira, V. Mousseau & B. Roy, in *Multiple Criteria Decision Analysis: State of the Art Surveys*, pp. 133–153 (2005)](https://doi.org/10.1007/0-387-23081-5_4) — closed access and the copy the research transcribed from is no longer online, so its wording is **not** quoted here; the substantive claim rests on [7].
9. [On the Theory of Scales of Measurement — S. S. Stevens (1946)](https://www.science.org/doi/10.1126/science.103.2684.677)
10. [Nominal, Ordinal, Interval, and Ratio Typologies Are Misleading — P. F. Velleman & L. Wilkinson (1993)](https://www.tandfonline.com/doi/abs/10.1080/00031305.1993.10475938)
11. [Likert scales, levels of measurement and the "laws" of statistics — G. Norman (2010)](https://link.springer.com/article/10.1007/s10459-010-9222-y) — paywalled; the quoted sentence is from the abstract.
12. [Ten Common Misunderstandings … about Likert Scales and Likert Response Formats and their Antidotes — J. Carifio & R. J. Perla (2007)](https://thescipub.com/abstract/jssp.2007.106.116) — read directly; quotations verbatim.
13. [Analyzing ordinal data with metric models: What could possibly go wrong? — T. M. Liddell & J. K. Kruschke (2018)](https://scholarworks.iu.edu/dspace/items/9bcd0f5e-7837-4f9c-ac07-a114e595e146)
