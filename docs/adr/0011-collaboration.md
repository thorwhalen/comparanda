# ADR-0011: Collaboration — annotations, multi-rater values, and disagreement as a finding

- **Status:** accepted
- **Date:** 2026-08-18

## Context
A comparison is rarely produced by one person and then obeyed. It is produced, then argued over,
amended, and used to bring a group to a decision. A tool that only supports authoring — and
treats discussion as something that happens in Slack — loses the reasoning exactly where it is
most valuable, and the artifact decays into a screenshot.

The requirement is that a deployed `comparanda` is a place a **team** discusses options: editing
the analysis, commenting, annotating, disagreeing.

## Decision

**1. Annotations are anchored at every scope.** A comment attaches to a cell, an alternative, a
criterion, a group, a group-pair block, or the analysis as a whole. Cell-level is the common case;
criterion-level is where definitional arguments live ("what do we even mean by Reachability"), and
those are frequently the most valuable threads in the document.

**2. Threads, with resolve.** Comments form threads. A thread can be resolved, and resolved threads
are hidden by default but never deleted — the record of *why* a score moved is the point.

**3. Multi-rater values are first-class.** Several people may assert a value for the same
(alternative, criterion, measure). The schema retains every assertion with its author, timestamp
and justification. What the cell *displays* is a named reduction over those assertions:
`single`, `latest`, `median`, `consensus` (an explicitly agreed value that supersedes).

**4. Disagreement is an encoding.** Where raters diverge, the view can show the spread rather than
hiding it behind a reduction. A cell where two experienced people scored 2 and 5 is the most
decision-relevant cell on the page, and a mean of 3.5 is the one representation guaranteed to
destroy that information. Ship a `disagreement` encoding and compute an agreement statistic
(Krippendorff's alpha handles ordinal data and missing values, which is exactly our case — confirm
in research).

**5. Suggestion mode.** Where a user lacks edit rights, or the analysis is locked, an edit becomes
a *proposal* attached to the cell, which an owner accepts or declines. This is how a reviewer
participates without mutating a shared artifact.

**6. Concurrency: last-write-wins is not acceptable for the analysis.** Values carry a version;
a write against a stale version is rejected and surfaced as a conflict for the human to resolve.
No CRDT and no operational transform in v1 — the editing granularity is a cell, edits are
infrequent, and conflicts are rare enough to be worth showing rather than merging silently. Revisit
only if real usage proves otherwise.

**7. Activity is legible.** Recent changes are visible — what moved, who moved it, when, and what
justification they gave. A comparison that changed under you between readings, invisibly, is worse
than one that never changed.

## Consequences
This is the largest single area of the specification and should be staged: annotations and edit
attribution first, then multi-rater and disagreement, then suggestion mode. The schema must
accommodate all three from the start — retrofitting multi-rater onto a single-value cell is a
migration through every stored analysis.

## Alternatives considered
- *Comments in a side panel, unanchored.* Cheaper, and loses the connection between an argument
  and the cell it is about, which is the entire value.
- *Real-time co-editing.* Impressive, expensive, and solves a problem this workload does not have.

## Amendments

### 2026-08-21 — Anchors, agreement scope, round scope, and the disagreement encoding

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section adds the anchor model the Decision above assumed without stating, settles the "confirm
in research" left open in point 4, and hands three questions to the ADRs written to answer them. The
Context, the Decision and the Consequences above stand as written; nothing here reverses a point.

Collaboration itself remains Phase 4 work. The **anchor model is Phase 1**, because it is a
statement about how entities are identified and deleted, and retrofitting it means rewriting every
stored analysis. The evidence is in `docs/research/findings-terminology.md` § 6.2 and
`docs/research/findings-visualisation.md` § 6.1.

