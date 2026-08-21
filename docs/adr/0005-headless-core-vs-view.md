# ADR-0005: Headless core, separate view, one package with subpath exports

- **Status:** accepted
- **Date:** 2026-08-21 (proposed 2026-08-18)
- **Deciders:** Thor Whalen

## Context
The stated requirement is that the schema and the rendering are separate concerns. That is a
module-boundary question and a packaging question, and they are not the same.

## Decision
Keep a hard internal boundary: `core` has no DOM references, no framework imports, and is testable
in plain Node. `view` depends on `core`; nothing depends on `view`.

Ship **one npm package** `comparanda` with subpath exports rather than a monorepo of several:

    comparanda          -> core: schema, validation, analyses, view-state logic
    comparanda/view     -> framework-agnostic rendering
    comparanda/react    -> framework bindings, if a framework wrapper proves necessary
    comparanda/store    -> persistence adapters

One version number, one changelog, one install for the common case. **The package is not split**,
and the condition this ADR attached to that choice — that tree-shaking actually keeps `core`-only
consumers free of view code — is verified met rather than assumed. A subpath export is a separate
module graph, so `core`-only isolation held in every tested configuration, including with no
`sideEffects` field declared at all (`docs/research/findings-visualisation.md` §§ 5.1–5.2).

The trigger for splitting into `@comparanda/*` stands unchanged: a genuine consumer who needs
`core` without ever touching the view. The subpath structure makes that split mechanical if it ever
arrives.

**The boundary is a CI property, not an intention.** Four checks stand permanently:

1. An esbuild `--metafile` **input-path assertion** over the `core` entry point: no module under
   `view` may appear in its graph. This is the primary check because it names the offending import
   chain on failure, where a size budget only says the number went up.
2. **Per-fixture byte budgets**, checked into the repo, so a regression is a diff.
3. **`publint`** and **`@arethetypeswrong/cli`** on the published tarball, so the export map and the
   type resolutions are verified as consumers actually see them, not as the source tree implies.
4. A **no-DOM Node test environment** for `core`, plus an ESLint `no-restricted-globals` rule over
   `src/core/**`.

## Consequences
Cheap to start, with a documented trigger for splitting that no longer rests on an untested
assumption. The risk remains boundary erosion — one convenience import of a DOM helper into `core`
and the property is lost — which is why check 1 exists and why it fails loudly with the import
chain in hand. The four checks are now a standing cost on every release: the tarball checks in
particular require the package to be built and packed in CI, not merely linted.

## Settlement
Phase 0 research settled this ADR rather than a later implementation pass, because the measurement
it asked for was cheap to run on the real stack (`docs/research/findings-visualisation.md` § 5.2:
"ADR-0005's condition of acceptance is met … **Do not split the package.**").

Two things changed from the recommendation as written. The conditional clause — "the implementer
should confirm … if it does not, split the packages" — is discharged and removed; the split trigger
that survives is the *consumer* trigger, which was always the substantive one. And "enforce with an
import-boundary lint rule in CI" is replaced by the four named checks, because a lint rule alone
does not see the bundled graph, the published export map, or the tarball's type resolution.

Independent corroboration arrived from an unrelated direction: the whole accessibility workstream
(ADR-0027 through ADR-0029) produced no requirement for a DOM API inside `core`. The boundary was
tested by a body of work that had no stake in it and did not bend.

#### References for this settlement

Measurements and full reasoning: `docs/research/findings-visualisation.md` §§ 5.1–5.2, and
`docs/research/findings-terminology.md` § 6.3. Both are own measurements of built bundles, not
citations.
