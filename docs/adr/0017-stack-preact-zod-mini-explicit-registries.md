# ADR-0017: Preact for the view, `zod/mini` for the schema, explicit registries

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
`BRIEF.md` asks for the framework to be chosen in an ADR before view code is written, justified
against the standalone-bundle constraint. ADR-0005 makes tree-shaking a condition of accepting one
package with subpath exports. ADR-0013 makes a single self-contained HTML file a first-class output.

That file is mailed and opened over `file://`. No transport compression applies to a saved
attachment, and mail encoding adds roughly 33%. **Raw bytes are the governing figure here, not
gzip** — the reverse of the usual web instinct, and the reason a decision that would otherwise be
taste becomes arithmetic.

The decision lands now rather than at Phase 3 because it names the library the Phase 1 schema is
authored in, and because it forbids a module pattern that is cheap to adopt in Phase 1 and
expensive to unwind after encodings and analyses exist.

**Measurement conditions.** One machine, one bundler, one day: esbuild 0.27.4, flags
`--bundle --minify --format=esm --platform=browser` (plus `--define:process.env.NODE_ENV="production"`
for React), `gzip -9`, all on 2026-08-18 [1]. Same bundler, same settings, same day, so the rows are
comparable to each other — and to nothing else. Treat them as ratios, not as published sizes.

| Entry | Raw bytes | gzip -9 |
|---|---:|---:|
| `import { z } from 'zod'` (v4.3.6) + a comparanda-shaped schema | 310,946 | 61,756 |
| Named imports from classic `zod`, same schema | 68,204 | 19,032 |
| `import * as z from 'zod/mini'`, same schema | **15,250** | **5,491** |
| `@zodal/core` `defineCollection` alone | 10,819 | 3,785 |
| React 19.2.6 + `react-dom/client`, one trivial `useState` component | 193,327 | 60,146 |
| Preact 10.29.1 + `preact/hooks`, same component | **12,781** | **5,331** |
| `preact/compat` + `preact/compat/client`, same component | 18,591 | 7,456 |

A second finding, independent of size and more consequential. Under `"sideEffects": false` — which
is what a package must declare to tree-shake well — esbuild was demonstrated to delete a module
whose only purpose was its module-scope `register(...)` call **from the bundle that needs it**. The
view shipped, the registry was empty, and nothing errored at build time [3]. ADR-0010's pluggable
encodings are exactly the shape that invites this pattern.

## Decision
**1. The view is built on Preact.** 15× the raw bytes for the same trivial component is not a
margin that judgement overturns. `preact/compat` stays available as an escape hatch at a measured
+5,810 raw over bare Preact — cheap insurance against needing a React-ecosystem component. Preact
requires no compiler and no bundler plugin, which is what "must still build in three years" asks
for [2].

**2. The runtime schema is authored in `zod/mini`.** The classic `z` namespace barrel is the single
most expensive line of code available to this project: a namespace object's properties cannot be
dead-code-eliminated, so the whole classic surface stays alive. `@zodal/core`'s `defineCollection`
works unchanged on `zod/mini` schemas, and classic Zod's `toJSONSchema` accepts them — both verified
by execution [1].

**3. JSON Schema emission is a Node-only build step.** The classic Zod import that provides
`toJSONSchema` must never appear in a browser entry point. Enforce it with an ESLint
`no-restricted-imports` rule, not with a convention. This is how ADR-0004's language-neutral
contract artifact gets produced without the browser paying for it.

**4. Registries are populated explicitly by the composition root.** Encodings (ADR-0010), analyses
(ADR-0015) and adapters (ADR-0013) are plain named exports; no module registers itself at module
scope. `mountMatrix`, or the caller, registers what it wants. This is a correctness requirement
under `"sideEffects": false` — demonstrated [3], not a style preference. It also improves the
product: a consumer who only wants `value` and `uncertainty-suppressed` does not ship
`disagreement`, `staleness` and `completeness`, and tree-shaking works in their favour rather than
against them.

**5. `comparanda/react` is not published in v1.** The public mounting contract is
`mountMatrix(el, props) => { update, destroy }`. Document a fifteen-line React wrapper and a Vue one
in the README; ship neither. Revisit when two real consumers ask [2] — ADR-0005's subpath structure
makes the addition mechanical.

**6. The standalone build is Vite plus `vite-plugin-singlefile`.** The analysis is inlined as
`<script type="application/json">`, which avoids escaping bugs and leaves the data readable to
anyone who opens the file in an editor. The build injects a Content-Security-Policy meta tag
(`default-src 'none'; connect-src 'none'`, with `'unsafe-inline'` for script and style and `data:`
for images and fonts), which turns ADR-0013's no-network property from a review convention into
something the browser enforces. **The zero-network check fails the build, not only CI** — a check
that runs only in CI does not protect someone who builds locally and mails the result [4].

