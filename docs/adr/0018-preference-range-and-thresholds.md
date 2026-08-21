# ADR-0018: Criteria carry a direction of preference, a declared range, and optional thresholds

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0003 adopted the word "criterion" and then modelled a bare attribute. In the tradition it cites
those are not the same thing. "Attribute" belongs to the *measurement* question; a **criterion** is
an attribute *plus a direction of preference*, and dominance-based methods make that operational by
requiring a preference relation on every attribute in the family [2 §3]. The government MCDA manual
switches to "criterion" for exactly this reason [1 §2.1].

The gap is not cosmetic. ADR-0015 ships two flagship analyses that are *undefined* without a
direction. Dominance is performing "at least as well as another on all criteria and strictly better
... on at least one" [1 §4.5] — "at least as well as" has no referent until something declares which
way is better. Screening's "falls below" silently assumes higher-is-better on every column, and the
first cost criterion breaks it.

Separately, nothing in the schema declares the *range* a criterion is measured over, and three
different mechanisms need one. The evidence is in `docs/research/findings-terminology.md` §1–2; the
two design collisions this resolves are its §7 Conflicts E and F.

## Decision
Each `(criterion, measure)` declares, beside its level of measurement, three things. Following
ADR-0003, the declaration sits on the pair and takes a per-criterion default, so the common case
stays terse.

**1. A `preference`, one of five kinds.**

- `increasing` — a gain criterion: higher is better.
- `decreasing` — a cost criterion: lower is better.
- `target` — an ideal value is declared, and closeness to it is better.
- `ordered` — an explicit best-to-worst order over levels that would otherwise read as nominal.
- `none` — a descriptive column carrying no judgement.

`increasing` and `decreasing` are invalid on a nominal criterion, which has no order to move along;
such a criterion uses `ordered` or `none`.

`none` **excludes** the criterion from dominance, screening and the datum encoding, and **any
analysis result that excludes a criterion names it**. "Dominated on all criteria", computed over
four of nine columns, is a different claim from the one a reader hears, and the difference belongs
on the page rather than in documentation elsewhere.

`target` ships in the schema and is **excluded from strict dominance in v1**, and the report says
so. Ordering by closeness to an ideal needs a distance, and a distance reintroduces the cardinal
assumption ADR-0003's measurement rules exist to keep out (findings §9, open question 1).

**2. A `range`** — required on ordinal, interval and ratio. On an ordinal criterion the declared
ordered set of levels *is* the range. It does three separate jobs, and no other field does any of
them:

- it supplies the interval bounds a contingently missing cell widens to, which is what makes
  dominance over an incomplete matrix well-defined (ADR-0019);
- it is the *declared* normalisation for opt-in weighted aggregation, which is what keeps that
  aggregation free of the rank reversal afflicting relatively-normalised methods [3];
- it is the scale an elicited weight is elicited *against*. A weighted-sum weight is a scaling
  constant tied to a criterion's range and means nothing without it [4].

**3. Optional `indifference` (`q`) and `preferenceThreshold` (`p`)**, taking their names and
semantics from the outranking family [5, 6]: `q` is the difference small enough to be noise, `p` the
difference large enough to be a strict preference. Each is interpreted by the criterion's declared
level — a count of levels on ordinal, a quantity in the criterion's own units on interval and ratio,
and **invalid on nominal**. Counting steps is a ranking operation; measuring a distance in units is
not, and an ordinal criterion may not do the second.

`direction` is deliberately **not** a field of `range`. It would duplicate `preference`, and two
sources of truth for one fact drift.

**An aggregation refuses to run over a criterion with no declared range**, rather than substituting
observed extrema. This is a decision, not a caution: the refusal is the value of shipping the
aggregation at all.

## Consequences
Authoring a criterion costs two more fields, and a column that means nothing directional has to say
so out loud. In exchange, dominance, screening, the datum encoding and normalisation all become
well-defined, and the tooling can decline an illegal operation with a specific reason instead of
producing a plausible wrong number — the same move ADR-0003 made for levels of measurement.

`range` also lands an obligation on the producing side that no schema request asked for. `rubricator`
has no slot for it today: it must appear in the schema sketch, it is a derived constant for a fixed
1–5 ordinal scale, and it has to be genuinely elicited when a criterion is typed ratio, which this
ADR forbids inferring from the data. Changing a declared range changes what every stored score
means, so a range change belongs on the criterion-revision invalidation trigger list beside the
question, the scale and the preference. Recording that here does not discharge it; the cross-repo
coordination document still needs the matching entry.

## Alternatives considered
- *Infer the direction from the criterion's name, or from the data.* Guessing the sign of "cost" is
  the exact failure this ADR exists to prevent.
- *Normalise against observed extrema instead of a declared range.* This is what makes methods
  rank-reversal-prone [3]: adding one alternative silently moves every other score.
- *Put `direction` inside `range`.* Two sources of truth for one fact, and the richer `preference`
  union — target, ordered, none — cannot be expressed as a direction at all.
- *Ship `target` with a distance metric in v1.* Buys a dominance result on target criteria at the
  cost of a cardinal assumption smuggled in below the level of measurement. Deferred, not refused.
- *Leave `range` optional and warn.* A warning next to a number is read as a number. The refusal is
  the product.

## References
1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [Dominance-based Rough Set Approach, basic ideas and main trends — Błaszczyński, Greco, Matarazzo & Szeląg, arXiv:2210.03233 (2022)](https://arxiv.org/pdf/2210.03233) — the "consistent family of criteria" properties are attributed there to Roy & Bouyssou (1993), which was not read directly.
3. [The Rank Reversal Problem in Multi-Criteria Decision Making: A Literature Review — Aires & Ferreira (2018)](https://www.scielo.br/j/pope/a/BPwgsywPZqgctBDcfPXxczg/?lang=en)
4. [Common Mistakes in Making Value Trade-Offs — R. L. Keeney, Operations Research 50(6) (2002)](https://pubsonline.informs.org/doi/10.1287/opre.50.6.935.357) — abstract verified; full text paywalled.
5. [A Preference Ranking Organisation Method: The PROMETHEE Method for Multiple Criteria Decision-Making — Brans & Vincke, Management Science 31(6) (1985)](https://pubsonline.informs.org/doi/10.1287/mnsc.31.6.647)
6. [The outranking approach and the foundations of ELECTRE methods — B. Roy (1991)](https://link.springer.com/article/10.1007/BF00134132)

The ELECTRE survey chapter that the research quotes for the `q`/`p`/`v` triple is closed access and
the transcribed copy is gone, so it is cited here through Roy's foundational paper instead and is
not quoted. Full provenance for every claim above: `docs/research/findings-terminology.md`.
