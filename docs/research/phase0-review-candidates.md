# Phase 0 review — candidates, not findings

> [!IMPORTANT]
> **Superseded by [`phase0-review.md`](./phase0-review.md). Do not act on this file.**
>
> This was written while the review was half-finished: 21 of 77 candidates had been examined, all
> 21 refuted, and 56 were unadjudicated because a usage limit cut the run short. The 56 have since
> been adjudicated fairly, and the result is materially different — 7 confirmed and 22 partly real,
> with **every** candidate that claimed `blocking` downgraded.
>
> It is kept, rather than deleted, because its framing was correct at the time and the record of
> what a half-finished review looked like is part of the calibration story the successor tells.



**Read the next paragraph before you read anything else in this file.**

This is the output of an *incomplete* adversarial review pass, and its measured precision is
low. It is published because a checkable worklist is worth having, and because the refutations
in the second half are genuinely useful negative results. **No entry here has been established
as a defect.** Treat every line as a question to check, never as a conclusion to act on.

The repositories' own standard applies to their review as much as to their output: prefer a
qualified blank to a confident guess. This document is that blank, qualified.

## What was run, and what happened

Five review lenses read both repositories' briefs, ADRs, pending ADR actions, findings and
roadmaps, and raised **77 candidate defects**. Each was then to be attacked by two independent
skeptics — one testing whether the quoted text says what the finding claims *in context*, one
testing whether the consequence follows or is already mitigated elsewhere — with findings
**defaulting to refuted under uncertainty**.

The refutation phase was cut short by an account usage limit. Of 154 planned skeptic runs, 42
completed, adjudicating 21 findings.

| | count |
|---|---|
| candidates raised | 77 |
| adjudicated | 21 |
| **of those, refuted** | **21 — all of them** |
| never adjudicated | 56 |

Two further candidates were checked by hand afterwards:

- *"86 of one repository's issues carry unresolved template placeholders"* — **false**. Zero
  issues in either repository contain an unresolved placeholder. The lens read the issue
  tracker while a patching pass was still running and reported a race as a defect.
- *"One repo reduces repeats by lower median; the other's reduction enum has no such member"* —
  **partly real**, and the one candidate so far that survived checking. See the issue it produced.

So the running tally is 22 checked, 21 refuted, 1 false, 1 partly real. **A candidate here is
more likely to be wrong than right.** The refutations were often substantive — several found
the finding had truncated a quotation in a way that inverted its meaning, or reported as a
defect something an ADR decided deliberately.

## How to use this

When settling a pending ADR action, scan the candidates whose `where` names that ADR. If one
looks real, check it — the file and the quote are given. If you refute it, say so in the ADR
you were settling, so the next reader does not re-check it. Delete a candidate once it is
resolved either way.

---

## Unadjudicated candidates (56)

Severity is **as claimed by the lens that raised it**, and is unverified — the adjudicated set
shows claimed severity was often wrong.

### Cross-repo contradictions

<details><summary><b>[blocking]</b> The missingness change is a semantic split, not a rename — and the sweep it is scheduled as will emit the wrong code</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 3 (ADR-0009 amend) and item 23 (ADR-0014 confirm, note 3); comparanda: docs/cross-repo-coordination.md §7.1; rubricator: docs/adr/PENDING-ACTIONS.md §6 draft ADR-0012 rule 1, §11 draft ADR-0017, §12 ADR-0008 amend (b)
- **claim:** comparanda §7.1 says: "the codes travel *inside* the document with `broader` and the `structural` / `terminal` flags, so nothing in `rubricator` may `switch` on a literal code — which is what makes the sweep a rename and not a redesign." But comparanda's own ADR-0014 note 3 says: "Replace 'an agent that cannot cite a span should be recording `unknown`' with the `not-evidenced` / `indeterminate` distinction (ADR-0009 amended)." rubricator's draft ADR-0012 rule 1 is "**No citable span ⇒ `unknown`, never a low-confidence score.**"
- **asserted consequence:** `unknown` is not being renamed to `indeterminate`; it is being split into `not-evidenced` (searched, nothing found) and `indeterminate` (looked, could not determine). rubricator's honesty rule fires on "no citable span", which is `not-evidenced` — so the mechanical sweep §7.1 authorises produces the wrong code for the flagship rule of the product. The error is invisible: the document validates, the cell renders, and comparanda's ADR-0022 missingness-to-alpha mapping ("`not-evidenced`, `indeterminate` and `withheld` are absent but **counted separately**") silently pools two different observations. Downstream, ADR-0008's degenerate-agent counter-metric now has two codes to defend against, not one, and `unknown_preference_rate` measures neither of them. §7.1's sizing of this as "a prompt change and a metric rename" is what will cause it to be done by find-and-replace.
- **proposed action:** Restate §7.1 as a split with a three-way mapping table that a human fills in per site, and require the tracking issue to enumerate call sites rather than strings: the ADR-0012 honesty rule → `not-evidenced`; the ADR-0017 resume semantics' "someone looked and could not determine" → `indeterminate`; the ADR-0008 refusal-to-guess metric family → both, counted separately, with the degenerate-agent counter-metric defending against the union. Rename the metrics for the behaviour (`qualified_blank_rate`, `blank_inflation_rate`) rather than for a code, so the next code change is not another sweep.

</details>

<details><summary><b>[blocking]</b> comparanda makes `range` required on every ordinal criterion; nothing in rubricator elicits it, requests it, or has a fallback</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 1 (draft ADR-0018) and docs/cross-repo-coordination.md §6 shortener 1 and §7 register; rubricator: docs/adr/0005-the-elicitation-pipeline.md step 3, docs/adr/PENDING-ACTIONS.md §8 draft ADR-0016, §14 request table
- **claim:** comparanda draft ADR-0018: "a **`range`** — required on ordinal, interval and ratio" … "An aggregation **refuses to run** over a criterion with no declared range rather than substituting observed extrema. That refusal is the value of shipping it." comparanda §6 names "criterion `preference` and `range`" among the four expensive-to-retrofit shapes that must be in the 1.0.0-rc. rubricator's ADR-0005 step 3 elicits "definitions, polarity (is higher better?), level of measurement, and any veto status"; its structured-definition request is "objective, question, scale anchors, evidence rule, missing rule, exclusions"; §5.2's longer list adds "level, preference, attribute type". `range` appears in neither, and the word does not occur as a criterion field anywhere in rubricator.
- **asserted consequence:** rubricator will emit criteria with no `range` on every run. comparanda then either fails them at validation — rubricator's ADR-0002 validates at the boundary, so the demo breaks at link 7 of the critical path — or accepts them and refuses to run dominance, screening, the datum encoding and every aggregation, which is every analysis in ADR-0015 except completeness. The failure lands after Gate 2b, when the schema is frozen and the fix is a prompt change plus a re-run rather than a line in the criteria tool. Request 6 confirmed `preference` and stopped there, so the pair that comparanda's ADR-0018 treats as one decision arrived across the boundary as one field.
- **proposed action:** Add `range` to the §7 register as request 8, or fold it into request 1's structured definition, before Gate 1 closes. For the 1–5 ordinal `score` the range is derivable from ADR-0012's fixed scale and costs nothing; the real work is ratio-level criteria, where rubricator must elicit bounds at step 3 and ADR-0018 forbids inferring them from observed extrema. State the fallback: if `range` is rejected, rubricator emits only ordinal criteria and refuses the ratio escape hatch.

</details>

<details><summary><b>[blocking]</b> `preference` is declared per (criterion, measure) in comparanda and requested per criterion by rubricator — and nothing says which measure dominance reads</summary>

- **where:** comparanda: docs/research/findings-terminology.md finding #4 and docs/adr/PENDING-ACTIONS.md Tier 1 items 1–2 (draft ADR-0018, ADR-0019); comparanda: docs/domain-model.md Correction 3; rubricator: docs/adr/PENDING-ACTIONS.md §14 request table and §6 draft ADR-0012
- **claim:** comparanda finding #4: "`preference: increasing / decreasing / target / ordered / none` per `(criterion, measure)`". Draft ADR-0018: "Each `(criterion, measure)` declares, beside its level of measurement: 1. a **`preference`** … `none` excludes the criterion from dominance, screening and the datum encoding". Draft ADR-0019 then computes dominance "on every criterion in the comparison basis". rubricator's register row reads "Confirm the criterion **`preference`** (direction) field" — criterion-granular — and its ADR-0012 declares `confidence` as "a three-level ordinal evidence-quality measure" once, globally, not per criterion.
- **asserted consequence:** Three separate breakages from one granularity mismatch. (a) Every criterion carries at least `score` and `confidence`, so under ADR-0018 rubricator must emit a `preference` and a `range` for `confidence` on every criterion — declarations it has no concept of and no place to elicit. (b) Whatever it emits, `confidence: increasing` makes evidence quality a legal dominance dimension, so an alternative can be declared dominated for being less well-evidenced; `confidence: none` is the only safe value and nothing says so. (c) ADR-0019 quantifies over criteria while ADR-0018 declares over pairs, so the dominance implementation has to pick a measure and neither ADR names one. The two repos both believe request 6 is a confirmation of a settled field; they are confirming different fields.
- **proposed action:** Settle in comparanda before Gate 2a whether `preference`/`range` hang off the criterion or the pair, and if the pair, ship a measure-level default (`confidence` ⇒ `preference: none`) the way the domain model already ships a per-criterion default for the level of measurement. Then name, in ADR-0019, the measure dominance is computed over, and make request 6's mirror issue record the granularity explicitly rather than the field name.

</details>

<details><summary><b>[blocking]</b> A polarised cell has no legal representation: rubricator emits no reduction, comparanda forbids a bare null</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §5 draft ADR-0011; comparanda: docs/adr/0009-missingness.md, docs/adr/PENDING-ACTIONS.md Tier 2 item 11 (draft ADR-0022) and item 18 (draft ADR-0024)
- **claim:** rubricator draft ADR-0011: "**No point reduction is emitted for a polarised cell** — emit the level multiset and a `contested` marker instead." comparanda ADR-0009: "No bare nulls. Every absence carries a reason code from a closed, schema-declared set." comparanda draft ADR-0022 reports per cell "`n`, the level multiset, `min`, `max`, `span`, mode(s), a `polarised` flag" as derived statistics.
- **asserted consequence:** When rubricator declines to reduce, the cell's `score` measure holds neither a value nor a qualified missing — a state comparanda's schema does not admit. Every reason code in the set is wrong: the cell was assessed, is not deferred, is not indeterminate, is not withheld, and is certainly not `not-applicable`. There is no code for "assertions exist and no reduction over them is legal", and it is not in the §7 register even though the rarer `insufficient_evidence_to_discriminate` is. Separately, comparanda derives `polarised` and rubricator wants to store `contested`: same concept, two spellings, and the stored version fails triage test 1 of the schema-change skill ("is it derived?") with no fallback recorded, which §3.1 says makes it a demand rather than a request.
- **proposed action:** File this as a request before Gate 1 closes, with the fallback stated. Preferred shape: no new code and no stored marker — rubricator writes all k assertions, omits the reduction, and comparanda's view falls through to the ADR-0024 rater dot strip, which is already the right rendering. That requires only that comparanda's schema make the reduction optional when n>1, which is one line. If it must be stored, adopt comparanda's spelling `polarised` in rubricator's ADR-0011 now, while it is still a draft.

</details>

<details><summary><b>[blocking]</b> comparanda will compute Krippendorff's alpha over rubricator's repeats and label it agreement; accepting `independence` does not stop it</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 2 item 11 (draft ADR-0022) and item 22(b); comparanda: docs/cross-repo-coordination.md §5.1; rubricator: docs/adr/PENDING-ACTIONS.md §13 draft ADR-0018
- **claim:** comparanda draft ADR-0022: "Krippendorff's alpha is the coefficient … computed **per criterion, over alternatives as units**, never per cell. Always reported with a jackknife interval". rubricator draft ADR-0018: "**A statistic over rung-1 assertions is test–retest reliability, not inter-rater reliability**, and the report must say so — getting this label wrong is exactly the manufactured rigour ADR-0006 exists to prevent." comparanda §5.1: "Five draws of one model must never render as five raters."
- **asserted consequence:** §5.1 treats this purely as a migration hazard — the risk that `independence` lands after v1. It does not. Even with request 4 accepted at v1, ADR-0022's draft contains no clause that consults `independence`, `authorKind` or `perturbation`; it computes alpha per criterion over whatever assertions are present and reports it with an interval. rubricator's deployed default is k=5 draws of one model, so the very first agent-produced analysis comparanda renders will carry an alpha over five draws of one model, labelled as inter-rater agreement, with a jackknife interval that makes it look like a measurement. The field's existence is necessary and not sufficient; the register buys a slot and no obligation to read it.
- **proposed action:** Add a consumption clause to ADR-0022 before Gate 2a: alpha is computed only over assertion sets whose members differ in `independence` at rung `fresh-session` or above; a set at rung `in-session` yields test–retest reliability under that name, and a mixed set yields neither. Add a corresponding acceptance criterion to Gate 3 — a fixture of five same-rung assertions that must not produce a number labelled agreement. Requests should generally carry a consumption clause, not only a shape.

</details>

<details><summary><b>[blocking]</b> rubricator's headline stability statistic rests on a dominance relation comparanda defines three ways, and saturates on exactly the matrices rubricator produces</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §13 draft ADR-0018 and docs/cross-repo-coordination.md §2.2 item 11; comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 2 (draft ADR-0019)
- **claim:** rubricator draft ADR-0018: "**The headline stability statistic is the weight-free dominance survival rate** — the fraction of repeated matrices in which an alternative remains non-dominated". comparanda draft ADR-0019: "a contingently missing value gives the criterion's declared range" … "`a` **necessarily dominates** `b` iff `lo_a[j] >= hi_b[j]` on every criterion" … "Results have three tiers: dominated, provisionally surviving, robustly non-dominated" … "The comparison basis is the set of criteria applicable to every alternative in the current scope … The natural scope is an alternatives group".
- **asserted consequence:** Three problems compound. (a) "Non-dominated" names one set; ADR-0019 produces two relations and three tiers, so the statistic is undefined until someone picks one — and the two picks behave oppositely. (b) Under necessary dominance every contingent blank widens to the full declared range, so a single missing cell almost guarantees non-domination. ADR-0006's honest agent produces blanks by design, so the survival rate saturates near 1.0 precisely on the sparse matrices rubricator exists to produce: the flagship stability number stops discriminating exactly where stability matters most. Under possible dominance the relation is non-transitive and ADR-0019 forbids building a front from it. (c) ADR-0019 scopes dominance to an alternatives group, and rubricator's ADR-0005 pipeline never elicits alternative groups — the word does not appear in its ADRs — so rubricator would compute over the whole set, which ADR-0019 says reintroduces the non-transitivity it exists to avoid. Compounding all three: coordination §2.2 item 11 lists `stability_report` as needing nothing from comparanda ("Order statistics and vendored numerics"), which is false — it needs ADR-0019's semantics, reimplemented in a second language with no conformance fixture.
- **proposed action:** Have rubricator's ADR-0018 name the relation explicitly (robust non-domination is the only tier that is a partial order) and state the saturation limit as a known property, not discover it in the harness. Add alternatives-group elicitation to ADR-0005 step 2, or state that rubricator computes over a single implicit group and accept the basis rule that follows. Move dominance out of §2.2's parallel-safe list and add a shared golden fixture for it to Gate 3 — two implementations of a subtle relation with no cross-check is the same defect ADR-0022 cites for npm alpha implementations.

</details>

<details><summary><b>[expensive-later]</b> rubricator reduces repeats by lower median; comparanda's reduction enum has no such member and its `median` breaks ordinality on even n</summary>

- **where:** comparanda: docs/adr/0011-collaboration.md decision 3 and docs/domain-model.md §Multi-rater values; rubricator: docs/adr/PENDING-ACTIONS.md §5 draft ADR-0011 and §14 request table row 4
- **claim:** comparanda ADR-0011.3: "What the cell *displays* is a named reduction over those assertions: `single`, `latest`, `median`, `consensus`." rubricator draft ADR-0011: "**Repeats reduce by lower median.** `mean` is refused at the tool boundary, naming the level of measurement". rubricator's request asks only that "`'mode'` joins the reduction enum".
- **asserted consequence:** `lower-median` is not in the enum and was not requested, so rubricator's actual reduction has no legal name in the document it writes. Worse, `median` as written is the trap: over an even number of assertions the conventional median averages the two middle levels and returns a value no rater chose on an ordinal scale — the exact category error comparanda's domain model Correction 2 and ADR-0024 ("no mark sits where a mean would be") exist to forbid. rubricator sets k=5 in the deployed runtime, but its adaptive schedule halts at 3 and escalates to 9 — and any drop-out or `withheld` assertion makes the count even. Adding an enum member later is a MINOR bump under §3.3, so this is cheap now and merely embarrassing later; leaving `median` under-specified is the part that ships a wrong number.
- **proposed action:** Amend request 4 to ask for `lower-median` alongside `mode`, and amend comparanda ADR-0011.3 to define `median` as the lower median on ordinal measures (or to reject `median` on ordinal outright and force `lower-median`). One sentence in each repo.

</details>

