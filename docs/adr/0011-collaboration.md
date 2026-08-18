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
