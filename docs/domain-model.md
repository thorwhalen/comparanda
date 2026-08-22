# Domain model and glossary

This file fixes the vocabulary. Implementers and agents should use these words in code, docs and
prompts, so that `comparanda`, `rubricator` and any downstream tool mean the same thing by them.

Where an established field already has a word, we take theirs rather than inventing one. The
relevant field is **multi-criteria decision analysis (MCDA)**, also called multi-attribute
decision making (MADM). Confirm and extend this vocabulary during the research phase
(see [research/terminology.md](./research/terminology.md)) — but do not casually rename things
that already have standard names.

---

## The core nouns

| Concept | Our term | Standard term(s) | Notes |
|---|---|---|---|
| The question being decided | **subject** | decision context, decision problem, goal | One per analysis. Free text plus optional structured framing. |
| The things being compared | **alternatives** | alternatives (MCDA), options, candidates | Rows, by convention. |
| The things they are compared on | **criteria** | criteria (MCDA), attributes, dimensions | Columns, by convention. |
| The whole grid | **matrix** | performance matrix, consequence table | See the note below on why *not* "decision matrix". |
| One (alternative, criterion) intersection | **cell** | performance value | |
| A distinct quantity stored per cell | **measure** | — | e.g. `score`, `confidence`. See the correction below. |
| A stored datum | **value** | performance value | Typed by its criterion × measure. |
| A qualified absence | **missing** | missingness, observation status | Always carries a reason code. |

**Why not "decision matrix".** It is the most common name and we do not use it, for two reasons.
Its canonical definition puts *criteria on rows* — transposed from our convention, so the phrase
imports an orientation we do not follow. And it names the artefact after the decision, when the
grid holds *consequences*: the decision is what a reader does after reading it, which is exactly
the stance ADR-0015 takes in refusing a default verdict. The practitioner traditions we draw on
say **performance matrix** or **consequence table**, and the second is the friendlier of the two
for a non-specialist. See ADR-0003.

Note also that row/column orientation is genuinely unstandardised across the literature — the
Pugh tradition puts concepts on columns and criteria on rows — so `transposed` is view state, not
a fact about the data.

**Domain aliasing is required, not optional.** "Alternatives" and "criteria" are the internal
names; every deployment must be able to relabel them in the UI without touching data — *directions*
and *axes*, *vendors* and *requirements*, *candidates* and *competencies*. Store the alias on the
analysis; never hard-code the words into components.

---

## Correction 1 — measures are stored, encodings are derived

The originating sketch described a third axis called "metric", with `score`, `confidence` and
`blended` as its values. Two of those are not the same kind of thing.

- **`score` and `confidence` are measures.** They are stored per cell, independently authored,
  independently editable, independently missing.
- **`blended` is an encoding.** Nothing is stored for it. It is a *rendering* that consumes the
  score and the confidence and produces a colour. It belongs to the view layer, not the data.

Collapsing them into one axis would mean the schema has to store a value for a thing that is
computed, and the view has to special-case one member of an otherwise uniform dimension.

So the model is:

- **Measures** are a real dimension of the data. The matrix is a tensor of shape
  `alternatives × criteria × measures`, each slot holding a value or a qualified missing.
- **Encodings** are a view concern: a named, parameterised mapping from one or more measures to a
  visual channel. `score`, `confidence` and `blended` are all *encodings*; the first two happen to
  be identity mappings over a single measure.

This separation is what makes it possible to add a fourth encoding (say, disagreement between
raters) without touching the schema at all.

## Correction 2 — value types are levels of measurement

The sketch listed "numerical, categorical, boolean, ordinal". That is very nearly Stevens's
**levels of measurement**, which is the standard framing and should be adopted explicitly because
it determines what operations are *legal*:

| Level | Example here | Legal operations |
|---|---|---|
| **nominal** | a category label, a boolean | equality, grouping, counting |
| **ordinal** | a 1–5 rating, a Likert item, low/med/high | the above, plus ranking, median, min/max |
| **interval** | a temperature-like scale with no true zero | the above, plus differences and means |
| **ratio** | a cost, a count, a duration | the above, plus ratios |

This matters concretely: **a 1–5 rating scale is ordinal, not interval.** Averaging it is a
category error that the literature argues about at length. The schema must record the level so
the tooling can refuse — or at minimum, loudly qualify — an illegal operation. It is also the
formal reason behind the "no total column by default" stance.

Booleans are modelled as a nominal type with exactly two levels, not as a separate primitive.

## Correction 3 — the type is per (criterion, measure), not per criterion

Stated in the sketch and worth making explicit in the schema: a criterion can carry a 1–5 ordinal
`score` and a three-level ordinal `confidence` at once. The type declaration therefore hangs off
the pair, with a per-criterion default to keep the common case terse.

---

## Missingness

A blank must never be ambiguous. Every absent value carries a reason code from a closed core set,
and every code declares three flags that analyses key on **instead of the literal code** — so a
deployment can extend the set without breaking anything downstream.

