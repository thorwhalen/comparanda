# MCDA vocabulary, Pugh matrices, consequence tables, and what to call things

**Research question(s):** Confirm or correct the MCDA/MADM vocabulary adopted in
`docs/domain-model.md` and ADR-0003. Who uses "attribute" vs "criterion", and why? Is "decision
matrix" / "performance matrix" / "consequence table" the right name for the grid? Does Pugh's
datum column suggest a feature we are missing? Are consequence tables a better UI metaphor than
"decision matrix"? Should we ship even-swaps? What do comparable products call these things, and
what should our internal name and default display alias be?

**Brief section:** `docs/research/terminology.md` §1 ("Confirm or correct the vocabulary").

**Evidence grade:** **strong** — the core naming questions are settled by a UK government MCDA
manual, a peer-reviewed model-based evaluation of Pugh's method, a peer-reviewed experimental study
of even-swaps, and verbatim definitions from primary product documentation. The weak spots, both
declared in place below: the *Smart Choices* book itself, which I could not obtain (its content is
corroborated through the authors' own *Harvard Business Review* article and two independent
secondary sources), and the Smart-Swaps DSS paper [15], which is closed-access and from which
nothing is quoted.

**Citation audit:** this section was re-checked against sources after drafting. Every reference URL
resolves; the Frey et al. [12] and Lahtinen & Hämäläinen [14] quotations were verified
character-for-character against full texts, as were all quotations from the DCLG manual [1]. Seven
defects were found and repaired in place: the row/column orientation attributed to structured
decision making [8] was **backwards** (§3, §6); a Wikipedia definition was paraphrased inside
quotation marks (§2); a DCLG quotation was spliced across a section boundary and misattributed
(§5); a "verbatim" CBA definition was silently truncated (§1); three quotations attributed to Coda
[18] do not appear on the cited page (§6); a quotation was attributed to the unread [15] (§5); and
the DCLG usage counts, the HBR page range, and an internal ADR cross-reference were wrong. Details
are flagged at each site.

---

## Bottom line

ADR-0003's three decisions all survive, but two of its words do not, and it has one hole big enough
to break ADR-0015. **Keep `alternatives`, `criteria`, `subject`, `measure`, `encoding`, and the
measures/encodings split — the split is vindicated below.** **Drop "decision matrix"**: it is the
popular-press name, its most-cited definition puts criteria on the *rows* (transposed from ours),
and it asserts that the artefact is the decision, which is exactly what ADR-0015 refuses. Document
the grid as a **performance matrix / consequence table** instead, and default the alternatives
display alias to **"options"**, which is what the user-facing material consistently puts in front of
readers [1, 5, 7, 19] — though note that 1000minds [6], which is also user-facing, says
"alternatives", so this is a preponderance and not a clean sweep.

The hole: **criteria in this schema carry no direction of preference.** ADR-0015 ships Pareto
dominance and veto screening, and neither is *definable* without knowing whether higher is better
on each column. Add `preference` beside `level` on the `(criterion, measure)` spec. This is the
single most important finding here.

Pugh's datum column is a real missing feature, and it costs nothing: **"relative to a datum" is an
encoding, not a measure** — no schema change, which is the measures/encodings split earning its
keep. It is also the honest, ordinal-legal substitute for the total column ADR-0015 forbids,
because "better/same/worse than the datum" is a ranking operation and ranking is legal on ordinal
data. Ship it. **Do not ship even-swaps** — it is experimentally path-dependent, requires cardinal
tradeable scales we do not guarantee, and requires mutating cell values to invent hypothetical
alternatives. Ship its two computational by-products instead: practical dominance, and detection of
non-discriminating criteria.

---

## Findings

### 1. "Criterion" is correct, and the reason obliges us to change the schema

**EVIDENCE.** The UK Department for Communities and Local Government's *Multi-criteria analysis: a
manual* — a government methodology standard, not a summary — settles the word choice explicitly
[1, §2.1]:

> "The words criterion and attribute are often used synonymously in the literature on MCA, which is
> indeed sometimes referred to as multi-attribute analysis. Attribute is also sometimes used to
> refer to a measurable criterion. In this manual we use the word criterion rather than attribute."

The synonymy is real but the divergence has a shape, and the shape matters to us:

- **"Attribute" belongs to the measurement question.** Keeney and Gregory define attributes as the
  things that *measure the achievement of an objective*, classified as natural, constructed, or
  proxy, and judged against five properties — unambiguous, comprehensive, direct, operational,
  understandable [2]. An attribute is a scale, not a value judgement. `MADM` (multi-attribute
  decision making) is the term Hwang and Yoon attached to the discrete-alternatives case [3], which
  is why "attribute" is the more common word in the American/engineering strand.