<details><summary><b>[expensive-later]</b> comparanda renames `veto` to `acceptability` and re-scopes it; rubricator's accepted ADR-0005 elicits "veto status", and the rename tracking covers only missingness codes</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 8(a) (ADR-0015 amend); rubricator: docs/adr/0005-the-elicitation-pipeline.md step 3, docs/adr/PENDING-ACTIONS.md §8 draft ADR-0016 and §14 register; comparanda: docs/cross-repo-coordination.md §7.1
- **claim:** comparanda ADR-0015 amendment (a): "The veto-criterion-with-a-threshold is a **conjunctive (non-compensatory) screening rule** [36], not ELECTRE's `v_j`, which thresholds a *pairwise difference* [24]. Rename the field `acceptability`; reserve `veto` for the ELECTRE sense." rubricator ADR-0005 step 3 (accepted): criteria are proposed "with definitions, polarity (is higher better?), level of measurement, and any veto status."
- **asserted consequence:** §7.1 identifies the missingness codes as "the largest un-tracked cross-repo consequence in this plan" and tracks exactly that one rename. This is a second one, in an ADR rubricator has already accepted, and it is worse than a rename: `veto` after the amendment means a different thing (a pairwise-difference threshold rubricator has never asked for), so a rubricator prompt that elicits "veto status" and writes it into the field now called `acceptability` is not stale spelling but a wrong claim about what was elicited. Separately, `acceptability`/`veto` appears in neither request 1's structured-definition list nor §5.2's longer required-field list, so `criteria_set` — rubricator's own validator — has nothing to validate the one criterion attribute ADR-0005 names by hand. And ADR-0016's invalidation trigger list (`question`, `scale`, `preference`, `exclusions`) omits it, so moving an acceptability threshold silently retains cells scored against the old one.
- **proposed action:** Widen §7.1 from "the missingness rename" to "renames and re-scopings" and add this one, plus a check that no other comparanda amendment renames a field rubricator writes. Add `acceptability` (with its threshold) to request 1's field list and to ADR-0016's invalidation triggers. Decide whether ELECTRE-sense `veto` is in v1 at all; if not, say so, so the word is free.

</details>

<details><summary><b>[expensive-later]</b> comparanda's plan confirms ADR-0014 unchanged while rubricator's largest schema request is a full evidence-reference redesign</summary>

- **where:** comparanda: docs/adr/0014-evidence-and-provenance.md and docs/adr/PENDING-ACTIONS.md item 23 ("ADR-0014 — confirm, with two notes"); rubricator: docs/adr/PENDING-ACTIONS.md §9 draft ADR-0014 and §10 draft ADR-0015; comparanda: docs/cross-repo-coordination.md §7 request 5
- **claim:** comparanda ADR-0014: "A reference is an opaque, typed pointer resolved by a host-supplied `EvidenceResolver`". Its pending action is "**Action:** confirm. The span-not-document rule and the resolver indirection both hold up", with three notes — none of which mentions `stance`, `sourceType`, `derivedFrom` or `quoteHash`. rubricator draft ADR-0014 requires "a flat array of selectors that all select the same span, with a `TextQuoteSelector` mandatory wherever a text layer exists"; draft ADR-0015 states "Requires schema support in comparanda for `stance`, `sourceType`, `derivedFrom`, `quoteHash` and a tool-written `check`."
- **asserted consequence:** comparanda's ADR pass records evidence references as settled; the register records five new fields plus a structured locator profile against them. The two documents will be read side by side by whoever settles the ADRs, and one of them says there is nothing to do here. "Opaque pointer" and "array of W3C selectors with quotes as truth and positions as hints" are not the same design: opacity is what lets comparanda avoid knowing about normalisation, and rubricator's `check` ladder requires comparanda to store a `quoteHash` produced by a *versioned normalisation function* comparanda has never heard of and cannot re-run. rubricator's own open question 8 ("Where does a citation `check` live when an analysis is shared? … This is comparanda's call") is an unanswered question addressed to a repo whose plan says the ADR is confirmed.
- **proposed action:** Change comparanda's ADR-0014 action from "confirm" to "amend, pending request 5", and make request 5 carry the normaliser-version field and an answer to open question 8 (persist the check with `checkedAt` and `checkerVersion`, or recompute on load and never persist — the standalone bundle case forces the first). Reconcile field by field in the mirror issue: `stance` and `sourceType` are additive; `derivedFrom` is a graph edge into other references and is the one with design weight; `quoteHash` drags the normaliser version across the boundary and should be requested together with it.

</details>

<details><summary><b>[expensive-later]</b> rubricator's mandated JSON Schema subset cannot express the comparanda types its own tools write</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §3 draft ADR-0013; comparanda: docs/adr/0009-missingness.md, docs/adr/PENDING-ACTIONS.md item 19 (ADR-0008 amend, groups) and item 3 (ADR-0009 amend); comparanda: docs/cross-repo-coordination.md §2.1
- **claim:** rubricator draft ADR-0013: "**The supported subset is a hard constraint on the tool surface, honoured before Phase 1 freezes it:** scores are `enum`, never `minimum`/`maximum`; no recursion; no external `$ref`; no string-length constraints; `additionalProperties: false` everywhere." comparanda ADR-0009 (accepted): "analyses may extend it"; the amendment keeps extension via "every code declares `broader` into a closed core". comparanda ADR-0008 amendment adopts `@zodal/groups-core` with "nested trees".
- **asserted consequence:** `measures_write`, `criteria_set` and `analysis_open` take comparanda-shaped arguments, so their `inputSchema`s are projections of comparanda's schema. A schema with `broader`-parented codes and nested group trees is self-referential and will emit `$ref` and recursion; the subset forbids both. `additionalProperties: false` plus a literal `enum` of reason codes freezes the set at the core six inside the tool boundary, which contradicts both the accepted ADR-0009 extensibility clause and §7.1's assurance that nothing in rubricator switches on a literal code. The escape — hand-maintaining a flattened, subset-legal mirror of every comparanda type — is a second schema that drifts, which is exactly what §2.1's single `SchemaSource` indirection was built to prevent. Nothing in Gate 1's checklist tests entry 3 against what comparanda will actually emit, even though it names entry 3 as "a hard constraint on signatures and … pure rework if retrofitted".
- **proposed action:** Before Gate 1 closes, write the two or three tool signatures that carry comparanda types and check them against the subset by hand, using the schema sketch (§2.1) as the stand-in. Expect the answer to be that tools take flat leaf arguments (`analysis_id`, `alternative_id`, `criterion_id`, `code`, `note`) and never a nested document fragment — which is a decision about the tool surface, not an accident, and belongs in ADR-0013's Decision rather than being discovered in Phase 1. Add a Gate 2b criterion that the published JSON Schema declares whether it is subset-legal, so rubricator knows without reading it.

</details>

<details><summary><b>[expensive-later]</b> The shared relocation fixture is specified as both a renderer torture-test and an agent gold set, and contains cells no agent can produce</summary>

- **where:** comparanda: docs/cross-repo-coordination.md §4.1 and §4.2; comparanda: docs/adr/0016-public-repo-hygiene.md; rubricator: docs/adr/0008-evaluation.md
- **claim:** §4.1: "A **`comparanda` example** is a *finished analysis document* … It is an **output**. A **`rubricator` eval fixture** is an *input plus an expected output* … They overlap in exactly one object: the finished analysis document." §4.2 then specifies one document for both jobs: "`relocation.json` — deliberately messy: all missingness reason codes, an inapplicable group-pair block, multi-rater disagreement on at least three cells, mixed levels of measurement, a stale evidence reference, three annotation threads" and "`rubricator`'s corpus is built toward the **relocation** subject specifically, so that the agent's output can be compared cell-by-cell against `comparanda`'s hand-authored messy fixture on an identical frame."
- **asserted consequence:** §4.1 draws the distinction and §4.2 collapses it. A renderer torture-test is designed to contain one of everything; a gold set must contain exactly the answers the corpus supports and exactly the blanks the corpus justifies — that is what makes the refusal-to-guess arm meaningful. The named contents make the conflation concrete: multi-rater disagreement on three cells and three annotation threads cannot be produced by any rubricator run (annotations are human, comparanda ADR-0011; multi-rater is Phase 4), so a cell-by-cell comparison reports the agent as wrong on every one of them. Conversely a document authored to exercise the renderer will contain blanks whose reason is "we needed one of these", not "the corpus does not say", so the refusal-to-guess arm measures fixture authorship rather than agent behaviour. This is the strongest evaluation either project has, per §4.2, and it is being built on a document with a conflicting job.
- **proposed action:** Keep one subject and two documents: `relocation.json` stays comparanda's renderer fixture with the full torture list, and `relocation-gold.json` is a separate, thinner document authored *from* the corpus, owned by comparanda per §4.2's ownership argument but specified by rubricator's eval needs, containing only cells the corpus decides and the deliberate evidence gaps. Both validate under the §4.2 rule; only the second is an answer key. The extra cost is one afternoon and it removes a class of demo failure that will read as an agent bug.

</details>

<details><summary><b>[worth-fixing]</b> `insufficient_evidence_to_discriminate` is a derived analysis result being requested as a stored missingness code, and comparanda already computes it</summary>

- **where:** comparanda: docs/cross-repo-coordination.md §7 request 7 and §3.1 triage test 1; comparanda: docs/adr/PENDING-ACTIONS.md item 8(f) (ADR-0015 amend); rubricator: docs/adr/PENDING-ACTIONS.md §5 draft ADR-0011
- **claim:** Request 7: "A `missing` reason for `insufficient_evidence_to_discriminate` — The negative case of the pairwise escalation rule has no existing code, so it currently collapses into a catch-all". comparanda's ADR-0015 amendment (f): "Add `findNonDiscriminatingCriteria`." comparanda's triage tests (§3.1) begin "is it derived?"
- **asserted consequence:** The requested code does not describe an absence. Evidence exists and was read; what failed is discrimination between alternatives on that criterion — a property of the comparison, not of the cell, and comparanda already plans to compute it as `findNonDiscriminatingCriteria`. As a stored per-cell missingness code it fails triage test 1 and, worse, it is a criterion-level fact written into cells: a criterion that discriminates nothing produces a whole column of the code, which comparanda's completeness reporting would then have to classify as either outstanding work or resolved absence, and neither is true. It also inverts under the amended ADR-0009's `broader` model, where it must parent into a core code, and the choice of parent silently decides whether it counts as work remaining.
- **proposed action:** Disposition it `reject`, and say why in the mirror: the negative case of pairwise escalation is a criterion-level finding, reported by `findNonDiscriminatingCriteria` and by rubricator's own review stage, not a cell state. rubricator's stated fallback should be to record it in the criterion's provenance (request 3 already carries a rejected-criteria reason-code vocabulary and `no-discrimination-expected` is already in it — this is the same fact observed after scoring rather than before).

</details>

<details><summary><b>[worth-fixing]</b> The coordination document's own sixth triage test rejects the `procedure` record it accepted into the register</summary>

- **where:** comparanda: docs/cross-repo-coordination.md §3.1 test 6 and §7 request 4; rubricator: docs/adr/PENDING-ACTIONS.md §13 draft ADR-0018
- **claim:** §3.1 test 6: "**Does the field let `comparanda` tell that an agent produced the analysis?** ADR-0002 says it must not be able to, except through authorship metadata. `authorKind` and `independence` are legitimate *because* they are authorship metadata and a human panel needs them equally. A field named for the producer rather than the property would not be." Request 4 asks for "a `procedure` record", which rubricator's ADR-0018 defines as "(traversal, k, seeds, prompt versions, model id, whether re-scoring withheld the prior)".
- **asserted consequence:** `seeds`, `prompt versions` and `model id` are not properties a human panel has. A document carrying them is unambiguously agent-produced, which is precisely what test 6 forbids and what rubricator's own ADR-0002 ("comparanda must not be able to tell the difference") disclaims. As written, the test rejects the request; as filed, the request passes. Whoever runs Gate 2a triage will hit this in the first request that matters and will have to invent the resolution on the spot, most likely by weakening the test — which is the wrong direction, because the test is the only thing keeping producer-specific fields out of a format that is supposed to be producer-agnostic.
- **proposed action:** Split request 4. `authorKind` and `independence` are properties of an assertion and pass test 6 cleanly. The `procedure` record is a *provenance blob* about a run, not a property of the comparison: model it as opaque, namespaced, schema-ignored provenance attached to the author (comparanda ADR-0014 already separates provenance from evidence and stores both), so comparanda validates its presence and never reads inside it. Then test 6 holds and rubricator loses nothing.

</details>

<details><summary><b>[worth-fixing]</b> rubricator writes invalidated cells as `not-assessed` with the real reason in a note — the failure mode ADR-0009 was written to abolish</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §8 draft ADR-0016; comparanda: docs/adr/0009-missingness.md and docs/domain-model.md §Missingness; comparanda: docs/adr/PENDING-ACTIONS.md item 3 (ADR-0009 amend)
- **claim:** rubricator draft ADR-0016: "every cell scored under the old definition is invalidated — set to `missing` with reason `not-assessed` and a note naming the definition version — rather than silently retained." comparanda's domain model defines `not-assessed` as "Nobody has looked yet | default for a new cell", and ADR-0009's Consequences say of the alternative: "pushes the distinction into a comment field where it cannot be counted or filtered."
- **asserted consequence:** An invalidated cell was assessed; the assessment was superseded. Recording it as "nobody has looked yet" makes the amended ADR-0009's `assessedRate` under-report and makes "what is left to do" — the question ADR-0009 exists to answer — unable to distinguish a cell that needs original research from one that needs a cheap re-score against a revised anchor. The distinguishing fact lives in a free-text note, which is the exact anti-pattern ADR-0009's Consequences name. rubricator filed a request for the rarer `insufficient_evidence_to_discriminate` and not for this, which will occur on every criterion revision.
- **proposed action:** File it: a code meaning `superseded` / `invalidated-by-revision`, parented under a contingent core code so it counts as outstanding, carrying the definition version as a structured field rather than prose. It is one enum member and a MINOR bump if it lands after v1, so the cost of getting it wrong is low — but the cost of shipping it as a note is that the counts are wrong from the first revision and nobody notices.

</details>

<details><summary><b>[worth-fixing]</b> Two versioning mechanisms for one fact: anchor content-hash and criteria-set version disagree, and only one crosses the boundary</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §6 draft ADR-0012 and §8 draft ADR-0016; comparanda: docs/cross-repo-coordination.md §7 request 2
- **claim:** Draft ADR-0012: anchors are "**versioned by content hash** with the criterion: two analyses sharing a criterion key but not an anchor hash are **not comparable on that criterion**, and the tooling says so." Draft ADR-0016: "**Criteria sets carry a version** … **When a criterion's `question`, `scale`, `preference` or `exclusions` changes after cells have been scored, every cell scored under the old definition is invalidated**". Request 2 asks comparanda only for "Criteria sets are **versioned**; every measure records the criterion version it was scored against."
- **asserted consequence:** Editing the level-3 anchor is one event with two rules and opposite outcomes: ADR-0012 makes the analyses incomparable on that criterion (the hash moved), ADR-0016 retains every cell (anchors are not in its trigger list). Only the set version reaches comparanda, so the finer-grained rule — the one that actually protects comparability — is unenforceable in the stored document; a reader of a comparanda analysis cannot tell whether two columns share anchors. The two drafts are being settled in the same sitting by the same person and read as if written by different people.
- **proposed action:** Pick one. The per-criterion content hash is the stronger mechanism and subsumes the set version: hash the whole structured definition (question, scale, anchors, preference, exclusions, acceptability) and let the set version be derived from the member hashes. Then ADR-0016's trigger list becomes "the hash changed" and cannot omit a field, and request 2 asks comparanda for a `definitionHash` per criterion plus that hash recorded on every measure — the same field count, strictly more information.

</details>

<details><summary><b>[worth-fixing]</b> comparanda's uncertainty channel is fed by evidence quality alone, hiding the procedural instability rubricator computes</summary>

- **where:** comparanda: docs/research/findings-visualisation.md §blended encoding ("û = 1 − normalise(confidence)") and docs/adr/PENDING-ACTIONS.md item 13 (ADR-0010 amend) and item 15 (draft ADR-0028); rubricator: docs/adr/PENDING-ACTIONS.md §6 draft ADR-0012
- **claim:** comparanda: "**⚠️ We store *confidence*, not uncertainty.** `û = 1 − normalise(confidence)`"; ADR-0010 amendment (b) adopts "an **ordinal merge tree** (9 colours for 5 scores x 3 confidence levels)"; ADR-0028: "hatch **density** … carries confidence". rubricator draft ADR-0012: "**The two uncertainties are separated permanently.** *Evidential confidence* is **stored** and tool-verifiable. *Procedural stability* is **derived** from the assertion set, reported `n = 1, unmeasured` when unmeasured".
- **asserted consequence:** comparanda's flagship encoding — the one BRIEF.md calls "the one that changes minds" — makes evidence quality the entire uncertainty channel. A cell with a well-cited primary source (confidence high) whose five repeats came back 2,2,4,5,5 renders as fully trustworthy, and the reader's documented behaviour under that encoding is to *avoid high-uncertainty options* (ADR-0010 amendment (i)), so the encoding actively steers toward the unstable cell. rubricator computes exactly the missing quantity and has nowhere to put it: `stability` is not a measure in comparanda's model, not in the register, and ADR-0010's palette is already committed to 5×3. Both repos use the word "uncertainty" for a different half of it.
- **proposed action:** Decide which uncertainty the suppression channel encodes and say so in the legend copy, which ADR-0010 already requires to state the aliasing in words. If it stays evidential, add a request for a derived-or-stored `stability` per cell and give it its own encoding (the disagreement-spread ramp of ADR-0024 is already the right shape) rather than blending it. If it becomes both, the merge tree needs a third input and that is a Phase 3 decision worth taking now, before the palette is built and contrast-tested.

