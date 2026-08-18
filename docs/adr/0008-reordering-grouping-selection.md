# ADR-0008: Reordering is seriation; selection is view state, groups are data

- **Status:** proposed
- **Date:** 2026-08-18

## Context
The sketch asks for drag-to-reorder rows and columns, selection of both, and grouping — and
suggests selection might be implemented *as* a degenerate grouping.

Reordering a matrix to reveal structure is not a UI nicety. It is **Bertin's reorderable matrix**,
and the algorithmic form is **seriation**, with a substantial literature (see
[../research/visualisation.md](../research/visualisation.md)). Permuting rows and columns of the
same data can take a matrix from noise to obvious block structure without changing a single value.

## Decision (recommendation — settle during implementation)

**Groups are data. Selection and order are view state.** Do not implement selection as a group.

They differ on every axis that matters: groups are authored, shared, meaningful, and belong in the
analysis document; selection is per-user, per-moment, and belongs in view state. Implementing
selection as an implicit group means every "show me only these three" pollutes the shared artifact
and appears in someone else's copy. Keep the concepts separate; let the *UI* offer "select this
group" as a one-click bridge, which gives the sketch's convenience without the coupling.

**Manual reordering:** drag-and-drop for both rows and columns, with a keyboard-accessible
equivalent (select header, arrow keys to move) — drag-only reordering is an accessibility failure.
Use a maintained primitive rather than hand-rolling pointer maths; evaluate `dnd-kit` first for its
keyboard and screen-reader story. Persist order in view state.

**Automatic reordering:** offer seriation as a first-class action — "arrange to reveal structure" —
alongside plain sorts. Implement at least one principled algorithm; see the research brief for
candidates. Automatic ordering must be a *starting point a human then adjusts*, never a mode that
fights the user's manual drags.

**Grouping** applies independently to alternatives and criteria. Groups may nest in the schema;
render one level initially. Membership is many-to-many (groups are tags, not a partition), because
"this direction is both an AI play and an infrastructure play" is a real and common case.

## Consequences
Two persistence targets with different lifecycles and sharing semantics, which is more work than
one but is the correct model. Collapsing them would be a one-way door.

## Alternatives considered
- *Selection as a group*, per the sketch. Rejected above; the coupling is the problem, and the
  ergonomic benefit is recoverable with a UI affordance.