- **"Criterion" belongs to the preference question.** In the European (Roy) tradition a criterion is
  an attribute *plus a direction of preference*. The standard requirement is that the criteria form
  a **consistent family of criteria** satisfying completeness, **monotonicity** ("the better the
  evaluation of an object on considered criteria, the more it is preferable to another object"), and
  non-redundancy [4, §4.1; attributed there to Roy & Bouyssou 1993]. Dominance-based methods make this
  operational: dominance is only defined once "to each attribute *q* ∈ *Q* there is associated a preference
  relation ≽*q*" [4, §3].

**REASONING (not evidence).** That distinction is not a pedantic one for us. `docs/domain-model.md`
declares the level of measurement per `(criterion, measure)` and stops there. ADR-0015 then ships
**Pareto dominance filtering** and **veto screening**, and both are undefined without a direction of
preference:

- Dominance, in the manual's own words, "occurs when one option performs at least as well as another
  on all criteria and strictly better than the other on at least one criterion" [1, §4.5]. "At least
  as well as" is not computable from a number and a level of measurement alone.
- ADR-0015 says a veto fires when an alternative falls "below" a threshold. "Below" silently assumes
  higher-is-better on every veto criterion. A cost column breaks it.

So we have adopted the word "criterion" while modelling an attribute. Either the schema earns the
word or the analyses in ADR-0015 cannot be implemented correctly. **Earn the word.**

**A terminology hazard worth documenting.** *Choosing By Advantages* (Suhr), widely used in lean
construction, assigns these same words incompatible meanings [5]:

| CBA term | CBA definition (verbatim) [5] | comparanda equivalent |
|---|---|---|
| alternative | "The people, things, or plans being considered (often called options, but never 'choices')." | **alternative** ✓ |
| factor | "The elements of the decision; the specific data needed to make comparisons." | **criterion** |
| attribute | "A characteristic or quality of one alternative." | **value** (a cell) |
| criterion | "The standard or rule that guides the decision; criteria clarify what matters most to customers and stakeholders." | *no equivalent* — closest is a veto threshold |
| advantage | "A benefit or improvement that represents the difference between the attributes of two alternatives." | *no equivalent* — see the datum encoding below |

A CBA practitioner reading our UI will read "criteria" as our thresholds and look for our columns
under "factors". The display-alias mechanism already handles this; the docs should name the
collision so nobody "fixes" it by renaming.

**Verdict on the word: CONFIRM `criterion`.** It is the term of the manual we are most closely
aligned with [1], of the MCDA tooling vendors [6, 7], and of the decision-analysis tradition. But
confirming it obliges the schema change in the next section.

### 2. The name of the grid: drop "decision matrix"

**EVIDENCE.** The manual's definitional sentence gives us both surviving names in one breath
[1, §4.3.2]:

> "A standard feature of multi-criteria analysis is a performance matrix, or consequence table, in
> which each row describes an option and each column describes the performance of the options
> against each criterion."

and its glossary repeats the equivalence: "Performance matrix. A matrix or table setting out the
performance of each option according to each of the criteria by which options are to be judged.
Sometimes referred to as a consequence table." [1, glossary]

The structured-decision-making community — the practitioner-facing descendant of Hammond, Keeney and
Raiffa — uses the second name: "A consequence table is a summary matrix illustrating the performance
of each alternative on each objective." [8] The *Smart Choices* framework (PrOACT: Problem,
Objectives, Alternatives, Consequences, Tradeoffs) puts the consequences table at its centre
[9, 10]. 1000minds calls it a "performance matrix" or "performance table" [6].

**"Decision matrix" is the outlier, and it is the one we adopted.** The most widely-read definition
of the term — Wikipedia's — sets the grid up as "An MCDA problem, where there are M alternative
options and each needs to be assessed on N criteria, can be described by the decision matrix which
has N rows and M columns" [11]: criteria in the rows, alternatives in the columns, the *transpose*
of our convention and of the manual's. The term is also
the Six Sigma/product-management vernacular, where it is used interchangeably with "Pugh matrix",
whose orientation is likewise transposed [12, 13].

Three reasons to drop it (REASONING):

1. **It is the least precise of the three names** and the only one whose canonical definition
   contradicts our row/column convention.
2. **It asserts the wrong thing.** "Decision matrix" says the artefact is the decision. ADR-0002 and
   ADR-0015 both say emphatically that it is not: "it does not return 'the answer'". "Consequence
   table" says the cells hold consequences — a statement about content, not about authority. That is
   precisely the position ADR-0015 takes.
3. **The manual explicitly blesses stopping at the table.** "In a basic form of MCA this performance
   matrix may be the final product of the analysis. The decision makers are then left with the task
   of assessing the extent to which their objectives are met by the entries in the matrix."
   [1, §4.3.2] This is a government methodology standard endorsing exactly comparanda's default
   presentation. It should be quoted in the README; it is the strongest external validation of
   ADR-0015 available.

**Consequence tables are also the better metaphor for non-specialists,** and the SDM guidance tells
us what goes in the cells: a mixture of natural units, constructed scales (e.g. a documented
10-point scale), and qualitative ratings — and, critically, "Importantly, there will normally be supporting
information about every cell in the table." That supporting information carries context, the significance of differences, and
uncertainty [8]. **That is per-cell justification plus evidence links plus confidence, described by
the practitioner literature as normal practice.** `docs/domain-model.md`'s provenance section is not
a comparanda invention; it is the consequence-table convention, and we should say so.

One caution (EVIDENCE): the SDM guidance keeps uncertainty *out* of the cells and in the backing
material [8]. Our blended encoding puts it *in* the cell. That is a deliberate departure and we
should own it as one — it is a claim that the table can carry more than the tradition assumed, not an
implementation of the tradition.

