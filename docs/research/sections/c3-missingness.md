# Missingness vocabularies and incomplete decision matrices

> [!IMPORTANT]
> **Superseded on one point.** § 3.3 drops a criterion from the comparison for an alternative whose cell is structurally missing; per pair, that is the common-dimensions rule, which is non-transitive. Dominance is instead computed over a fixed criterion set applicable to every alternative in scope, with the excluded criteria named in the result. See [`findings-terminology.md` § 7, Conflict G](../findings-terminology.md); the evidence below stands, the recommendation does not.

**Research question(s):** What are the standard vocabularies for observation status (SDMX, survey
research, DDI, and others), and how does `comparanda`'s set — `not-applicable`, `not-assessed`,
`pending`, `unknown`, `withheld` — map against them? What is missing, what is named badly, and
should the set be extensible? Is the MCAR/MAR/MNAR framing useful here or a category error? How do
MCDA methods handle incomplete matrices, and under what completeness conditions may `comparanda`
offer an aggregation at all? Does excluding `not-applicable` from completeness counts match
practice, and exactly how should completeness be reported? Finally: how should missingness be
*rendered* so that `not-applicable` reads as "correctly nothing" and `not-assessed` reads as "a
gap", without relying on colour?

**Brief section:** `docs/research/terminology.md` §4 — Missingness.

