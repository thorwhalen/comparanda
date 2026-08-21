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