### 3. Row/column orientation is not standardised — make transposition view state

**EVIDENCE.** The sources disagree, and not along a clean two-tradition line:

| Source | Rows | Columns |
|---|---|---|
| DCLG performance matrix [1, §4.3.2] | options | criteria |
| SDM consequence table [8] | **objectives / performance measures** | **alternatives** |
| *Smart Choices* consequences table [9, 10] | *(UNVERIFIED — could not locate source)* | *(UNVERIFIED)* |
| **Pugh matrix** [12, 13] | **criteria** | **concepts (alternatives)** |
| Wikipedia "decision matrix" [11] | criteria | alternatives |

Frey et al. are explicit: "The columns of the Pugh matrix are labeled with a description, in
drawings and text, of design concepts. The rows of the matrix are labeled with concise statements of
the criteria by which the design concepts can be judged." [12] The IfM's description of the same
method agrees: "The list of criteria is the vertical axis of the matrix and the product concepts
form the horizontal axis." [13]

The SDM row deserves a note, because it is the one that surprised me. The page never uses the words
"row" or "column" at all; its orientation can only be read off its two worked examples, and **both
of them put objectives down the side and alternatives across the top** — one a hand-drawn table with
`Alt 1 / Alt 2 / Alt 3` as column headers, the other an island-restoration table whose first column
is literally headed "Objective" [8]. So the decision-analysis strand does *not* line up behind our
convention. Only the DCLG manual does.

**REASONING.** Our convention (rows = alternatives) matches the DCLG manual [1], and the DCLG manual
alone among the sources surveyed. It is a defensible home — the manual is the source this project is
otherwise most aligned with — but the earlier draft of this section claimed it matched "the
decision-analysis strand" generally, and that is simply false: SDM sits with Pugh and Wikipedia on
the other side. The disagreement is therefore *wider* than first thought, which strengthens rather
than weakens the recommendation below. A user arriving from engineering design or Six Sigma will
expect the transpose — and so, it turns out, will a user arriving from structured decision making.
The reason Pugh transposes is practical: a *design concept* column needs vertical room for a
sketch, whereas a *criterion* is a one-line statement. Anyone pasting images or long justifications
into cells will want the same. ADR-0008 already puts row and column order in view state; **`transposed: boolean`
belongs in exactly the same place**, and it is a pure render flip over an orientation-neutral data
model. Cheap, and it removes an entire class of "this tool is backwards" objection.

### 4. Pugh's datum column: yes, this is a missing feature, and it is free

**EVIDENCE — what the method actually is.** Pugh Controlled Convergence [12, 13]:

- One alternative is designated the **datum**, "preferably a design concept that is both well
  understood and known to be generally strong. Often the initial datum concept is currently the
  leader in the market." [12]
- Every cell holds `+`, `−`, or `S`, meaning the concept is "clearly better than, clearly worse than,
  or roughly the same as the datum concept as judged according to the criterion of that row" [12].
- "Generally, the evaluation matrix includes summary scores along the bottom. The number of +, −, or
  S scores for each concept are counted and presented as a rough measure of the characteristics of
  each alternative." [12]
- The matrix is **run repeatedly**, with a different (stronger) datum each round; between rounds,
  dominated concepts are dropped, hybrids are invented, and criteria that failed to discriminate are
  removed [12].
- **There is no voting.** "In Pugh's method, a discussion proceeds in which the experts on both sides
  communicate their reasons for holding their views… If the disagreement persists for any significant
  length of time, then an S is entered." [12]

**EVIDENCE — that it works, and why.** Frey et al. built executable models of the process and
concluded that "Pugh's method, under a substantial range of assumptions, results in better design
outcomes than those from these alternative procedures" — the alternatives being a single summary
criterion and a Borda count [12]. Two of their conclusions bear directly on comparanda:

> "a major objective of PuCC is to encourage [ideation and evaluation in parallel]… if just a couple
> new hybrid concepts emerge from insights arising from Pugh evaluation matrices, then these benefits
> trump the concerns about potential violations of internal consistency." [12]

> "uncertainty should not be taken as an immutable facet of design decision making… PuCC can help
> teams target alternative/criterion pairs with high leverage in the decisions they face. In our
> models, reducing uncertainty in a targeted fashion improved the design outcomes." [12]

The second is a peer-reviewed, model-based argument for storing per-cell **confidence** and for
shipping a "what should we investigate next" analysis. It is the strongest evidence I found for
comparanda's confidence measure, and it comes from outside decision theory entirely.

**Why the datum is more than a convention (REASONING, with support).** Comparing to a datum moves the
judgement from a *level* to a *difference*. That is the same move Choosing By Advantages makes its
central rule — importance attaches to an **advantage**, "a benefit or improvement that represents the
difference between the attributes of two alternatives" [5] — and the same move even-swaps makes,
where the decision maker "changes an alternative in two attributes such that the modified alternative
is preferentially equivalent to the original one" [14]. Three independent methodologies converge on
the same thing: **people are better at judging differences than at judging absolute levels.**
comparanda currently supports only absolute levels.

**Why it is free.** "Relative to a datum" reads score values, needs no stored data of its own, and
produces a visual mark. By ADR-0003 decision 2, that is definitionally an **encoding**. Adding it
touches zero bytes of schema. This is the measures/encodings split paying for itself, in exactly the
way ADR-0003's consequences section predicted, and it should be cited as such.