**Evidence grade:** **strong for the vocabularies and the MCDA methods; weaker for rendering.** The
vocabulary claims are taken from the normative artefacts and were re-checked against them
(SDMX Global Registry `CL_OBS_STATUS` v2.3 and the SWG/TWG implementation note; HL7 Terminology
v6.0.2 `NullFlavor`; FHIR R4 `DataAbsentReason`; the DDI/QDDT missing-values documentation with its
ESS worked example; Codd's SIGMOD Record paper). The MCDA-with-incomplete-data claims come from
primary papers (Greco, Mousseau & Słowiński EJOR 2008; Jiménez, Mateos & Ríos-Insua Omega 2009;
Lahdelma, Hokkanen & Salminen EJOR 1998; Khalefa, Mokbel & Levandoski ICDE 2008 — the last quoted
via Kalyvas & Tzouramanis's survey rather than from the primary text) plus a practitioner handbook
(OECD/JRC 2008), the COINr documentation, and a live production audit (JRC statistical audit of the
GII 2024). Two legs are weaker and are marked in place: the ISO/IEC 25012 completeness definition is
quoted from secondary sources because the normative text is paywalled, and the *rendering*
recommendation rests on one source ([20]) that could not be reached at audit time plus a WCAG
success criterion that gives a principle but no measured study of the specific
structural-vs-contingent contrast; that part is labelled as reasoning.

---

## Bottom line

The five-code set is close to right and its ancestry is respectable — `not-applicable` is exactly
Codd's I-mark and HL7's `NA`; `not-assessed` is FHIR's `not-asked`; `withheld` is HL7's `MSK` —
but it has one bad name and one substantive hole. **`unknown` is named badly**: in both HL7 v3 and
FHIR, `unknown`/`UNK` is the *generic parent of the entire not-known branch* [3][4], so an author
or an agent reaching for the word gets the catch-all that ADR-0009 exists to abolish. **The hole is
`not-evidenced`** — "we searched the sources and they are silent on this" — which is the single
most decision-relevant absence a `rubricator` analysis can produce and is currently forced into
`unknown`. Make the set **extensible with two mandatory boolean flags** (`structural`, `terminal`)
and a mandatory `broader` pointer into the closed core, so completeness arithmetic and rendering
never hard-code a code list. On the statistics: **MCAR/MAR/MNAR is a category error as schema
content and essential as a design rationale** — do not store it, do cite it as the reason the
default is never to impute. On aggregation: **do not impute, and do not renormalise weights over
observed criteria** (that is mean imputation wearing a disguise [12]); instead substitute each
missing cell's declared range and compute **necessary / possible** dominance and interval-valued
aggregates, the robust-ordinal-regression framing [8]. Offer a point aggregate only at 100% weight
coverage for that alternative; offer the interval form down to **2/3 weight coverage** (the
threshold a real production index adopted on JRC advice [13]); below that, offer dominance
screening only. And render **structural absence as the absence of ink, contingent absence as the
presence of a placeholder** — that one rule carries the whole distinction with no hue at all.

---

## Findings

### 1. What the standard vocabularies actually contain

#### 1.1 SDMX `CL_OBS_STATUS`

**EVIDENCE.** The SDMX cross-domain code list for observation status, version 2.3, contains 23
codes [1]. The ones that concern us:

| SDMX code | Definition (v2.3) |
|---|---|
| `A` | Normal value — "default value if no value is provided or when no special coded qualification is assumed" |
| `O` | Missing value — "no breakdown is made between the reasons why data are missing" |
| `M` | Missing value; data cannot exist — "empty cells resulting from the impossibility to collect a statistical value" |
| `L` | Missing value; data exist but were not collected |
| `H` | Missing value; holiday or weekend |
| `Q` | Missing value; suppressed — "data are suppressed due to statistical confidentiality considerations" |
| `_U` | Unknown — "observation status (rather than the value) is not available" |
| `S` | Strike and other special events — "Special circumstances (e.g. strike) affecting the observation or causing a missing value" |
| `E`, `I`, `F`, `P`, `V`, `U`, `G` | present-value qualifiers: estimated, imputed, forecast, provisional, unvalidated, low reliability, experimental |

Three things are worth stealing.

**(a) SDMX puts "why is it missing" and "how good is the value that is there" in one code list, and
regrets it.** The official implementation guidance opens by admitting the list "has an
heterogeneous character as it mixes concepts which are not always mutually exclusive," and says
that ideally it "should be broken down into various sub-code lists" — which was not done because
it "would unnecessarily increase the number of (very short) code lists" [2]. `comparanda` does not
have this problem, because presence-quality lives in the `confidence` measure and in provenance
(ADR-0014), not in the missingness code. **Do not import SDMX's `E`/`I`/`P`/`U` codes.** They are
value qualifiers and they belong to a different axis. (This is also why `withheld` deserves a
second look — see §1.5.)

**(b) SDMX publishes a strict precedence hierarchy for the one-flag-per-value case**, ordered by
"importance": `B > O > M > L > H > Q > J > S > D > I > F > E > P > N > U > V > G > A` [2]. The
principle transfers: if a cell could carry more than one reason, the schema must name a
deterministic winner rather than leaving it to the author. `comparanda`'s codes are close to
mutually exclusive already; declare a precedence anyway, because a group-pair `not-applicable`
rule (domain model, §Groups) can collide with an author-set `pending`, and structural absence must
win.

**(c) SDMX evaluated exactly the extensibility question `comparanda` faces** and reached a
three-way answer: duplicate the concept (`OBS_STATUS_1`, `OBS_STATUS_2`, …) — recommended;
decompose into orthogonal boolean concepts — "Conceptually the “Decomposition” approach is
definitely the strongest of the two," accepted but not preferred, the duplication approach being
recommended "mainly on the practical grounds of ease of implementation"; or enumerate every legal
combination — "strongly discouraged" [2]. For a greenfield schema with no legacy exchange format,
**the decomposition answer is the correct one** and its cost objection does not apply to us: see §1.6.

#### 1.2 HL7 v3 `NullFlavor` and FHIR `DataAbsentReason`

**EVIDENCE.** HL7 v3's `NullFlavor` is the most elaborated missingness vocabulary this review found
in production use, and it is *hierarchical* [3]. (The comparative judgement is mine; the hierarchy and
the definitions below are quoted from the normative artefact.)

```
NI   NoInformation ("The value is exceptional (missing, omitted, incomplete, improper). No
                     information as to the reason for being an exceptional value is provided.")
├── NA    not applicable   "Known to have no proper value"
├── MSK   masked           "There is information on this item available but it has not been
│                      provided by the sender due to security, privacy or other reasons"
├── UNK   unknown          "A proper value is applicable, but not known"
│   ├── ASKU  asked but unknown   "Information was sought but not found"
│   │   └── NAV  temporarily unavailable
│   ├── NASK  not asked           "This information has not been sought"
│   ├── NAVU  Not available       (no expectation of future availability)
│   │   └── NAV  temporarily unavailable
│   ├── QS    sufficient quantity
│   └── TRC   trace
└── INV   invalid
    ├── OTH  other  ├── NINF, PINF
    ├── DER  derived
    └── UNC  un-encoded
```

FHIR R4's `DataAbsentReason` is the flattened, modern restatement [4]: `unknown`, `asked-unknown`,
`temp-unknown`, `not-asked`, `asked-declined`, `masked`, `not-applicable`, `unsupported`,
`as-text`, `error`, `not-a-number`, `negative-infinity`, `positive-infinity`, `not-performed`,
`not-permitted`.

The mapping to `comparanda`:

| `comparanda` | HL7 v3 | FHIR R4 | SDMX | Codd | Verdict |
|---|---|---|---|---|---|
| `not-applicable` | `NA` | `not-applicable` | `M` | I-mark | **exact match, keep verbatim** |
| `not-assessed` | `NASK` | `not-asked` | `L` | — | **exact match, keep** |
| `pending` | `NAV` (temporarily unavailable) | `temp-unknown` | — | — | right concept, **weak name** |
| `unknown` | `ASKU` (not `UNK`!) | `asked-unknown` (not `unknown`!) | — | A-mark | **badly named** |
| `withheld` | `MSK` | `masked` | `Q` (+ `CL_CONF_STATUS`) | — | good name, **wrong axis** |
| — | — | — | — | — | **gap: source is silent** |
| — | `OTH`/`INV` | `error` | — | — | gap, low priority |

**The `unknown` problem is real and worth fixing.** The domain model defines `unknown` as
"Someone looked and could not determine it" — that is `ASKU` / `asked-unknown`, a *leaf* of the
not-known branch. But both HL7 and FHIR reserve the bare word `unknown` for the branch *root*, the
"we know nothing about why" catch-all. Anyone who has ever touched a clinical, statistical or
database schema will read `unknown` as the fallback and will use it as one. That is precisely the
"silent blank in a different costume" that ADR-0009 is written to prevent, and the risk is highest
in the runtime where it matters most: an agent under instruction-following pressure will reach for
the vaguest available code. (Reasoning, on top of the vocabulary evidence.)

#### 1.3 Survey research and DDI

**EVIDENCE.** DDI-Lifecycle models missing values as a **separate, independently reusable value
structure** layered onto the variable's representation, not as members of the valid domain:
"Conceptually, response domains for questions and variable representations for variables consist in
two parts, the valid domain or representation, and the missing values," and "Sets of missing values
are also reusable in themselves" [5]. Concretely, "DDI 3.2 has a separate missing values structure,
which allows reuse of missing values and missing values sets in variables and question structures by
reference" — a `ManagedMissingValueRepresentation`, which "can be a `MissingCodeRepresentation`, a
`MissingNumericRepresentation` or a `MissingTextRepresentation`" — plus an attribute
"`BlankisMissingValue` = 'true' … to define blanks as missing values at the level of
`ManagedMissingValueRepresentation`" [5]. (The "sentinel value domain" / "sentinel conceptual
domain" terminology used in earlier drafts of this section belongs to DDI-CDI, not to [5], and is
**UNVERIFIED — could not locate source**; it is dropped here in favour of [5]'s own wording, which
carries the same design point.) The European Social Survey convention, which the DDI/QDDT
documentation uses as its worked example, has four categories with the familiar radix-expanding
codes [5]:

- **Not applicable** (6, 66, 666) — "respondent has been routed away from the question"
- **Refusal** (7, 77, 777)
- **Don't know** (8, 88, 888)
- **No answer** (9, 99, 999) — "codes for missing data not elsewhere explained… respondent/
  interviewer errors and production/system errors"

UK survey practice uses negative sentinels for the same distinctions: a UK Data Service tutorial on
the Labour Force Survey teaching dataset notes that "in many surveys, there are different missing
codes, i.e. -9, -8, -7, etc. that may indicate different missing mechanisms, such as refusing, not
applicable, etc.", and its worked variables carry the value labels −9 "Does not apply" and −8 "No
answer" [6]. (An earlier draft attributed to [6] the stronger claim that "blanks, system-missing or
'0' values are best avoided"; that sentence does not appear in [6] and is **UNVERIFIED — could not
locate source**. The weaker, sourced point — that practice codes *reasons* rather than leaving the
cell empty — is what the argument needs and is what [6] shows.)

Two lessons. First, **the four-category survey set is a subset of ours**: "not applicable" =
`not-applicable`, "don't know" = `unknown`, "no answer" ≈ `not-assessed`, and "refusal" is a code
`comparanda` does not have and arguably should, in the multi-rater case (a rater who declines to
score a cell is a different fact from a rater who has not looked). Second — and this is the design
lesson — **DDI's construction says the missingness codes are a separate, independently-reusable
value structure layered on the variable's own representation, not members of its valid domain.**
That is the same conclusion as SDMX's decomposition analysis and the same conclusion §1.6 reaches:
missingness reasons are their own vocabulary object with their own metadata, not string literals.
(The extrapolation from "reusable missing-values structure" to "vocabulary object with metadata" is
reasoning; [5] supports the separation and the reusability, not the metadata model.)

#### 1.4 Codd, and why the structural/contingent split is fifty years old

