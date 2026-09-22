# ADR-0008: Reordering is seriation; selection is view state, groups are data

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
The sketch asks for drag-to-reorder rows and columns, selection of both, and grouping — and
suggests selection might be implemented *as* a degenerate grouping.

Reordering a matrix to reveal structure is not a UI nicety. It is **Bertin's reorderable matrix**,
and the algorithmic form is **seriation**, with a substantial literature (see
[../research/visualisation.md](../research/visualisation.md)). Permuting rows and columns of the
same data can take a matrix from noise to obvious block structure without changing a single value.

Three further forces close choices this ADR originally left open. Reordering by pointer alone is
not merely inconsiderate, it is non-conformant: WCAG 2.2 SC 2.5.7 requires a non-drag
single-pointer route and names a move menu on a sortable list as the example [4]. Manual adjustment
and automatic arrangement are not two features in tension — pins and locked runs are *parameters*
of the ordering algorithm, and plain sort is that algorithm on a single-criterion input. And which
axis holds the alternatives is not settled by the field: our convention follows the DCLG manual [5]
while the most widely-read definition of "decision matrix" transposes it [6].

## Decision

**Groups are data. Selection and order are view state.** Do not implement selection as a group.

They differ on every axis that matters: groups are authored, shared, meaningful, and belong in the
analysis document; selection is per-user, per-moment, and belongs in view state. Implementing
selection as an implicit group means every "show me only these three" pollutes the shared artifact
and appears in someone else's copy. Keep the concepts separate; let the *UI* offer "select this
group" as a one-click bridge, which gives the sketch's convenience without the coupling.

**Grouping applies independently to alternatives and criteria, and we adopt `@zodal/groups-core`
with the `labels` profile for it.** Membership is many-to-many — groups are tags, not a partition,
because "this direction is both an AI play and an infrastructure play" is real and common — and the
package models exactly that: reified membership edges, nested group trees, `scopeFilter`,
intensional groups (`unfiled`, `multiHomed`), and fractional-index `orderBetween()` with the rank on
the **membership edge**, because an alternative in three groups needs three ranks. Groups may nest
in the schema; render one level initially. Charge its 16.1 kB raw against the standalone byte budget
(ADR-0017). Inherit its documented sharp edge verbatim into our own docs: locale-aware string
comparison silently corrupts fractional-index ordering, so compare by code unit and never by
`localeCompare`.

Two gaps the package does not fill, and we do:

- **Global axis order** is a different object from within-group order, and lives in view state. Use
  fractional indices there too.
- **Group-pair inapplicability** — a relation between two group spaces, marking a whole block of
  cells structurally absent — is ours to model. It is what makes applicability homogeneous within a
  group, which is why **dominance is computed per group scope** (ADR-0019).

**Manual reordering has one primary path, and it is keyboard-and-menu.** Every alternative header
and criterion header carries a single reorder handle offering a move menu and a grab mode. This is
the reference implementation, written first, and it is the conformance path: SC 2.5.7 is normative
at Level AA, so **the move menu exists for pointer users too, not only for keyboard users** [4].
The full interaction specification, keybindings and announcement contract are ADR-0027's.

**Pointer drag is a thin second path over the same `core` `moveTo(axis, from, to)`** — deletable
without touching the keyboard path, and saying the same things because both call the same
`describeMove()`. Adopt `@atlaskit/pragmatic-drag-and-drop` for that path **only** because we need
auto-scroll: the matrix is a scroll container in both axes with sticky headers, and dragging an
alternative from position 40 to position 2 requires it. Charge it against the byte budget explicitly
and re-examine the pointer path if it exceeds it.

**We withdraw the `dnd-kit` recommendation.** Its stable line has been unreleased since
2024-12-05 and its successor has sat pre-1.0 for two years [1], and it is React-only, so on
ADR-0017's Preact view it costs the `preact/compat` escape hatch for a dependency we should not be
taking at all. The deeper reason is that the premise was wrong: a drag library
sells a **pointer abstraction, never an accessible reorder**. Atlassian's own packages say they are
"unopinionated about visual language or accessibility" [2] and that the core "does not enable
accessible controls automatically" [3]. The keyboard path and the announcements are ours in every
case, so the library is a convenience on the second path and never the foundation of the first.

**Automatic reordering is the same feature, not a rival one.** Optimal leaf ordering is the
default; the algorithm, distance and missingness policy are specified in ADR-0025. Pins and locked
runs are **inputs** to the run, never a permutation re-applied to its output — which is what makes
"a starting point a human then adjusts" a mechanism rather than an intention. Never seriate on load.
Ship **"arrange by similarity to this alternative"** as a named action, and ship **`suggestGroups`**,
which proposes a grouping from a dendrogram cut and **never writes one** — groups are data, and only
a human authors data.

**`transposed: boolean` is view state**, next to row and column order. It is a pure render flip over
an orientation-neutral model, and it removes a class of "this tool is backwards" objection from
users arriving from Pugh or structured decision making.

## Consequences
Two persistence targets with different lifecycles and sharing semantics, which is more work than
one but is the correct model. Collapsing them would be a one-way door.