**Why it is the answer to the total-column problem.** ADR-0015 refuses a default total because
averaging ordinal ratings is a category error (ADR-0003 decision 3). But `better / same / worse` is a
**ranking** comparison, and `docs/domain-model.md`'s own legality table says ranking is legal at the
ordinal level. So the datum encoding gives readers the compressed, at-a-glance reading they want from
a total column, **without committing the illegal operation**. This is the single most useful thing in
this report for the product.

**The trap to avoid, named by the literature.** Frey et al. warn that the `+/S/−` tallies are
routinely misread:

> "These scores are sometimes interpreted as a means by which to choose the single winning design.
> This misconception is reflected in terminology — Pugh's method is most often referred to in the
> design literature as 'Pugh Concept Selection' whereas Pugh emphasized 'Controlled Convergence'."
> [12]

So: show the counts, never a net score. Three numbers, not one. A `net = plus − minus` field is a
compensatory aggregate over ordinal comparisons wearing a disguise, and it belongs under ADR-0015's
opt-in-and-labelled rule if it exists at all.

**A second trap that confirms ADR-0009.** Pugh's `S` is overloaded: "It can mean that the experts
agree that the concept's merit is similar to the datum or that the differences between the concept
and the datum are controversial and cannot be determined yet." Frey et al. note that Pahl and Beitz
proposed entering `i` or `?` instead, "to more strongly encourage investigation" [12]. **This is
ADR-0009's argument, made in 1984, in a different field, about a different matrix, and it is a
documented defect of the most famous version of this tool.** Cite it in ADR-0009's consequences: the
cost of a bare, ambiguous blank has been observed in the wild.

### 5. Even-swaps: do not ship it; ship the two things it is for

**EVIDENCE — the method.** Even-swaps [9, 14, 15]: the decision maker performs a sequence of swaps
in which one alternative is changed on two criteria so that the modified alternative is
preferentially equivalent to the original. Swaps are chosen either to make an alternative dominated
(so it can be eliminated) or to make a criterion **irrelevant** — all surviving alternatives equal on
it — so the column can be struck. Repeat until one alternative remains [14]. The Smart-Swaps decision
support system implements this, adding a preference-programming model that identifies practically
dominated alternatives and suggests which criteria to swap on next [15]. (Paraphrase, not quotation:
the DSS paper is closed-access and its abstract is withheld by the publisher, so I could not verify
any wording from [15] directly. The nearest published statement of the idea is in the same authors'
earlier *Decision Analysis* paper, whose abstract says the model helps "identify practically
dominated alternatives, and to find applicable candidate attributes for the next even swap"
[15a].)

**EVIDENCE — why not to ship it.** Lahtinen and Hämäläinen ran experiments with Smart-Swaps and found
the method is **path-dependent**: the answer depends on the order of the swaps [14].

> "When the subjects go through the Even Swaps process and use money as the measuring stick in the
> even swap tasks, i.e. they give responses in money, they end up favoring those alternatives which
> are good in the monetary attribute. When two alternatives are compared such that the same
> alternative is modified in every swap, the subjects favor the modified alternative." [14]

They attribute this to accumulated **scale compatibility bias** (extra weight goes to whichever
criterion the answer is expressed in) and **loss aversion bias** (the modified alternative is
favoured), and warn that "the straightforward pricing out method… can, however, favor the
alternatives which are good in the monetary attribute" [14].

**REASONING — what it would cost the schema.** Beyond the bias problem, even-swaps demands four
things comparanda does not have and should not casually acquire:

1. **Cardinal, tradeable cell values.** A swap asserts "this much of criterion A compensates for that
   much of criterion B". That requires meaningful differences — interval or ratio. ADR-0003 decision 3
   exists precisely to stop us treating 1–5 ratings that way. Even-swaps is *illegal* on most of our
   expected data.
2. **Mutable, hypothetical alternatives.** Each swap invents a counterfactual variant of a real
   alternative. That is a new entity kind (a derived alternative with an explicit lineage) and a new
   provenance class ("this value was constructed by a swap, not observed").
3. **A recorded path, with replay.** Given [14], any implementation would be obliged to store the
   swap sequence and let the user re-run from a different path to detect that the answer moved. That
   is a research instrument, not a feature.
4. **Direction of preference on every criterion** — the same gap as §1.

Against that: even-swaps is a specialist elicitation technique, and adoption data for far simpler
structured methods is discouraging — a survey of 106 experienced engineers found "just over 15%" had
used Pugh Concept Selection at work, and a Finnish industry survey put it at "roughly 2% of firms",
against about 40% of companies using informal approaches labelled "concept review meetings",
"intuitive selection" or "expert assessment" [12]. Building a bias-prone elicitation loop for a technique this
specialist violates ADR-0002's non-goals ("not a decision engine").

**What to ship instead.** Even-swaps' *goal* is reachable without its *elicitation*, and both halves
are pure computation over data we already hold:

- **Non-discriminating criteria.** A criterion on which all surviving alternatives are equal (or
  within a stated tolerance) cannot affect the choice and can be collapsed. This is precisely what
  even-swaps engineers by hand, and it is exactly what the Pugh case study did between rounds: "Some
  criteria were dropped because they did not discriminate among the alternatives and some because
  they were too difficult to evaluate precisely." [12] No preferences required beyond a direction.