**EVIDENCE.** Codd's 1986 SIGMOD Record paper is titled, literally, *Missing information
(applicable and inapplicable) in relational databases* [7]. Version 2 of the relational model
distinguishes an **A-mark** (missing but applicable — the entity has the attribute, we do not know
its value) from an **I-mark** (missing but inapplicable — the entity does not have the attribute,
so no value can ever exist) [7]. SQL shipped with one `NULL` for both. (That this is the
single most complained-about consequence is my characterisation, not a claim in [7].)

This is exactly `comparanda`'s structural-vs-contingent axis, forty years earlier, and it is the
strongest possible confirmation that ADR-0009's insistence on the distinction is not fussiness.
`not-applicable` is an I-mark; everything else in the set is an A-mark.

#### 1.5 `withheld` sits on the wrong axis, or rather on two

**EVIDENCE + REASONING.** SDMX deliberately keeps confidentiality in a *separate* concept and code
list — `CONF_STATUS` / `CL_CONF_STATUS` — alongside `OBS_STATUS`, and only mirrors it into
`OBS_STATUS` as the code `Q` ("missing value; suppressed") for the case where suppression causes
the absence [1][2]. HL7 does the same thing differently: `MSK` is a `NullFlavor`, but FHIR also
carries `Observation.security` labels for values that *are* present but restricted.

The practical consequence for `comparanda` is a real modelling question. A value that is
`withheld` in a shared deployment may be *present* in the authoring store — the analysis knows the
score, the reader is not shown it. If `withheld` is only a missingness reason, then rendering a
redacted view of an analysis requires destroying data. **Recommendation: keep `withheld` in the
reason set (it is genuinely the reason a reader sees nothing), and additionally model disclosure as
an orthogonal, view-time property of a value** so that redaction is a projection rather than an
edit. This is a schema-level decision and it is cheap now and expensive later.

#### 1.6 Should the set be extensible? Yes — with two mandatory flags and a parent

**REASONING, grounded in [2], [3] and [5].** ADR-0009 already says "closed, schema-declared set…
and analyses may extend it," which is internally in tension. Resolve it as HL7 does: **the set is
open, but every code — core or custom — is a first-class object that must declare where it sits in
the closed core taxonomy and what arithmetic it participates in.**

Every missingness reason declares:

| field | type | meaning |
|---|---|---|
| `code` | string | stable identifier |
| `broader` | one of the **closed core** codes | ancestor, so an unknown code degrades gracefully |
| `structural` | boolean | true ⇒ the cell is outside the applicable matrix; excluded from **every** denominator |
| `terminal` | boolean | false ⇒ work remains; true ⇒ this absence is the finished answer |
| `informative` | boolean (advisory) | true ⇒ the absence is a statement about the **subject**; false ⇒ about **our process** |
| `label`, `description`, `glyph` | display | see §4 |

The core set, with the flags fixed:

| code | `structural` | `terminal` | `informative` | reads as |
|---|---|---|---|---|
| `not-applicable` | **true** | true | true | "correctly nothing" |
| `not-assessed` | false | **false** | false | "a gap" |
| `deferred` (was `pending`) | false | **false** | false | "a gap, on purpose, for now" |
| `not-evidenced` (**new**) | false | true | **true** | "we looked; the sources are silent" |
| `indeterminate` (was `unknown`) | false | true | true | "we looked; we could not tell" |
| `withheld` | false | true | false | "known, not shown here" |

Two flags are enough to make every completeness computation and every rendering decision without a
`switch` on the code — which is the open-closed property the project wants and the reason a custom
code from a downstream deployment cannot break the completeness report.

**Constraints on extension:** a custom code (i) MUST declare `broader` from the core six; (ii) MUST
declare `structural` and `terminal`, and MUST NOT set `structural: true` unless its `broader` is
`not-applicable`; (iii) MUST NOT be usable as a schema default; (iv) is scoped to the analysis and
travels inside the document, so a standalone bundle renders it with no registry lookup. Plausible
extensions that should *not* be in core: `declined` (a rater refused to score — `broader:
not-assessed`, from the ESS "refusal" category [5]), `contested` (sources materially disagree —
`broader: indeterminate`), `out-of-scope` (`broader: not-applicable`), `superseded`.

#### 1.7 The gap that matters most: `not-evidenced`

**REASONING, motivated by the MNAR literature in §2.** ADR-0014 says an agent "that cannot cite a
span should be recording `unknown` rather than a confident number." But there are two very
different findings behind that blank, and only one of them is about the alternative:

- *We searched the sources and they do not address this criterion.* This is a fact **about the
  alternative and its documentation**. It is frequently the finding. An alternative whose material
  never mentions, say, migration cost is telling you something about migration cost.
- *We found material bearing on this criterion but could not resolve it to a score* — the sources
  conflict, or are too vague, or the criterion as framed does not cut the evidence cleanly. This
  is a fact **about the criterion definition and the evidence**, and it usually means the criteria
  discussion (ADR-0005 in `rubricator`) is not finished.

Collapsing these two into `unknown` destroys the most useful signal the tool produces. Split them:
`not-evidenced` and `indeterminate`. `not-evidenced` should be **countable and encodable** — a
column of `not-evidenced` down one alternative is a finding about that alternative; a row of it
across one criterion is a finding about the criterion.

---

### 2. MCAR / MAR / MNAR — decisive verdict

**Verdict: a category error as schema content; load-bearing as design rationale. Do not store it.
Do cite it.**

**EVIDENCE.** Rubin's taxonomy classifies the *mechanism* that generates missingness, in a
probabilistic model, for one purpose: deciding when the missingness mechanism is **ignorable** for
likelihood-based inference about a population [9]. The OECD/JRC handbook states the definitions in
the composite-indicator context and then states the operative caveat: "there is no statistical test
for NMAR and often no basis on which to judge whether data are missing at random or systematically,
while most of the methods that impute missing values require a missing at random mechanism, i.e.
MCAR or MAR. When there are reasons to assume a non-random missing pattern (NMAR), the pattern must
be explicitly modelled and included in the analysis. This could be very difficult and could imply
ad hoc assumptions that are likely to influence the result of the entire exercise" [10].

**Why it is a category error here.** Every premise of the taxonomy fails for `comparanda`. There is
no population and no sample: the alternatives are purposively chosen, not drawn. There is no
repeated realisation over which "the probability that a value is missing" is defined — the matrix
is one document, authored once, tens by tens. There is no likelihood being maximised and no
estimator whose bias the classification would characterise. And, decisively, **`comparanda` already
records the reason directly.** MCAR/MAR/MNAR is a *taxonomy of unobserved mechanisms you have to
guess at*; ADR-0009's reason codes are *observed statements by the author about why*. Having the
second, you do not need the first — asking an author or an agent to additionally classify a blank
as MAR versus MNAR is asking them to make an unfalsifiable claim about a data-generating process
that does not exist. (Reasoning, on the evidence of [9][10].)

