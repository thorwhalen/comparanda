# ADR-0029: Accessibility acceptance criteria

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
Four documents state accessibility requirements — ADR-0010 (never colour alone, computed contrast),
ADR-0013 (the standalone bundle issues zero network requests), ADR-0027 (matrix semantics),
ADR-0028 (texture, forced colors, print) — and BRIEF.md lists "accessibility is not a later pass"
among the non-negotiables. None of them fails a build. A requirement no machine checks is a
requirement that survives exactly as long as nobody is in a hurry.

The interaction research already did the hard part: it enumerates twenty automated checks (A1–A20)
and eight manual ones (B1–B8), each with the mechanism that runs it, in
`docs/research/sections/c7-interaction-a11y.md` § "v1 accessibility acceptance checklist". What was
missing was the decision to enforce them.

## Decision
**The automated set is a merge gate. The manual set is a release gate.** A1–A20 must be green for a
pull request to merge; the B1–B8 pass runs once per release and is **recorded in the release notes**
— which browser, which screen reader, which version, and what it did.

**The gate does not rest on axe-core.** A1 runs axe-core over the standalone bundle in both themes,
and it is a **floor, not the value**: it catches a minority of real defects, and it is green on every
failure mode specific to this matrix. The checks that carry the gate are the ones no generic tool
knows to look for:

- **no cell is announced as blank** (A3), and **every `missing` cell's announced text matches its
  reason code** (A4) — table-driven over the whole reason-code set, so extending that set (ADR-0009
  permits it) fails the build until the phrase and the glyph exist;
- **a keyboard reorder round-trips with focus preserved** (A6), **the `Tab` route produces the
  identical order** (A7), and **`Escape` restores the original order and focus** (A8);
- **a focused edge cell is not obscured by sticky chrome** (A10) — SC 2.4.11, asserted on bounding
  boxes rather than on intent;
- **zero focusable elements inside any tooltip** (A12) — the boundary ADR-0027 draws, checked by
  query rather than by review;
- **composited contrast per encoding per theme** (A13) — read back off the rendered pixels, because
  the declared colour is not the colour a reader sees;
- **forced-colors still shows the numeral and the glyph** (A15), and **no `background-image` carries
  meaning** (A16) — the pair that makes ADR-0028 enforceable;
- **the standalone bundle issues zero network requests** (A19) — BRIEF.md asked for this check by
  name.

Most are one Playwright assertion each, because `page.emulateMedia()` covers `colorScheme`,
`forcedColors`, `reducedMotion` and `print` through one API [3]. Two carry conditions worth naming:
`forcedColors` is documented without stating engine coverage, so A15 is only as strong as the
engines honouring it at the pinned version — confirm that when pinning. And A14, the colour-vision
simulation, must be run against the real palette **before the palette is frozen**; run late it
reports a problem whose fix is no longer cheap.

**The checklist is transcribed into the test suite, and the suite is then authoritative.** The
research section is where the checks came from, not a document CI reads.

## Consequences
Accessibility regressions become build failures rather than bug reports, which is the only form in
which the brief's non-negotiable is true. The cost is accepted deliberately: several checks need a
**real browser in CI** — canvas readback, geometry, media emulation, request interception — so the
pipeline is slower and heavier than a jsdom-only one. That is the price of the property, and a
pipeline that cannot see composited pixels cannot check the thing we care about.

Two further commitments follow. The gate must be in place before the view lands, because
retrofitting twenty checks onto a finished matrix means discovering the failures at the worst
moment. And the manual pass has an owner and a slot in the release procedure — a release-gate check
with no place in the release checklist is the same aspiration in a new costume.

## Alternatives considered
- *A checklist in the contributing guide.* This is precisely what "a later pass" looks like in
  practice.
- *axe-core alone.* Green, and blind to every failure mode specific to this matrix.
- *Automated checks only, no manual pass.* No emulation substitutes for real Windows High Contrast
  Mode or a real screen reader; B1–B8 exist because A1–A20 cannot see those failures.
- *Manual pass only, no gate.* Runs when someone remembers, which is after the regression shipped.
- *Fold this into ADR-0027 and ADR-0028 as one accessibility ADR.* Raised in adversarial review and
  judged a matter of taste rather than a defect (`docs/research/phase0-review.md`). Declined: 0027
  settles semantics and 0028 settles channels, while this one is the acceptance gate over both and
  changes on a different clock — the checks get added to as the view grows, and neither of the other
  two should be reopened when they do.

## References
1. `docs/research/sections/c7-interaction-a11y.md` § "v1 accessibility acceptance checklist" — the
   twenty automated checks with their mechanisms, and the eight manual ones with their targets.
2. `docs/research/findings-visualisation.md` §4.6 — the argument for promotion to a merge gate, and
   the identification of the highest-value subset named above.
3. [`page.emulateMedia()` — Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media)

## Amendment, 2026-10-13: the gate is in the suite (#105)

The twenty checks are transcribed into `tests/a11y/`, and the suite there is now authoritative. `pnpm test:a11y` runs it; CI runs it as the job `a11y-gate`, which is the status a branch protection rule requires.