- **Practical dominance** — dominance modulo a per-criterion indifference tolerance, the concept
  Smart-Swaps adds on top of strict dominance [15]. Strict dominance is famously toothless: "In
  practice, dominance is rare. The extent to which it can help to discriminate between options and
  so to support real decisions is correspondingly limited." [1, §5.5.2.1], and, in the section
  immediately following, "Dominance is limited in the extent to which it can differentiate between
  options specifically because it makes no assumption at all about the relative importance of
  criteria" [1, §5.5.2.2]. A tolerance is what makes ADR-0015's flagship analysis actually
  discriminate. This is important: **without tolerances, the strongest defensible reduction in
  ADR-0015 will usually return "nothing is dominated" and look broken.**

Both are honest, both are computable, both state their assumptions in one sentence.

### 6. Product vocabulary sweep

**EVIDENCE.** From primary product documentation:

| Product | Row | Column | Cell / value | Notes |
|---|---|---|---|---|
| **Airtable** [16] | **record** — "A record is an individual item in a table." | **field** — "A field is a vertical column in a table. It contains the details or data for each record in the table." | — | Grid view: "each record a row, and each field a column." |
| **Notion** [17] | **page** — "Every item you enter into your database is a Notion page." | **property** | — | Properties "contextualize, label, and augment any database item". |
| **Coda** [18] | **row** — "Rows generally represent 'things' (people, tasks, inventory items, places to visit, grocery list items, etc.)" | **column** — "the columns are generally 'attributes' of those things" | — | "each row is an individual data point, and each column represents an attribute of that data point" — i.e. Coda's own docs gloss columns as "attributes" of the row. |
| **Loomio** [19] | — | — | — | **options** for the things voted on; poll types Choose / Score / Allocate / Rank; Score "lets participants rate every option on the same scale". |
| **1000minds** [6] | **alternatives** — "Alternatives (or individuals) to be ranked or chosen from." | **criteria** — "Criteria by which the alternatives are evaluated and compared." | — | Names the grid a "performance matrix"/"performance table"; supports 0–100 continuous *and* level-based (low/medium/high) scoring. |
| **TransparentChoice** [7] | **alternatives** (also "options") | **criteria**, under a **goal** | scores | "break it down into underlying criteria that you will use to score competing alternatives". |
| **DCLG manual** [1] | **options** (~630 uses vs ~57 of "alternatives"; all inflections, counted over a `pdftotext` extraction of the cited PDF, so ±a few) | **criteria** | performance | Glossary: "Options. Ways of achieving objectives." |
| **SDM / Smart Choices** [8, 9, 10] | **objectives** (measured by **performance measures**) | **alternatives** | consequences | Orientation is the reverse of the DCLG manual's — see §3. The vocabulary is what matters here: the things compared are **alternatives**, the things they are judged on are **objectives**. |
| **CBA** [5] | **alternatives** | **factors** | **attributes** | "criterion" means a decision rule — see §1. |

**REASONING — the recommendation.** Two clean groups. The database/no-code tools have no decision
vocabulary at all (record/field, page/property, row/column) and offer us nothing to borrow; they
confirm only that grid tools do not name the grid to users — it is simply the page. The decision
tools split on one word: the **specialist** literature says *alternatives* [6, 8, 9], the
**user-facing** material says *options* [1, 5, 7, 19]. Note that CBA's own definition concedes the
point: alternatives are "often called options" [5].

- **Internal name: `alternatives`.** Confirmed — it is what 1000minds, SDM, and *Smart Choices* use,
  and it is the word the literature we will keep citing uses.
- **Default display alias: "options".** It is what the manual we are most aligned with actually puts
  in front of readers, and English "an alternative" reads as *the other one*, which is wrong for a
  set of six.
- **Internal and display name for columns: `criteria`.** No change; it is ordinary English and every
  decision tool surveyed uses it. Ship `factors` and `objectives` as documented alias presets.
- **The grid**: keep `matrix` as the internal key (orientation-neutral, already used), delete
  "decision matrix" from the docs, and document the standard-term mapping as **"performance matrix
  (MCDA) / consequence table (decision analysis)"**. The display alias slot should exist but default
  to something a reader does not have to learn — "comparison". No surveyed product asks users to
  learn a name for its own grid.

---

## What this means for the schema / the view / the agent

### Schema — the one blocking change

Add a direction of preference beside the level of measurement, per `(criterion, measure)`, with the
same per-criterion default:

```ts
type Level = 'nominal' | 'ordinal' | 'interval' | 'ratio';

type Preference =
  | { kind: 'increasing' }                       // gain criterion: higher is better
  | { kind: 'decreasing' }                       // cost criterion: lower is better
  | { kind: 'target'; ideal: Value }             // closest to ideal is better
  | { kind: 'ordered'; best: Value[] }           // explicit order for nominal-looking levels
  | { kind: 'none' };                            // descriptive column; excluded from all screening

interface CriterionMeasureSpec {
  level: Level;
  preference: Preference;                        // default { kind: 'none' }
  indifference?: number;                         // tolerance for "practically the same"
}
```

