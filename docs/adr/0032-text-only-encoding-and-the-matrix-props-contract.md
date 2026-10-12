# ADR-0032: `text-only` is v1's encoding, and the matrix props contract ships before the matrix

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

## Context
Two facts collide. ADR-0018's amendment of 2026-08-22 makes a criterion's scale a declared,
extensible thing — so one analysis may hold a currency column, a boolean column and a 1–5 rating
column at once. ADR-0010's parameterised palette is built on an ordinal merge tree over a **known
level count**, and its build-time contrast test computes a fixed grid of colours from scores ×
confidence levels. A ratio-valued column has no correct ramp under that construction, and there is
no honest arity to give it.

Meanwhile the first real consumer of this schema needs to render a matrix *now*, and this
repository's view is a placeholder behind a Phase-3 epic behind an accessibility merge gate.
Blocking a working product on a palette redesign is the wrong trade in both directions.

## Decision

**1. `text-only` is a ninth registered encoding, and it is the only one v1 ships.** It renders a
value as its text and every absence as the vocabulary's `means` string (ADR-0009, amended). It has
**no palette, therefore no arity, therefore no scale assumption**, and it passes the accessibility
gate by construction rather than by a contrast test — the information is in the text, which is where
a screen reader was going to get it anyway (ADR-0028).

This is not a placeholder for a real encoding. It is the encoding that is correct under a declared
scale and stays correct for every scale that will ever be declared, and it is what a mixed-level
matrix should offer as its default even after the colour encodings ship.

**2. The eight encodings of ADR-0010 are unchanged and undeferred in design; what changes is which
one v1 registers.** `value`, `uncertainty-suppressed` and the VSUP blend arrive with an arity
**derived from the resolved scale** rather than assumed: a five-level ordinal gets today's merge
tree, a ratio column gets a continuous ramp or opts out and falls back to `text-only`. The
build-time contrast test then runs per registered scale arity, not over one hardcoded nine-colour
grid.

**3. `MatrixProps` is published from this repository before the matrix component exists.**

    MatrixProps {
      analysis, measure, vocabulary, encoding,
      standing?: (check) => CheckStanding,
      onEdit?: (patch) => void
    }

A plain data shape: an `Analysis`, a measure name, a missingness vocabulary, an encoding, and two
callbacks. It imports no provider, no `fetch`, no store.

**Why publish a type from a repository whose view is a stub.** The first consumer will render its
own table in the meantime — that is correct and cheap. The failure to avoid is that it renders it
against a *different shape*, so that `mountMatrix` arriving later is a rewrite rather than a
deletion. Publishing the props first makes the consumer's throwaway table and this repository's
eventual matrix consume one contract, so the table is deleted rather than refactored. The type costs
nothing to ship and buys the only thing that makes a throwaway component genuinely throwaway.

**4. `standing` is injected, so the view owns no clock and no policy.** ADR-0014's amendment
requires that a non-current check never render as current and that `now` be a parameter. A view that
called `checkStanding` itself would need a clock, and a bundle rendered twice from the same inputs
would render differently. The caller supplies the function; the component renders what it returns,
caveat included.

## Consequences
v1 renders a matrix that is legible, accessible, scale-agnostic and dull. That is the right first
version: the argument this project makes is about *what a cell is allowed to say*, and a cell saying
"we looked; the sources are silent" in words makes the point better than a cell saying it in a hatch
pattern nobody has learned yet.

The cost is that the encoding roster — the most distinctive part of the specification — ships later
than the matrix, and a reader of ADR-0010 who expects eight encodings in v1 will not find them.
Recorded here rather than left as a gap.

A second cost, smaller and easy to miss: `text-only` puts the whole weight of a blank cell on the
declaration's `means` string. A custom code declared with a vague `means` degrades the product
directly, where under a colour encoding it would merely degrade a tooltip. That is an argument for
`means` being required, which ADR-0030 already makes it, and against ever letting it default.

## Alternatives considered
- *Ship `value` with the five-level palette and forbid non-ordinal scales in v1.* Re-closes the seam
  ADR-0018's amendment just opened, and does it in the view, where it is least visible.
- *Derive palette arity at render time from the resolved scale, in v1.* The right eventual answer
  (clause 2) and not the right first one: it puts a palette redesign and a build-time contrast test
  on the critical path of a product that has not yet rendered a cell.