**Why the MNAR insight is nevertheless the most important idea in this section.** The brief's
parenthetical is right: an alternative whose documentation omits a criterion is often omitting it
for a reason. That is textbook informative missingness, and the correct engineering response is not
Rubin's taxonomy but the **missing-indicator method**: keep missingness as a first-class,
inspectable feature rather than an artefact to be smoothed away. Recent theory shows, of the Missing
Indicator Method, "that MIM improves performance for informative missing values, and we prove that
MIM does not hurt linear models asymptotically for uninformative missing values" [11] — i.e.
carrying the indicator is close to a free option. `comparanda`'s equivalents of the missing
indicator are (a) the `informative` flag in §1.6, (b) the `not-evidenced` code, and (c) a
**`missingness` encoding** registered under ADR-0010 that colours the grid by reason rather than by
score, so the pattern of silence is directly readable.

**Where to put the framing.** In `docs/domain-model.md` and in the *point-of-use* copy that
ADR-0015 requires of every analysis: the sentence justifying why the aggregation dialog defaults to
"do not impute" is "imputation methods require the missing values to be ignorable, this cannot be
tested, and here they usually are not" — with the citation. That is exactly the kind of assumption
ADR-0015 says must be stated in the UI and not in documentation elsewhere.

---

### 3. How MCDA handles incomplete matrices, and what we may offer

Four families exist. Only one of them belongs in `comparanda` as a default.

#### 3.1 Deletion — rejected

**EVIDENCE.** Case deletion "ignores possible systematic differences between complete and
incomplete samples and produces unbiased estimates only if deleted records are a random sub-sample
of the original sample (MCAR assumption)"; the handbook's rule of thumb is that "if a variable has
more than 5% missing values, cases are not deleted" [10].

For `comparanda` this is doubly wrong: dropping an alternative because a cell is blank silently
removes a candidate from a decision, and the matrices are far too small to absorb it. Deletion may
be offered only as an explicit, visible, reversible filter the user applies — never as a
precondition of an analysis.

#### 3.2 Imputation — available, never default, never silent

**EVIDENCE.** The handbook's own verdict: "No imputation model is free of assumptions and the
imputation results should hence be thoroughly checked for their statistical properties… as well as
heuristically for their meaningfulness" [10]. Mean substitution specifically: "By 'filling in' blank
spaces with the sample mean, the imputed value becomes a biased estimator of the population mean,
even in the case of MCAR mechanisms, and the sample variance underestimates true variance, thus
underestimating the uncertainty in the composite due to the imputation" [10].

**The trap that will otherwise be walked into.** The obvious-seeming "just skip the missing
criteria and renormalise the weights over the ones you have" is **mean imputation in disguise**.
COINr's documentation states it flatly: "if we take the mean of a group of indicators, and there is
a `NA` present, this value is excluded from the mean calculation. Doing this is mathematically
equivalent to assigning the mean to that missing value… This is sometimes known as 'shadow
imputation'" [12]. The JRC statistical audit of the Global Innovation Index makes the same
observation about a live production index whose team "has always opted not to estimate missing
data": there, "the score of the aggregate containing the missing value is based on the other
elements of the aggregate for which values are observed", which "technically … constitutes a form of
'shadow' imputation", so that "the available data (indicators) in the incomplete pillar may dominate,
sometimes biasing the ranks up or down" [13].

Jiménez, Mateos & Ríos-Insua give the two textbook options for missing consequences in a
multiattribute utility model: "disregarding the attributes for which a decision alternative provides
no consequence by redistributing their respective weights throughout the objective hierarchy," or
"assignation of the respective attribute range as a default value for missing
consequences due to possible uncertainty" [14]. The
first is the renormalisation trap above. **The second is the recommendation.**

So: ship imputation as a named, opt-in analysis if at all; label it with the method; and — this is
the part that is non-negotiable — **weight renormalisation must be labelled as an imputation**, in
the UI, with the sentence "this assumes each missing criterion performs at this alternative's
average." It is currently the thing every spreadsheet does without saying so.

#### 3.3 Interval / robust methods — **this is the recommendation**

**EVIDENCE.** Robust ordinal regression (Greco, Mousseau & Słowiński, `UTA-GMS`) defines two
relations over a set of preference models compatible with the available information: **necessary
weak preference**, which holds "if and only if for all compatible value functions a is preferred to
b," and **possible weak preference**, which holds "if and only if for at least one compatible value
function a is preferred to b." The necessary relation is a partial preorder; the possible relation
is strongly complete; and with no preference information at all "the necessary weak preference
relation is a weak dominance relation, and the possible weak preference relation is a complete
relation" — each new piece of information enriches the necessary relation and impoverishes the
possible one until they converge [8].

The move `comparanda` should make is to apply that same necessary/possible split to **missing
performance data** rather than missing preference data, using Jiménez et al.'s "attribute range as
default" device [14] to turn each missing cell into an interval. Concretely:

- Each cell becomes an interval `[lo, hi]`. An observed value gives the degenerate interval
  `[v, v]`. A contingently missing value gives the criterion's declared range `[min, max]`. A
  **structurally** missing value gives no interval at all — the criterion is dropped from the
  comparison for that alternative, which is a different and stronger statement.
- A **completion** is any choice of one value from each interval.
- `a` **necessarily dominates** `b` ⟺ for every criterion `j`, `lo_a[j] ≥ hi_b[j]`, with strict
  inequality for at least one `j`. This holds under every completion.
- `a` **possibly dominates** `b` ⟺ for every criterion `j`, `hi_a[j] ≥ lo_b[j]`, with strict
  somewhere. This holds under at least one completion.

Two properties make this implementable and safe. **Necessary dominance is transitive** — if
`lo_a[j] ≥ hi_b[j]` and `lo_b[j] ≥ hi_c[j]` then, since `hi_b[j] ≥ lo_b[j]`, `lo_a[j] ≥ hi_c[j]` —
so the necessarily-dominated set is a well-behaved reduction and can be computed by any standard
skyline routine. **Possible dominance is not transitive**, which is fine because it is used as a
filter, not an order.

**The alternative approach must be actively prohibited.** The naive "compare on the criteria both
alternatives happen to have" is exactly the relation studied in the incomplete-skyline literature,
and it is broken. Khalefa, Mokbel & Levandoski [15] showed this; the clearest statement of it is in
Kalyvas & Tzouramanis's survey, summarising [15]: "On incomplete data, the transitivity does not
always holds. A non-transitive dominance property may lead to cycle dominance … resulting that each
point is dominated by at least one other point" [16]. The survey gives a three-point worked example
— `p1=(4,2,–)`, `p2=(3,–,4)`, `p3=(–,3,2)`, comparing only on commonly-known dimensions — in which
`p1` dominates `p2`, `p2` dominates `p3` and `p3` dominates `p1`, so "none of the points can be
considered skyline points" [16]. The `ISkyline` algorithm of [15] uses "two optimization techniques
namely virtual points and shadow skyline in order to avoid the cycle dominance that may occur due to
the non-transitivite dominance relation" [16].
`comparanda` does not need `ISkyline`'s machinery — at tens of alternatives, exhaustive pairwise
comparison is free — but it absolutely needs the warning: **a Pareto filter that compares on common
known criteria can silently eliminate every alternative, including the right one.** Use the
necessary/possible interval relations instead.

