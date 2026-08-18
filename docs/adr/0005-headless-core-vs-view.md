# ADR-0005: Headless core, separate view, one package with subpath exports

- **Status:** proposed
- **Date:** 2026-08-18

## Context
The stated requirement is that the schema and the rendering are separate concerns. That is a
module-boundary question and a packaging question, and they are not the same.

## Decision (recommendation — settle during implementation)
Keep a hard internal boundary: `core` has no DOM references, no framework imports, and is testable
in plain Node. `view` depends on `core`; nothing depends on `view`.

Ship **one npm package** `comparanda` with subpath exports rather than a monorepo of several:

    comparanda          -> core: schema, validation, analyses, view-state logic
    comparanda/view     -> framework-agnostic rendering
    comparanda/react    -> React bindings, if a framework wrapper proves necessary
    comparanda/store    -> persistence adapters

Rationale: one version number, one changelog, one install for the common case, and the boundary is
enforced by lint rules and tests rather than by publishing overhead. Split into `@comparanda/*`
only if a genuine consumer needs `core` without ever touching the view — at which point the subpath
structure makes the split mechanical.

The implementer should confirm that tree-shaking actually keeps `core`-only consumers free of view
code before accepting this; if it does not, split the packages.

## Consequences
Cheap to start, with a documented trigger for splitting. The risk is boundary erosion — one
convenience import of a DOM helper into `core` and the property is lost. Enforce with an
import-boundary lint rule in CI, not by intention.
