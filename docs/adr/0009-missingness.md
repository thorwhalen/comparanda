# ADR-0009: Absence is qualified and visually distinct

- **Status:** accepted
- **Date:** 2026-08-18

## Context
In every comparison table that matters, some cells are empty, and the reasons are not
interchangeable. "Does not apply" and "nobody has checked" look identical in a spreadsheet and
mean opposite things about whether the analysis is finished.

## Decision
No bare nulls. Every absence carries a reason code from a closed, schema-declared set. The initial
set — `not-applicable`, `not-assessed`, `pending`, `unknown`, `withheld` — is defined in
[../domain-model.md](../domain-model.md), and analyses may extend it.

Requirements:
- **Structural vs contingent absence is queryable.** "What is left to do here" must be answerable,
  which means `not-applicable` is excluded from completeness counts and the others are not.
- **The view distinguishes them**, and not by colour alone — a hatch, a glyph, an empty cell with a
  rule. `not-applicable` should read as "correctly nothing"; `not-assessed` should read as a gap.
- **An agent can be instructed to leave cells blank with a reason.** "Fill Pain and Market for all
  alternatives, mark everything else `pending`" is a supported instruction, and the resulting
  document is valid and complete-as-specified rather than half-broken.
- **Completeness is reportable** at analysis, row, column and group level.

## Consequences
Slightly heavier authoring, and worth it. The alternative — a nullable value — pushes the
distinction into a comment field where it cannot be counted or filtered.

## Amendments

### 2026-08-21 — Reason codes become flagged, parented objects

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section amends the Decision above. The Context and the Consequences stand as written, and so
does every requirement in the Decision except where a clause here replaces one. The evidence is in
`docs/research/findings-terminology.md` § 4; this is the ruling, not the argument.

**1. Two renames and one new code.** `pending` becomes `deferred`. `unknown` becomes
`indeterminate`. `not-evidenced` joins the set. The renames are not taste. In HL7 v3, `UNK` is the
*parent* of the whole not-known branch and `ASKU` ("information was sought but not found") is a leaf
under it [1]; FHIR R4 flattens the same structure, with `unknown` standing beside `asked-unknown`
and `not-asked` [2]. This ADR defined `unknown` as the `ASKU` leaf while spelling it with the word
both vocabularies reserve for the catch-all — so a reader who has touched a clinical, statistical or
database schema will take it for the fallback and use it as one, which is the silent blank this ADR
exists to abolish. The risk is worst in the runtime where it matters most: an agent under
instruction-following pressure reaches for the vaguest legal code. `not-evidenced` closes a real
hole. "We searched and the sources are silent" is a fact about the alternative and its
documentation, and is frequently the finding itself; "we found material and could not resolve it to
a level" is a fact about the criterion and the evidence, and usually means the criteria discussion
is unfinished. Collapsing both into one code destroys the more useful of the two signals.

**2. The core set is these six codes, and each carries flags.**

| code | `structural` | `terminal` | `informative` | reads as |
|---|---|---|---|---|
| `not-applicable` | **true** | true | true | "correctly nothing" |
| `not-assessed` | false | **false** | false | "a gap" |
| `deferred` (was `pending`) | false | **false** | false | "a gap, on purpose, for now" |
| `not-evidenced` (**new**) | false | true | **true** | "we looked; the sources are silent" |
| `indeterminate` (was `unknown`) | false | true | true | "we looked; we could not tell" |
| `withheld` | false | true | false | "known, not shown here" |

`structural` says the cell is not a gap because there was never a question to answer. `terminal`
says no further work is expected on this cell. `informative` is advisory: it says the absence is
itself evidence about the subject.

**3. The set is open; every code is an object.** This replaces the Decision's unresolved
"closed, schema-declared set … and analyses may extend it". A reason code — core or custom — is a
first-class object declaring `broader` (an ancestor in the closed six-code core), the mandatory
`structural` and `terminal` flags, the advisory `informative` flag, and its display fields. The two
mandatory flags drive every completeness computation and every rendering decision, so **no code
anywhere in this system may `switch` on a literal reason code** — a downstream deployment's custom
code degrades to its `broader` ancestor instead of breaking the completeness report. This is the
"decomposition" design SDMX judged the stronger of its two options and declined only on
migration-cost grounds that do not apply to a greenfield schema [3]. Three constraints:
`structural: true` requires `broader === 'not-applicable'`; no custom code may be a schema default;
and codes travel inside the document, so a standalone bundle needs no registry to be readable.