The payoff is a feature, not just a safeguard. **The gap between the possibly-non-dominated set and
the necessarily-non-dominated set is a direct measure of how much the missing data is costing the
decision.** And because the matrices are small, the tool can go one step further and compute, for
each contingently missing cell, whether resolving it could change the necessary set — a
value-of-information ranking that answers "which blank should we go and fill first?" This is the
best argument for the whole missingness apparatus and it falls straight out of the interval model.
(Reasoning, built on [8][14][15].)

#### 3.4 Stochastic / partial-information MCDA — note it, do not ship it

**EVIDENCE.** SMAA (Lahdelma, Hokkanen & Salminen) is a technique in which "the decision makers need
not express their preferences explicitly or implicitly; instead the technique analyses what kind of
valuations would make each alternative the preferred one"; "inaccurate or uncertain input data can be
represented as probability distributions"; and it produces per alternative "an acceptability index
measuring the variety of different valuations that support that alternative, a central weight vector
representing the typical valuations resulting in that decision, and a **confidence factor** measuring
whether the input data is accurate enough for making an informed decision" [17].

SMAA is the right answer for a different problem: uncertainty in *weights*, over continuous
criteria, with a defensible distributional model. `comparanda`'s cells are largely ordinal
(ADR-0003), its missingness is often structural or informative rather than random, and Monte Carlo
over a uniform prior for a blank cell would manufacture precision the data does not have. **Cite it
in the docs as the method a user should reach for if they genuinely have distributions; do not
implement it in v1.** The one idea worth stealing is the *confidence factor* framing: report
alongside any ranking a statement of whether the data supports it — which the necessary/possible
gap already provides in a form that requires no distributional assumption.

#### 3.5 The recommendation, as a decision table

Define, for an alternative `a` and a weighting `w`, **weight coverage** = the sum of `w_j` over
criteria where `a` has an observed value, divided by the sum of `w_j` over criteria **applicable**
to `a`. (Structural absences leave the denominator, per §4 — a criterion that cannot apply must not
count against the alternative.)

| weight coverage for `a` | what the tool offers |
|---|---|
| **1.0** | point aggregate available (still opt-in, still labelled, still warned on ordinal data per ADR-0015) |
| **≥ 2/3 and < 1.0** | interval aggregate `[lo, hi]` only. No point value anywhere in the UI. Ranking shown only between alternatives whose intervals do not overlap; overlapping pairs render as "not separable on the available data" |
| **< 2/3** | **no aggregate of any kind.** Dominance screening (necessary / possible), veto screening, and the completeness report only |