</details>

<details><summary><b>[worth-fixing]</b> rubricator's `certainty` measure is typed ratio over an enumerated domain and carries a view rule comparanda has no mechanism to honour</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md §6 draft ADR-0012; comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 1 (draft ADR-0018) and item 13 (ADR-0010 amend); comparanda: docs/cross-repo-coordination.md §7 register
- **claim:** rubricator draft ADR-0012: "**`certainty` is an optional ratio measure** from a fixed closed set of allowed probabilities … It is never required in a delivered analysis, **never encoded in the view**, and never blended into the score×confidence palette."
- **asserted consequence:** Two problems. First, a ratio-typed measure requires a declared `range` under comparanda's ADR-0018, and a "fixed closed set of allowed probabilities" is an enumeration — the schema will have to carry both a range and an enum for one measure, and nobody has said which is authoritative. Second, "never encoded in the view" is a rule about a repository rubricator does not control, stated in a rubricator ADR, and not filed as a request. comparanda's encoding registry (ADR-0010, ADR-0028) takes any measure and has no per-measure opt-out; the first person to add a `certainty` encoding will be doing something comparanda's documents permit and rubricator's ADR forbids, and neither will know. `certainty` is also cut-item 4 on rubricator's own cut list, which makes it the cheapest thing here to resolve by deleting.
- **proposed action:** Either drop `certainty` from the delivered document entirely — keep it in the evaluation harness's own records, where the view never sees it, which matches its evaluation-only purpose and costs nothing — or file it as a request with a `viewable: false` flag on the measure declaration, so the rule lives in the document rather than in a foreign ADR.

</details>

<details><summary><b>[taste]</b> comparanda adopts "options" as the default display alias while rubricator's prompts are mandated to say "alternatives"</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md item 9 (ADR-0003 amend) and docs/domain-model.md §Domain aliasing; rubricator: CLAUDE.md §Vocabulary
- **claim:** comparanda ADR-0003 amendment: "Record that the **default display alias for alternatives is "options"**". rubricator CLAUDE.md: "Use `comparanda`'s: **alternatives** (rows), **criteria** (columns) … Never \"items\" or \"features\"."
- **asserted consequence:** rubricator's prompts are the user-facing surface — the chat turn where the frame is elicited and confirmed — and comparanda's matrix is where the same user reads the result. In the end-to-end demo the agent will say "alternatives" and the rendered matrix will say "options" for the same axis, in the same session. Harmless, and the kind of seam a first viewer notices immediately.
- **proposed action:** State the split once, in the coordination document's §2.4 vocabulary line: `alternatives`/`criteria` are the schema and code names in both repos; the display alias is analysis-level data and rubricator sets it (defaulting to "options") when it writes the analysis, and uses the same word in its prompts.

</details>

### Evidence to recommendation

<details><summary><b>[blocking]</b> Interval-widened "possible dominance" reduces algebraically to the common-dimensions rule the same ADR forbids</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 1 item 2 (draft ADR-0019); docs/research/findings-terminology.md § 3.3
- **claim:** "`a` **necessarily dominates** `b` iff `lo_a[j] >= hi_b[j]` on every criterion in the comparison basis … `a` **possibly dominates** `b` iff `hi_a[j] >= lo_b[j]` with strict inequality somewhere", with "a contingently missing value gives the criterion's declared range"; and, as the rejected alternative, "*Compare on commonly-known criteria.* Forbidden: non-transitive, cyclic, can empty the front."
- **asserted consequence:** Substitute the widened intervals into the possible-dominance test and the missing criteria drop out identically on both sides: where b is blank, `lo_b = min`, so `hi_a >= lo_b` is vacuously true; where a is blank, `hi_a = max`, likewise. Possible dominance therefore holds exactly when a >= b on the criteria both alternatives actually have — which *is* the common-dimensions rule, the one the ADR's own Alternatives section forbids as non-transitive and cyclic. The ADR does note that possible dominance is non-transitive, but it never notices that the two rules are the same rule, and it then builds the third tier ("robustly non-dominated = nothing even possibly dominates it") on top of it. So the exact failure the ADR exists to prevent — a cycle in which the front is empty — reappears as "no alternative is robustly non-dominated", and the 200,000-triple verification does not catch it because it verified only the *necessary* relation. The global comparison basis does not rescue this: the basis screens out structurally inapplicable criteria, while the pathology is driven by contingent blanks, which stay inside the basis and are handled per-pair by the widening.
- **proposed action:** Before writing ADR-0019, run the missing measurement: on the messy example fixture, print |dominated|, |provisionally surviving| and |robustly non-dominated| at 0%, 10%, 20% and 30% contingent missingness. If tier 3 is unstable or empty, either (a) state that possible dominance is the common-dimensions rule and confine it to `explainDominance`, never to a tier a reader sees, or (b) replace tier 3 with a cycle-aware construction and require the result object to report detected cycles, as the ADR already requires for the q-relaxed relation. Either way, delete the sentence that presents the common-dimensions rule as forbidden while shipping it under a different name.

</details>

<details><summary><b>[blocking]</b> Necessary dominance almost never fires once any cell is blank, and the offered relaxation is calibrated against the wrong scarcity</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 1 item 2 (draft ADR-0019) and item 8(c) (ADR-0015 amend); docs/adr/0015-analyses-and-no-default-aggregation.md
- **claim:** ADR-0015 calls dominance "the strongest defensible reduction available and requires no value judgements"; the amendment adds "(c) Support a per-criterion **indifference tolerance** (practical dominance), because strict dominance 'is rare' [1 §5.5.2.1]"; ADR-0019 states "Results have three tiers: dominated, provisionally surviving, robustly non-dominated."
- **asserted consequence:** Under the widening rule, `a` necessarily dominates `b` only if `a` scores the criterion's *maximum* wherever `b` is blank and `b` scores the *minimum* wherever `a` is blank. On a 12-criterion matrix with 20% contingent missingness, the probability that an ordered pair has no blank on either side is 0.8^24 ≈ 0.005 — and strict dominance must then still hold on all twelve. The "dominated" tier is therefore empty in practice, so every alternative lands in the middle tier and the flagship analysis returns "we cannot tell" for the whole matrix. The mitigation ADR-0015(c) offers is an indifference tolerance justified by a quotation about *strict* dominance being rare on complete data. That q does not touch the new scarcity: q = 1 on a 1–5 criterion does not bridge the gap between an observed 4 and a `[1,5]` interval. The relaxation is calibrated against a problem an order of magnitude smaller than the one the widening creates, and no one measured the difference.
- **proposed action:** Treat "what fraction of pairs does necessary dominance resolve at realistic missingness" as a Phase-1 gate, not a Phase-2 discovery. If the answer is near zero, the honest options are to make the *middle* tier the product (rank alternatives by how many blanks stand between them and a verdict) or to admit an explicitly labelled optimistic/pessimistic completion. Do not ship ADR-0015's "strongest defensible reduction available" language alongside ADR-0019 without a measured yield number in the Consequences section.

</details>

<details><summary><b>[blocking]</b> The mandated 1–5 scale is a five-point scale, but every psychometric source cited says five is below the floor, and the winning LLM result is six-point</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 6 (draft ADR-0012); docs/research/findings-method.md summary row 7 and § 2; docs/research/sections/r2-rubrics-and-calibration.md § scale. Cross-repo: comparanda: docs/adr/PENDING-ACTIONS.md § Tier 3 item 13(b) (the 5 × 3 = 9-colour VSUP merge tree)
- **claim:** "**`score` is a 1–5 integer, declared ordinal, not configurable.** … 0–5 beats 0–10 and 0–100 on absolute human–LLM agreement [17]", supported in r2 by "attenuated psychometric precision below 6 options and **no psychometric advantage for any scale beyond 6 options**" and by Preston & Colman's "indices rose up to about seven points".
- **asserted consequence:** 0–5 is six levels. 1–5 is five. The one study that ranks scales by absolute human–LLM agreement measured the six-level scale; the two human psychometric studies both place the floor at about six options, which puts a five-point scale on the attenuated side of their own stated boundary. The recommendation adopts the winning *label* and drops one level, and neither the findings nor the ADR draft notices the substitution. The second consequence is worse: an odd scale has a midpoint, and ADR-0012's own enforcement rule 2 — "**The score is never hedged toward the midpoint**" — exists only because the chosen scale supplies a hedging target. That rule is a prompt-level honesty rule, and the sibling draft ADR-0015 states as its central argument that "prompt-level honesty rules erode". A six-level scale removes the failure mode structurally, which is exactly the move ADR-0015 says to prefer over a prompt instruction. The number is also load-bearing across the repo boundary: comparanda's merge tree is specified as "5 score levels × 3 confidence levels = 9 colours", so changing it after schema-v1 is a migration plus a palette rebuild plus an anchor rewrite.
- **proposed action:** Settle 5 vs 6 explicitly in ADR-0012 with the discrepancy on the page: state that the cited agreement result is six-level, state that the psychometric floor is six, and either adopt 0–5 (six levels, no midpoint, enforcement rule 2 becomes unnecessary) or record in the Alternatives section why five is preferred despite both. Whichever wins, propagate the count to comparanda's merge-tree ADR before the palette is drawn, not after.

</details>

<details><summary><b>[blocking]</b> Disclosure as a "view-time projection" is not redaction in the standalone bundle, which is the artifact the feature is for</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 1 item 5 (draft ADR-0021) vs docs/adr/0013-standalone-and-connected.md
- **claim:** ADR-0021: "Model disclosure as an orthogonal, **view-time** property of a value, so redaction is a **projection** rather than an edit … Redaction never mutates the analysis, so an owner and a reviewer read the same document." ADR-0013: "Ship a **build command** that takes an analysis and emits a single self-contained HTML file … This is the format for sharing a finished comparison, and it is a first-class output."
- **asserted consequence:** In the standalone shape the analysis is inlined into the file as `<script type="application/json">` and mailed. If disclosure is enforced only at render time, the withheld values travel inside the file to the person they are withheld from, recoverable with View Source. "An owner and a reviewer read the same document" is precisely the defect there, not the virtue. The Alternatives section considers only "`withheld` as a missingness reason only" and "deriving `withheld` entirely at render time" — it never considers the option the flagship artifact actually requires, which is projecting *before* serialisation at build time. Shipping this as drafted puts a confidentiality claim in the docs that the primary output shape does not honour, and discovering it after v1 means a build-pipeline change plus a disclosure to whoever already mailed a file.
- **proposed action:** Split the decision by deployment shape in the ADR itself: in connected mode, disclosure is a view-time projection over a store the reader cannot read past; in standalone mode, `comparanda build` takes an audience and emits a document from which withheld values have been *removed*, with the count of removed cells retained so the widened-interval dominance report is still computable and still announced. Add a build-time test asserting that no withheld value appears anywhere in the emitted bytes.

</details>

<details><summary><b>[expensive-later]</b> The `polarised` refusal triggers on spread, but the simulation that justifies it demonstrates a symmetry pathology</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 5 (draft ADR-0011) and § Proposed MCP tool surface tool 14; docs/research/sections/r4-variance-mitigation.md § 2.4
- **claim:** "**No point reduction is emitted for a polarised cell** — emit the level multiset and a `contested` marker instead. *(REASONING, from simulation: for a cell split 2/4 at p = .45 each, the median lands on 3 — a level almost nobody chose — with probability rising from .10 at k = 1 to .36 at k = 21.)*" Implemented as `aggregate_assertions(..., allow_contested_reduction=false, polarised_gap=1)`.
- **asserted consequence:** The simulation is correct and its conclusion is sound *for the case it simulates*: a near-symmetric bimodal distribution whose hollow centre is the distributional median. That is why the lower median converges to 3. Make the distribution asymmetric — p(2) = .6, p(4) = .3, p(3) = .1 — and the median converges to 2, which is the modal level and the right answer; more repeats then make the estimate monotonically *better*. The rule derived from the simulation, however, keys on a gap parameter, not on symmetry. A cell whose observed levels are {2, 2, 2, 4} has gap 2, would be flagged `polarised`, and would be refused a point reduction even though three of four draws said 2 and the reduction is exactly right. On a matrix with any real spread this suppresses point values across a large fraction of cells, which propagates into comparanda as `contested` cells the view cannot encode with the value ramp, into the dominance analysis (a cell with no point value is another blank), and into a schema request for a `contested` marker that is then over-produced.
- **proposed action:** Re-derive the trigger from the pathology, not from the spread. Refuse the point reduction when the reduction level's own observed frequency is low relative to the multiset (e.g. the reduced level is an anti-mode, or the two modes straddle it), not when min and max are far apart. State the trigger condition in the ADR as a formula, mark it explicitly reasoning, and add a harness arm that measures how often it fires on the fixtures before `polarised_gap = 1` becomes a default.

</details>

<details><summary><b>[expensive-later]</b> k = 5 is attributed to two citations that do not contain it, and is derived from the best case of a simulation the section itself says is the best case</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 13 (draft ADR-0018); docs/research/findings-method.md summary row 16; docs/research/sections/r4-variance-mitigation.md § 2.3
- **claim:** ADR-0018: "`k = 5` with adaptive early stopping (halt at 3 on agreement, escalate to 9 only for cells the review flags) … **The knee is at 5; past 9 you buy decimal places on a 5-level scale [33][34].**" r4 § 2.3, on the same table: "This agrees with the direction of [5][6][7] and **gives a number they do not**", and "the mode sits at the *centre* of the scale (level 3) … **This assumption is load-bearing** — with an off-centre mode the lower median recovers it far less often (for the loose row with the mode at level 4, recovery at `k = 15` falls from .940 to ≈.76) — so read the table as the *best* case for replication, not the typical one."
- **asserted consequence:** Two qualifications are lost between the working note and the ADR draft. First, the source note says explicitly that the cited papers do *not* supply the number; the ADR attaches [33][34] to the sentence carrying it, so a reader checking the citation will find adaptive-consistency and self-consistency papers on single-correct-answer reasoning tasks and conclude the knee is measured. Second, the knee is read off a row whose generative model centres the mode on the scale — the most favourable geometry for a median — and the note's own off-centre check drops recovery at k = 15 from .940 to ≈.76, which puts the knee well past 5. k is the deployed runtime's dominant cost multiplier; getting it wrong by one step is a 20% cost error on every unattended run, and getting it wrong downward is a quality error the stability report will not reveal because the same k produced it.
- **proposed action:** In ADR-0018, state k = 5 as engineering judgement, cite [33][34] only for the *shape* of diminishing returns, and reproduce the off-centre-mode row beside the centred one so the reader sees the sensitivity. Add k to the harness as a swept parameter rather than a fixed default, and let the fixture run set it. Also settle open question 12 (whether adaptive early stopping under-samples the tail that determines `polarised`) before early stopping and the polarised rule ship together — they interact, and the interaction is adversarial.

</details>

<details><summary><b>[expensive-later]</b> The negative result on column correlation rests on a confound the adopted scoring protocol is designed to remove</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 12 (ADR-0008 amend) and § 5 (draft ADR-0011); docs/research/findings-method.md § 1 and § 7.7
- **claim:** "**column correlation is a `traversal_leakage_diagnostic`, never a redundancy finding** … for an LLM-scored matrix the judge's own halo inflates inter-criterion correlation far beyond the signal [10]", where [10] is Stureborg et al., described earlier in the same document as "when GPT-4 scores several attributes **in one generation** the inter-attribute correlation inflates from a human r = 0.315 to r = 0.979".
- **asserted consequence:** The r = 0.98 figure is measured under a multi-attribute single-generation template. ADR-0011 mandates the opposite — "one criterion per generation" — precisely to abolish that condition. So under the protocol rubricator will actually run, the second leg of the argument has no measured support: nobody has reported inter-criterion correlation for cell-wise scoring, and the project's own thesis is that cell-wise removes the assimilation that produced the number. The first leg (the DCLG counterexample) is sound but proves something narrower than the conclusion drawn: it shows correlation does not establish *preference dependence*, a value-structure property. ADR-0005 step 3's concern is semantic overlap between two criteria — a different thing, which the DCLG quotation does not address. The rename compounds the problem: relabelling the field `traversal_leakage_diagnostic` asserts that any observed correlation is leakage, when real alternatives genuinely covary across criteria. The diagnostic has no null model, so it can only produce false alarms or be ignored, and ADR-0008's stability work inherits a metric that cannot be interpreted.
- **proposed action:** Keep the prohibition on labelling correlation a redundancy finding — that part is right and well argued from DCLG — but drop the halo leg from the justification, or restate it as: measured under batched scoring, magnitude untransferable to cell-wise. Then either give `traversal_leakage_diagnostic` a null (a permutation baseline over shuffled cell assignments, which is deterministic and cheap) or demote it to a reported number with no name that implies causation. Add "what is inter-criterion correlation under cell-wise scoring?" to the open-questions list; it is a free by-product of the harness arms already budgeted.

</details>