`core` owns reordering, not the view: `moveTo(axis, from, to)` and `describeMove()` sit on the
headless side of the ADR-0005 boundary so that three routes cannot drift into three behaviours. The
pointer path is then genuinely optional, and the accessibility acceptance criteria (ADR-0029) test
the path that ships first rather than the one that ships last.

We own the reorder interaction. That is more code than adopting a library appeared to promise, and
it is the same amount of code either way once the keyboard path is counted honestly.

Grouping becomes load-bearing rather than decorative: ADR-0015's flagship dominance analysis reads
group scope, so a sloppy grouping now degrades an analysis and not just a layout.

`transposed` is cheap only if the model never assumes an orientation. Every core signature takes an
`axis`; none takes "row" or "column".

## Alternatives considered
- *Selection as a group*, per the sketch. Rejected: the coupling is the problem, and the ergonomic
  benefit is recoverable with a UI affordance.
- *`dnd-kit` as the first library to evaluate*, per this ADR's own original recommendation.
  Withdrawn above on maintenance, framework fit, and premise.
- *No drag-and-drop dependency at all.* Correct that raw bytes govern and that the hard part is
  ours regardless, and it remains the position on everything except auto-scroll — which is not
  worth hand-rolling for a matrix that scrolls in both axes.
- *Drag as the primary path with a keyboard equivalent.* This ADR's original framing. Rejected:
  SC 2.5.7 makes the non-drag route normative, so "equivalent" understates it, and building the
  conformance path second is how it ends up untested.
- *Automatic ordering as a mode that overrides manual moves*, or manual moves re-applied after a
  run. Both rejected in ADR-0025; the pins become a lie the next re-run discards.
- *A dendrogram cut that writes groups automatically.* Rejected: an algorithmic grouping the reader
  cannot contest is the failure the prior-art survey singles out in Polis
  (`docs/research/findings-visualisation.md` § 6.2). Propose, never write.
- *Hand-rolling group membership.* Rejected: `@zodal/groups-core` matches "groups are tags, not a
  partition" almost line for line, and fractional-index ordering on the membership edge is the part
  we would have got wrong.

## Settlement
This ADR was recorded `proposed`, with its Decision section marked a recommendation to settle during
implementation (ADR-0001). Phase 0 research settled it, and two of its recommendations did not
survive.

The `dnd-kit` recommendation is withdrawn outright — the library is unmaintained on its stable line
and React-only, and the premise behind "pick a drag library" was mistaken. The
"keyboard-accessible equivalent" framing is upgraded to a keyboard-and-menu **primary** path,
because SC 2.5.7 makes the non-drag route a Level AA obligation owed to pointer users as well.

The framing of manual and automatic reordering as "two features that must not fight" got the intent
right by the wrong mechanism, and is replaced by one feature with constraints as algorithm inputs.

Added: `@zodal/groups-core` for grouping, `transposed` in view state, `suggestGroups` and
"arrange by similarity to this alternative" as named actions, and the record that dominance is
computed per group scope.

The groups-are-data / selection-is-view-state decision and the many-to-many membership rule are
unchanged, and were the parts the research corroborated rather than corrected.

Specification that would have bloated this ADR now lives where it belongs: ADR-0025 owns the
seriation algorithm, ADR-0027 owns the reorder interaction and announcements, ADR-0029 owns the
acceptance criteria, and ADR-0019 owns the dominance scope rule. This ADR keeps the decisions those
three depend on.

## References
The reasoning is in `docs/research/findings-visualisation.md` § 1.4 (one feature, not two), § 4.1
(the reorder specification and the normative requirement), § 5.4 (`@zodal/groups-core`) and § 7.1
(the drag-dependency resolution), and in `docs/research/findings-terminology.md` § 1 (orientation)
and § 7, Conflict G (dominance per group scope).

1. [npm registry metadata for `@dnd-kit/*`, `@atlaskit/pragmatic-drag-and-drop`, `sortablejs`, `@react-aria/dnd` (retrieved 2026-08-18)](https://registry.npmjs.org/)
2. [Pragmatic drag and drop — README — Atlassian](https://github.com/atlassian/pragmatic-drag-and-drop)
3. [Pragmatic drag and drop — Accessibility guidelines — Atlassian Design System](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)
4. [Understanding SC 2.5.7: Dragging Movements (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
5. [Multi-criteria analysis: a manual — Department for Communities and Local Government (2009)](https://researchonline.lse.ac.uk/id/eprint/12761/1/Multi-criteria_Analysis.pdf)
6. [Decision matrix — Wikipedia](https://en.wikipedia.org/wiki/Decision_matrix) — cited for its criteria-in-rows orientation, the transpose of ours.

## Amendments

### 2026-09-22 — A group-pair inapplicability covers the members of sub-groups

Adopting `@zodal/groups-core` (#47) made membership closed under nesting: a row in a sub-group is a member of every group above it, which is the library's rule and the one "groups may nest" implies. A declared group-pair inapplicability is read through that same membership, so a block naming a group also covers the rows of its sub-groups. This ADR only said group-pair inapplicability is "ours to model"; this records how it is modelled. Structural absence still wins over an author-set code (ADR-0009). No shipped fixture nests groups, and their results are unchanged.
