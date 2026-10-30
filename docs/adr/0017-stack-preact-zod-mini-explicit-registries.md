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

## Amendments

### 2026-08-21 — Decision 4's tree-shaking example names two encodings that do not exist

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Decision 4 illustrates per-consumer tree-shaking with "a consumer who only wants `value` and
`uncertainty-suppressed` does not ship `disagreement`, `staleness` and `completeness`". `staleness`
and `completeness` are not encodings. ADR-0010's amendment of the same date fixes the roster at
eight — `value`, `categorical`, `uncertainty-suppressed`, `missingness`, `datum`, `disagreement`,
`disagreement-spread`, `consensus-suppressed` — and completeness is an analysis (ADR-0015), not a
mapping to a visual channel. The example was written against ADR-0010's Consequences, which names
"rater disagreement, staleness, completeness" as *future lenses* rather than as registered
encodings.

**Read the example as `disagreement`, `disagreement-spread` and `datum`.** Nothing about decision 4
changes: registries are still populated explicitly by the composition root, self-registration is
still a correctness defect under `"sideEffects": false`, and the tree-shaking argument is unaffected
by which three encodings the sentence happens to name. ADR-0010 clause 8 restates this same sentence
and is to be read the same way; per ADR-0001 neither is corrected by an edit.

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

### 2026-10-12 — the build's peers are optional, and the data is inlined after Vite runs

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Thor Whalen

Clause 6 chose Vite plus `vite-plugin-singlefile`. Building it (#114) settled two details the clause left open.

**The two are optional peer dependencies, not dependencies.** `comparanda build` ships in the package, but most consumers only mount the matrix, and Vite is far heavier at install time than anything it would replace for them. They are optional peers (as `preact` already is), `comparanda/build` imports them dynamically, and a missing one is refused with the install command. The build module is Node-only, behind its own `comparanda/build` subpath, so no browser consumer's module graph reaches it.

**The analysis is inlined after Vite has run, not passed through it.** Vite rewrites an HTML template (it substitutes `%ENV%` placeholders, among other things), and an analysis is arbitrary text. So Vite bundles a page with an empty `<title>` and two empty `<script type="application/json">` elements, and the build splices the title, the analysis and its settings into them afterwards; the JSON has `<` written as `\u003c` so no string can close the element. The analysis is inlined verbatim, as given, unless a disclosure projection was asked for. The page's entry is a pre-bundled browser module (`dist/standalone/main.js`) that Vite only inlines; it is the one module the package declares as having side effects (`sideEffects`), and the build refuses a page whose bundle lost it.

The CSP tag and the build-time zero-network check, the byte budget and the mail-filter warning remain clause 6's and clause 8's, each with its own issue (#115, #116, #118).


### 2026-10-12 — clause 8's budget is enforced, and a committed dependency is charged before it lands

The budget is `STANDALONE_BUDGET` in `src/build/budget.ts`: **200 kB raw, 1 kB = 1024 bytes** (the unit `comparanda build` prints), held against the page *without* the analysis, its title and its settings — the bundled shell, measured before they are spliced in. `buildStandalone` throws `BudgetExceeded` over it; `budget: false` reports without enforcing. The failure names where the bytes went, per package, largest first: the bundler's rendered length per module shares out the minified code bytes, approximate per package and exact in total. So a dependency that breaks the budget is named in the failure, ranked by size (#116); its own dependencies are named under their own packages. The shipped standalone entry is pre-bundled by tsup into one module, so tsup writes `main.packages.json` beside it from esbuild's metafile, and the budget shares that module out by it — without it every dependency would be charged to comparanda in the published CLI.

ADR-0008 adopts `@atlaskit/pragmatic-drag-and-drop` and says to charge it explicitly. It is not in the bundle yet, so it is charged as a **reservation** (24 kB, an estimate): counted against the limit until the package appears in the bundle, then replaced by its measured bytes. Discovering its real size under pressure is the point of setting the budget at Phase 3.

CI reports the figures for every example fixture, in the log and the job summary. At this amendment the shell is about 96 kB, 120 kB charged with the reservation.

### 2026-10-20 — clause 8's limit rises from 200 kB to 206 kB for the view-state provider (#224)

Wiring `viewStateProvider` into the standalone page (so a browser that will not keep the reader's arrangement says so, in the page) brings the view-state schema, its migration chain and the provider into the bundle: about 4.8 kB raw, which took the charged total from 197.6 kB to 202.4 kB against a 200 kB limit. The provider is what ADR-0006 requires and the notice is what #73 promised, so the limit moves rather than the feature. The new limit is 206 kB, which leaves about 3.6 kB of headroom; the shell is about 174 kB measured, plus the 24 kB drag-and-drop reservation, which lapses when the package is bundled and may free room then. The earlier "about 96 kB" figure above is stale. Reversible: lower the constant when the reservation is replaced by its measured bytes.

### 2026-10-20 — clause 8's limit rises from 206 kB to 213 kB for the rater dot strip (#110)

The strip (its data, the redaction-aware reader, the encoding with its legend, the drawing and the container-query rules) adds about 5.4 kB raw. CI charges the page about 2.5 kB more than a local build does (it measured 210.8 kB with the strip against 206 kB), so the limit is set against CI's figure: 213 kB, leaving about 2 kB. The strip is ADR-0024's decision and the one place a mean could otherwise re-enter the view, so the limit moves rather than the feature. Reversible: lower the constant when the drag-and-drop reservation (an estimate) is replaced by its measured bytes.

### 2026-10-20 — clause 8 measures the production page, whatever NODE_ENV the build runs under

The budget was charged against a development build whenever the process had a non-production `NODE_ENV`, which is every CI run: vitest sets `test`, Vite keeps an inherited `NODE_ENV`, and with it compiles the TSX through the development JSX transform. That transform writes each element's absolute source path and line number into the page. It added about 23 kB to the measured shell (186 kB, not 163 kB, on the example fixtures) and put the builder's local file paths into a file meant to be mailed. The build now pins `mode: 'production'`, `process.env.NODE_ENV` and `jsxDev: false`, so the page is byte-identical under any `NODE_ENV`. The limit is unchanged at 213 kB. The two raises above were sized against the inflated figure; whether either should be revisited is the decision in #226 and #234.

### 2026-10-30 — the drag-and-drop reservation is released (#190, #188)

The 24 kB charged for `@atlaskit/pragmatic-drag-and-drop` is dropped: the pointer path is native (ADR-0008 amendment), so the package is not coming. The limit stays at 213 kB, so the page gains about 24 kB of headroom, which the comment-edit write and panel (#195, #221) spend first. Whether the limit should now fall back is the open question in #226 and #234; this change does not take it. Reversible: a library that returns is charged again as a reservation.