**7. ADR-0005's condition of acceptance is verified met; the package is not split.** A subpath
export is a separate module graph, so a `comparanda`-only consumer never reaches `comparanda/view`
— confirmed in every tested configuration [3]. CI keeps it that way with an esbuild `--metafile`
input-path assertion, per-fixture byte budgets, `publint` and `@arethetypeswrong/cli` on the
published tarball, and a no-DOM test environment for `core`.

**8. Phase 3 sets a byte budget on the standalone bundle and fails the build when it is exceeded.**
200 kB raw excluding the analysis payload, until a real analysis says otherwise. The number belongs
in the repo where it can be argued with, and it must be discovered under pressure rather than at the
end.

## Consequences
The dependency floor of a mailed report is about 51 kB raw — Preact, `zod/mini`, `@zodal/core`,
`@zodal/groups-core` — rather than the ~500 kB that React plus the classic Zod barrel would impose.
That is the difference between an artifact whose largest component is the analysis it exists to
carry and one whose largest component is the framework. It is also, plausibly, the difference
between a file that survives a mail gateway and one that does not.

The costs are real and worth naming. Preact's ecosystem is smaller than React's, so a React-only
component means `preact/compat` or a replacement. `zod/mini`'s API is more verbose
(`z.optional(z.int())` rather than `z.int().optional()`). Explicit registration means the
composition root carries a list that must be kept current — a visible, greppable cost, which is why
it is preferable to the invisible one it replaces.

Two things stop being someone's responsibility to remember: the classic-Zod import (a lint rule) and
the network reach-around (a CSP tag plus a failing build).

Separately, size is not the only thing that governs whether the mailed file arrives. Enterprise mail
filters commonly offer `htm`/`html` as blockable attachment types, matched by true type rather than
by extension. `comparanda build` should print raw bytes, gzip bytes, and that warning, and the docs
should give the workaround.

## Alternatives considered
- *React.* 15× the raw bytes for the same trivial component, measured against the one constraint
  that governs the artifact. Familiarity does not survive that.
- *Svelte or Solid.* **Not measured**, and no primary comparable figure was located; both ship most
  of their cost as compiler output proportional to component count, so a single-number comparison
  would not have been meaningful anyway. Both plausibly land near Preact, and the
  compiler-and-plugin coupling is expected to decide it regardless — but that expectation is
  reasoning, not evidence, and it is recorded here as such.
- *Lit.* Shadow DOM complicates computed text contrast against a rendered background (ADR-0010),
  `forced-colors`, print, and a single coherent `role="grid"` tree — four things this project cares
  about more than most.
- *Vanilla TS plus a small reactive layer.* Saves at most ~13 kB raw and costs a hand-written
  renderer that must preserve DOM identity and keyboard focus across reorder — the fiddliest
  requirement in the visualisation brief.
- *Classic Zod in the browser.* 20× the raw bytes for a capability only the build step uses.
- *Self-registering modules.* Demonstrated to be deleted by the bundler [3].
- *A `sideEffects` glob array listing the encoding modules.* Keeps self-registration working, but
  force-retains every encoding the view barrel imports — forfeiting the per-consumer shaking that
  motivates the rule — and requires hand-maintaining the glob list as encodings are added.
- *esbuild plus a hand-rolled inliner.* Reimplements asset inlining, CSS extraction and data-URI
  encoding. `vite-plugin-singlefile` is the maintained thing, and Quarto's `embed-resources` reached
  the same conclusion for the same artifact shape.

## References
1. `docs/research/sections/c8-prior-art-and-stack.md` §B.5 — measured bundle sizes, conditions, and
   the raw-versus-gzip argument. Condensed in `docs/research/findings-visualisation.md` §5.1 and
   `docs/research/findings-terminology.md` §6.3.
2. `docs/research/sections/c8-prior-art-and-stack.md` §B.6–§B.7 — the framework decision and the
   case against shipping `comparanda/react`.
3. `docs/research/sections/c8-prior-art-and-stack.md` §B.10 — the three-configuration tree-shaking
   fixture: the deleted self-registering module, and the verification of ADR-0005's condition.
   Condensed in `docs/research/findings-visualisation.md` §5.2.
4. `docs/research/sections/c8-prior-art-and-stack.md` §B.8–§B.9 — the build pipeline, the CSP tag,
   the browser test and the static pre-filter. Condensed in
   `docs/research/findings-visualisation.md` §5.3.