**4. Completeness exclusion keys on the flag, not on the string.** The Decision's requirement that
`not-applicable` be excluded from completeness counts is replaced by: **codes with
`structural: true` are excluded; all others are counted.** ISO/IEC 25012 defines completeness
against the attributes *expected in a specific context of use* [4], and every vocabulary surveyed
puts structural absence outside the count. Keying on the literal string is the same rule written so
that a custom structural code silently breaks it.

**5. Completeness reports five counts and three rates, per measure.** Per measure, because the
tensor is alternatives × criteria × measures and a cell routinely carries a `score` and no
`confidence`. The counts are `applicable`, `inapplicable`, `valued`, `resolved-absent`,
`outstanding`. The rates are:

- **`assessedRate` = valued / applicable** — how much carries a value;
- **`settledRate` = (valued + resolved-absent) / applicable** — how much has been *looked at*. This
  is what answers "is the analysis finished", and it makes this ADR's "complete-as-specified rather
  than half-broken" requirement literal: an analysis deliberately full of qualified blanks reaches
  `settledRate = 1.0` while `assessedRate` stays low;
- **`silenceRate`** — the share of the applicable matrix where we looked and the absence is itself a
  statement about the subject. At criterion level it is the strongest available evidence that a
  criterion is badly framed.

**Ship `assessedRate` and `settledRate` together; never ship only one.** Every rate renders as a
fraction — "34 / 51 applicable", never a bare "67%", which hides whether the denominator shrank
because work was done or because a block was declared inapplicable.

**6. Structural absence wins.** Where a group-pair inapplicability rule and an author-set contingent
code disagree about the same cell, the inapplicability rule takes precedence [3]. Declaring the
precedence is the point; either answer alone would be defensible, and silence would not be.

**7. Rubin's MCAR/MAR/MNAR taxonomy [5] is rationale, never stored content.** No field records a
missingness mechanism, and nothing asks an author to classify a blank. Every premise of the
taxonomy fails here — alternatives are purposively chosen rather than sampled, the analysis is one
document authored once, there is no estimator whose bias the classification characterises, and we
already record the reason directly. The taxonomy is cited in exactly one place: the point-of-use
copy explaining why the opt-in aggregation dialog defaults to not imputing [6]. The engineering
response to the MNAR insight is to keep absence as a first-class inspectable feature rather than
smoothing it away [7], and we already have three of those: the `informative` flag, the
`not-evidenced` code, and a `missingness` encoding registered under ADR-0010 that colours the grid
by reason instead of by measure.

**8. Replacing `unknown` is a per-site mapping, not a search-and-replace.** The literal has two
correct destinations. "No citable span for this cell" resolves to `not-evidenced`; "spans were found
and do not resolve to a level", and the resume semantics "someone looked and could not determine",
resolve to `indeterminate`. Any sweep of the old spellings — here or in the companion repo — decides
each site rather than substituting a string. This correction comes from `docs/research/phase0-review.md`,
"The missingness change is a semantic split, not a rename".

**9. Nothing here changes the view.** The Decision's requirement that the view distinguish the codes
without relying on colour alone stands unchanged and unextended. Which glyph carries which reason,
and which non-colour channel carries which flag, is decided in the accessibility ADR on non-colour
channels, not here.

**10. The delegation still points at `docs/domain-model.md`.** The Decision names that file as where
the set is defined, and that stands — but the definition there must be brought into line with the
table above, flags and `broader` included, since two repositories read it as the shared vocabulary.
Until it is, this section is the authority.

**On how this was settled.** The research named an experiment for this decision — write both code
sets into the companion repo's prompts, run one real analysis each way, count the reaches for the
catch-all — and it was not run. The coordination rule forbidding a code literal in the companion
repo before this disposition was recorded left no window for it before the gate, and the gate wanted
the answer first. The disposition above is therefore taken on argument: the vocabulary evidence
[1, 2] is strong, both repositories are still documentation-only so no stored analysis and no prompt
needs migrating, and deciding later costs a two-repo sweep that deciding now does not. The messy
example dataset is the place to check it against reality, and finding otherwise is grounds for a
superseding ADR, not a quiet edit.

### 2026-08-22 — `informative` ships, `silenceRate` narrows to it, and the shipped names are recorded

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

Three corrections, all of them the implementation catching up with clauses 2 and 5 above, plus one
divergence that had gone unrecorded. Nothing in the decision changes.

**1. `informative` exists now.** Clause 2 tabulates it for all six core codes and clause 5 defines
`silenceRate` in terms of it, but `MissingCodeFacts` carried only `structural`, `terminal` and
`means`, and `docs/domain-model.md`'s table carried only the first two. The flag is now in the
interface, in `CORE_MISSING_CODES` with clause 2's values verbatim, and in the domain model's table.
A decided-and-absent field is worse than an undecided one: it reads as settled to anyone checking
the ADR and is invisible to anyone reading the code.