**1. An annotation anchor is a tuple of stable opaque ids. Never a position, never a label.** This
is absolute, and it is cheap because we are not in the situation that forces the alternative. Text
anchoring is hard because text has no identity; every robust scheme answers that with redundancy —
several descriptors resolved strongest-first, standardised by the W3C as multiple selectors whose
own `TextPositionSelector` the specification calls brittle [2], and implemented by Hypothesis as a
fuzzy search bounded by a position *hint* [3]. Google's own Drive API models an anchor as a revision
id plus a region and then disclaims it: anchors "are immutable, and their position relative to the
content of a document cannot be guaranteed between revisions", so use them "in documents where the
position doesn't change" [1]. Figma's name-and-hierarchy matching is the same failure in the other
direction — a rename silently orphans the override, with no diagnostic [4].

An alternative, a criterion, a group and a measure are entities *we* mint. Reordering is view state
(ADR-0008); renaming changes an attribute, not a key. So reorder and rename are free for us, which
is a genuine advantage over every system named above, and paying for redundancy we do not need would
be paying for it twice.

**2. Three operations still break an id anchor, and each has a required answer.**

- **Split.** The retired criterion records `supersededBy: Id[]`. The annotation resolves to *all*
  successors and renders flagged, because which successor the argument was about is a human's call.
- **Delete or merge.** An entity carrying annotations is **tombstoned, never hard-deleted** — this
  is a requirement, not a recommendation — and its annotations surface in a visible **orphaned
  annotations tray**. Silent disappearance is not an option the implementation may take. Orphaning
  should be rare enough here that each instance deserves a human's attention.
- **Re-import.** A fresh `rubricator` run must not mint fresh ids and orphan the whole discussion.
  Ids are minted **once**, from a slug at creation, then frozen; the entity carries
  `aliases: string[]` of former slugs so a re-run that renames a criterion still resolves. **This is
  the single place a label participates in identity, and it does so exactly once.** It binds the
  cross-repo contract, not just our implementation.

The instruction behind all three: **deleting a criterion must never delete the argument about
whether that criterion should exist.** In a document editor, deleting the anchored text is the
moment you most want to keep the argument and the moment the anchor dies. We invert that.

**3. `repairHint` is stored and never consulted.** An anchor may carry
`repairHint: { labelAtAnchorTime, axisIndexAtAnchorTime }`. It exists **only** to generate a
human-readable repair suggestion when an id fails to resolve. **No resolution path reads it, ever** —
not as a fallback, not as a tie-break, not "just for merges". Stated this bluntly so that nobody
later reads the field as a licence to reintroduce label matching, which is exactly the bug rule 1
exists to prevent.

**4. Point 4's agreement statistic is per criterion, not per cell.** Krippendorff's alpha is
confirmed as the coefficient, and everything else about it — its unit of analysis, its interval, how
it is labelled, and the rule that no threshold ever gates anything — now belongs to **ADR-0022**.
Read point 4's parenthetical "confirm in research" as discharged there.

**5. Point 7 is qualified by round scope, not withdrawn.** "Activity is legible" as written makes
anonymous first-round rating impossible, and the Delphi evidence says round one should be anonymous.
**ADR-0023** reconciles them: the author is always stored, the view redacts until the round closes,
and activity inside an open blind round is legible as *what moved and when* before it becomes
legible as *who*.

**6. The `disagreement` encoding's visual form is ADR-0024's to fix.** One constraint is decided
here and is not ADR-0024's to reopen: **a stacked bar never appears in a matrix cell.** It needs a
declared midpoint that ordinal data does not license (ADR-0010) and an `n` we do not have. The
detail panel is where that chart may live.

**7. Suggestion mode carries bulk accept and bulk reject.** Per-suggestion accept alone is unusable
at the scale reviewers actually work at: a reviewer who leaves forty cell proposals needs "accept
all from this reviewer" on the other side [5]. Bulk actions are part of point 5, not a later
convenience.