**EVIDENCE for the 2/3 threshold.** The Global Innovation Index, on JRC recommendation and following
"the criteria adopted in 2016", includes an economy only if "data availability is at least 66 percent
within each of the two sub-indices", a rule whose stated purpose is to "ensure that economy scores
for the GII and for the two Input and Output Sub-Indices are not overly sensitive to missing values"
[13]. COINr's `checkData()` uses the same 2/3 default for screening units
[12]. It is the closest thing to a consensus number in the practitioner literature; adopt it as the
**default value of a configurable parameter**, not as a magic number in the code. **One caveat, and
it is ours to own:** both [13] and [12] measure availability as a *count* of indicators (GII: "35 out
of 53 variables within the Input Sub-Index and 17 out of the 25 variables in the Output Sub-Index"),
whereas §3.5 applies the threshold to *weight* coverage. The transfer is deliberate — an unweighted
count is the wrong denominator once criteria carry unequal weights — but it is our extension, not
something either source establishes.

Two further rules, both mandatory:

- **Any alternative excluded from an aggregation by the coverage gate stays visible in the matrix,
  labelled "not scored — insufficient coverage".** Silently dropping it reintroduces case deletion
  (§3.1) through the back door.
- **`withheld` counts as observed-but-unavailable-to-you, not as absent.** If a value is withheld
  from a reader, that reader must be told the aggregate is computed on data they cannot see, or the
  aggregate must be suppressed. Do not let redaction masquerade as sparsity.

---

### 4. Structural vs contingent absence, and exactly how to report completeness

#### 4.1 Excluding `not-applicable` from completeness matches practice

**EVIDENCE.** ISO/IEC 25012 defines completeness as "the degree to which subject data associated with
an entity has values for all **expected** attributes and related entity instances **in a specific
context of use**" [18] — the two qualifiers do the work: an attribute that cannot apply in this
context is not expected, so its absence is not a completeness defect. (An earlier draft of this
section rendered the definition as "all attributes *necessary* for the representation of the entity";
that wording is not the standard's. The normative text is paywalled, and the free summary cited at
[18] carries only the gloss "Required information should be present for intended use", so the
quotation above is **UNVERIFIED against the normative text** and is reproduced from secondary
sources. The argument does not depend on which qualifier is used.) Codd's I-mark
exists precisely to mark cells for which "no value can ever be resolved" [7]; SDMX's `M` is "empty
cells resulting from the impossibility to collect a statistical value," a separate code from `L`
(exists but not collected) and `O` (unspecified) [1]; DDI/ESS routes "not applicable" respondents
*away from the question*, so the question was never in that respondent's denominator [5]. Every one
of these vocabularies puts structural absence outside the count.

**ADR-0009's requirement is correct as written. Confirm it.** The only amendment needed is to
generalise it: the exclusion must key on the `structural` flag (§1.6), not on the literal string
`not-applicable`, so that a deployment's custom `out-of-scope` code behaves correctly.

#### 4.2 The completeness report, specified

A completeness report over a scope `S` (a set of cells) yields five counts and three derived rates.
Cells are `(alternative, criterion, measure)` triples — completeness **must** be per-measure,
because `comparanda`'s tensor is `alternatives × criteria × measures` and a cell routinely has a
`score` and no `confidence`.

Counts:

- `applicable` — cells in `S` whose reason is not `structural`, i.e. the denominator
- `inapplicable` — cells in `S` whose reason is `structural` (reported, never divided by)
- `valued` — applicable cells holding at least one asserted value
- `resolved-absent` — applicable cells missing with `terminal: true` (`not-evidenced`,
  `indeterminate`, `withheld`)
- `outstanding` — applicable cells missing with `terminal: false` (`not-assessed`, `deferred`)

Rates (`valued + resolved-absent + outstanding = applicable`, by construction):

- **`assessedRate` = `valued / applicable`** — how much of the applicable matrix carries a value
- **`settledRate` = `(valued + resolved-absent) / applicable`** — how much has been *looked at*.
  This is the number that answers "is the analysis finished", and it is the number ADR-0009 needs
  for its "valid and complete-as-specified rather than half-broken" requirement: an analysis
  deliberately full of qualified blanks reaches `settledRate = 1.0` while `assessedRate` stays low.
  **Ship both. Never ship only one.**
- **`silenceRate` = `count(informative && terminal) / applicable`** — the share of the applicable
  matrix where we looked and the absence is itself a statement about the subject. Note that with the
  core flags of §1.6 this counts `not-evidenced` **and** `indeterminate`; if the intended reading is
  strictly "the sources said nothing", report `not-evidenced` alone and treat the wider figure as a
  second rate. Pick one before Phase 2 and name it accordingly. Either way this is the MNAR signal
  from §2 made into a number, and at the criterion level it is the strongest available evidence that
  a criterion is badly framed.

Levels at which the report is computed, all from the same function over a different cell scope:

| level | scope | what it answers |
|---|---|---|
| **analysis** | all cells | is this done? |
| **alternative (row)** | one alternative × all criteria × all measures | do we know enough about this option to rank it? |
| **criterion (column)** | all alternatives × one criterion × all measures | is this criterion answerable at all? |
| **measure** | all cells for one measure | (e.g.) is `confidence` being filled in, or ignored? |
| **alternative group** | union over member rows | |
| **criterion group** | union over member columns | |
| **group-pair block** | one alternatives-group × one criteria-group | the block the domain model lets you declare inapplicable |

Four reporting rules:

1. **Always render the fraction, never a bare percentage.** "34 / 51 applicable" is auditable;
   "67%" is not, and hides whether the denominator dropped because work was done or because a
   block was declared inapplicable. Show `inapplicable` next to it.
2. **Report whole-alternative absence separately from per-cell absence.** Survey research separates
   *unit nonresponse* (nobody answered anything) from *item nonresponse* (a single question was
   skipped) for good reason; in `comparanda`'s vocabulary that is an entirely empty **alternative**
   or **criterion** versus scattered empty **cells**. A row with zero valued cells is a categorically
   different problem from a row that is 80% filled, and averaging the two into one analysis-level
   percentage hides it. Flag `valued == 0` rows and columns explicitly.
3. **Report against declared scope by default, and against the full applicable matrix as a
   secondary figure.** ADR-0009 requires that "fill these two criteria for all alternatives, mark
   everything else `deferred`" produce a document that is complete-as-specified. Make that literal:
   the analysis may carry an optional **round scope** (a set of group-pair blocks), and the headline
   completeness is computed against it. The full-matrix figure is always available and always
   shown second, so a scoped analysis can never be mistaken for a finished one.
4. **`withheld` counts as settled, not outstanding, and is disclosed.** The completeness report of
   a redacted view must say how many cells were withheld from *this reader*.

---

### 5. Rendering: "correctly nothing" versus "a gap", without colour

**EVIDENCE.** WCAG 2.2 SC 1.4.1 (Use of Color) requires that colour is never "the only visual means
of conveying information, indicating an action, prompting a response, or distinguishing a visual
element" [19]. The Pearson Data Visualization Style Guide, which otherwise argues *against*
patterned fills on cognitive-load grounds, is reported to name exactly one exception: "the limited
use of patterned fills or strokes to indicate some qualitative exception, such as missing data,
uncertain data, or future projected data… The use of patterns should be reserved for this semantic
data, rather than as a visual distinction" [20]. **(UNVERIFIED — `accessibility.pearson.com` refused
connections at audit time; the host resolves but served no content, so this quotation could not be
checked against the source. Treat the pattern-reservation rule below as reasoning constrained by
[19] until [20] is re-checked.)** That is a direct licence for the one place `comparanda`
needs texture, and a direct prohibition on using it anywhere else — which conveniently keeps the
texture channel free for the `uncertainty-suppressed` encoding's hatching (ADR-0010) to remain
distinguishable, because that hatch means "uncertain value present" while these mean "no value".

**REASONING — the single rule that carries the distinction.**

> **Structural absence is the absence of ink. Contingent absence is the presence of a placeholder.**

`not-applicable` should not look like an empty cell; it should look like *there is no cell there*.
Contingent absences should look like a container that is waiting to be filled. That reads correctly
in greyscale, in forced-colors mode, in print, and to a colour-blind reader, because the channel is
figure-versus-ground rather than hue.

Concretely:

| reason | fill | glyph | border | in a fully-structural block |
|---|---|---|---|---|
| `not-applicable` (`structural`) | **none** — page surface, not a cell colour | none, or a hairline diagonal rule corner-to-corner | no cell border; the grid line simply passes through | the whole block collapses to a single labelled band, per the domain model |
| `not-assessed` | surface, inset | `?` | full cell border, **dashed** | — |
| `deferred` | surface, inset | `…` | full cell border, dashed | — |
| `not-evidenced` | surface, inset, faint 45° hatch | `∅` | full cell border, **solid** | — |
| `indeterminate` | surface, inset, faint 45° hatch | `~` | full cell border, solid | — |
| `withheld` | surface, inset, faint cross-hatch | `▪` (or a lock glyph) | full cell border, solid | — |

The border encodes `terminal`: **dashed = work remains, solid = this is the answer.** The glyph
encodes the specific reason. The fill pattern encodes `informative`. Three independent
non-hue channels, all legible at the 20-or-so-pixel cell heights a 22 × 12 matrix implies.

Six supporting requirements:

1. **Never take the "missing" colour from the sequential value ramp.** A sequential ramp inverted
   for a dark surface (ADR-0010) passes through mid-greys, so any grey chosen for missing collides
   with a real value in one theme. Missing cells take the *surface* colour, not a ramp colour.
2. **The em dash is not an accessible name.** Every missing cell exposes its reason as text: in the
   tooltip, in the detail panel, and in `aria-label` / the `role="gridcell"` accessible name —
   "Reachability, Alternative C: not assessed". Screen-reader users must not have to infer a
   glyph.
3. **The legend changes with the encoding (ADR-0010) but the missingness key does not.** Missing
   reasons present in the current view are always listed, with glyph, label and count. If the grid
   contains three `withheld` cells, the reader is told so without hunting.
4. **Structural blocks are omissible, contingent blocks never are.** The domain model already lets
   a group-pair be declared inapplicable and the view "omit it entirely rather than rendering a
   rectangle of blanks" — that is the right behaviour and it is only ever right for `structural`.
   A rectangle of `not-assessed` must stay on screen; it is the work queue.
5. **Axis headers carry their own completeness.** A small `34/51` on each row and column header
   makes sparsity legible without a separate report, and makes an under-evidenced alternative
   impossible to skim past.