- *Let the consumer define its own props and adapt later.* An adapter between two shapes that mean
  the same thing, maintained forever, to avoid publishing a type today.

## Amendments

### 2026-10-12 — `onEdit` leaves `MatrixProps`; edits go through the source

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Thor Whalen

Clause 3 listed `onEdit?: (patch) => void`. It is not in the published `MatrixProps` (#88), for two reasons that arrived after this ADR.

First, ADR-0006 clause 3 makes `getCapabilities()` the only source of truth for what the view offers, and #72 built that as `editAffordances(source, analysis, { authorize })` with a boundary rule (`view-edits-through-store`) that fails any other reading. A callback with no provider behind it has no capability to gate on, so a view holding only `onEdit` would either offer every edit or invent the parallel read-only flag ADR-0006 forbids.

Second, the clause never said what a `patch` is, and the write path that now exists does: `source.update(id, partial)`, checked by `revisionProblems` before anything is stored. A second edit channel would be a second place for that check to be skipped.

**So:** `MatrixProps` is `{ analysis, measure, vocabulary?, encoding?, standing? }` and still names no provider. `mountMatrix` takes `MountMatrixProps`, which adds an optional `source` (followed through `subscribe`, and the only thing edits are gated on) and the host's `authorize`. Without a source the matrix is read-only and says why wherever it would have offered a write. A host that wants a callback hands over a source whose `update` is that callback. `vocabulary` and `encoding` became optional with the defaults the rest of the package already uses (`vocabularyOf(analysis)`, `text-only`); passing them is unchanged.

The clause-3 argument is untouched: the type is published before the grid (#89), and an interim table written against it is deleted rather than refactored.

### 2026-10-12 — `view?: ViewState` joins `MatrixProps`

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Thor Whalen

The matrix component (#89) renders both orientations and group bands, and both are view state (ADR-0006, ADR-0008: `transposed`, `grouping`), as are order and hiding. Rather than one prop per field, which would grow a second, partial view state inside the props, `MatrixProps` takes the reader's `ViewState` whole, as an optional `view`. Absent, the matrix shows `initialViewState(analysis)`: the document's order, recomputed on every render so an alternative a source adds is shown. Present, it is checked against the `ViewState` schema at the prop boundary and refused by name if it is not one.

Two rules keep a stale view state honest. An id the view does not order is shown after the ordered ones, in document order, so a view saved before an edit never hides what it has not heard of; an id the document no longer has is dropped. Both live in core (`matrixLayout`), so every view lays out the same way. `encoding` remains its own prop and wins when given; otherwise the view state's `encoding` applies, then `text-only`.

The addition is optional, so no consumer changes. The view state stays the host's to keep and persist (ADR-0006); the matrix renders the one it is given and owns none of its own until the interactions that change it (reorder #92, grouping #93) arrive with their port.


### 2026-10-12 — `onViewChange` joins `MountMatrixProps`, and the matrix keeps the reader's position

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Thor Whalen

The grid (#99, ADR-0027) is the first interaction that changes view state: the roving `tabindex` position is `session.focus`, and ADR-0027 requires it to survive a return from the detail panel and a reload. The amendment above said the matrix would own none of its view state "until the interactions that change it arrive with their port". This is that port, in its v1 form.

`MountMatrixProps` gains `onViewChange?: (view: ViewState) => void`, called with the whole view state after each change the matrix makes. It is a callback rather than a `ViewStateStore` because ADR-0006's 2026-08-22 amendment builds one port in v1, and a `ViewStateStore` arrives as `DataProvider<ViewState>` when a second implementation exists; a host with one writes `onViewChange: (v) => store.update(id, v)`. It is on `MountMatrixProps`, not `MatrixProps`, because the latter is the plain data shape a consumer renders against, and a callback is not data.

`mountMatrix` keeps the reader's move laid over the host's `view` until the host hands over a *different* `view` object (typically the one `onViewChange` sent). A wrapper re-passing the same object on every render therefore keeps the move; a host that never listens still gets a working grid for as long as the matrix is mounted. The component stays a pure function: it reports where focus went, and `mountMatrix` re-renders.

The addition is optional, so no consumer changes.