<details><summary><b>[expensive-later]</b> Family B calibration metrics measure a channel that delivered analyses never emit</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 6 (draft ADR-0012) and § 12(b) (ADR-0008 amend); docs/research/findings-method.md summary row 10 and § 7.3
- **claim:** "**`certainty` is an optional ratio measure** from a fixed closed set of allowed probabilities, elicited **only** in evaluation runs against fixtures with known answers or on explicit request. It is never required in a delivered analysis" — together with "**Family B — proper scoring over `certainty`** … Brier with Murphy decomposition, skill score, value-binned reliability curve, ECE reported second behind a minimum-n gate, AUROC."
- **asserted consequence:** A metric family whose input is elicited only in evaluation runs measures a behaviour that never occurs in production. Whatever Brier score the harness computes describes the model's calibration when asked a question the shipped prompts never ask; it cannot detect a regression in the delivered product, because the delivered product has no `certainty` field to regress. The originating claim is also weaker than stated: summary row 10 says ADR-0008's calibration item is "**Not as written**" computable, but ADR-0008's actual text — "on fixtures with known answers, do high-confidence cells outperform low-confidence ones?" — is a discrimination test, and the findings concede in § 2 that "a *discrimination* test … an ordinal label can pass". So the item is computable; only the word "calibration" is wrong. The cost of the fix is a new ratio measure, a fixed probability set, an equivalent-bet elicitation prompt, a separate elicitation path, a comparanda schema request, five metrics with a min-n gate, and a permanent "never render this measure" rule in the view — all to correct a label.
- **proposed action:** Rename the ADR-0008 item to "confidence discrimination" and ship Family A, which does map onto production behaviour. Make `certainty` and Family B a numbered open question with a stated pass condition ("we will add a probability measure if and only if Family A fails to separate the fixture arms"), rather than a decided ADR clause. If `certainty` is kept, say in the ADR what a Brier score over an eval-only channel licenses you to claim about a delivered analysis — the honest answer is very little, and writing it down is the cheapest way to test whether the family is worth its cost.

</details>

<details><summary><b>[expensive-later]</b> Mandatory cell invalidation on criterion revision contradicts comparanda's "retain every assertion", and has no material-change test</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 8 (draft ADR-0016). Cross-repo: comparanda: docs/adr/0011-collaboration.md point 3
- **claim:** ADR-0016: "When a criterion's `question`, `scale`, `preference` or `exclusions` changes after cells have been scored, **every cell scored under the old definition is invalidated** — set to `missing` with reason `not-assessed` and a note naming the definition version — rather than silently retained." comparanda ADR-0011 point 3: "The schema retains **every** assertion with its author, timestamp and justification."
- **asserted consequence:** The two rules cannot both hold as stated and nobody has decided which gives. If the old assertions are retained (comparanda's rule) while the cell renders `not-assessed`, then the assertion set still contains measures scored against a superseded rubric — and every derived statistic that reads the assertion set (the `disagreement` encoding, Krippendorff's alpha per criterion, the stability report, `aggregate_assertions`) silently mixes rubric versions, which is precisely the failure ADR-0016 was written to prevent. If they are discarded, rubricator is asking comparanda to violate its own retention guarantee, and the audit trail for "why did this score move" is gone. Separately, the trigger has no materiality test: fixing a typo in a criterion's `question` invalidates the whole column. On a 22 × 12 matrix at k = 5 that is 110 model calls destroyed by an editorial change, in a pipeline whose own ADR-0005 makes iterative criteria discussion the valuable part. The Consequences section frames the expense as honesty — "Revising a criterion becomes visibly expensive, which is honest — it *is* expensive" — but the expense is being charged for edits that change nothing about what a score means.
- **proposed action:** Decide the retention question explicitly and record it in both repos: the clean shape is that assertions are retained and stamped with `criterionVersion`, and every derived statistic filters to the current version by default while the superseded assertions remain readable. Then replace the blanket trigger with a declared `materialChange: boolean` on the criteria-set version bump, defaulting to true, so an author can record "wording only" and keep the column. Note also that the evidence for the whole ADR is one UIST study of developers iterating LLM-evaluator prompts, graded moderate — that supports "criteria drift happens", not "invalidate on every field edit".

</details>

<details><summary><b>[expensive-later]</b> The categorical embedding ban is a slogan, and its escape hatch does not reach the connector's primary use case</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 2 (draft ADR-0010); docs/research/findings-method.md § 5 and § 7.6
- **claim:** "**No in-tool model calls of any kind, and no embedding calls** — an embedding model is a model. It needs either a key (no connector) or a bundled local model whose version silently changes results between runs. … Contextual and late-chunked embedding indexes are permitted only in an offline corpus-preparation step run by the deployed agent or the CLI, producing a static index the connector reads. … This is sufficient because the model does the semantic work in its own loop and can issue several queries."
- **asserted consequence:** Three separate problems. First, the stated reason does not survive the same document: § 5 recommends bundling HHEM-2.1-Open (100M), AlignScore (355M) or MiniCheck-FT5 (770M) for citation checking, noting approvingly that "All run on CPU with no API key". A pinned local embedding model is exactly as deterministic and exactly as key-free as a pinned local NLI checker; the version-drift objection is a dependency-pinning problem the project solves elsewhere. Second, the offline-preparation escape hatch does not apply where it is most needed: the connector's own `corpus_add` ingests the user's documents at analysis time, so the connector can never have a semantic index over the corpus it is actually working on. The exception is written for a case the flagship runtime does not have. Third, "This is sufficient because the model does the semantic work in its own loop" is asserted with no evidence and is the single upstream determinant of the product's output density: under ADR-0006 and ADR-0012, no citable span means `unknown`, so every recall failure in BM25 converts directly into a blank cell. Open question 6 already worries that the `unknown` rule may "produce an unusably sparse matrix" without connecting it to the retrieval decision that causes it.
- **proposed action:** Rewrite the ban as what it actually is: no *network* model calls and no *nondeterministic* model calls in tools. Then state the real reasons for excluding a bundled embedding model (install weight, wheel size, CPU latency in an interactive connector) and let them be weighed, since they are arguable and the current reason is not. Add a retrieval-recall arm to the ADR-0008 harness — BM25 alone vs BM25 plus a pinned local embedding rerank, measured as `unknown` rate and citation recall on the fixtures. That is the cheapest experiment in either repo and it is currently unbudgeted.

</details>

<details><summary><b>[worth-fixing]</b> The 25k inline threshold is a client's response-truncation cap, presented where the derived crossover would go</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 2 (draft ADR-0010); docs/research/sections/r6-mcp-and-agent-architecture.md § 6
- **claim:** "There is no long-context pricing surcharge on current models, so the crossover is set by cache economics — roughly 20k–40k corpus tokens when you control caching and roughly **5k** when you do not, and in the connector you control neither." Immediately preceded by: "**Retrieve by default.** Inline the whole corpus only under roughly **25k** tokens and only at the enumeration stage."
- **asserted consequence:** The two numbers sit in adjacent sentences and only one of them comes from the arithmetic. r6 § 6 shows where 25,000 actually originates: "Claude Code truncates tool responses at 25,000 tokens by default" — a client-side truncation limit, an entirely different quantity from a cost crossover. The ADR's own analysis says the connector's crossover is ~5k because the connector controls neither the cache breakpoints nor the context budget, and then sets the inline default at five times that. A reader of the ADR alone will reasonably take 25k as derived, and the number becomes a hard behaviour of `corpus_search` ("Empty query returns the whole corpus under the inline threshold, else an actionable `isError`"). It is also absent from open question 9, which lists the numbers the research knows are guesses.
- **proposed action:** State the provenance of each figure in the ADR: 5k is the uncached cost crossover, 25k is one client's truncation default, and the inline threshold is a separate parameter that should be min(crossover, client cap) with both named. Add it to open question 9's list of unmeasured thresholds. Since `corpus_add` already reports a token estimate, make the threshold configuration rather than a literal, and have the `isError` message name which of the two limits was hit.

</details>

<details><summary><b>[worth-fixing]</b> The tool-count headroom compares rubricator's tools against a limit that is about the whole session</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md § 1 (draft ADR-0009); docs/research/findings-method.md summary row 35; docs/research/sections/r6-mcp-and-agent-architecture.md § 4
- **claim:** "**Tool surface: 19 tools, 11 minimum viable** — comfortably under the band where tool selection degrades", from "Claude's ability to pick the right tool degrades once you exceed **30–50 available tools**".
- **asserted consequence:** The quoted degradation band counts *available* tools in the session, not tools contributed by one server. The same source quoted two sentences earlier in r6 makes this explicit: "a typical five-server MCP setup can consume ~55k tokens in definitions before Claude does any work." In the connector runtime — the MVP, and the runtime rubricator's whole architecture exists to serve — rubricator's 19 tools land in a session that already contains the host's built-in tools and whatever else the user has connected. Nineteen is not headroom under 30–50; it is over a third of the budget consumed by one server. The corroborating independent evidence (RAG-MCP) is band-by-*position*, which degrades earlier still. Freezing a 19-tool surface at Gate 1 on the strength of a mis-scoped comparison is expensive because the gate exists precisely to stop the surface moving afterwards.
- **proposed action:** Restate the headroom claim in session terms: "19 tools plus a typical host's built-ins puts a session near the lower edge of the documented degradation band." Then either commit to the 11-tool minimum viable set as the *shipped default* with the other 8 behind an opt-in, or measure it — a throwaway server logging tool-selection accuracy with 11 vs 19 exposed is the same one-afternoon experiment already scheduled as open question 7 for `clientCapabilities`, and can ride along with it.

</details>

<details><summary><b>[worth-fixing]</b> Krippendorff's alpha is made the shipped agreement statistic while the section that validated it concludes the point estimate is near-meaningless at this scale</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 2 item 11 (draft ADR-0022) vs docs/research/sections/c4-agreement.md § 1.3
- **claim:** ADR-0022: "Krippendorff's alpha is the coefficient … computed **per criterion, over alternatives as units** … Always reported with a jackknife interval [63]." c4 § 1.3: "A criterion in a 22-alternative matrix gives at most 22 units. Zapf et al. simulated n = 50, 100 and 200 … their *smallest* simulated sample is still more than twice comparanda's, so applying this at n≈20 is an extrapolation downward, not a measurement … **At n≈20 the interval will be wide enough that the point estimate is close to meaningless on its own.**"
- **asserted consequence:** The ADR draft carries the coefficient and the interval requirement but drops the sentence that says what the number is worth at comparanda's stated scale. ADR-0002 caps the tool at "tens to low hundreds of alternatives", and the reference behaviour in BRIEF.md is 22 rows — so the near-meaningless regime is the normal case, not the edge case. The ADR then compounds it by forbidding any gate ("**No threshold gates, warns on, suppresses or excludes anything**"), which is right in spirit but leaves nothing at all standing between a wide, unstable alpha and a UI that displays it beside a band label. The sibling repo reached the opposite conclusion on the identical problem: rubricator's ADR-0008 amendment requires "ECE reported second behind a **minimum-n gate**". Two repos, one class of small-sample estimator, opposite handling, no stated reason for the asymmetry.
- **proposed action:** Carry c4's own conclusion into ADR-0022's Consequences verbatim, and add a display rule that is not a data gate: below a configurable unit count, render the interval and suppress the *point estimate*, exactly as rubricator's min-n gate does for ECE. That satisfies "no threshold suppresses data" — no cell is hidden, no criterion is excluded — while refusing to print a number the research says is close to meaningless.

</details>

<details><summary><b>[worth-fixing]</b> The coverage gate's 100% rule is stricter than both cited sources, which do the thing it forbids; and 2/3 arrives in the ADR stripped of its caveats</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 1 item 8(d) (ADR-0015 amend) vs docs/research/findings-terminology.md § The coverage gate and open question 5
- **claim:** ADR-0015 amend (d): "Add the **coverage gate**: point aggregate at 100% weight coverage, interval aggregate down to 2/3 [49], dominance and completeness only below that. Weight renormalisation **is** mean imputation and must be labelled as such [48, 49]." The findings say of the same number: "Adopt it as the **default of a configurable parameter**, not a literal. **One caveat we own:** both sources measure availability as a *count*, we apply it to *weight* coverage."
- **asserted consequence:** Three qualifications the findings state are absent from the drafted amendment. First, 2/3 is a configurable default there and a literal here. Second, the count-vs-weight transfer is flagged as "our extension" there and cited to [49] here, so the ADR reads as though the threshold is measured on the quantity we apply it to. Third, open question 5 says plainly that "our matrices are ~22 × 12, and the threshold's sensitivity at small `n` is untested" and asks for a simulation "before the default is fixed" — the ADR fixes it. Separately, the 100% rule is not in either source: both [48] and [49] *renormalise* above their 66% floor and publish point scores, which is the practice the amendment forbids. The reasoning for forbidding it (renormalisation is shadow imputation) is good and stands on its own — but citing [48, 49] for a rule those sources contradict in practice will mislead anyone who checks.
- **proposed action:** In the amendment, attribute the 100% point-aggregate rule to the shadow-imputation argument only, and note explicitly that both cited indices renormalise instead. Restore "configurable default, not a literal" and the count-vs-weight caveat. Run the cheap simulation open question 5 already specifies — how often does the interval aggregate's ranking change as coverage falls, on the two example fixtures — before 2/3 is written into a schema-facing ADR.

</details>

<details><summary><b>[worth-fixing]</b> The self-registration ban is derived from a mis-declared `sideEffects` field, and the standard remedy is never considered</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 1 item 4 (draft ADR-0017) and § Tier 3 item 13(h) (ADR-0010 amend); docs/research/sections/c8-prior-art-and-stack.md § B.10
- **claim:** "**Registries are populated explicitly by the composition root.** … no module registers itself at module scope. This is a **correctness requirement** under `"sideEffects": false`, demonstrated, not a style preference." The demonstration's own table: row 1 `sideEffects: false` + self-registration → module deleted; row 2 **no `sideEffects` field** + self-registration → module present.
- **asserted consequence:** What the fixture demonstrates is that declaring `"sideEffects": false` on a package containing side-effecting modules is a false declaration — which is a packaging bug in a field comparanda controls, not a property of self-registration. The `sideEffects` field accepts a glob array precisely for this case; listing `src/encodings/*.ts` fixes row 1 while keeping tree-shaking everywhere else. That option appears nowhere in § B.10 or in either ADR draft, and the section's own row 2 shows the mechanism. The conclusion — explicit registration by the composition root — is a good design and I would keep it, for the reason the section gives incidentally (a consumer wanting only two encodings ships only two). But labelling it "a correctness requirement, not a style preference" and promoting it to a binding rule "every contributor must know" over-reads a three-row experiment, and it makes ADR-0010(h) and ADR-0017 both hinge on a claim a reviewer can falsify in one line of `package.json`.
- **proposed action:** Keep the rule, change the warrant. State it as: explicit registration is chosen because it makes encodings tree-shakeable *for consumers*, and because it avoids a `sideEffects` glob list that has to be maintained by hand as encodings are added. Record the glob-array alternative in Alternatives considered with why it was rejected. Drop "correctness requirement" — the correctness bug is an inaccurate `sideEffects` declaration, and that should be its own CI check regardless of which registration pattern wins.

</details>

<details><summary><b>[worth-fixing]</b> The VSUP verdict reads the study's decision measure with the sign reversed</summary>

- **where:** comparanda: docs/research/sections/c6-views-and-uncertainty.md § B.1 and § B.2; carried into docs/adr/PENDING-ACTIONS.md § Tier 3 item 13(i) (ADR-0010 amend) and findings-visualisation.md summary row 10
- **claim:** The evidence table records "VSUP vs traditional (danger/value accepted) | M = 0.32 vs 0.29, t = 2.3, p = 0.02 — **VSUP users accepted worse expected value**". Two pages later the alternatives table records, for the traditional bivariate square: "Superseded. Equal on accuracy, **worse on the decision measure** [12]. Use VSUP."
- **asserted consequence:** On the study's own numbers the traditional bivariate did *better* on expected value; VSUP users traded expected value for lower uncertainty. Calling the traditional encoding "worse on the decision measure" inverts the sign of the only decision outcome reported. The summary row that will reach the ADR — "**Not readability — decisions**" — inherits the inversion and reads as though VSUP is measurably better at decisions, which the cited numbers do not show. There is a defensible version of the argument: comparanda *wants* readers to discount thin evidence, so uncertainty aversion is the intended effect and the expected-value cost is an accepted trade. But that is an assumption about the product's goal, not a finding, and it needs to be stated because it is exactly the claim BRIEF.md makes without a warrant ("the blended encoding is the one that changes minds"). The base is n = 24 crowdworkers on one synthetic task, graded moderate in the working note and about to be written into an accepted ADR.
- **proposed action:** Fix the sign in the alternatives table and in the ADR amendment. State the trade explicitly: "in the originating study, VSUP readers avoided the most uncertain options and accepted worse expected value to do so; comparanda adopts VSUP because inducing that discount is the product's intent, not because it improved decisions on any measure the study reports." Keep the moderate grade and the n = 24 caveat in the ADR body, not only in the working note.

</details>