6. **Add a `missingness` encoding to the ADR-0010 registry.** Colour the grid by reason code
   instead of by measure. It costs a registration, it is the fastest way to see the *shape* of
   what is not known, and it is the view in which an informative-silence pattern down one
   alternative becomes obvious. (Reasoning; this is the missing-indicator method [11] rendered.)

---

## What this means for the schema / the view / the agent

**Schema (`core`, Phase 1).**

```ts
type MissingnessCode = string;               // open; core codes are reserved

interface MissingnessReason {
  code: MissingnessCode;
  broader: CoreMissingnessCode;              // 'not-applicable' | 'not-assessed' | 'deferred'
                                             // | 'not-evidenced' | 'indeterminate' | 'withheld'
  structural: boolean;                       // excluded from every completeness denominator
  terminal: boolean;                         // false ⇒ work remains
  informative?: boolean;                     // absence is a statement about the subject
  label: string;
  description: string;
  glyph: string;
}

interface Missing {                          // what sits in a cell slot instead of a value
  code: MissingnessCode;
  note?: string;                             // free text, e.g. which sources were searched
  author?: AuthorRef;                        // provenance applies to absences too (ADR-0014)
  at?: Timestamp;
  evidence?: EvidenceRef[];                  // yes: "we searched X and Y" is citable
}
```

`MissingnessReason` records for the core six ship with the schema; an analysis may add more under
the §1.6 constraints. Validation rules: `structural: true` requires `broader === 'not-applicable'`;
no reason may be a schema default except `not-assessed`; a group-pair inapplicability rule
overrides any author-set contingent code (declare that precedence, per SDMX practice [2]).

**Core logic (Phase 2).**

- `completeness(analysis, scope): CompletenessReport` — one function, five counts, three rates, no
  hard-coded code list; it reads `structural` / `terminal` / `informative` only. Levels are
  different `scope` arguments, not different functions.
- `toIntervals(analysis, alternative): Record<CriterionId, [number, number]>` — observed values give
  degenerate intervals; contingent missing gives the criterion's declared range; structural missing
  is omitted from the criterion set for that alternative.
- `necessarilyDominates(a, b)` / `possiblyDominates(a, b)` per §3.3, and
  `dominanceSets(analysis) → { necessarilyNonDominated, possiblyNonDominated }`. The existing
  ADR-0015 dominance filter is implemented **as** these two, not alongside them.
- `informationValue(analysis) → Array<{cell, wouldChangeNecessarySet: boolean}>` — for each
  contingently missing cell, does resolving it move the necessary set? Ranks the work queue.
  O(cells × alternatives²) is free at this scale.
- `weightCoverage(analysis, alternative, weights) → number` and a
  `aggregationEligibility(...) → 'point' | 'interval' | 'refused'` gate implementing §3.5, with the
  2/3 floor as a configurable keyword parameter, not a literal.
- `intervalAggregate(...) → [lo, hi]`, and a `separable(a, b)` predicate so the ranking view can
  say "not separable on the available data" instead of inventing an order.

**View (Phase 3).**

- A `MissingCell` renderer driven entirely by the reason record's flags and glyph — never a
  `switch` on the code.
- `missingness` registered as an encoding under ADR-0010.
- Completeness fractions on row and column headers; the missingness key always in the legend.
- Structural blocks collapse; contingent blocks never do.

**Agent (`rubricator`).**

- The instruction "mark everything else `deferred`" must be expressible and must produce
  `settledRate === 1.0` against the declared round scope.
- The agent must distinguish `not-evidenced` from `indeterminate` and should attach the searched
  sources as evidence on the `Missing` record — "we searched these three documents and none
  addresses migration cost" is a citable finding under ADR-0014, and a far better output than a
  guess.
- `indeterminate` on a whole column is a signal to reopen the criteria discussion, not to try
  harder on the cells.
- No reason code may be chosen by default. If the agent cannot pick between `not-evidenced` and
  `indeterminate`, that is itself worth surfacing.

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0009 | **amend** | Rename `pending` → `deferred` and `unknown` → `indeterminate`; add `not-evidenced` to the core set; replace the "closed set that analyses may extend" tension with the flagged-and-parented extension model of §1.6; require completeness exclusion to key on the `structural` flag rather than on the literal `not-applicable`; specify the five counts and three rates of §4.2 including `settledRate` and round scope. |
| ADR-0015 | **amend** | State the coverage gate of §3.5 (point aggregate at 1.0 only; interval aggregate to 2/3; nothing below); prohibit silent weight renormalisation and require it to be labelled as imputation [12][13]; specify Pareto/dominance filtering as **necessary and possible** dominance over intervals, and explicitly forbid comparison on common-known criteria because it is non-transitive and can empty the skyline [15][16]; add value-of-information ranking of missing cells as a shipped analysis. |
| ADR-0010 | **amend** | Add `missingness` to the shipped encoding list; record the reserved-channel rule — patterns/hatching are reserved for uncertainty and absence and are not available as a general categorical channel (per [20], **whose text could not be verified at audit time — re-check before adopting**); record the structural-is-absence-of-ink / contingent-is-a-placeholder rule and the dashed-vs-solid border convention for `terminal`. |
| ADR-0014 | **amend** | Change "an agent that cannot cite a span should be recording `unknown`" to distinguish `not-evidenced` from `indeterminate`, and state that a `Missing` record may itself carry evidence references and provenance — "we searched these sources and they are silent" is a citable finding. |
| — | **new ADR** — *Disclosure is orthogonal to presence* | §1.5: a value may be present in the store and withheld from a view. Model disclosure as a view-time property so redaction is a projection, not a destructive edit, and so a redacted reader is told an aggregate depends on data they cannot see. Follows SDMX's separation of `CONF_STATUS` from `OBS_STATUS` [1][2]. |
| ADR-0003 | **confirm** | The measures-vs-encodings and level-of-measurement decisions survive contact with this material unchanged; the per-`(criterion, measure)` typing is what makes per-measure completeness (§4.2) well-defined. |
| ADR-0008 | **confirm** (no change from this section) | Group-pair inapplicability as data, selection as view state, is consistent with structural absence being a property of the analysis rather than of a reader's session. |

---

## Open questions

1. **Is renaming `unknown` worth the churn?** The argument is strong (§1.2) but this is a
   vocabulary decision with product consequences, and I am recommending a rename of an `accepted`
   ADR's published set. **What would settle it:** write the six-code set into `rubricator`'s
   prompts and run one real analysis in each of two ways — with `unknown` and with
   `indeterminate` + `not-evidenced` — and count how often the model reaches for the catch-all.
   If `unknown` is not over-used, the minimal amendment (keep the name, redefine it as the leaf,
   still add `not-evidenced`) is enough.
2. **Should `withheld` be in the reason set at all, or only in the disclosure layer?** §1.5 keeps
   it in both, which is mild duplication. The clean alternative is to remove it from the reason set
   entirely and let a redacted view *derive* a synthetic missing reason at render time. That is
   more correct and more work. **What would settle it:** whether any deployment needs an analysis
   in which nobody, including the owner, is allowed to store the value.
