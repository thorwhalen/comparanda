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
| The whole grid | **matrix** | decision matrix, evaluation matrix, performance matrix, consequence table | |
| One (alternative, criterion) intersection | **cell** | performance value | |
| A distinct quantity stored per cell | **measure** | — | e.g. `score`, `confidence`. See the correction below. |
| A stored datum | **value** | performance value | Typed by its criterion × measure. |
| A qualified absence | **missing** | missingness, observation status | Always carries a reason code. |

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

A blank must never be ambiguous. Every absent value carries a reason:

| Code | Means | Typically set by |
|---|---|---|
| `not-applicable` | This criterion does not apply to this alternative — often a whole group × group block | author or schema rule |
| `not-assessed` | Nobody has looked yet | default for a new cell |
| `pending` | Deliberately deferred; someone was asked to leave it blank for now | author or agent instruction |
| `unknown` | Someone looked and could not determine it | assessor or agent |
| `withheld` | Known but not shown here — confidentiality, licensing | author |

`not-applicable` and `not-assessed` must be visually distinguishable, not merely different in the
data. They mean opposite things about whether work remains.

The distinction between *structurally* absent (`not-applicable`) and *contingently* absent
(everything else) should be queryable: "what is left to do" is a real question the tool should
answer.

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