Validation rules, all cheap and all worth writing on day one:

- `level: 'nominal'` with `preference.kind === 'increasing' | 'decreasing'` is **invalid** — a
  nominal scale has no order to increase along. Use `'ordered'` or `'none'`.
- `preference.kind === 'none'` **excludes** the criterion from dominance, veto screening, and the
  datum encoding. The UI must name the excluded columns wherever it reports a result, or a reader
  will believe a dominance claim covered more than it did.
- `indifference` is only meaningful at `interval`/`ratio`; on `ordinal` express tolerance in levels,
  not in units.

Rename nothing else. `alternatives`, `criteria`, `subject`, `measure`, `encoding`, `missing`,
`cell`, `matrix` all stand.

Add the alias slots the display-alias rule already implies, with these defaults:

```ts
interface DisplayAliases {
  alternatives: string;   // default "options"
  criteria: string;       // default "criteria"
  matrix: string;         // default "comparison"
}
```

### Core — three new pure functions

```ts
// 1. The datum encoding. No stored data; consumes score + preference.
type DatumMark = 'better' | 'same' | 'worse' | { missing: MissingReason };

function encodeRelativeToDatum(
  matrix: Matrix,
  *,
  datum: AlternativeId,
  measure: MeasureId,
  indifference?: Partial<Record<CriterionId, number>>,
): Map<CellKey, DatumMark>;

// Tally returns FOUR counts and deliberately has no `net` field. See Frey et al. [12].
interface DatumTally { better: number; same: number; worse: number; missing: number }
function datumTally(marks: Map<CellKey, DatumMark>): Map<AlternativeId, DatumTally>;

// 2. Dominance with tolerance — makes ADR-0015's flagship analysis actually discriminate.
function findDominated(
  matrix: Matrix,
  *,
  measure: MeasureId,
  tolerance?: Partial<Record<CriterionId, number>>,   // omit -> strict dominance
): Array<{ dominated: AlternativeId; dominatedBy: AlternativeId; strictOn: CriterionId[] }>;

// 3. The useful half of even-swaps.
function findNonDiscriminatingCriteria(
  matrix: Matrix,
  *,
  measure: MeasureId,
  among?: AlternativeId[],                            // default: all not-yet-eliminated
  tolerance?: Partial<Record<CriterionId, number>>,
): CriterionId[];
```

Rules that follow from the evidence:

- **A cell missing on either side of a datum comparison yields `{ missing: reason }`, never
  `'same'`.** Pugh's overloaded `S` is the documented failure this avoids [12].
- **`findDominated` must report which criteria were excluded** (`preference.kind === 'none'`) and
  how missing cells were treated. A dominance claim computed over four of nine columns is a
  different claim.
- **No `net` score anywhere in the core.** If a caller wants one, it goes through the ADR-0015
  opt-in aggregation path with its method named and its ordinal warning shown.

### View

- **Add a `datum` encoding** to the encoding registry alongside `score`, `confidence`, `blended`. A
  diverging three-class scale plus a glyph (▲ / = / ▼) — never colour alone, per ADR-0010. The datum
  alternative's own column renders as the reference, visually distinct from `same`.
- **Datum picker in the toolbar**, defaulting to no datum. Frey et al. found datum strength drives
  convergence, and that a randomly chosen datum converges worse [12] — so offer "use the most
  complete alternative" and "use the incumbent" as suggestions, never auto-select silently.
- **Show the tally as four numbers**, and label the axis "vs. {datum name}". Never a single figure.
- **`transposed: boolean` in view state**, next to row/column order (ADR-0008). Pugh users expect the
  transpose, and a cell holding a sketch or a long justification wants the taller layout [12].
- **Legend copy for the datum encoding must say what it is not**: "counts of better/same/worse
  against {datum}; not a score, and not comparable across different datums."

### Agent (rubricator)

- The `(criterion, measure)` spec now has a `preference` field the agent must set when it proposes a
  frame. "Is higher better on this criterion?" belongs in the criteria-elicitation conversation, not
  in a post-hoc guess — and it is a question a non-specialist can answer instantly, which makes it
  good elicitation material.
- **Targeted investigation is a supported output.** Frey et al.'s finding that "reducing uncertainty
  in a targeted fashion improved the design outcomes" and that the method "can help teams target
  alternative/criterion pairs with high leverage" [12] justifies an analysis that ranks cells by
  *decision leverage under low confidence* — cells where resolving the uncertainty could flip a
  dominance relation or a veto. This is the best-evidenced new feature in this report after the
  datum encoding, and it is the natural thing for an agent runtime to be pointed at next.