<details><summary><b>[taste]</b> "Never numerically average ordinal codes" is applied as an absolute veto in one ADR and as a documented assumption in another, with no stated boundary</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § Tier 2 item 11 (draft ADR-0022) vs § Tier 2 item 12 (draft ADR-0025); docs/research/findings-visualisation.md § 1.3
- **claim:** ADR-0022: "Tastle and Wierman's consensus measure is **rejected outright** because it internally averages the ordinal codes"; ICC rejected because it "assumes interval". ADR-0025: "Ordinal levels are scored by their **declared** level index normalised to [0,1] … The resulting equal-spacing assumption is stated in the UI alongside the order and is **not** a licence to average scores anywhere."
- **asserted consequence:** Gower's coefficient with level indices normalised to [0,1] and averaged across criteria is numerically averaging ordinal codes with an equal-spacing assumption — the same operation that gets Tastle–Wierman rejected outright. The seriation section is honest about this ("a real interval assumption smuggled into a similarity computation") and offers a boundary: it is confined to a view-layer ordering heuristic and "produces no number anyone reports". That is a reasonable rule, but it is stated in one working note and nowhere in either ADR, so the two ADRs as drafted apply opposite standards to the same operation with no principle a future contributor can apply. The predictable outcome is a re-litigation every time someone proposes a statistic: an outright rejection and a documented deviation are both available precedents.
- **proposed action:** Write the boundary down once, in ADR-0003's vocabulary amendment or in ADR-0022: an equal-spacing assumption over ordinal levels is permitted where its output is an ordering or a layout and no number is reported to the user, and forbidden where its output is a reported value. Then re-derive both decisions from it, so ADR-0022's rejection of Tastle–Wierman rests on "it reports a number" rather than on "it averages", which the tool does elsewhere.

</details>

### Scope, cost, buildability

<details><summary><b>[expensive-later]</b> Two schema needs are load-bearing in rubricator's ADRs and absent from the request register that Gate 2a certifies as complete</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md item 6 (draft ADR-0012) and item 11 (draft ADR-0017), and findings-method.md tool 1; against comparanda: docs/cross-repo-coordination.md §7 (the seven-request register) and Gate 2a
- **claim:** Draft ADR-0012 introduces a measure: "**`certainty` is an optional ratio measure** from a fixed closed set of allowed probabilities, elicited **only** in evaluation runs". Draft ADR-0017: "**The stored record is itself a schema-valid comparanda analysis** — not a bespoke checkpoint format", and tool 1 `analysis_open` "Creates a new in-progress analysis — a valid, minimal comparanda document with zero rows and columns". The register in cross-repo-coordination.md §7 lists exactly seven requests — structured criterion definitions, criteria versioning, criteria provenance/rejects, assertion `authorKind`/`independence`/`perturbation`, evidence `stance`/`sourceType`/`derivedFrom`/`quoteHash`/`check`, criterion `preference`, and one missingness code — and Gate 2a passes when "Every field `rubricator` must read from or write into a comparanda document is either already in the schema sketch (§2.1) or filed as a request (§3)."
- **asserted consequence:** Neither need is a field addition of the kind the register handles cheaply. `certainty` is a *measure*, and ADR-0003 makes the measure set schema content typed by level of measurement — a ratio measure alongside two ordinal ones is a real schema shape, not an optional property. "Validates strict with zero alternatives and zero criteria" is a constraint on the schema's own required-ness, and it is the precondition for every `analysis_validate` call in the connector's normal operation: if comparanda requires at least one alternative, rubricator's entire durable-partial-document design fails on its first tool call, and the failure surfaces at the `SketchSchema` → `PublishedSchema` swap (critical-path step 5), which is the worst place on the chain to find it. Gate 2a will pass while both are unrecorded, because the gate checks the register and the register is short by two.
- **proposed action:** File both before Gate 1 closes: (a) `certainty` as an eighth request with the standard fallback statement — the obvious fallback is that it is eval-run-only and therefore lives in rubricator's own store, never in the delivered document, in which case the request is withdrawn and the roadmap's cut #4 becomes free; (b) an emptiness/partiality constraint on the schema, phrased as a validation requirement rather than a field: "a document with zero alternatives and zero criteria validates strict". (b) costs comparanda one decision and nothing else, and it is the single cheapest thing on this list to get wrong.

</details>