**2. `silenceRate` narrows to match its own definition.** Clause 5 defines it as "the share of the
applicable matrix where we looked and the absence is itself a statement about the subject" — that
is `informative && terminal`. What shipped was `settledAbsent / applicable`: **every** terminal
absence, which lumps `withheld` (we know, we are not saying) in with `not-evidenced` (we looked,
the sources are silent). Only the second is evidence a reader can use, and `silenceRate` is the
number an honest agent moves and a careless one does not — so the wider quantity quietly weakened
the metric the honesty guarantee is measured by.

A new count, **`informativeAbsent`**, is a subset of `settledAbsent`, and the rate is computed from
it. `settledAbsent` is retained because `examinedRate` needs it and because "looked at and settled"
is a real quantity; it simply is not this one.

**3. `informative` is no longer merely advisory, and clause 3's wording is corrected to that
extent.** Clause 3 lists "the mandatory `structural` and `terminal` flags, the advisory
`informative` flag". Once `silenceRate` keys on it, it is load-bearing. Precisely:

- in **resolved facts** it is mandatory — `MissingCodeFacts.informative` is a required boolean, so
  no consumer ever meets an absent value;
- in a **declaration** it is optional and defaults from `broader`, exactly like `structural` and
  `terminal`, and an override is a real claim.

The override is the case that matters, because the world-versus-process axis cuts *across* the
silence-versus-conflict axis: a deployment code for "the source is paywalled" is a sensible
refinement of `not-evidenced` and is emphatically **not** informative about the subject. Inheriting
is a claim the declarer makes by choosing `broader`; overriding is a sharper one. An **undeclared**
code still resolves to `undefined` and counts as outstanding — guessing `informative` for a code
nobody declared would put an invention underneath the one metric the honesty claim rests on.

`not-applicable` keeps clause 2's `informative: true`, which is correct on its own terms — "this
criterion does not apply" is a real statement about the alternative — and is moot for the rate,
since structural absence leaves the denominator before any rate is computed.

**4. The shipped count and rate names differ from clause 5's, deliberately, and that was never
written down.** Recorded here so the next reader does not treat it as drift:

| clause 5 | shipped | why |
|---|---|---|
| `assessedRate` | **`valuedRate`** | both original names read naturally as "looked at" *and* as "carries a value" — which is how this ADR and the implementation came to define them as each other's opposite |
| `settledRate` | **`examinedRate`** | as above |
| `valued` | `present` | matches `hasValue` at the call site |
| `inapplicable` | `structural` | keys on the flag, as clause 4 requires, rather than restating the code |
| `resolved-absent` | `settledAbsent` | one word, and it is not a code |
| — | `total`, `informativeAbsent` | a rate with no denominator is unreadable; `informativeAbsent` is new here |

**Ship `examinedRate` and `valuedRate` together; never ship only one** — clause 5's rule, under the
shipped names.

A test pins all of this, including the `withheld` cell the two definitions disagree about. Four of
its assertions fail against the superseded `settledAbsent / applicable` definition, which was
verified by restoring that definition and watching them go red. A guard that cannot fail is not a
guard, and this repository has shipped three of those.

Closes #125.

#### References

1. [CodeSystem: NullFlavor (HL7 v3) — HL7 Terminology v6.0.2 (2024)](https://terminology.hl7.org/6.0.2/CodeSystem-v3-NullFlavor.html)
2. [CodeSystem: DataAbsentReason — HL7 FHIR R4 v4.0.1 (2019)](https://hl7.org/fhir/R4/codesystem-data-absent-reason.html)
3. [Possible Ways of Implementing CL_OBS_STATUS Code List — SDMX Statistical Working Group / Technical Working Group (2014)](https://sdmx.org/wp-content/uploads/CL_OBS_STATUS_implementation_20-10-2014.pdf)
4. [ISO/IEC 25012:2008 — Software engineering — SQuaRE — Data quality model](https://www.iso.org/standard/35736.html) — the normative text is paywalled and was not read; the completeness definition is taken from secondary sources and the argument does not turn on its exact wording.
5. [Inference and missing data — D. B. Rubin, Biometrika 63(3):581–592 (1976)](https://doi.org/10.1093/biomet/63.3.581)
6. [Handbook on Constructing Composite Indicators: Methodology and User Guide — OECD / JRC European Commission (2008)](https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf)
7. [The Missing Indicator Method: From Low to High Dimensions — M. Van Ness et al., arXiv:2211.09259 (2022)](https://arxiv.org/pdf/2211.09259)