- The `pending` missingness code should be the agent's output for "high leverage, needs
  investigation" — the role Pahl and Beitz's `?` played in the Pugh matrix [12].

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0003 | amend | Its three decisions stand, but "decision matrix" should be replaced by "performance matrix / consequence table" [1, 8], and the vocabulary list should record that the display alias for alternatives defaults to "options" [1, 5, 7, 19]. |
| ADR-0003 | new | Criteria carry a **direction of preference** (`increasing` / `decreasing` / `target` / `ordered` / `none`) per `(criterion, measure)`, with `indifference` tolerance. Without it, ADR-0015's dominance and veto screening are not definable [1, §4.5; 4]. This is the blocking finding. |
| ADR-0015 | new | Add the **datum-relative encoding** (Pugh) as the ordinal-legal alternative to a total column, with a four-count tally and an explicit prohibition on a net score [12]. Pure view-layer; no schema change, which is ADR-0003 decision 2 earning its keep. |
| ADR-0015 | amend | Dominance must support a per-criterion **indifference tolerance** ("practical dominance", [15]); strict dominance alone "is rare" and will usually return nothing [1, §5.5.2.1]. Add `findNonDiscriminatingCriteria` as a named analysis. Record that **even-swaps is rejected** for v1, with the path-dependence evidence [14]. |
| ADR-0008 | amend | Add `transposed: boolean` to view state alongside row/column order — orientation is genuinely unstandardised, and our convention is shared only by the DCLG manual [1]; SDM [8], Pugh [12, 13] and Wikipedia [11] all use the transpose. |
| ADR-0009 | confirm | Externally corroborated: Pugh's `S` conflates "genuinely equal" with "contested, undetermined", and Pahl & Beitz proposed a distinct `?` symbol to fix it [12]. The bare ambiguous blank is a documented defect, not a hypothetical one. |
| ADR-0002 | confirm | Strengthened: a government methodology standard states that "In a basic form of MCA this performance matrix may be the final product of the analysis" [1, §4.3.2]. Worth quoting in the README. |

---

## Open questions

- **The `target` preference kind.** "Closest to 12 people" is a real criterion shape, but dominance
  over a target criterion requires a distance metric, which reintroduces a cardinal assumption
  through the back door. I recommend shipping `target` in the schema but excluding it from strict
  dominance in v1 and saying so in the UI. Settled by: writing a deliberately messy worked example
  with a target criterion in it and seeing what the dominance report should honestly say. (The
  earlier draft cited "ADR-0016" for this; ADR-0016 is *Public repository — no proprietary content
  in tests, examples or fixtures*, and no messy-example ADR exists yet. One may be worth writing.)
- **Default indifference tolerance.** I have no evidence for a number. Smart-Swaps derives practical
  dominance from an elicited preference model [15], which we are not building. Recommend defaulting
  to zero (strict) and making the tolerance an explicit, labelled user act. Settled by: user
  testing, or by a survey of what tolerance makes dominance non-empty on realistic matrices.
- ***Smart Choices* itself.** I could not obtain the book; its consequence-table treatment is
  corroborated here through the authors' own HBR article [9] and two independent sources [1, 8, 10].
  If the exact cell-content guidance matters for the view, the book should be read directly.
- **Whether "options" or "alternatives" should be the *internal* name.** I recommend internal
  `alternatives` on literature grounds, but the usage counts in the manual we most align with are
  lopsided the other way (roughly 630 to 57, about eleven to one) [1]. If a future reader finds the alias indirection annoying,
  this is the defensible place to change course — and it is a one-line rename in a pre-implementation
  repo, versus a migration later.
- **Per-round history.** Pugh is explicitly iterative — rerun with a new datum, drop criteria,
  invent hybrids [12] — and comparanda currently models one analysis, not a sequence of rounds. Is a
  "round" a first-class concept, or is it just a saved view (ADR-0007) plus a new analysis version?
  I lean to the latter, but the Delphi work in §5 of the research brief may change the answer.

---

## REFERENCES

1. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
2. [Selecting Attributes to Measure the Achievement of Objectives — Ralph L. Keeney & Robin S. Gregory, Operations Research 53(1):1–11 (2005)](https://pubsonline.informs.org/doi/10.1287/opre.1040.0158)
3. [Multiple Attribute Decision Making: Methods and Applications — A State-of-the-Art Survey — Ching-Lai Hwang & Kwangsun Yoon, Springer-Verlag (1981)](https://www.semanticscholar.org/paper/Multiple-Attribute-Decision-Making:-Methods-and-A-Hwang-Yoon/a7862f4ac351c8f1caa563b288ac2a63412b6b8f)
4. [Dominance-based Rough Set Approach, basic ideas and main trends — Jerzy Błaszczyński, Salvatore Greco, Benedetto Matarazzo & Marcin Szeląg, arXiv:2210.03233 (2022)](https://arxiv.org/pdf/2210.03233) — the "consistent family of criteria" properties are attributed there to Roy & Bouyssou, *Aide Multicritère à la Décision: Méthodes et Cas*, Economica (1993), which I did not read directly.
5. [Choosing By Advantages (CBA) — Lean Construction Institute](https://leanconstruction.org/lean-topics/choosing-by-advantages/) — the definitions originate with Jim Suhr, *The Choosing By Advantages Decisionmaking System* (1999), which I did not read directly.
6. [Multi-Criteria Decision Analysis (MCDA/MCDM) — 1000minds](https://www.1000minds.com/decision-making/what-is-mcdm-mcda)
7. [Analytic Hierarchy Process: A Complete Guide — TransparentChoice](https://www.transparentchoice.com/analytic-hierarchy-process)
8. [The Consequence Table — StructuredDecisionMaking.org](https://www.structureddecisionmaking.org/the-steps/the-consequence-table/) — the page's prose never uses the words "row" or "column"; the orientation reported in §3 is read off its two worked-example images ([sketch](https://www.structureddecisionmaking.org/wp-content/uploads/2023/05/sketch-consequence-table.jpg), [island restoration](https://www.structureddecisionmaking.org/wp-content/uploads/2023/05/Picture5.png)), both of which put objectives in rows and alternatives in columns.
9. [Even Swaps: A Rational Method for Making Trade-offs — John S. Hammond, Ralph L. Keeney & Howard Raiffa, Harvard Business Review 76(2), March–April 1998:137–149](https://hbr.org/1998/03/even-swaps-a-rational-method-for-making-trade-offs) — I confirmed the article's existence, authorship and date on the HBR page but could not retrieve its full text; its method content is taken from [14] and [15], which cite it directly. The volume/issue/page range is taken from the bibliography of [14], which gives "Harvard Business Review 76(2):137-149". (An earlier draft of this section gave the range as 137–150; that was wrong.)
10. [Smart Choices: A Practical Guide to Making Better Decisions — John S. Hammond, Ralph L. Keeney & Howard Raiffa, Harvard Business School Press, 1998](https://www.hbs.edu/faculty/Pages/item.aspx?num=14579) — **not read directly**; all claims about it here are corroborated by [1], [8] or [14]. Note that the linked HBS record is the entry for the *Finnish* edition; its citation block reads "Boston: Harvard Business School Press, 1998, Finnish ed. (Paperback: Broadway Books, 2002; …)". An earlier draft of this section dated the Broadway paperback to 1999, which this source does not support. [14] cites the book as 1999, so the year is genuinely inconsistent across sources; nothing in this section depends on it.
11. [Decision matrix — Wikipedia](https://en.wikipedia.org/wiki/Decision_matrix)
12. [The Pugh Controlled Convergence Method: Model-Based Evaluation and Implications for Design Theory — Daniel D. Frey, Paulien M. Herder, Ype Wijnia, Eswaran Subrahmanian, Konstantinos Katsikopoulos & Don P. Clausing, Research in Engineering Design 20 (2009)](https://dspace.mit.edu/handle/1721.1/49448) — MIT open-access manuscript, read in full. Cites Pugh (1990) as the primary source; the Pahl & Beitz `i`/`?` suggestion is reported there from Pahl & Beitz (1984). I did not read either primary source directly.
13. [Controlled convergence — Institute for Manufacturing, University of Cambridge](https://www.ifm.eng.cam.ac.uk/research/dmg/tools-and-techniques/controlled-convergence/)
14. [Biases and path dependency in the Even Swaps method — Tuomas J. Lahtinen & Raimo P. Hämäläinen, Systems Analysis Laboratory, Aalto University (working paper)](https://sal.aalto.fi/publications/pdf-files/mlah14.pdf) — read in full; all quotations above are from this working paper. The published version is Lahtinen & Hämäläinen, "Path dependence and biases in the even swaps decision analysis method", *European Journal of Operational Research* 249(3):890–898 (2016), [doi:10.1016/j.ejor.2015.09.056](https://doi.org/10.1016/j.ejor.2015.09.056) — volume, issue, pages and year confirmed via Crossref; the publisher's own page is bot-gated and was not retrieved.
15. [Smart-Swaps — A decision support system for multicriteria decision analysis with the even swaps method — Jyri Mustajoki & Raimo P. Hämäläinen, Decision Support Systems 44(1):313–325 (2007)](https://www.sciencedirect.com/science/article/abs/pii/S0167923607000723), [doi:10.1016/j.dss.2007.04.004](https://doi.org/10.1016/j.dss.2007.04.004) — metadata confirmed via Crossref. **Full text and abstract not retrieved** (closed access; the abstract is withheld by the publisher from the indexing APIs, and the ScienceDirect page is captcha-gated). Everything attributed to [15] here is therefore either a paraphrase or comes via [14], which uses the software. **No verbatim quotation from [15] appears in this section.**
15a. [A Preference Programming Approach to Make the Even Swaps Method Even Easier — Jyri Mustajoki & Raimo P. Hämäläinen, *Decision Analysis* 2(2):110–123 (2005)](https://doi.org/10.1287/deca.1050.0043) — the abstract *is* available and states that the model helps "identify practically dominated alternatives, and to find applicable candidate attributes for the next even swap". This is the verifiable source for the practical-dominance idea attributed loosely to [15] in an earlier draft.
16. [Glossary of Airtable terminology — Airtable Support](https://support.airtable.com/docs/glossary-of-airtable-terminology)
17. [Intro to databases — Notion Help Center](https://www.notion.com/help/intro-to-databases)
18. [Overview: Tables — Coda Help Center](https://help.coda.io/hc/en-us/articles/39555768266893-Overview-Tables) — the page is bot-gated to a direct fetch (HTTP 403) but was retrieved through a rendering proxy and read in full. An earlier draft of this section quoted phrasing taken from a search-engine snippet ("a single, structured data item in a table", "rows are the nouns in your data", "columns hold the details that describe them"); **none of that wording appears on the page** and it has been replaced above with the page's actual text. Note also that the page is now branded "Superhuman Docs", so the Coda-era wording may have been edited away.
19. [Polls — Loomio Help](https://www.loomio.com/docs/en/user_manual/polls/proposal_types)