3. **What is the right interval for a missing cell on a *nominal* criterion?** §3.3's construction
   assumes an ordered range. For a nominal measure there is no `[min, max]`, so necessary dominance
   is undefined and only equality/inequality is available. Probably: nominal criteria are excluded
   from dominance analysis when missing, and the exclusion is reported. Needs a decision in Phase 2.
4. **Confidence about a missing value.** Can a `Missing` carry a `confidence` — how sure are we
   that the sources really are silent? It is meaningful (a shallow search and an exhaustive one are
   different claims) and it doubles the cell state space. Deferred, but the `Missing.note` and
   `Missing.evidence` fields in §"Schema" are the cheap version of it and should ship in Phase 1.
5. **Is 2/3 the right floor for *this* domain?** [13] is a 133-economy index with 78 indicators;
   `comparanda` matrices are 22 × 12. The threshold's sensitivity at small `n` is untested. **What
   would settle it:** a simulation over the example datasets — how often does the interval
   aggregate's ranking change as coverage falls? Cheap to run once Phase 2 exists, and it should
   be run before the default is fixed.
6. **Does the dashed-vs-solid border convention actually read at cell scale?** No study covers it;
   §5 is design reasoning constrained by [19][20]. **What would settle it:** a five-person
   screen-and-print check on the messy example dataset from ADR-0016, in both themes, greyscale,
   and forced-colors.

---

## REFERENCES

1. [CL_OBS_STATUS v2.3 — SDMX cross-domain code list for Observation Status, SDMX Global Registry (2025)](https://registry.sdmx.org/sdmx/v2/structure/codelist/SDMX/CL_OBS_STATUS/+/?format=sdmx-json&detail=full) — index page: [SDMX Cross-Domain Code Lists](https://sdmx.org/sdmx_cdcl/)
2. [Possible Ways of Implementing CL_OBS_STATUS Code List — SDMX Statistical Working Group / Technical Working Group (2014)](https://sdmx.org/wp-content/uploads/CL_OBS_STATUS_implementation_20-10-2014.pdf)
3. [CodeSystem: NullFlavor (HL7 v3) — HL7 Terminology v6.0.2 (2024)](https://terminology.hl7.org/6.0.2/CodeSystem-v3-NullFlavor.html)
4. [CodeSystem: DataAbsentReason — HL7 FHIR R4 v4.0.1 (2019)](https://hl7.org/fhir/R4/codesystem-data-absent-reason.html)
5. [DDI — Handling of missing values in the QDDT — DASISH / QDDT project wiki (2015)](https://github.com/DASISH/qddt-client/wiki/DDI---Handling-of-missing-values-in-the-QDDT) — note: this source covers the ESS categories and DDI 3.2's separate missing-values structures; it does **not** use the "sentinel value domain" terminology, and does not contain a "strongly encourages the separate MissingValueRepresentation" statement.
6. [Missing data — Ana Morales, UK Data Service, 12 September 2019](https://ukdataservice.ac.uk/app/uploads/missingdata.pdf) — an R tutorial on the Labour Force Survey teaching dataset; supports the negative-sentinel codes (−9 "Does not apply", −8 "No answer") but not a "blanks are best avoided" recommendation.
7. [Missing information (applicable and inapplicable) in relational databases — E. F. Codd, ACM SIGMOD Record 15(4):53–78 (1986)](https://dl.acm.org/doi/10.1145/16301.16303) — bibliographic details confirmed via Crossref and dblp; the ACM landing page blocks automated fetches (HTTP 403), it is not a dead link.
8. [Ordinal regression revisited: multiple criteria ranking using a set of additive value functions — S. Greco, V. Mousseau, R. Słowiński, European Journal of Operational Research 191(2):416–436 (2008)](https://researchportal.port.ac.uk/en/publications/ordinal-regression-revisited-multiple-criteria-ranking-using-a-se/)
9. [Inference and missing data — D. B. Rubin, Biometrika 63(3):581–592 (1976)](https://doi.org/10.1093/biomet/63.3.581)
10. [Handbook on Constructing Composite Indicators: Methodology and User Guide — OECD / JRC European Commission (2008)](https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf)
11. [The Missing Indicator Method: From Low to High Dimensions — M. Van Ness et al., arXiv:2211.09259 (2022)](https://arxiv.org/pdf/2211.09259)
12. [Composite Indicator Development and Analysis in R with COINr, Chapter 6: Missing data and Imputation — W. Becker (2022)](https://bluefoxr.github.io/COINrDoc/missing-data-and-imputation.html)
13. [Global Innovation Index 2024, Appendix II: JRC statistical audit of the 2024 Global Innovation Index — Joint Research Centre / WIPO (2024)](https://www.wipo.int/web-publications/global-innovation-index-2024/en/appendix-ii-joint-research-centre-jrc-statistical-audit-of-the-2024-global-innovation-index.html)
14. [Missing consequences in multiattribute utility theory — A. Jiménez, A. Mateos, S. Ríos-Insua, Omega 37(2):395–410 (2009)](https://ideas.repec.org/a/eee/jomega/v37y2009i2p395-410.html)
15. [Skyline query processing for incomplete data — M. E. Khalefa, M. F. Mokbel, J. J. Levandoski, ICDE 2008, pp. 556–565](https://www.microsoft.com/en-us/research/publication/skyline-query-processing-incomplete-data/)
16. [A Survey of Skyline Query Processing — C. Kalyvas, T. Tzouramanis, arXiv:1704.01788 (2017)](https://arxiv.org/pdf/1704.01788)
17. [SMAA — Stochastic multiobjective acceptability analysis — R. Lahdelma, J. Hokkanen, P. Salminen, European Journal of Operational Research 106(1):137–143 (1998)](https://research.aalto.fi/en/publications/smaa-stochastic-multiobjective-acceptability-analysis/)
18. [ISO/IEC 25012:2008 — Software engineering — SQuaRE — Data quality model](https://www.iso.org/standard/35736.html) — the full normative text is paywalled and iso.org blocks automated fetches (HTTP 403). The [arc42 Quality Model](https://quality.arc42.org/standards/iso-iec-25012) page reached at audit time glosses completeness only as "Required information should be present for intended use"; the fuller definition quoted in §4.1 is reproduced from secondary sources and is **not verified against the normative text**.
19. [Understanding SC 1.4.1: Use of Color — W3C WCAG 2.2 (2023)](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
20. [Pearson Data Visualization Style Guide, v0.0.3 — Pearson Accessibility (2024)](https://accessibility.pearson.com/resources/dataviz/) — **UNVERIFIED.** The host resolves (`accessibility.pearsoncmg.com`) but reset every connection at audit time, so neither the quotation in §5 nor the version number could be checked.
