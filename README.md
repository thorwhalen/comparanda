# comparanda

**A schema and a view for structured comparison.**

*Comparanda* (Latin, plural of *comparandum*): the things to be compared.

You have a set of options and a set of criteria. Every (option, criterion) pair gets a value —
a score, a rating, a flag, a note — or an explicit, qualified nothing. `comparanda` gives that
structure a schema, a persistence story, and a view a team can actually argue over.

It is deliberately two separable things:

- **a headless core** — a schema (built on zodal) that declares what a comparison *is* and what
  affordances it offers, with no DOM and no opinions about rendering;
- **a view** — a reorderable, groupable, annotatable matrix that consumes that schema.

Either is usable without the other. The schema is also the contract that **rubricator** — the
agent side — writes against.

## Why it exists

Comparison tables are where consequential decisions actually get made, and they are usually made
badly: in a spreadsheet nobody can re-sort, with a total column that averages away the shape,
with no record of how confident anyone was, and no way to tell whether a blank cell means "not
applicable" or "nobody has looked yet".

`comparanda` takes a position on each of those:

- **No forced aggregation.** A weighted total is one optional analysis among several, never the
  default. The shape of a row is the finding.
- **Uncertainty is data.** Values carry confidence, and the view can encode value and confidence
  together so a high score on thin evidence visibly recedes instead of shouting.
- **Absence is data.** A missing value is qualified — not applicable, not yet assessed, unknown,
  withheld — never a silent blank.
- **Rearranging is analysis.** Reordering rows and columns to reveal structure is a documented
  method with a literature, not a UI nicety.
- **Disagreement is a feature.** Several people can score the same cell, and the spread between
  them is often more informative than any single number.

## Two deployment shapes, both first-class

1. **Standalone.** A single self-contained HTML file with the data bundled in. No network, no
   API, no build step at the reader's end. Mail it to someone.
2. **Connected.** The same view wired to a data provider, a persistence target, an identity
   source, and resolvers for tooltips and evidence links.

The second must not be a rewrite of the first.

## Status

Pre-implementation. This repository currently contains the specification — a domain model, a set
of architecture decision records, and research briefs for the questions that should be settled
with evidence rather than taste.

**Start at [BRIEF.md](./BRIEF.md).**

## License

Apache-2.0. See [LICENSE](./LICENSE).
