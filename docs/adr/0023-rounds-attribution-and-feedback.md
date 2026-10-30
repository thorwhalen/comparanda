# ADR-0023: Rounds, attribution policy and feedback policy

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0011's multi-rater loop — rate, discuss, revise — is the Delphi method with the serial numbers
filed off. The Delphi literature's best-evidenced structural claim is that round-one rating should
be **anonymous**, because anonymity reduces the inhibition that group settings impose on
individual judgement [1]. The best-documented operationalisation, the RAND/UCLA appropriateness
method, rates individually with no interaction among panellists in round one, then re-rates after
discussion with each panellist shown the group's distribution alongside their own response — group
visible, individuals not [2].

ADR-0011 point 7 says activity is legible: what moved, who moved it, when. As stated, that makes
anonymous round-one rating impossible. The two are reconcilable only if anonymity is *scoped and
temporary*, and scoping it requires the round to be a thing the schema knows about rather than a
boundary someone infers from timestamps.

The evidence and the ~15-line cost estimate are in `docs/research/findings-terminology.md` §5.

## Decision

**A `round?: RoundId` on every assertion, plus a small `rounds` collection, enters the schema in
Phase 1.** Both are optional. An analysis that never declares a round behaves exactly as it does
today: assertions belong to an implicit single round that is attributed and gives no feedback.

Each declared round carries two policies:

- **`attribution`**: `attributed` | `blind-until-close`;
- **`feedback`**: `none` | `distribution` | `distribution-and-rationales`.

**The author is always stored; the view redacts until the round closes.** Redaction is a property
of the read path in `core` (ADR-0005), applied once, not a rule each view component remembers.
ADR-0011 point 7 is **qualified by round scope, not withdrawn**: activity inside an open
`blind-until-close` round is legible as *what moved and when*, and becomes legible as *who* the
moment the round closes. Attribution is never destroyed, which is what ADR-0012 requires.

**Stopping is a stability trace, never a consensus threshold.** Consensus is assessed *within* a
round; stability is assessed *between* rounds; the literature has no agreed criterion for when
consensus has been reached [1]. So we ship the trace and no number gates on it — "the trend
flattened" is a chart a human reads, which is the same stance ADR-0015 takes toward aggregation.
The between-round statistic is **churn** — the fraction of raters who changed, plus the change in
spread — and it **must never be conflated with alpha**, which is the within-round statistic owned
by ADR-0022. They answer different questions and a single label over both would be wrong in
whichever direction it was read.

**v1 stores the field, computes the trace, and redacts by policy — nothing else.** Round locking,
deadlines, and any round-transition workflow are deliberately out of scope. They can be added
later without a migration, which is the whole reason for adding the field now.

## Consequences
Multi-round elicitation becomes possible without a schema change, and the anonymity requirement
becomes a policy on data rather than a behaviour of one particular UI — so an agent, an export and
a second view all honour it or all visibly fail to.

What becomes hard: the view must redact an author it can plainly see. That is a rule enforced in
one place and tested there, and it must be documented for what it is — **a presentation policy,
not a security boundary**. The author is in the document; anyone holding the raw JSON can read it.
`blind-until-close` buys a Delphi panel's honesty, not confidentiality, and claiming otherwise
would be the same over-promise ADR-0012 refuses to make about local identity.

The cost of *not* doing it now is a migration through every stored analysis, because round
boundaries would otherwise have to be reconstructed from timestamps.

## Alternatives considered
- *Infer rounds from timestamps.* Fragile, and unrecoverable the moment anyone edits late or
  assertions from two rounds interleave.
- *Add rounds in Phase 4, when multi-rater ships.* A migration through every stored analysis, for
  a field that is nearly free before anything is stored.
- *Anonymise by not storing the author.* Destroys attribution, which ADR-0012 requires and which
  the round's own close is supposed to restore.
- *A single `anonymous` flag on the analysis.* Anonymity is a property of a round, not of an
  analysis — round one blind and round two attributed is the design the evidence supports.

## Amendments

### 2026-10-12 — A replication pass is a round; the round says *which pass*, independence says *how related*

- **Status:** accepted
- **Date:** 2026-10-12

The companion repo reached rounds from the other end: its replication pass (the same criteria scored again, the earlier pass not visible) is structurally a round. #68 confirms the mapping so that it emits `roundId` instead of inventing a parallel "pass" concept that would later have to be reconciled.

**The mapping, as shipped:**

- **One replication pass is one declared round.** Each pass appends a `rounds[]` entry `{ id, index, label?, feedback: 'none', attribution: 'attributed' }`. Each assertion it produces carries `roundId`. `feedback: 'none'` is what makes it a replication rather than a Delphi revision: the pass did not see the earlier one.
- **The round does not replace the per-assertion independence rung, and is not read as one.** Each draw also records `independence` (`resampled`, or `perturbed` with a `perturbation` record), and `procedureId` points at the run's `procedure` (`repeats`, `reduction`, `traversal`, `temperature`). `roundId` answers *which pass produced this*. `independence` answers *how many heads the set represents*, and that is what the agreement label (ADR-0022) and the cell's text alternative (ADR-0024, `describeAssertionSet`) read. Being in different rounds never makes two draws of one model independent.
- **Between-round change over replication rounds is test–retest, not churn.** This ADR's churn is revision after feedback. Over rounds declared `feedback: 'none'` from one principal, the same computation measures self-consistency, and it must be labelled that way by the same lowest-rung rule as ADR-0022. Nothing computes churn yet. This sentence binds whatever first does.
- **Spelling.** The Decision's policy names are the shipped schema's `attribution: 'anonymous' | 'attributed'` (`blind-until-close` = `anonymous`) and `feedback: 'none' | 'anonymous-summary' | 'full'` (`distribution` = `anonymous-summary`, `distribution-and-rationales` = `full`). The redaction module (`src/core/schema/redaction.ts`) already reads them this way. The emitted JSON Schema is the source of truth.