**8. The disagreement *analysis* is group-informed consensus; the *glyph* is a separate thing.**
Point 4 conflates them. The glyph shows one cell's spread (ADR-0024). The analysis answers a
different question, and Polis states its form best: report **what the disagreeing camps nonetheless
agree on**, rather than an average [6]. That is the shape of the analysis over a whole matrix, and
it is the reporting form we take — **not** the clustering that produces it. Algorithmic grouping a
participant cannot contest is precisely the thing to avoid [7]; any arrangement we compute stays a
starting point a human adjusts (ADR-0008) and any analysis states its method at the point of use
(ADR-0015).

### 2026-08-21 — Every assertion declares its `independence`

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Point 3 above makes multi-rater values first-class and names what an assertion retains — author,
timestamp, justification — and stops one field short. ADR-0022 labels every agreement statistic by
"the lowest `independence` rung present in the assertion set it was computed over"; ADR-0024 gives the
rater dot strip's accessible name the same dependency. Both consume the field and no ADR creates it:
it exists in `src/core/schema/provenance.ts` and as a cross-repo request in
`docs/cross-repo-coordination.md` § 5.1. It was **assumed rather than decided**, and this decides it,
here, because this ADR owns what a multi-rater assertion stores.

**Every assertion carries `independence`, one rung of a five-rung ladder, weakest first:**

| rung | means |
|---|---|
| `shared-context` | produced in the same conversation or transcript as other assertions here; prior judgements were visible, or at least present |
| `resampled` | a fresh draw from the same model and prompt — independent of the other draws' text, not of the model's priors |
| `perturbed` | deliberately varied; the companion `perturbation` field records what was varied |
| `independent` | a genuinely separate assessor — a different person, or a different model with no shared context |
| `consensus` | not an independent observation at all; an agreed value that supersedes what it was derived from |

Three rules come with it, and they are why the field is v1 rather than later.

- **It is required, and there is no permissive default.** Five draws of one model and five people who
  argued in a room are the same bytes without it, and ADR-0022's labelling rule then reduces to
  guessing. Where a rung is genuinely unrecorded — a document migrated in from before the field — the
  value is `shared-context`, the most cautious rung, never `independent`. A silently optimistic
  default is the exact failure this field exists to prevent, wearing the schema's own clothes.
- **The rung is a property of the assertion, not of its author.** A person shown the panel's scores
  before rating is `shared-context`; an agent run with no prior context is `independent`. Deriving it
  from `Author.kind` reintroduces the conflation it removes.
- **The spelling above governs.** ADR-0022's Decision calls the lowest rung `in-session`; that is this
  rung under an earlier spelling, corrected in ADR-0022's amendment of the same date. `in-session` is
  reserved for nothing.

This is the migration hazard the Consequences above already name for multi-rater, arriving through
provenance instead. An assertion set migrated in after the fact cannot be relabelled honestly,
because nobody can afterwards recover which it was — so every agreement statistic computed before the
field lands is permanently uninterpretable (`docs/cross-repo-coordination.md` § 5.1).

## References
The reasoning and the citation-integrity pass behind these entries are in
`docs/research/findings-terminology.md` § 6.1–6.2 and `docs/research/findings-visualisation.md`
§ 6.1. The separation in item 8 of the reporting form from the mechanism that produces it is the
surviving residue of the review of this amendment in `docs/research/phase0-review.md`.

1. [Manage comments and replies — Google Drive API, Google Workspace](https://developers.google.com/workspace/drive/api/guides/manage-comments)
2. [Web Annotation Data Model — R. Sanderson, P. Ciccarese & B. Young, W3C Recommendation (2017)](https://www.w3.org/TR/annotation-model/)
3. [Fuzzy Anchoring — Hypothesis (2013)](https://web.hypothes.is/blog/fuzzy-anchoring/)
4. [Apply overrides to instances — Figma Help Center](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)
5. [Suggest edits in Google Docs — Google Docs Editors Help](https://support.google.com/docs/answer/6033474)
6. [Group informed consensus — The Computational Democracy Project / Polis](https://compdemocracy.org/Group-Informed-Consensus/)
7. [Algorithms — The Computational Democracy Project / Polis](https://compdemocracy.org/algorithms/)