<details><summary><b>[expensive-later]</b> Twenty-five pre-drafted ADRs is roughly sixteen decisions; here is the consolidation</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md (13 new, 9 amendments, 5 confirms) and rubricator: docs/adr/PENDING-ACTIONS.md (11 new plus one unnumbered, 3 amendments, 4 confirms); both docs/ROADMAP.md epic 1
- **claim:** comparanda's roadmap: "`adr/PENDING-ACTIONS.md` holds thirteen new ADRs (0017–0029), nine amendments … Four items genuinely need a human rather than more reading." rubricator's roadmap: "Fifteen issues … Four issues are marked `decision-needed` because they are genuinely contested rather than merely undecided." So by the plans' own count, 8 of ~40 actions need a decision and the rest need a signature — yet Phase 0 gates everything in both repositories on all of them.
- **asserted consequence:** Epic 1 in both roadmaps is the gate on every other epic, and it is currently ~1,800 lines of pre-written ADR bodies to read and ratify. That is the largest single serial block on the critical path, and most of it is a rubber stamp. Worse, a large ADR set has a maintenance cost that compounds: the number allocation has already collided twice (both rounds claimed 0017–0024; rubricator's §7 ADR has no number at all because 0009–0019 are taken), and findings-visualisation §9 Q6 still points at "ADR-0023" meaning the pre-renumbering matrix-accessibility ADR — a cross-reference that is now wrong and that the allocation decision explicitly did not plan to sweep.

Specific consolidation — comparanda, 13 new → 8:
• **0017 splits, then shrinks**: 0017a schema authoring + registries (Tier 1); the view framework moves to Phase 3 (finding above). Net still 2, but only one is Tier 1.
• **0020 (two kinds of weight) merges into 0018**. It is a field-naming rule on the criterion, `substitutionWeight` is invalid without 0018's `range`, and its whole Decision is four sentences. One decision: what a criterion declares.
• **0027 + 0028 + 0029 merge into one accessibility ADR** (finding above). 3 → 1.
• **0024 (rater dot strip) merges into the 0010 amendment**. It is an encoding registration; ADR-0003 decision 2 exists precisely so that a new encoding costs no ADR. Its own draft says so: "Adding it costs an encoding registration, not a schema change".
• **Keep separate and unmerged**: 0018 (criterion declaration), 0019 (dominance), 0021 (disclosure — reduced per the finding above), 0022 (agreement), 0023 (rounds — reduced), 0025 (seriation), 0026 (the view set and the declines).

Specific consolidation — rubricator, 12 new → 8:
• **0010 (determinism boundary) + 0019 (aix facade + import test) merge.** 0019 is the enforcement mechanism for 0010's rule; separating the rule from its teeth is how the rule erodes, which is the exact failure 0019 exists to prevent.
• **0014 (locator profile) + 0015 (source type, stance, derived-from) merge.** Both specify one object — the evidence reference — and both land in comparanda as one request (register entry #5).
• **0011 (scoring protocol) + 0018 (variance policy per runtime) merge.** 0018 is 0011's budget; 0011 already carries budget content (the repeat reduction rule), and splitting them is why the escalation-threshold contradiction above exists.
• **0016 (criteria revisable) + the unnumbered ADR-0005-step-4 ADR merge.** Both are "what the confirmation checkpoint is": 0016's whole content is that step 4 is a gate that opens both ways.
• **Keep separate**: 0009 (host framework), 0012 (scales and the two uncertainties), 0013 (structured output subset), 0017 (durable partial documents).
- **proposed action:** Adopt the consolidation above — 25 new ADRs become 16 — and change how Phase 0 is executed: ratify the uncontested drafts in one PR as `accepted` with no line edits, and spend the settlement effort on the eight `decision-needed` items plus the six substantive findings in this report. Before deleting either PENDING-ACTIONS.md, move the two things in it that are not ADR content to the research ledger: the unverifiable-source caveats ("No ADR should quote either") and the number-allocation record. And sweep findings-visualisation's internal ADR cross-references in the same pass as the renumbering, since the allocation was chosen to protect the terminology round's cross-references and therefore breaks the visualisation round's.

</details>

<details><summary><b>[worth-fixing]</b> ADR-0015's coverage gate names an aggregate that has no algorithm, and the findings behind it commit to a full stochastic acceptability analysis the draft does not mention</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 1 item 8, clauses (d) and (h); against docs/research/findings-terminology.md §3.2
- **claim:** Amendment (d): "Add the **coverage gate**: point aggregate at 100% weight coverage, interval aggregate down to 2/3 [49], dominance and completeness only below that." Nothing in the ADR or the findings defines what an "interval aggregate" is, how a weighted sum with 2/3 of its weights becomes an interval, or what the view shows. Amendment (h) says only "Sensitivity analysis must include an **add/remove-an-alternative** perturbation [28, 91]", while findings-terminology §3.2's verdict table commits to something much larger: "**Yes, both**: closed-form weight-flip margin [33] and Monte-Carlo rank acceptability — the acceptability index and central weight vector are SMAA's [35], the per-rank indices are SMAA-2's [37]".
- **asserted consequence:** Two failures in opposite directions inside one amendment. "Interval aggregate" is a wish: no algorithm, no data shape, no acceptance test, sitting inside a Tier-1 amendment that Phase 2 is supposed to implement. Monte-Carlo rank acceptability is the reverse — a fully-specified method that is far too much: SMAA-2 samples the weight space and reports per-rank acceptability indices and central weight vectors, for a tool whose position is that "In a basic form of MCA this performance matrix may be the final product of the analysis" and whose roadmap lists weighted aggregation as cut #2. Building SMAA for an opt-in feature that is second on the chopping block is the clearest over-build in comparanda's plan; and the ADR draft and the findings disagree about whether it is in, which means whichever is read last wins.
- **proposed action:** In the amendment, (1) either define the interval aggregate in two sentences (lower bound = missing weights contribute their range minimum, upper = maximum, reported as a band with the coverage fraction) or delete the 2/3 tier and let the gate be binary: point aggregate at full coverage, dominance and completeness otherwise; (2) state explicitly that sensitivity in v1 is the closed-form weight-flip margin plus add/remove-an-alternative, and that SMAA/SMAA-2 rank acceptability is **declined for v1** with the reason — otherwise the findings table stands as an unrebutted commitment.

</details>

<details><summary><b>[worth-fixing]</b> The disagreement analysis is specified as 'Polis-style group-informed consensus' with no algorithm, and the obvious implementation is the method ADR-0025 rejects outright</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md item 22 (ADR-0011 amend), clause (f); against Tier 2 item 12 (draft ADR-0025)
- **claim:** Clause (f) in full: "Frame the disagreement *analysis* as Polis-style **group-informed consensus** [85, 95] — what do people who disagree elsewhere nonetheless agree on — distinct from the disagreement *glyph*." That is the whole specification: no clustering method, no input shape, no output shape, no acceptance test, no phase. Draft ADR-0025, on the same data with the same missingness: "**The eigen-based families — spectral, metric MDS, PCA — are rejected outright**, not on speed but because missing values can cost the similarity matrix its positive semi-definiteness [8], and ADR-0009 guarantees missing cells."
- **asserted consequence:** Group-informed consensus requires first partitioning raters into opinion groups; Polis does that with PCA followed by k-means over a sparse vote matrix. So the one clause that names the analysis implies precisely the algorithm family that a sibling ADR in the same pending file rejects, for a reason (guaranteed missing cells) that applies identically here. As written, an implementer either builds the rejected thing or has nothing to build. It is also a new analysis family — rater clustering — arriving as a single bullet inside an amendment to a Phase-4 ADR, with two citations and no cost estimate.
- **proposed action:** Cut clause (f) from the v1 amendment and record it as an open question in the research ledger, phrased as the real question: "can opinion groups be identified over a 22×12 ordinal matrix with 2–5 raters and guaranteed gaps, without an eigen decomposition?" If it is kept, it needs its own ADR with an algorithm that survives ADR-0025's own objection, and a note that the rater counts this project assumes (2–5, per findings-terminology §9 Q12) are an order of magnitude below what Polis-style clustering is built for.

</details>

<details><summary><b>[worth-fixing]</b> The ADR-0006 amendment re-conflates the three persistence targets that ADR-0006's own Context separates</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md Tier 2 item 10, against docs/adr/0006-persistence-stores-and-view-state.md Context and Decision
- **claim:** The amendment: "There is no key-value 'zodal store'. `@zodal/store` provides `DataProvider<T>` (collection CRUD). Restate the port in those terms and model the analysis as a degenerate one-item provider … Keep the fallback chain, the feature-detected `localStorage` write, the visible in-memory notice and the migration harness unchanged; **only the port's shape is wrong**." ADR-0006's Context opens: "Three quite different things need persisting, and conflating them is a common failure: 1. **the analysis** … Shared, authored, versioned. 2. **view state** … Per-user, per-device, ephemeral, changes constantly. 3. **saved views** …", and its Decision resolves the fallback chain in key-value terms: "`localStorage`, if available and writable (feature-detected by attempting a write) … an in-memory object".
- **asserted consequence:** "Only the port's shape is wrong" understates it. If the single port becomes collection CRUD, then view state — per-user, ephemeral, written on every drag — must be expressed as a collection provider over a key-value backing, and the localStorage adapter has to implement collection semantics it does not have. That is not a restatement; it is the conflation ADR-0006's first paragraph warns against, arriving from the other direction. The cost lands in Phase 2 ("the `DataProvider` ports and the fallback chain" is roadmap epic 6) as adapter code nobody budgeted, and it makes the cheapest, most-exercised write path in the product the most ceremonious.
- **proposed action:** Amend ADR-0006 to name **two** ports, not one: `DataProvider<Analysis>` (collection CRUD, the shared authored document, versioned, conflict-checked per ADR-0011) and a key-value `ViewStateStore` (per-user, ephemeral, last-write-wins, the localStorage/in-memory fallback chain unchanged). Saved views sit with view state until someone shares one, at which point they move. Keep the `getCapabilities()` addition — that part of the amendment is right and is the graceful-degradation mechanism ADR-0013 asks for and does not name.

</details>

<details><summary><b>[worth-fixing]</b> rubricator's scoring ADR names its escalation thresholds as evaluation's first tuning target while declining to build the thing they gate</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md item 5 (draft ADR-0011), and item 12 (ADR-0008 amend); findings-method.md tool 19
- **claim:** Draft ADR-0011: "**Pairwise is not the default and is not built in v1.** It may be escalated per criterion only under *all* of: evidence coverage ≥ 70% (hard veto), decision relevance, and compression or instability … **The escalation thresholds are reasoning, not evidence, and are the first thing ADR-0008 tunes.**" Tool 19 `fit_bradley_terry` is marked "**cut / defer**" and the roadmap's cut list puts it at #1: "Both are already marked cut-first in the research. Pairwise is an escalation that is not built in v1 at all."
- **asserted consequence:** The evaluation suite cannot tune a threshold that gates a code path that does not exist. Either the escalation ladder is built (in which case it is not cut #1 and the tool count is not 19-minus-2) or the thresholds are not evaluation's first tuning target (in which case ADR-0008's amendment inherits a priority that is wrong). Left as written, the first person to work Phase 4 will look for the tuning target named as first and find nothing, and the four-condition ladder — three of whose conditions are individually unspecified ("decision relevance", "compression", "instability") — sits in an accepted ADR as unexecutable specification.
- **proposed action:** Delete the escalation ladder's thresholds from ADR-0011's Decision and keep only the prohibition that earns its place: pairwise is not the default, and forced choice "manufactures a winner where the judge's own scalar reading contains no significant difference", which is the finding worth freezing. Record the ladder as a design sketch in the research ledger, to be specified if and when pairwise is built. Correct ADR-0008's amendment to name a tuning target that exists — the fuzzy-match threshold in the citation ladder is the obvious candidate and is already flagged as "reasoning, not evidence".

</details>

<details><summary><b>[worth-fixing]</b> The citation ladder's last three steps are the product's non-cuttable tool and are the least specified thing in either repo</summary>

- **where:** rubricator: docs/adr/PENDING-ACTIONS.md item 9 (draft ADR-0014), and findings-method.md tool 13; against docs/adr/PENDING-ACTIONS.md item 2 (draft ADR-0010)
- **claim:** Draft ADR-0014: "**Citation checking is a deterministic eight-step ladder**: normalise (versioned) → resolvability → exact containment → bounded-edit-distance containment → drift classification → span-size sanity → numeric-claim agreement → polarity trap." Tool 13 is marked "**13 is not cuttable** — it is the product." Draft ADR-0010: "**No in-tool model calls of any kind, and no embedding calls** … **Retrieval is lexical**: BM25 plus normalised substring matching". Nothing anywhere defines the polarity trap, the numeric-claim agreement rule, or what verdict either produces.
- **asserted consequence:** Steps 1–5 are string algorithms with obvious implementations and obvious tests. Steps 7 and 8 are not: "does this justification's numeric claim agree with the span" requires number extraction, unit handling and comparison semantics, and "polarity trap" — detecting that a span says the opposite of what the justification claims — is a natural-language inference problem that ADR-0010 has just forbidden the only reliable tool for. A deterministic negation detector is a lexical heuristic with a false-positive rate, and a false positive here downgrades a correct citation on the tool's own authority, in the one tool declared non-cuttable. It will be built anyway, under time pressure, by someone who reads "eight-step ladder" as a settled specification.
- **proposed action:** In ADR-0014, mark steps 6–8 as **advisory flags, not verdict-bearing steps**: they may add a `flags[]` entry that a human or the model reads, and they may never move a reference's graded verdict. Specify the v1 ladder as steps 1–5 producing the verdict, and state the reason in the Consequences — a deterministic polarity check is a heuristic, and letting a heuristic downgrade a verified citation is the same class of error as letting a model write the verdict, which the ADR already forbids ("the verdict field is **written by the tool and never by the model**").

</details>

### Gaps and stale content

<details><summary><b>[blocking]</b> rubricator's agent guide and README still instruct the next agent to build on the framework the research rejected</summary>

- **where:** rubricator: CLAUDE.md § "Local ecosystem"; rubricator: README.md § "Two ways to run it"; contradicted by rubricator: docs/research/findings-method.md §6 and §7.5, docs/research/sections/r7-local-ecosystem.md § "Bottom line", and docs/adr/PENDING-ACTIONS.md §1
- **claim:** CLAUDE.md: "`aw_agents` is the declarative agent framework to build the deployed runtime on — find it in the local package ecosystem and read it before designing. `oa` and neighbours may already have the LLM access patterns you need." README.md: "**As a deployed agent.** ... Python, built on the `aw_agents` family — write the agent once, deploy to several platforms."
- **asserted consequence:** These are the two documents nobody chooses to read: CLAUDE.md is loaded automatically into every agent session in this repo, and README.md is the public front page. The research settled the opposite — PENDING-ACTIONS.md §1 records that `aw_agents`' MCP adapter "registers exactly `list_tools` and `call_tool`", cannot serve prompts or resources, and "contains no model client, loop, session or streaming, so it does not supply the deployed runtime ADR-0004 assumed" — and r7 additionally recommends "do not depend on `oa`". Issue #12, which lands ADR-0009, has a four-item "Done when" list and neither file is on it. The concrete cost: the next fresh session reads CLAUDE.md, goes and reads `aw_agents`, and spends a session re-deriving a conclusion already written down; and a public reader is told the deployed runtime is built on a framework that was explicitly rejected.
- **proposed action:** Add both files to issue #12's "Done when". CLAUDE.md's "Local ecosystem" section should read: the MCP surface is built on the official MCP Python SDK v2 / FastMCP 4; all model access in the deployed runtime goes through the local `aix` facade and nothing else; `aw_agents` was read and rejected as host (ADR-0009) and `py2mcp` is a candidate only on the CLI/OpenAPI line; do not depend on `oa`. README.md's deployed-agent paragraph should drop the `aw_agents` sentence entirely rather than name a replacement — the README should not carry a framework claim that an unsettled ADR owns.

</details>

<details><summary><b>[blocking]</b> The missingness rename cannot be settled the way both repos say it must be settled — the stated experiment is forbidden by the stated rule, and the gate requires the answer first</summary>

- **where:** comparanda: docs/research/README.md § "Open questions" (Gates a schema decision) vs docs/cross-repo-coordination.md §7.1 and §1 Gate 2a
- **claim:** The ledger's settling mechanism: "Is renaming `unknown` worth the churn on an accepted, published code set? | rename | writing both code sets into `rubricator`'s prompts, running one real analysis each way, counting reaches for the catch-all." The coordination document's rule: "`rubricator` must not write a code literal into a prompt, an ADR or a metric name before that disposition is recorded." And Gate 2a: the ADR-0009 amendment is one of the "six field-shaping Tier 1 entries" that must be settled to close intake.
- **asserted consequence:** The only experiment either repo proposes for the one open question both roadmaps flag as "needs a human" and "the largest un-tracked cross-repo cost" requires writing both code sets into rubricator's prompts — which §7.1 forbids until the disposition exists, and the disposition is what the experiment was supposed to inform. Gate 2a closes on the decision, so the loop has no entry point. In practice this resolves itself the bad way: somebody decides by fiat under schedule pressure, the interim position ("rename") ships unexamined, and the churn lands on rubricator's prompts and metric names anyway — which is the exact cost the ADR-0009 amendment cites as its reason to decide now.
- **proposed action:** Break the loop explicitly in comparanda #15 and rubricator #109. Either (a) carve out the experiment: state in §7.1 that a single throwaway prompt pair, in a scratch file outside `docs/prompts/`, is exempt from the no-literals rule for the express purpose of settling the rename, and name the file; or (b) drop the experiment and decide on the argument already recorded — the HL7/FHIR branch-root collision for `unknown`, and the fact that `not-evidenced` is a new distinction rather than a rename — and say in the ADR that it was decided on argument, not on measurement. (b) is cheaper and honest; what is not acceptable is leaving on the books a settling mechanism the rules make unexecutable.

</details>

<details><summary><b>[expensive-later]</b> Eleven working-note sections across the two repos still recommend what their own findings documents overturned, and not one carries a correction note</summary>

- **where:** rubricator: docs/research/sections/{r2,r3,r5,r6,r7}.md and docs/prompts/README.md; comparanda: docs/research/sections/{c1,c2,c3,c4,c6,c8}.md
- **claim:** Both research READMEs promise the opposite. rubricator: docs/research/README.md — "each carries its own evidence grade, its own citation audit and its own open questions, and each is written to be readable alone." comparanda: docs/research/README.md — "**Sections stay as the evidence of record.** ... when a claim needs its full chain, read the section it came from." A file that is readable alone and is the evidence of record must not silently carry a superseded recommendation.
- **asserted consequence:** The findings documents' §7 "Conflicts resolved" sections name these files and, in three cases, call their text "wrong" (rubricator §7.1), "precisely wrong" (§7.7) and "wrong on one word" (§7.6) — but the corrections live only in the synthesis. A reader who opens the section first, which is exactly what the READMEs tell them to do when they want the full chain, gets the overturned answer with a **strong** evidence grade attached. This already bites: issue #12 cites `sections/r7-local-ecosystem.md` as the evidence for building on the official MCP SDK, and r7's own "Recommended ADR actions" table says "Build on `py2mcp`/FastMCP" and "ADR-0004 | **amend**" — both reversed by findings §7.5 and §7.8. Two of these corrections are owned by issues (#26 and #73, both only for the `score-column` line); the other nine are owned by nobody.
- **proposed action:** Put a dated block at the top of each affected section: "**Correction (date).** This section's recommendation on X was superseded by `findings-*.md` §N. The evidence below stands; the recommendation does not." Specifically — **r7**: bottom line + ADR-actions table + the ADR-0004 draft amendment → superseded by findings §7.5 (official MCP Python SDK v2 / FastMCP 4, because FastMCP 4.0.0 is the first release with `InputRequiredResult` elicitation and py2mcp pins `fastmcp` unbounded to 3.x) and §7.8 (supersede, not amend); py2mcp survives only on the CLI/OpenAPI line. **r6**: the prompt table's "`score-column` ... 5 — **the default**, per the sibling scoring-order research" → §7.1, and note the attribution is a misreading, the sibling document recommends cell-wise; tool 14's `criterion_correlations` as "the post-hoc evidence of the double-counting" → §7.7, it is a `traversal_leakage_diagnostic` and never a redundancy finding. **r5** §2.2: "Late Chunking [24] is the model-free alternative and should be the default for the connector path" → §7.6, an embedding model is a model; offline corpus-prep only. **r3**: "`stability` — **NEW, and it must be a separate field**" → §7.2, stability is derived, not stored. **r2** ADR-actions table: "ADR-0006 | amend ... Mechanically this means a superseding ADR" and the second proposed new ADR "Calibration and confidence-quality metrics" → §7.4 and §7.9. **docs/prompts/README.md**: the `score-column` row → §7.1. **c2** §B.6: `certainlyDominates` → Conflict A renames it `necessarilyDominates`; the drop-a-criterion-when-one-side-is-`not-applicable` rule → Conflict G forbids it; `range: {lo, hi, direction}` → Conflict F deletes `direction` from `range`; `pending`/`unknown` literals → Conflict C; and c2's own proposed new-ADR text still uses the old relation names. **c3** §3.3: the same drop rule → Conflict G. **c4** §5 alpha table: the `pending` and `unknown` rows → Conflict C's renamed set plus a separately-counted `not-evidenced`. **c1**: "the `pending` missingness code should be the agent's output for 'high leverage, needs investigation'" → Conflict C, too coarse under the renamed set. **c6**: "Evaluate `lineupjs`" → visualisation §7.3 declines it as a dependency; the hatch-density proposal → §7.6. **c8**: "`Alt`+arrows" → §7.2, never bare `Alt+Arrow`; "adopt no drag library" → §7.1's split resolution. Add to all twelve the line that today exists only in `PENDING-ACTIONS.md`: "ADR numbers appearing in this file are not reserved."

</details>

<details><summary><b>[expensive-later]</b> 86 of rubricator's 111 issues carry unresolved template placeholders where the dependency links should be; comparanda's carry real issue numbers</summary>

- **where:** rubricator: GitHub issues (86 of 111 bodies contain `{{`), vs comparanda: GitHub issues (0 of 119); rubricator: docs/ROADMAP.md preamble
- **claim:** rubricator #49 ends "**Depends on** — {{adr-0013-structured-output}}, {{adr-0010-determinism-boundary}}"; #61 "{{epic-cross-repo-schema-requests}}, {{store-partial-analyses}}"; #85 "{{connector-end-to-end-public-corpus}}". comparanda #105 ends "**Depends on** #99, #100, #101, #102, #103, #104, #28." ROADMAP: "**The GitHub issues are the live source of truth.** This file is the map."
- **asserted consequence:** 69 distinct unresolved keys across 86 issues, and no key-to-number mapping is committed anywhere in the repository. The map's edges are dead text: GitHub renders no link, closes no dependency, and surfaces no blocker, so the ordering the roadmap relies on ("ordered by how much downstream work each unblocks") exists in no machine-readable form. If whatever tooling held the key table is gone, reconstructing 69 references across 86 issues is a manual pass over the entire backlog. The asymmetry with comparanda, whose issues resolved cleanly, shows this is a rendering step that failed rather than a deliberate convention — which also means nobody noticed.
- **proposed action:** Run one substitution pass from `{{key}}` to `#N`, resolving keys against issue titles, and commit the key-to-number table under `docs/` so the pass is repeatable. Add a guard to whatever creates issues that refuses to post a body still containing `{{`. While doing it, correct the roadmap's "Fifteen issues" for epic 1 — it is sixteen since #110 was added — and add #110 and #111 to the epic descriptions that should own them.

</details>

<details><summary><b>[expensive-later]</b> The four analysis-workflow artifacts are scheduled twice, as two different kinds of thing, and rubricator's own agent guide already decided against the version that got the issue</summary>

- **where:** rubricator: CLAUDE.md § "Dev skills" vs issue #85, docs/research/method.md §6, docs/research/README.md open question 17 (R38), and prompt issues #75 and #77
- **claim:** CLAUDE.md: "These are for the agent *building* rubricator, not for end users. (End-user skills — run an analysis, add a criterion, re-score a column, audit an existing analysis — ship as MCP prompts instead; see ADR-0003 and ADR-0007.)" Issue #85: "Write the four analysis-workflow dev skills ... Follow the local dev-skills conventions and the `{project}-dev-` naming prefix."
- **asserted consequence:** CLAUDE.md is right and #85 is wrong, and the reason is R36 — the finding that the prompt bundle and the MCP server are **one** artifact, which the ADR-0007 amendment adopts: "Claude clients surface MCP prompts as slash commands and resources as `@` mentions, so this is one artifact: there is no separate prompt bundle to build, package or keep in sync." A shipped skill telling a user's agent how to run an analysis end to end is precisely the second artifact that finding abolished. Worse, two of the four are already scheduled as prompts — #77 `run-analysis` ("the end-to-end orchestration prompt") and #75 `audit-existing` ("find the weaknesses in an analysis someone else made") — so #85 duplicates them, in a later phase (labelled `phase:3-connector` while the prompts are `phase:2-prompts`), with no cross-reference either way. Building both means two files per workflow, drifting, and the skill copy sits outside the evaluation gate: `rubricator-dev-prompt-change` binds only `docs/prompts/`.
- **proposed action:** Close #85 and replace it with two prompt issues, because only two of the four workflows are genuinely missing. **`add-criterion`** — add a criterion to an existing analysis; it is the user-facing half of the ADR-0016 criteria-revisability draft and must carry its invalidation rule (cells scored under the old definition become `missing` with reason `not-assessed` plus a note naming the version). **`rescore-criterion`** — re-score one criterion against new evidence; it is the connector's value-of-information re-scoring path and must state whether the prior is withheld. Both belong in `docs/prompts/` beside the other ten, under `phase:2-prompts`, where the prompt-change skill's evaluation gate covers them. Fix the vocabulary at the same time: CLAUDE.md and `method.md` §6 both say "re-score a **column**", naming the traversal mode ADR-0011 demotes — the unit is a **criterion**. Update open question 17 to record the resolution rather than leaving it as an open ask for four skills.

</details>

<details><summary><b>[expensive-later]</b> Nobody owns the version handshake, and the one issue that touches it declares a range where the canonical document mandates a set</summary>

- **where:** rubricator: issue #61 vs comparanda: docs/cross-repo-coordination.md §3.3 and §5; rubricator: docs/adr/0002-separation-from-comparanda.md
- **claim:** Issue #61 "Done when": "The emittable schema-version **range** is declared in package metadata, per ADR-0002's coordination rule." Coordination §3.3: "**`rubricator` declares a set, not a range** — an explicit module constant such as `EMITS = {"1.0", "1.1"}`. A set, because a range silently claims a version nobody tested." §5: "if `rubricator` declares a version **range** rather than a set, a MINOR-additive `comparanda` release makes `rubricator` start emitting fields that an older `comparanda` build silently drops on load. No error is raised anywhere, and the missing data is discovered by a reader noticing a blank cell."
- **asserted consequence:** The coordination document names this failure by name, in a section titled "Failure modes if the gates are ignored", and the acceptance criterion of the only issue implementing it specifies the failing variant. Beyond the word: a search of all 111 rubricator issues finds nothing owning the rest of §3.3 — vendoring each `EMITS` version's JSON Schema pinned by content hash (required because "the connector must work with no network"), serving them through `rubricator://schema/comparanda/{version}` (issue #66 fixes the resource *contract* and explicitly scopes serving elsewhere), the rule that rubricator emits the *lowest* version that expresses the analysis, and the scheduled CI job that compares the vendored set against published `latest` and "warns; it never fails a build". ADR-0002 makes the declaration a requirement of the only coupling between the two repos, so the contract's compliance mechanism has no owner.
- **proposed action:** Change #61's bullet to "the emittable schema-version **set** is declared as an explicit module constant, per coordination §3.3; a range is specifically forbidden and §5 says why." File one further issue — "The version handshake: vendored schemas, `EMITS`, and the drift job" — covering content-hash pinning, the lowest-version-that-expresses rule, serving the vendored files through the schema resource, and the warn-only scheduled comparison against `latest`. Attach it to #111, which already claims "The facade exposes the supported-version declaration required by ADR-0002" without owning the mechanism behind it.

</details>

<details><summary><b>[expensive-later]</b> The shared vocabulary SSOT still defines the old missingness codes and is in no rename issue's scope</summary>

- **where:** comparanda: docs/domain-model.md § "Missingness" and docs/adr/0009-missingness.md; comparanda issue #15; rubricator issue #109
- **claim:** ADR-0009 delegates the list: "The initial set — `not-applicable`, `not-assessed`, `pending`, `unknown`, `withheld` — is defined in [../domain-model.md]." domain-model.md still carries all five with their definitions. comparanda #15's four "Done when" boxes are all about the ADR body and none names domain-model.md; rubricator #109's "Where it lands here" lists only rubricator files.
- **asserted consequence:** Both CLAUDE.md files point at `docs/domain-model.md` as the vocabulary both repositories must write in, and rubricator issue #111 says the schema sketch records "the domain-model version it was derived from". Amending ADR-0009 without amending domain-model.md leaves the ADR pointing at a file that contradicts it, in the one document whose entire job is to stop the two repos meaning different things by the same word — and the sketch, the prompts and the `rubricator://missingness-codes` resource (issue #66) all derive from it. Cheap to fix at the same time and currently impossible: domain-model.md carries no version and no date, so "the domain-model version it was derived from" is unstateable.
- **proposed action:** Add to comparanda #15's "Done when": "`docs/domain-model.md` § Missingness carries the six-code core table with the `structural` and `terminal` flags and the `broader` parenting, and ADR-0009's delegation still resolves." Add `rubricator://missingness-codes` (issue #66) to rubricator #109's "Where it lands here" — it is a resource that literally serves the code set and is absent from the sweep list. Give domain-model.md a version line and a date so the sketch can cite it.

</details>

<details><summary><b>[expensive-later]</b> PENDING-ACTIONS.md is scheduled for deletion and is the only home of the do-not-cite caveats</summary>

- **where:** comparanda: docs/adr/PENDING-ACTIONS.md § "Before amending ADR-0015 on the strength of a quotation", issues #36 and #37; rubricator: docs/adr/PENDING-ACTIONS.md § "Conventions" and issue #26
- **claim:** comparanda PENDING-ACTIONS closes: "Two further sources could not be reached at audit time: the data-visualisation style guide behind the texture-reservation rule (ADR-0028) and the ISO/IEC 25012 normative text (ADR-0009's completeness wording). Both arguments survive without them. **No ADR should quote either.**" Both files also instruct: "**Delete this file once its actions are applied.**" comparanda #37 is "Delete PENDING-ACTIONS.md once its actions are applied"; #36 covers the ELECTRE quotation only.
- **asserted consequence:** The two prohibitions are instructions *to the ADRs being written*, and those ADRs are ADR-0028 and the ADR-0009 amendment — neither of whose issues (#27, #15) carries the prohibition. Once #37 runs, the only record that two load-bearing sources were unreachable is gone, and the next person to strengthen ADR-0028's texture rule will reach for the style guide because nothing says not to. The same shape exists in rubricator: PENDING-ACTIONS marks the pairwise-escalation thresholds and the fuzzy-match threshold **(reasoning, not evidence)** and calls them "the first thing ADR-0008 tunes", and issue #26 deletes the file without requiring those markers to survive into ADR-0011 and ADR-0014.
- **proposed action:** Add a "Done when" box to comparanda #27 ("ADR-0028 does not quote the unreachable style guide, and records that the texture-reservation argument stands without it") and the same to #15 for ISO/IEC 25012. Add to comparanda #37 and rubricator #26: "every caveat in PENDING-ACTIONS that is an instruction to a future writer — unreachable sources, reasoning-not-evidence markers, named tuning targets — has been transcribed into the ADR it constrains, verified by naming each one." The general rule worth stating once: a file whose deletion is a scheduled task may not be the sole home of a constraint.

</details>

<details><summary><b>[worth-fixing]</b> rubricator has no public-repo-hygiene ADR, and its .gitignore already cites a number its own pending actions assign to something else</summary>

- **where:** rubricator: .gitignore, BRIEF.md § "Non-negotiables", CLAUDE.md § "Standing constraints", docs/ROADMAP.md epic 5, docs/adr/PENDING-ACTIONS.md §8, issue #47
- **claim:** rubricator's .gitignore: "# ADR-0016 pre-publish denylist: names terms from the private originating work." BRIEF.md: "Fixtures use public domains, mirroring `comparanda` ADR-0016." ROADMAP epic 5: "a **public-repo hygiene check**, mirroring the companion repo's equivalent, run in CI over code, fixtures, prompts and docs." But rubricator's `docs/adr/` holds 0001–0008 only, and PENDING-ACTIONS §8 allocates **ADR-0016** to "Criteria are revisable, and the step-4 checkpoint is a gate, not a one-way door".
- **asserted consequence:** Two defects in one place. First, the hardest constraint in the repository — a public repo that must never carry content from a private analysis — is recorded in a BRIEF, an agent guide and a .gitignore comment, and in no ADR; ADR-0001's whole premise is that decisions live in `docs/adr/`, and this one has no record, no status and no date, while comparanda's equivalent is a full accepted ADR with a decision, acceptable example domains and a CI requirement. Second, the .gitignore comment points at an ADR that does not exist, and the moment issue #19 lands it will point at the *wrong* ADR — a reader chasing "ADR-0016" from the denylist rule arrives at criteria revisability. The roadmap's "mirroring the companion repo's equivalent" has the same defect: it names a number that means two different things in the two repos.
- **proposed action:** Either write rubricator's own hygiene ADR — its content is not identical to comparanda's, since it must also cover prompts, corpus manifests and eval fixtures, and must state the licence-per-document rule coordination §4.2 requires of the corpus — or state in an ADR that rubricator adopts comparanda ADR-0016 by reference, and record the adoption. Either way, allocate the number in the same pass as issue #110, fix the .gitignore comment to name it, and change the roadmap's phrase to a repo-qualified `comparanda ADR-0016` rather than a bare number. Add the resulting ADR reference to issue #47.

</details>

<details><summary><b>[worth-fixing]</b> The three issues the roadmap reconciliation reported missing all exist; two of them cite the wrong companion-repo issue</summary>

- **where:** rubricator issues #109, #110, #111 and docs/ROADMAP.md epics 1–2 and § "The one indirection that keeps the parallelism honest"; comparanda issues #2, #4, #12, #15
- **claim:** Issue #109: "**Depends on** the companion repo settling its ADR-0009 amendment — thorwhalen/comparanda#4" — but comparanda#4 is the epic "Example datasets"; the ADR-0009 amendment is comparanda#15. Issue #110: "The companion repo has the equivalent issue (thorwhalen/comparanda#2)" — but comparanda#2 is the epic "Repository scaffolding and CI"; the number-allocation issue is comparanda#12.
- **asserted consequence:** The verification comes back negative on all three: (a) the missingness-code rename sweep is #109, (b) the ADR-number allocation is #110 — and its body reproduces the gap correctly ("item 7 settles ADR-0005 by adding a new ADR that cites it as parent, and that ADR has no allocated number, because 0009–0019 are all claimed") — and (c) the schema sketch and `SchemaSource` facade is #111, which quotes "the assumption most likely to be quietly dropped under pressure" verbatim. What is wrong is smaller and still real: the two cross-repo links are the only mechanism connecting each item to the decision that governs it, and both point at an epic rather than the deciding issue — both plausible enough that the error will not announce itself. Separately, the roadmap text reporting these as gaps is now stale: epic 1 still says "Fifteen issues", and neither #110 nor #111 appears in any epic description.
- **proposed action:** Repoint #109 at comparanda#15 and #110 at comparanda#12, and add the reciprocal link on the comparanda side so each pair is cross-linked both ways as §3.1 requires. Update ROADMAP epic 1 to sixteen issues and name the allocation issue; add #111 to the "one indirection" paragraph, which today says only "it needs its own issue". Delete or rewrite #110's closing line "this one exists because the reconciliation found rubricator had no counterpart" — it reads as a live gap to the next reader.

</details>

<details><summary><b>[worth-fixing]</b> Two ADR decisions are queued ahead of the cheap experiments the research says must precede them</summary>

- **where:** rubricator: docs/research/README.md open questions 4, 5 and 16, vs docs/adr/PENDING-ACTIONS.md §6 (ADR-0012) and issues #17, #37, #38, #42
- **claim:** Open question 4: "**Does anchoring help *LLM* judges specifically?** ... *Settled by* the cheapest experiment available — same criteria, same corpus, anchors on vs off. **Run it before writing anchors at scale.**" Open question 5: "Is 1–5 with k repeats really as good as a bare 1–10 here? The reconciliation is reasoning over two studies that measured different quantities." ADR-0012's draft decides both in advance: "**`score` is a 1–5 integer, declared ordinal, not configurable**" and "**Ordinal criteria carry required anchors at levels 1, 3 and 5 only**".
- **asserted consequence:** This is the triage the ledger's ordering hides. All seventeen rubricator open questions have issue homes (#36–#43, #50, #85, #96, #102), so none is unowned; what is mis-sequenced is these. ADR-0012 is `decision-needed` and, by its own note, overrides the owner's prior recommendation to widen to 1–10; it will be settled in Phase 0 while the ablations bearing on it sit as `phase:0-research` issues with no gate and no dependency edge to #17. Anchors are the expensive artifact — one per criterion per level, versioned by content hash — so writing them at scale before the ablation is exactly the order the research warns against, and ADR-0001 makes an accepted ADR expensive to revisit. Open question 16 is the genuinely negligent one: reference [13] (Stevens 1946) is marked "*paywalled; paraphrased from secondary summaries, not quoted*" and is the sole citation under ADR-0011's "`mean` is refused at the tool boundary" and ADR-0012's ordinal declaration — two proposed decisions resting on a source nobody in the project has read, closable by one library visit (issue #42, no `decision-needed` label, no gate).
- **proposed action:** Genuinely research, leave open: 1, 2, 3 (the isolation and traversal harness arms — no literature exists and only the harness settles them), 10, 11, 12, 13. Engineering, decide now and stop calling them research: 15 (corpus normalisation — the ledger itself says "leaving it undecided is not" an option; #50 already carries `decision-needed`), 8 (comparanda's call, already filed as comparanda#66). Cheap and decisive enough that leaving them open is negligent: 16 — verify or retire the paywalled Stevens citation *before* ADR-0011 and ADR-0012 are accepted, since both rest on it; 7 — the client-capability probe, one afternoon, which the roadmap already says decides whether the checkpoint fallback matters at all; 4 and 5 — run both ablations before #17 is settled, or accept ADR-0012 with an explicit clause naming the two ablations as its falsification tests and a review date, so the decision is provisional in writing rather than by hope. Add a dependency edge from #17 to #37 and #38 either way.

</details>

<details><summary><b>[worth-fixing]</b> docs/prompts/README.md lists seven prompts; the settled set is ten, and the issues that correct it fix only one line</summary>

- **where:** rubricator: docs/prompts/README.md § "Expected set", vs comparanda: docs/cross-repo-coordination.md §2.2 item 6 and rubricator issues #67–#77, #26, #73
- **claim:** The README's table has seven rows: `frame`, `enumerate-alternatives`, `propose-criteria`, `score-cell`, `score-column`, `review`, `audit-existing`. The coordination document specifies ten: "`run-analysis`, `frame`, `enumerate-alternatives`, `propose-criteria`, `confirm-frame`, `score-cell`, `score-column`, `review`, `audit-existing`, `resume`." Issues #71, #76 and #77 exist for the three missing ones.
- **asserted consequence:** The README is the inventory a reader consults to learn what the prompt layer is, and it omits the two prompts carrying the load-bearing behaviours: `confirm-frame`, the chat-side half of the ADR-0005 step-4 checkpoint the BRIEF says must never be removed, and `resume`, one of the three resumption surfaces the durable-partial-analysis ADR requires. Both correcting issues (#26 and #73) name only the `score-column` line in their "Done when", so applying them leaves the inventory three rows short — and once `PENDING-ACTIONS.md` is deleted and the findings document recedes into history, this README is what the next person believes.
- **proposed action:** Add to #26's "Done when": "`docs/prompts/README.md`'s table lists all ten prompts, including `run-analysis`, `confirm-frame` and `resume`, each with its ADR-0005 stage." While editing, replace the `score-column` row's job description with its demoted role ("harness arm 2 and a cheap mode; not the default — see ADR-0011") rather than merely deleting the offending clause, so the demotion is visible rather than silent.

</details>

<details><summary><b>[worth-fixing]</b> examples/README.md is the declared authority on the messy fixture, is stale in six places, and no issue updates it</summary>

- **where:** comparanda: examples/README.md, docs/ROADMAP.md §4, issue #59
- **claim:** ROADMAP §4: "`examples/README.md` is the authority on that list and is currently **stale in two places**" — "all five missingness codes" (six after the ADR-0009 amendment) and "a criterion marked as a veto with a threshold" (the field is renamed `acceptability`). Issue #59 then adds four more requirements the README does not carry: "a `target` criterion; at least one `withheld` cell plus one disclosure-projected read; two rounds with different attribution policies; and at least one cell whose assertions come from repeated draws of one agent rather than several raters, so `independence` is exercised."
- **asserted consequence:** The roadmap says to "update that file in the same pass as the ADRs" and then files no issue to do it; #59 works around it instead, so the stated authority and the implementation now disagree in six places rather than two. Not cosmetic: the `target` criterion is the stated settling mechanism for one of the six schema-gating open questions ("Dominance over a `target` criterion needs a distance metric ... settled by writing the messy example with a target criterion and seeing what the report can honestly say"). If anyone builds the fixture from the README rather than from #59, the open question silently fails to be settled by the artifact meant to settle it.
- **proposed action:** Add a "Done when" box to comparanda #59: "`examples/README.md` has been updated to match this issue's list, so the two do not disagree" — or invert the ownership, making #59's list authoritative and the README a pointer. Either is fine; leaving two documents claiming the same job is not.

</details>

<details><summary><b>[worth-fixing]</b> Neither public repository has a contributing guide, a security policy, or an ADR index</summary>

- **where:** comparanda: repository root and docs/adr/; rubricator: repository root and docs/adr/
- **claim:** Both roots hold only `BRIEF.md`, `CLAUDE.md`, `LICENSE`, `README.md`, `docs/`, `skills/` (plus `examples/` in comparanda). There is no `CONTRIBUTING.md`, no `SECURITY.md`, no `CODE_OF_CONDUCT.md`, no `.github/`, no `CHANGELOG.md`, and `docs/adr/` has a `0000-template.md` but no index. No issue among the 230 across the two repos covers any of them.
- **asserted consequence:** Both are public repositories under Apache-2.0, both intend to publish (npm and PyPI), and both are about to grow from 16 and 8 ADRs to roughly 29 and 20. Three consequences. (1) The ADR set becomes unnavigable exactly when the number allocation lands — 29 files whose numbers were reassigned mid-flight, with no index mapping number to title and status, is the condition under which people stop reading ADRs. (2) The rules most needing to be told to a newcomer are the socially-enforced ones — comparanda's "no self-registering modules", "no DOM in core", "never colour alone"; rubricator's "no tool may require a model" — and they live in CLAUDE.md, addressed to an agent, and in ADRs a drive-by contributor will not read; comparanda's own ADR-0029 draft rejects "a checklist in the contributing guide", which presupposes one exists to reject it from. (3) A security policy matters more than usual here: the pre-publish denylist is the mechanism protecting a private analysis, and there is no stated route for reporting that something leaked — the one report these repos most need to receive quickly.
- **proposed action:** Add three short files to each repo's Phase 1 scaffolding epic (comparanda #2/#38, rubricator #5/#44). `CONTRIBUTING.md`: how to run the checks, that ADRs are immutable and how to propose a change, and the three or four rules that fail a PR on their own — pointing at the ADRs rather than restating them. `SECURITY.md`: a private reporting route, plus "if you believe content from a private analysis has been published here, report it privately first". `docs/adr/README.md`: a table of number, title, status and superseded-by, written as part of the number-allocation pass (comparanda #12, rubricator #110), which is the only moment it is cheap.

</details>

---

## Refuted — recorded so they are not raised again (21)

Each of these looked like a defect and was broken by a skeptic that read the full text. The
refutation is the valuable part.

<details><summary>"Human and machine assertions distinguishable at a glance" has no mechanism, and the two non-colour channels that could carry it are spent by ADR-0028</summary>

- **claimed:** ADR-0012: "Human and machine assertions must be distinguishable at a glance — a reader deciding how much to trust a score needs to know whether a person or a model asserted it. This is not an afterthought; it is a primary requirement of the whole system." PENDING-ACTIONS §26: "ADR-0012 was not examined by this research round and carries no recommendation."
- **claimed severity:** blocking · lens: The honesty guarantee

**Why it was refuted**

> Quotations are accurate, but every causal claim that makes the finding blocking is contradicted by the files. (1) "The whole visualisation round designed the cell without ever consulting the ADR" is false: PENDING-ACTIONS.md:340 rejects an alternative because it "Destroys attribution, which ADR-0012

</details>

<details><summary>The rater dot strip renders five draws of one model identically to five human raters; `independence` is stored and nothing consumes it</summary>

- **claimed:** cross-repo-coordination.md §7 request 4: "`independence` is the most important field in this table" — its stated purpose (§5.1) is that "Five draws of one model must never render as five raters." New ADR-0024: "K fixed slots across the cell, one filled dot per assertion at its level, ties stacked … `n` is **countable** rather than encoded … its text alternative is the exact multiset."
- **claimed severity:** blocking · lens: The honesty guarantee

**Why it was refuted**

> The quotes are accurate, but two load-bearing factual premises are false, and both are the ones that carry the "blocking" severity.
>
> **(1) "rubricator does not compute or display the statistic; comparanda does" — false.** rubricator's tool table entry 15, `stability_report` (`<path removed>

</details>

<details><summary>`check_citations` verifies that a quote exists, not that it supports the claim — and locator success is the licence for `confidence: high`</summary>

- **claimed:** r5: `check_confidence_consistency` — "high confidence requires >=1 EvidenceRef with sourceType in {primary, secondary} AND verdict in {exact, normalised}". ADR-0006 defines high as "directly supported by cited source". The ladder's own step 7 is "a lexical overlap floor used *only* as a weak on-topic signal, with the docstring stating plainly that lexical overlap is not a faithfulness measure".
- **claimed severity:** blocking · lens: The honesty guarantee

**Why it was refuted**

> The finding's individual quotes are accurate, but its two load-bearing characterisations are not what the text says.
>
> **1. "Locator success is the licence for `confidence: high`" — this inverts the rule's logical polarity.** The signature is `def check_confidence_consistency(analysis: Analysis) -> t

</details>

<details><summary>A contested cell has no legal representation in the comparanda schema — three documents give three incompatible answers</summary>

- **claimed:** rubricator ADR-0011: "**No point reduction is emitted for a polarised cell** — emit the level multiset and a `contested` marker instead." r4 §A: "Two things rubricator explicitly does **not** ask for: a stored `stability` measure … and any change to `missing`. The existing reason codes are sufficient; `unknown` is what a fully-contested cell degrades to when the analysis declines to guess." comparanda ADR-0011 point 3: "What the cell *displays* is a named reduction over those assertions: `single`, `latest`, `median`, `consensus`." Request 4 asks only that "`mode` joins the reduction enum".
- **claimed severity:** blocking · lens: The honesty guarantee

**Why it was refuted**

> The finding is built on a truncated quote. It cites comparanda ADR-0011 point 3 ("what the cell displays is a named reduction over those assertions") and concludes a contested cell has no legal representation — but point 4, the very next paragraph, is that representation: "Disagreement is an encodin

</details>

<details><summary>Dominance — the flagship analysis — silently reduces multi-rater and contested cells to a point</summary>

- **claimed:** New ADR-0019: "Every cell becomes an interval. An observed value gives `[v, v]`; a contingently missing value gives the criterion's declared range …; a structurally missing value leaves the comparison altogether."
- **claimed severity:** blocking · lens: The honesty guarantee

**Why it was refuted**

> The quote is accurate and in context (comparanda/docs/adr/PENDING-ACTIONS.md, draft ADR-0019, "Decision"), and it is true that the three examples given are observed / contingently-missing / structurally-missing. Everything the finding builds on that observation is contradicted by the text, including

</details>

<details><summary>The most load-bearing new field in the plan ships with two undefined enum members, and the findings' own resolution was dropped from the ADR draft</summary>

- **claimed:** The draft ADR-0018 body says: "a **`preference`** of `increasing` / `decreasing` / `target` / `ordered` / `none`. `none` excludes the criterion from dominance, screening and the datum encoding". Only `none` is given semantics. Draft ADR-0019's exclusion list is "Nominal criteria, criteria with `preference: none`, and criteria with no declared range are excluded by construction and reported" — `target` and `ordered` appear nowhere in it. Meanwhile findings-terminology §9 open question 1 says "dominance over a target criterion needs a distance metric, which smuggles a cardinal assumption back in. Recommend shipping `target` in the schema, excluding it from strict dominance in v1", and open question 4 says for nominal-with-missing "necessary dominance is undefined and only equality is available … Needs a Phase 2 decision."
- **claimed severity:** blocking · lens: Scope, cost, buildability

**Why it was refuted**

> The finding's literal quotes check out, but every interpretive and consequential claim built on them fails against the same documents.
>
> 1. "Two undefined enum members" is false at the level of the plan. The finding reads the ADR-0018 draft body in isolation, but PENDING-ACTIONS.md states in its own 

</details>

<details><summary>Dominance over incomplete data is specified as a schema-frozen algorithm in one repo and silently re-implemented in the other, with no shared test vector</summary>

- **claimed:** comparanda draft ADR-0019: "Necessary dominance is a strict partial order … Possible dominance is not transitive and is used only as a filter, never to build a front. **The comparison basis is the set of criteria applicable to every alternative in the current scope**". rubricator's `stability_report` contract: "**Weight-free primary:** dominance survival rate per alternative, Pareto-set churn", and `report_weaknesses` returns "**pivotal** cells first (±1 flips the non-dominated set) … dominated_alternatives". rubricator's draft ADR-0018: "**The headline stability statistic is the weight-free dominance survival rate**". The cross-repo request register (cross-repo-coordination.md §7) contains seven requests; none of them is the dominance definition, and §1.4 rejects the gate "All comparanda ADRs settled before rubricator starts" on the grounds that the Tier 2/3 analyses are "invisible to `rubricator` forever".
- **claimed severity:** blocking · lens: Scope, cost, buildability

**Why it was refuted**

> The facts are granted, but the consequence chain fails at three of its four links, and the severity is wrong by the plan's own gate definitions.
>
> **1. The demo failure it predicts is already excluded by the plan.** The claimed cost is "the agent says three alternatives survived and the view shows fi

</details>

<details><summary>ADR-0021 (disclosure) puts an access-control model into a package that ADR-0012 says never authenticates anybody, and it does not survive the flagship distribution format</summary>

- **claimed:** Draft ADR-0021: "Model disclosure as an orthogonal, **view-time** property of a value, so redaction is a **projection** rather than an edit … A reader without access computes dominance over the **widened** interval (ADR-0019) and is **told**: 'computed with 3 cells withheld from you'. Two readers with different access may legitimately see different fronts." Draft ADR-0017 specifies the standalone artifact as "Vite plus `vite-plugin-singlefile`, with the analysis inlined as `<script type="application/json">`". ADR-0012: "`comparanda` never authenticates anybody … Authorisation is likewise host-supplied: the schema declares *what is editable*, the host decides *who may edit*."
- **claimed severity:** blocking · lens: Scope, cost, buildability

**Why it was refuted**

> Quotes are verbatim, but all three load-bearing interpretations fail against the full text.
>
> (1) The ADR-0012 arm inverts the source. The finding truncates the sentence it relies on. ADR-0012 in full: "`comparanda` never authenticates anybody; it consumes an identity the host asserts. … Authorisatio

</details>

<details><summary>"Evidence before score" is unenforceable as designed: the tool it names does not exist and `measures_write` is order-blind</summary>

- **claimed:** New ADR-0011: "**`extract_evidence` runs before `score_cell`, and `score_cell` receives the span, not the corpus.** … scoring-then-citing is the arrangement that produces post-hoc citation."
- **claimed severity:** expensive-later · lens: The honesty guarantee

**Why it was refuted**

> Refuted. The consequence does not follow, and two of the three premises are wrong on the documents' own text.
>
> 1. "The tool it names does not exist" mistakes step names for tool names — deliberately. The same section that lists the 19 tools states under *Deliberately absent, and why*: "No `propose_c

</details>

<details><summary>The default setting of the most important tool is the behaviour the honesty rule forbids, and the tool has two contradictory contracts</summary>

- **claimed:** r6 tool 10 signature: `on_uncited: "reject"|"downgrade"|"allow"="downgrade"` — "`downgrade` demotes to medium and says so; `reject` refuses". findings-method tool 10 contract: "enforces … *`score` present ⇒ at least one evidence ref or an explicit `missing`*", while keeping `on_uncited=downgrade` in the signature. ADR-0012 rule 1: "**No citable span ⇒ `unknown`, never a low-confidence score.**"
- **claimed severity:** expensive-later · lens: The honesty guarantee

**Why it was refuted**

> The quotes are verbatim but the reading is wrong on three independent points. (1) r6 line 462 binds the three modes to one named rule in the same parenthetical: enforces "no `confidence: high` without a verified primary span" (`downgrade` demotes to medium and says so; `reject` refuses). So `downgra

</details>

<details><summary>The `not-evidenced` / `indeterminate` split is tracked as a rename; it is actually a bifurcation of the one rule that carries the product claim, and only one branch has a trigger</summary>

- **claimed:** ADR-0009 amendment splits the old `unknown` into `not-evidenced` ("we searched and the sources are silent") and `indeterminate` ("we found material but could not resolve it to a score"), and the terminology findings say the two are respectively "a fact about the alternative and its documentation" and "a fact about the criterion definition". cross-repo §7.1 frames the consequence as "a prompt change and a metric rename" and "what makes the sweep a rename and not a redesign". rubricator ADR-0017: "`unknown` = someone looked and could not determine. That last distinction is the one the whole product rests on."
- **claimed severity:** expensive-later · lens: The honesty guarantee

**Why it was refuted**

> The quotes are real but the central characterisation is wrong on four checkable points, and one of them is exactly backwards.
>
> **1. The split is not "tracked as a rename".** `comparanda/docs/cross-repo-coordination.md` §7.1 says, in its second sentence, that the amendment "**renames two reason codes

</details>

<details><summary>Three of the research's own open questions were hardened into ADR Decisions without running the experiments that were named as the way to settle them</summary>

- **claimed:** Findings §9 Q5: "**Is 2/3 the right coverage floor for *this* domain?** The sources are a 133-economy index with 78 indicators; our matrices are ~22 × 12 … *Settled by:* a simulation over the example datasets … Cheap, and it should be run before the default is fixed." The draft nonetheless states as decision: "Add the **coverage gate**: point aggregate at 100% weight coverage, interval aggregate down to 2/3 [49]". Findings §9 Q7: "**Is renaming `unknown` worth the churn?** … *Settled by:* writing both code sets into `rubricator`'s prompts, running one real analysis each way"; the amendment states flatly "rename `pending` -> `deferred` and `unknown` -> `indeterminate`". Visualisation §9 Q9: "**Does the ordinal merge tree preserve VSUP's measured decision effect?** … *Settled by:* a small A/B"; the amendment states "adopt an **ordinal merge tree** (9 colours for 5 scores x 3 confidence levels) rather than uniform binning".
- **claimed severity:** expensive-later · lens: Scope, cost, buildability

**Why it was refuted**

> Refuted on three independent factual grounds, one of them a misquote.
>
> (1) The visualisation instance is refuted by the text the reviewer truncated. PENDING-ACTIONS.md:548-549 item 13(b) reads in full: "adopt an **ordinal merge tree** (9 colours for 5 scores x 3 confidence levels) rather than unifor

</details>

<details><summary>ADR-0023 justifies a Delphi round-management feature by a migration argument that applies to one field out of six</summary>

- **claimed:** The draft's "Why": "roughly fifteen optional schema lines now, versus a migration through every stored analysis later, because round boundaries would otherwise have to be inferred from timestamps." Its Decision then adds, in Phase 1: "a `round?: RoundId` on every assertion, plus a small `rounds` collection … an `attribution` policy: `attributed` | `blind-until-close`; a `feedback` policy: `none` | `distribution` | `distribution-and-rationales` … **The author is always stored; the view redacts until the round closes** … v1 stores the field, computes the trace, and redacts by policy." ADR-0002's in-scope collaboration line reads in full: "Collaboration: comments, annotations, multi-rater values, edit attribution."
- **claimed severity:** expensive-later · lens: Scope, cost, buildability

**Why it was refuted**

> Refuted on four independent grounds, three of them factual misreadings of the cited text.
>
> (1) MATERIAL QUOTE TRUNCATION. PENDING-ACTIONS.md:296-298 reads: "**Why:** roughly fifteen optional schema lines now, versus a migration through every stored analysis later, because round boundaries would othe

</details>

<details><summary>rubricator's `stability_report` requires an agreement coefficient it does not name, walking into the exact implementation bug comparanda's research documented</summary>

- **claimed:** rubricator tool 15 contract: "**Per criterion:** test–retest agreement, labelled by the lowest independence rung present." Draft ADR-0018: "never a reliability coefficient over in-session assertions labelled as inter-rater agreement" — a prohibition on the *label*, not a specification of the *statistic*. No coefficient, no missing-data policy, no fixture. comparanda's draft ADR-0022, for the same job on the same data shape: "Krippendorff's alpha … computed **per criterion, over alternatives as units** … Implementation is owned in `core` and gated on Krippendorff's published dataset C as a golden fixture, because that is the fixture a mature library got wrong [62]", and findings-terminology §5 records that "A mature Python package returned 0.789 where R returned 0.815 on Krippendorff's own example" because "The ordinal difference function is the standard bug."
- **claimed severity:** expensive-later · lens: Scope, cost, buildability

**Why it was refuted**

> Factually false on its load-bearing claims. rubricator DOES name the coefficient, the missing-data policy and the fixture — just not in the two summary artifacts the finding chose to read. docs/research/sections/r4-variance-mitigation.md, the working note that findings-method.md row 15 summarises, g

</details>

<details><summary>`stance` is committed to the schema and covered by no view, no analysis and no count — contradicting evidence is representable and still invisible</summary>

- **claimed:** comparanda ROADMAP, Never cut: "… evidence `stance` …". rubricator findings §5: "A cell scored 4 that carries a `contradicts` reference is the most interesting cell on the page." The word `stance` appears nowhere in comparanda's ADRs, findings-terminology.md or findings-visualisation.md.
- **claimed severity:** worth-fixing · lens: The honesty guarantee

**Why it was refuted**

> Quotes are accurate but the inference is contradicted in situ. (a) The finding cites the condensed findings-method §5 and omits the source text it summarises: r5-evidence-citation.md:499-506 says stance "makes contradicting evidence countable in the view" and names comparanda's uncertainty-suppresse

</details>

<details><summary>Three fields the tool surface requires are in neither the schema sketch nor the seven requests, so Gate 1 cannot pass as written</summary>

- **claimed:** Gate 1 passes only when "Every field `rubricator` must read from or write into a comparanda document is either already in the schema sketch (§2.1) or filed as a request (§3)." `measures_write` "Requires the `depends_on` field (§1)"; ADR-0012 creates "`certainty` … an optional ratio measure"; ADR-0011 emits "the level multiset and a `contested` marker".
- **claimed severity:** worth-fixing · lens: The honesty guarantee

**Why it was refuted**

> The finding's two load-bearing factual claims do not survive reading the files.
>
> **1. The ADR-0013 claim is false, and it is a cross-repo ADR-number collision.** The finding says "ADR-0013 mandates `additionalProperties: false` everywhere," and builds its entire escalation on it ("an evaluation run 

</details>

<details><summary>The one constraint the research says neither repository has recorded is still unrecorded after twenty-eight recommended ADRs</summary>

- **claimed:** findings §6: "If corpus ingestion normalises documents into clean markdown, character-range spans index the *cleaned* text, not the source a reader opens — which is exactly the uncheckable citation ADR-0006 forbids. Decide early whether rubricator cites into a normalised, persisted rendition … or maintains an offset map back to the source. This is a Phase 1 schema decision, not a Phase 3 detail." ADR-0014's draft decides only that "The normalisation function is versioned".
- **claimed severity:** worth-fixing · lens: The honesty guarantee

**Why it was refuted**

> Three factual problems, one fatal to the finding's central assertion.
>
> 1. THE CONSTRAINT IS RECORDED — IN THE SAME DOCUMENT THE FINDING QUOTES. The headline claim is that the §6 constraint "is still unrecorded." But rubricator: docs/research/findings-method.md lin

</details>

<details><summary>One corpus and one hand-authored gold matrix carry four jobs, including being the ground truth for the refusal-to-guess gate</summary>

- **claimed:** cross-repo §4.2: "`rubricator`'s corpus is built toward the **relocation** subject specifically, so that the agent's output can be compared cell-by-cell against `comparanda`'s hand-authored messy fixture on an identical frame. That comparison is the strongest evaluation available to either project." ADR-0008 amendment (a) adopts the MVVP, which requires "≥3 runs, ≥2 contrasting corpora".
- **claimed severity:** worth-fixing · lens: The honesty guarantee

**Why it was refuted**

> Refuted on the facts. The §4.2 quote is verbatim, but the two claims that make the finding bite are misreadings of the cited text.
>
> (1) `relocation.json` is NOT the ground truth for refusal-to-guess. The finding's job (c) is contradicted by the paragraph immediately above the sentence it quotes. `co

</details>

<details><summary>The missingness rename is justified by a migration cost that does not exist, and its real cost is a two-repo prose sweep that makes the product's own slogan wrong</summary>

- **claimed:** The amendment's stated "Why": "Renaming later is a migration through every stored analysis *and* a prompt change in the companion repo." But cross-repo-coordination.md §0 states the actual situation: "**Today, both repositories are documentation only.** No schema code, no tools, no fixtures beyond a README describing them." There are zero stored analyses. Meanwhile rubricator's BRIEF says "**Prefer a qualified `unknown` to a plausible guess.** ADR-0006. This is the product's whole claim", and ADR-0006 says "emit `unknown` with a note, not a hedged 3."
- **claimed severity:** worth-fixing · lens: Scope, cost, buildability

**Why it was refuted**

> REFUTED on three independent factual grounds. The quotes are verbatim but the finding's central inference inverts what its own cited sources say.
>
> **1. The "migration cost that does not exist" is a misreading of the word "later."**
> `comparanda/docs/adr/PENDING-ACTIONS.md` Tier 1 item 3 reads: "Renam

</details>

<details><summary>ADR-0017 settles the view framework at Phase 1, three phases early, against the BRIEF's own instruction and on admittedly unmeasured alternatives</summary>

- **claimed:** BRIEF.md: "Stack: TypeScript throughout. Choose the framework in an ADR before writing view code" — i.e. at Phase 3. The draft places the choice in Tier 1 with the rationale "**Why here rather than at Phase 3:** it names the library the Phase 1 schema is authored in" — which is true of `zod/mini`, not of Preact. Its evidence is self-qualified: "Measured on one machine with one bundler on one day", and its own Alternatives section says of Svelte and Solid "Not measured, and no primary comparable figure was located; both plausibly land near Preact, and the compiler-coupling argument is expected to decide it regardless — but that expectation is reasoning, not evidence." Findings-visualisation §9 Q10 further records that the payload/code ratio is unknown: "How large is a real analysis payload, inlined? This determines … how much the framework choice matters at the margin."
- **claimed severity:** worth-fixing · lens: Scope, cost, buildability

**Why it was refuted**

> Every quote is verbatim, but the two load-bearing inferences do not survive reading the text in situ.
>
> 1. **"Against the BRIEF's own instruction" is false — the finding's own quote refutes it.** `comparanda: BRIEF.md` "Working agreements" says: "Choose the framewo

</details>

<details><summary>The accessibility decision is spread across four documents with the same rule stated twice, verbatim, in two of them</summary>

- **claimed:** ADR-0028 draft: "Every registered encoding must declare its `texture`; registration fails without it." ADR-0010 amendment (d): "`texture` becomes a **required** field of an encoding registration and registration fails without it." Likewise ADR-0010 amendment (h) — "**Encodings are plain named exports registered explicitly by the composition root; no module registers itself at module scope.** Demonstrated: under `"sideEffects": false`, esbuild deleted a self-registering module" — repeats ADR-0017's "**Registries are populated explicitly by the composition root.** … This is a correctness requirement under `"sideEffects": false`, demonstrated, not a style preference." ADR-0029 is described as promoting "the twenty automated checks and eight manual checks specified in the interaction research" into a merge gate — i.e. it is the acceptance criteria for 0027 and 0028.
- **claimed severity:** worth-fixing · lens: Scope, cost, buildability

**Why it was refuted**

> REFUTED — three of the finding's four load-bearing claims fail against the text at comparanda: docs/adr/PENDING-ACTIONS.md.
>
> 1. "Verbatim" is false. ADR-0010 amendment (d) (line 553-555): "texture is reserved for uncertainty and absence, never a general categorica

</details>