The other half of #68, ADR-0018's direction of preference, needs no amendment. It is confirmed as shipped: `preference` is **required** on every measurement (`increasing` | `decreasing` | `target` | `ordered` | `none`), not only on ordinal ones. An ordered level also requires a `range`, and nominal requires `none`.

## References
1. [An exploration of the use of simple statistics to measure consensus and stability in Delphi
   studies — Holey, Feeley, Dixon & Whittaker (2007), BMC Medical Research Methodology
   7:52](https://pmc.ncbi.nlm.nih.gov/articles/PMC2216026/)
2. [The RAND/UCLA Appropriateness Method User's Manual — Fitch et al. (2001), RAND
   MR-1269](https://www.rand.org/content/dam/rand/pubs/monograph_reports/2011/MR1269.pdf)

### 2026-10-13 — The activity record, and the one place a hidden author is kept out (#107)

- **Status:** accepted
- **Date:** 2026-10-13

ADR-0011 clause 7 ("what moved, who moved it, when, and what justification they gave") is now a function: `activityRecord(analysis, viewer, { since? })` in `core/activity.ts`, oldest first, derived from the document and stored nowhere. **No schema change**: every assertion already carries `authorId`, `at`, `value`, `justification`, `roundId` and, when replaced, its successor; a superseded assertion's successor gives `previous`. Comments, replies, resolutions and edits are listed too. `since` answers "what changed since I last looked", the case clause 7 names ("a comparison that changed under you between readings").

**One enforcement point.** Every fact about an assertion passes through `assertionVisibility` and then `redactForViewer` / `withoutAuthor` (`core/schema/redaction.ts`). An entry for an assertion whose author the round hides has `whoHidden: true`, no `who`, and nothing to reconstruct the author from: the id (producers mint ids from the author), the procedure (it names the agent) and the persona's principal are taken out, and its sentence says "Someone". It carries the value and the justification only as far as the round's `feedback` allows. `cellDetail` takes the same `viewer`: a hidden author's assertion is the anonymised copy under a stand-in id (`hidden-1`, with `supersededBy` mapped to match), `author`, `principal` and `procedure` are absent, and `reduced.contributing`, which carries whole assertions, is anonymised too. `tests/redaction-enforcement-point.test.ts` lists the only places `src/view` may name an author (comments, which belong to no round, and the fallback for an author the document does not describe), so a second one cannot appear without someone saying why it is safe.

**Who is looking** is the `viewer` prop (`{ viewerId, now }`, injected like `standing`, ADR-0032 clause 4). `mountMatrix` supplies one when the host gives none: the identity's id once it resolves (the matrix redraws when it does) and its clock. A pure `Matrix` given none hides nothing; a caller of `cellDetail` that says nothing about who is looking is not told to redact. Still a presentation policy, not a security boundary: the document holds every author.

**What this does not do, and why.** The panel's rows hide the *author* (the done-when of #107); they do not yet hide the *values and rationales* a round's `feedback` withholds, and the cell's reduced value is computed over every assertion. Hiding those would change what every analysis with a declared round shows its readers, including the replication passes of ADR-0023's earlier amendment, which declare `feedback: 'none'` and are never closed. That is a decision (manual-task #217), not a refactor. `activityRecord` does apply the full visibility, being new. A comment edit is recorded as `editedAt` only: the document keeps neither the earlier wording nor the editor, and the record does not invent them (#195).

Details the review of #218 settled, which are rules of the redaction and not accidents of the code: a replacement is shown as one only between two assertions the viewer may attribute alike (a link from a named hand to an unnamed one says they are the same, and people mostly revise their own); the set's description counts a hidden assertion as an unknown hand of its own with no independence claimed, so it never reads "2 assertions by one person" across a name and a mask; stand-in ids live in their own namespace (`hidden-author:n`) and skip any id the document uses, and evidence ids stand in with them; a `closedAt` with no zone is UTC; and the anonymous identity is nobody in particular (`viewerId` absent), not an author who happens to be called `anonymous`. Free text a rater wrote in a justification can name them, and exact timestamps can be matched to the same hand's visible activity: neither is something a view can redact.

## Amendment, 2026-10-13: an edit made through `editComment` is attributed to its editor

The sentence above that an edit keeps neither the earlier wording nor the editor holds for an edit that sets only `editedAt`. An edit made through `editComment` (#195) also leaves a comment by the editor that names the edited comment by id and quotes the wording it had, and `activityRecord` reports that as the editor's edit, once, at the time they made it. A reply that merely sounds like such a note, or names a comment the thread lacks, is a reply. An `editedAt` with no note naming its comment is still reported as before, with no earlier wording and no editor.
