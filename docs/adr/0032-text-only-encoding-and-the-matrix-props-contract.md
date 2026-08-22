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