- **One list.** `tests/a11y/spec.ts` names A1–A20 and the runtime each needs (plain Node, a real browser, or the built standalone page); a test asserts the list is the research section's table, and each runtime's file asserts it implements exactly its numbers, so a check cannot be listed and not run.
- **A broken fixture per check.** Each check comes with the smallest fault that should make it fail, applied to the same mounted DOM (or source, or page). Three tests per check: it holds on the shipped view; it fails on its fixture; and its fixture trips no other check beyond those it declares in `alsoTrips`, with the reason, so a check is shown to fail on its own and an overlap is written down rather than discovered.
- **A1** runs axe-core over the built page in both colour schemes, as opened and with the detail panel up. Axe reported one rule, `page-has-heading-one`: the shell has no `<h1>`. That is a product change (a few bytes, and a visible-heading decision), filed as #211; A1 lists it as a known exception and fails if the exception stops being needed.
- **A9** asserts exactly one announcement per step, naming the entry and giving "of *N*". It does not assert `assertive`: the live region is `polite` (ADR-0027), and a reorder is something the reader just did, so interrupting speech with it would be worse. The research table's word is superseded.
- **A11 and A12** apply to a tooltip, and the matrix draws none: ADR-0027 puts that content in a non-modal panel. The checks hover and focus cells and test whatever `role="tooltip"` appears (none today), and A11 also asserts that the panel is not closed by any timer. They guard the day a tooltip is added; their fixtures plant one.
- **A13** is the composited ink against the composited backdrop, from computed styles with alpha laid over every ancestor's fill, for every fixture × shipped encoding × theme; texture strokes against 3:1. Not a canvas readback: the computed colour is the one the browser paints, and it is cheap enough to run on all of them. A14 is the one that reads pixels, from screenshots.
- **A14** runs the hardest tree (most score levels, most confidence layers) per theme; `tests/browser/cvd.test.ts` still runs every tree.
- **A15** asserts that `forcedColors` emulation took before it measures. It is honoured in Chromium and in Firefox at the pinned Playwright; WebKit is not in CI (see the amendment on #216 below), and B6 is the real-Windows pass.
- **B1–B8** are rows of `docs/release-notes-template.md`, with columns for environment, result and what was done; a test asserts every row is there, in the research section's words.

Where the gate is deliberately a different shape from the research table's wording, or narrower than it:

- **A11** patches `setTimeout`/`setInterval` and counts timers of 100 ms or more started while a tooltip is up, instead of searching a tooltip module's source (there is none); `requestAnimationFrame` and animation-end callbacks are not watched.
- **A12 and A11** allow a tooltip 350 ms to appear after each hover or focus, on two cells and one header of each kind, and see one that appears and goes again.
- **A15 and A18** assert more than presence: every text-bearing element and every glyph or hatch mark is measured as painted (alpha and `opacity`) against its backdrop, in forced colors, and against paper in print; every absent cell, of any reason, shows a glyph; no element of a cell has a background image. They run over a matrix with every reason code in force. "Snapshot diff reviewed" is replaced by those assertions; B6 is the human look.
- **A16 and A17** are source greps, as the table says, over `src/view` and `src/standalone` with comments blanked. They are blunt: they ban every gradient (the table bans only those that carry meaning, and the view has none) and every `title=`, and they can be bypassed by building a name at runtime. The runtime backstop for background images is A15/A18 above and `tests/browser/channels.test.ts`.
- **A20** scans every element at rest, while a header is held and while it is carried, for a transition, an animation or smooth scrolling under `prefers-reduced-motion: reduce`, and watches script's own scroll calls.
- **The release gate** is a procedure for a person: the template states that a row neither done nor explained blocks the release, and a `not run (why)` row is the releaser's published decision. Nothing ties the template to a release automatically.

## Amendment, 2026-10-13 (later): hardening (#213)

- **A16 and A17 have a mounted-DOM twin** in the browser half, beside the source greps: no element, under any fixture × encoding × theme, in grab mode or with the panel open, computes a `background-image` other than `none` or carries `title`, `aria-grabbed` or `aria-dropeffect`. A name built at runtime, or a style set from script, passes the grep and not the twin.
- **A11 watches for anything that closes a tooltip on the reader**, not only timers started while it was up: every timer (`setTimeout`, `setInterval`, `AbortSignal.timeout`, `scheduler.postTask` with a delay) of 100 ms or more that is still pending 100 ms after the tooltip appeared (so its own show delay is not one), a loop of 30 `requestAnimationFrame` requests after it, and, whatever the mechanism (including a CSS or Web Animations close), a tooltip that is gone 1.5 s after it showed with nobody touching it. `tests/a11y/watch.gate.ts` plants a tooltip that closes by each of the ways and asserts A11 sees it, tests the instrument itself, and checks that overlapping watches put the page's functions back only when the last ends.
- **A13** reports as unmeasurable, rather than passing, a `filter`, a `backdrop-filter`, a `mix-blend-mode` or a painted `::before`/`::after` overlay on a cell, anything inside it, or any ancestor up to the matrix.
- **A16's twin** also reads `::before` and `::after`, and again with a cell focused and hovered; **A17's** and A16's twins run over a header held, carried a step, the move menu open, a pointer drag under way, and the panel open.
- **A13, A15, A16, A18 and A20 run again in Firefox** (`tests/a11y/firefox.gate.ts`), the checks whose answer depends on what an engine does with an emulated medium or a computed style. The cross-fixture matrix runs in Chromium only (it took 13 minutes in Firefox).

## Amendment, 2026-10-13 (later still): WebKit is not in the gate, and why (#216)

The gate runs in Chromium, and the engine-dependent checks again in Firefox. **WebKit is deliberately out for now.** It would run the same five checks (forced colors, print, reduced motion, contrast, background images) under Safari's engine. What already looks at Safari is the manual pass, and only in part: B3 and B4 are VoiceOver announcements and B8 is print on Safari; **nothing looks at reduced motion, contrast or background images in Safari.** The case against is cost and meaning: WebKit is a further download and a further set of system libraries on every run (installed with `--with-deps`, not unavailable), the job is already the longest in the workflow (about 8 minutes against 2.5 for `browser`), Playwright sends `forcedColors` to WebKit but whether it recolours the page has to be confirmed rather than assumed (A15 refuses to pass if the emulation does not take, so adding it fails loudly rather than quietly), and macOS has no forced-colors mode, so a WebKit result for A15 would have no real Safari reader behind it.

Reversible: add `webkit` to `PW_ENGINES` in the `a11y-gate` job of `.github/workflows/ci.yml` (the one place the workflow names the engines: the cache key, the install and the system libraries all follow it), one more project in `vitest.a11y.config.ts` beside Firefox's, and the engine-dependent list in `tests/a11y/firefox.gate.ts` (a constant private to that file, so it is exported, or the file renamed `engine.gate.ts`, for a second engine to share it). Revisit if a Safari-only regression ships past the manual pass. The Playwright browsers are cached by engines, installed Playwright version and runner image; a miss installs them, a hit installs only the system libraries.

## Amendment, 2026-11-16: A21, a hatch is told in words (#355)

A hatch is `aria-hidden` and is safe only because the cell says its level in words ("5 of 5, confidence low"). **A21** (browser) mounts every hatch-carrying shipped encoding over every fixture and fails when a hatched cell has no visually hidden text, after its label, saying "confidence" or "agreement" and a level; it also fails when a hatch-carrying encoding is drawn over no fixture. It found that `consensus-suppressed` hatched with no words, so that encoding now says ", agreement low/medium/high" in each coloured cell. Its broken fixture empties one hatched cell's words and trips only A21. It checks that words are present, not that they agree with the hatch's density.

## Amendment, 2026-11-16: A22, a step carried by colour is shown in words where the fills are gone (#357)

The `value` encoding's fill says a step of the criterion's range that the cell's text does not. A screen reader hears it in the cell's hidden words; print and forced colors show no fill, so `CellMark.plain` shows the step beside the value there (#345). **A22** (browser) mounts `value` under forced colors and under print and fails when a coloured cell does not show its step, or no cell was coloured. It is its own check, with its own broken fixture, because A15 and A18 each have one. The legend's entries now say "Worst/Second/Middle/Fourth/Best step of the criterion's range", the cell's own words. Not generalised to every swatched encoding: `categorical`'s colour repeats the cell's text, so a rule over "a swatch with no badge" would flag a gap that is not one; an encoding whose colour carries what its text does not sets `plain`.

## Amendment, 2026-11-16: A21 checks agreement, A23 checks a rating's scale (#361)

**A21** gains a second pass, over the hatch density: within each mount, one density is said as one level, and a denser hatch is said as a strictly lower level than a sparser one, wherever the words can be ordered (low, medium, high, or digits). It has its own broken fixture, which swaps the words of the sparsest and densest hatch. **A23** (browser): a value cell on an ordinal criterion with a declared range is heard with its top ("4 of 5"); A3 only asked that a cell not be blank, so a cell that lost "of 5" passed it.

Known gap of the agreement half: with the gate's fixtures `consensus-suppressed` hatches one cell at one density, so its "one density, one level, denser is lower" is trivially true there and its swapped-words fixture cannot fire on it; the confidence half is proven on three-level words. A fixture with real rater spread is needed (#369). Words are compared within one column (each has its own scale), and read after the noun the hatch carries.

## Amendment, 2026-11-16: A22 sweeps every shipped encoding (#367)

A22 now mounts every shipped encoding over the relocation example under each medium: where an encoding sets `CellMark.plain` on any coloured cell, every coloured cell of it must show the words (displayed, non-empty); `value` must opt in and colour cells, or the check fails on nothing to check. An encoding that forgets `plain` on some cells is caught; one that never opts in is not (its colour either repeats the text, as `categorical`'s does, or carries the meaning another way). Omitted-block cells do not render `plain`: a block is a run of cells with no value, which `value` does not colour.