| Code | Means | structural | terminal | informative |
|---|---|---|---|---|
| `not-applicable` | This criterion does not apply to this alternative — often a whole group × group block | yes | yes | yes |
| `not-assessed` | Nobody has looked yet. The default for a new cell | no | no | no |
| `deferred` | Deliberately left for now; someone was asked to skip it | no | no | no |
| `not-evidenced` | We looked, and the sources are **silent** | no | yes | **yes** |
| `indeterminate` | We looked, and the sources do **not settle it** — they conflict, or they underdetermine the level | no | yes | **yes** |
| `withheld` | Known, but not shown here — confidentiality, licensing | no | yes | **no** |

**`structural`** means the cell *should* be empty: excluded from completeness counts, and removed
from a dominance comparison rather than widened to the criterion's range. **`terminal`** means
someone looked and this is the answer; non-terminal absences are work outstanding.
**`informative`** means the absence is itself a statement about *the subject* rather than about our
process.

**On `informative`, and why a third flag.** It cuts across `terminal` rather than refining it. Look
at the last two rows: `not-evidenced` and `withheld` are both terminal — someone looked, and that
is the answer — and they mean opposite things about the alternative. "Nobody documents this" is
evidence a reader can act on; "we know and are not saying" tells them only about us. `silenceRate`
counts the first kind and not the second, which is the whole reason the flag is stored rather than
inferred. `not-applicable` is informative on the same reasoning — battery life not applying tells
you the alternative is a desktop — but being structural it never reaches a rate.

**On `not-evidenced` and `indeterminate`.** These were one code, called `unknown`. Splitting them
is not cosmetic. "Nobody has written this down" and "the sources disagree" lead to completely
different next actions — the first is a gap in the corpus, the second is a genuine finding about
a contested question — and collapsing them destroys the most decision-relevant signal an agent
produces. An agent authoring this document must distinguish them, which is why the distinction is
in the schema and not left to a note field.

`pending` was renamed `deferred` and `unknown` was retired in favour of the pair above. See
ADR-0009.

**Extending the set.** An analysis may declare additional codes. Each must name exactly one core
code as its `broader`, so a consumer that knows only the core set can still classify it by
following that link. Defaults for all three flags follow `broader` unless explicitly overridden, and
an override is a real claim about the code's meaning rather than a convenience.

`informative` is the flag most worth overriding, because a refinement can easily need the opposite
value from its parent: a deployment code for "the source is paywalled" is a sensible refinement of
`not-evidenced` and is emphatically not informative about the subject. An **undeclared** code — one
that names no `broader` at all — resolves to nothing and counts as outstanding work; the system does
not guess flags for a code nobody declared, least of all the flag the honesty metric rests on.

`not-applicable` and `not-assessed` must be visually distinguishable, not merely different in the
data. They mean opposite things about whether work remains: one reads as *correctly nothing*, the
other as *a gap*.

The distinction between *structurally* absent and *contingently* absent must be queryable: "what
is left to do" is a real question the tool should answer, at analysis, row, column and group
scope.

---

## Groups

Both alternatives and criteria can be grouped. Groups exist to make large matrices legible and to
support narrative — showing one group at a time is how you walk someone through a finding.

Open questions, to be settled in ADR-0008 during implementation:

- flat groups or nested? (Recommend: allow nesting in the schema, render one level initially.)
- can an item belong to several groups? (Recommend: yes — groups are tags, not a partition.)
- is selection just a degenerate group, as the sketch suggests? See ADR-0008; the recommendation
  there is **no** — selection is view state, groups are data — with reasoning.

A group pair may be declared **inapplicable**: criteria group *G* does not apply to alternatives
group *H*, which auto-populates that block with `not-applicable` and lets the view omit it
entirely rather than rendering a rectangle of blanks.

---

## Provenance and evidence

Every value may carry:

- **an author** — who asserted it (a human, or a named agent run);
- **a timestamp**;
- **a justification** — one line, the "why this score";
- **evidence links** — zero or more pointers into source material, ideally to a *span* rather than
  a document, so the view can deep-link to a highlighted passage.

Evidence links are what make a comparison auditable rather than merely asserted, and they are the
main thing an agent-produced analysis has that a hand-made spreadsheet does not. Treat the link
target as an opaque, resolver-backed reference (see ADR-0014) — the core must not assume the
documents live anywhere in particular.

---

## Multi-rater values

A cell may hold **more than one value for the same measure, from different authors**. This is the
Delphi-method shape and it is a first-class case, not an edge case: the spread between raters is
frequently the most decision-relevant thing on the page.

The schema must therefore treat "the value of this cell" as a *reduction over rater assertions*,
with the reduction named and configurable (single-author, latest-wins, median, consensus-after-
discussion), and with the raw assertions retained. Inter-rater agreement is then computable and
displayable — see ADR-0011.

---

## What this is not

- Not a spreadsheet. There are no formulas between cells and no cell references.
- Not a BI tool. It does not connect to warehouses or do aggregation over large data.
- Not a scoring engine that returns "the answer". Optional aggregations exist and are always
  presented as one lens among several, never as a verdict.
