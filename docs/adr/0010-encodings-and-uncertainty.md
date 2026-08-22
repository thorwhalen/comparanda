# ADR-0010: Encodings are pluggable; uncertainty is encoded, not annotated

- **Status:** accepted
- **Date:** 2026-08-18

## Context
The prototype this specification derives from carried a score and a confidence per cell, and
offered three ways to look at the grid: score alone, confidence alone, and a blended view in which
low confidence visually suppressed the score. The blended view was the one that changed minds,
because it made *high-score-thin-evidence* cells recede instead of shout.

## Decision
**Encodings are named, parameterised, pluggable mappings** from one or more measures to a visual
channel, registered against the view rather than hard-coded. Ship at least:

- `value` — a sequential ramp over a single measure;
- `categorical` — a fixed-order hue assignment for nominal measures;
- `uncertainty-suppressed` — the blended encoding: the value drives the colour step, and low
  confidence pulls that step toward the surface, with a secondary channel (hatching) so that an
  uncertain high value and a certain low value are never confusable.

The third has a name in the literature — **value-suppressing uncertainty palettes** (Correll &
Gleicher) — and the implementation should follow it rather than improvising.

Constraints on any encoding:
- **Never colour alone.** The cell carries its value as text, or a table view is one click away.
- **Text contrast is computed from the rendered background**, not assumed from the score. Blended
  encodings land on arbitrary intermediate colours, and a fixed lightness threshold gets some cells
  wrong in some theme. Pick the ink that actually wins on contrast ratio.
- **Sequential means one hue, light to dark**; the ramp direction inverts for a dark surface, and
  both directions are validated against their own surface.
- **Ordinal data does not get a diverging palette** unless a meaningful midpoint is declared.

## Consequences
Adding a new lens — rater disagreement, staleness, completeness — costs a registration, not a
schema change. The rule that the ink is computed rather than assumed is a small amount of code
that removes an entire class of theme-dependent legibility bug.

## Amendments

### 2026-08-21 — The encoding roster, the VSUP construction, and contrast as a build-time test

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section amends the Decision above. The Context and the Consequences stand as written, except
that clause 9 corrects how the Context's "changed minds" is to be read; every constraint in the
Decision stands except where a clause here replaces one. The argument is in
`docs/research/findings-visualisation.md` § 3 and § 4.5 and in
`docs/research/findings-terminology.md` § 1, § 4 and § 5; the implementable spec is
`docs/research/sections/c6-views-and-uncertainty.md` § B.1 and § B.4. This is the ruling, not the
argument.

**1. Five more encodings ship.** The roster is `value`, `categorical`, `uncertainty-suppressed`,
plus:

- **`missingness`** — colours the matrix by reason code rather than by measure, so that "what is
  left to do here" is a view, not a report (ADR-0009).
- **`datum`** — Pugh's better / same / worse against one designated alternative [3]. It reads
  existing measures and emits a mark, so it is an encoding and not a total column; four counts,
  never a net. ADR-0015 owns the tally, this owns the mark.
- **`disagreement`** — the rater dot strip.
- **`disagreement-spread`** — a sequential ramp whose domain is a dispersion statistic and nothing
  else.
- **`consensus-suppressed`** — the value-suppressing encoding re-parameterised with disagreement in
  place of confidence.

The last three are specified in ADR-0024; this clause only puts them on the roster. None of the five
costs a schema change, which is ADR-0003's measures-versus-encodings split paying for itself four
times over.

**2. The VSUP tree is parameterised, and its merge tree is ordinal — deviation 1.** The
`uncertainty-suppressed` parameters are named and declared per registration: `scoreLevels`,
`confidenceLevels`, `mergeTree`, `ramp`, `surface`, `suppressionSpace` and `hatchLevels`, spelled
out in `docs/research/sections/c6-views-and-uncertainty.md` § B.1.

The reference implementation bins uniformly, which suits continuous data. Ours is not continuous: a
score has *k* declared levels and confidence has *m*. So the leaf layer is exactly the *k* score
levels and each higher layer merges adjacent groups — for the common `k = 5, m = 3`,
`{1}{2}{3}{4}{5}` → `{1,2}{3}{4,5}` → `{1,2,3,4,5}`, **nine colours**, well under the paper's
sixteen-colour ceiling [1]. This is a deliberate deviation from what was tested, inside the design
space the paper itself opens: "non-uniform binning would allow the designer to target particular
distributions or important subregions of the data" [1]. It buys the thing this project is for —
every colour now corresponds to a **nameable set of levels**, so the legend and the tooltip say
"2 or 3, low confidence" in words instead of asking a reader to invert a ramp.

Three properties are load-bearing and must be tested:

- **We store confidence, not uncertainty.** `û = 1 − normalise(confidence)`. Getting this backwards
  inverts the whole encoding and looks entirely plausible. Unit-test the corners.
- **Do not "fix" the root.** At the top layer the representative `û` is (L−1)/L, so the
  most-uncertain colour sits partway to the surface and not at it. That is what keeps a maximally
  uncertain cell distinguishable from a **missing** one, and missing means something specific here
  (ADR-0009).
- **The legend states the aliasing in words.** "At low confidence, all scores are shown as one
  colour" is a claim about what the reader *cannot* see, and no ramp communicates it. The wedge form
  is chosen for communication, not for measured performance — the paper found no significant effect
  of legend shape on identification accuracy (F(1,70)=0.04, p=0.84) [1] — and nobody should later
  defend it as an empirical result.

**3. Suppression targets the theme surface, not white — deviation 2.** `surface` is a required
parameter carrying the actual rendered cell surface of the active theme. The reference
implementation hardcodes `#fff` [2]; on a dark surface, interpolating toward white makes the
least-trustworthy cells the brightest things on the page, which is the exact inverse of the intent.
A hardcoded white is a defect, not a default.

Clauses 2 and 3 qualify the Decision's instruction to follow the published technique "rather than
improvising". Both deviations are deliberate, both are recorded here as deviations, and neither is
to be rediscovered later as an accident.

**4. Texture is a reserved channel, and `texture` is a required field of a registration.** Texture
carries uncertainty and absence. It is never a general categorical channel, because a categorical
hatch would compete with the two meanings that have no other survivable channel. Every encoding
declares its `texture` at registration and **registration fails without it** — an encoding that
carries no texture says so, rather than saying nothing.

Texture is rendered in the **foreground**, as inline `<svg>` inside the cell with
`stroke="currentColor"`, never as a background. Under `forced-colors: active`, `background-image`
computes to `none` unless the value contains a `url()` [9], which deletes `repeating-linear-gradient()`
hatching — so a matrix built from background colours plus gradient hatching loses both channels at
once and renders as a grid of identical boxes. Hatch density is coarse: at most three levels, aligned
to the VSUP layers. ADR-0028 owns the channel details; the required field is here because it is a
property of registration.

**5. Ramps are declared per encoding, and the suppressed ramps reserve lightness headroom.** This is
a stated exception to the Decision's "sequential means one hue, light to dark". That rule is right
for `value`. It is wrong for `uncertainty-suppressed` and `consensus-suppressed`, whose suppression
channel *is* lightness: a ramp that has already spent its lightness range collides with the encoding
riding on top of it, which is why the originating paper uses a ramp with neither a very light nor a
very dark endpoint [1]. Ramps are therefore per-encoding parameters, never a single shared ramp.

**6. Contrast: gate on WCAG 2.x, tie-break on APCA, and compute it at build time.** This replaces
the Decision's render-time framing, and the change of kind is the point.

- **Get the background that is really painted.** Composite every layer — cell fill, row stripe,
  hover and selection overlays, focus backdrop — in paint order in gamma-encoded sRGB, because that
  is how browsers composite. The suppression interpolates in CIELAB, so convert back to sRGB and
  gamut-clamp *before* measuring, or you measure a colour the screen never showed.
- **Two luminance functions that share no code.** WCAG 2.x relative luminance is piecewise, with a
  linear segment below 0.04045 — skipping it is wrong for dark colours, which is precisely the
  dark-theme suppressed region — and coefficients 0.2126 / 0.7152 / 0.0722 [4]. APCA uses a plain
  2.4 exponent with no toe, longer coefficients, and a low-luminance clamp on both text and
  background [5]. Name them `relativeLuminanceWcag()` and `screenLuminanceApca()`.
- **Gate on WCAG**: `TEXT_CONTRAST_MIN = 4.5` (SC 1.4.3) and `GRAPHIC_CONTRAST_MIN = 3` for texture
  strokes, cell borders, focus rings and any meaning-bearing glyph (SC 1.4.11, whose Understanding
  document glosses "graphical objects" as covering the important parts of a complex diagram [10]).
  APCA is **not** the WCAG 3 method: it was removed from the working draft in 2023, and as of the
  April 2026 editor's draft the group still states the WCAG 3 contrast algorithm is undetermined
  [6]. WCAG 2.1/2.2 AA is also a live legal obligation [8].
- **Tie-break on APCA**, because WCAG 2's ratio behaves badly in the dark region [7] — exactly where
  a dark-theme VSUP puts its most-suppressed cells. Tie-breaking *within* an already-conforming set
  cannot cause a conformance failure, so it is free.
- **This is a build-time test.** The palette is finite and knowable before the app starts: nine
  colours × two themes plus a few overlays. Enumerate the swatches, assert them in CI via
  `assertPaletteLegible(encoding, theme, overlays)`, and keep the render path free of colour maths.
  **If the passing set is ever empty, that is a palette bug, not a runtime condition** — the repair
  moves the *background* (pull the most-suppressed swatch further from the surface, or reduce the
  root suppression fraction). Accepting a failing ink at render time is how the prototype's
  theme-dependent legibility bug happens again.

**7. Structural absence is the absence of ink; contingent absence is the presence of a placeholder.**
`not-applicable` should not look like an empty cell — it should look like there is no cell there.
The channel is figure-versus-ground rather than hue, which is why it reads correctly in greyscale,
in forced-colors mode, in print, and to a reader with a colour-vision deficiency. Three independent
non-hue channels: **border encodes `terminal`** — dashed means work remains, solid means this is the
answer — **glyph shape encodes the specific reason**, and **fill pattern encodes `informative`**
(ADR-0009). Two prohibitions: never take a missing cell's colour from the sequential value ramp, an
inverted ramp passes through the mid-greys and will collide in one theme; and never let a missing
cell's accessible name be an em dash — every missing cell exposes its reason as text, and the
missingness key sits in the legend with counts.

**8. Encodings are plain named exports, registered explicitly by the composition root.** No module
registers itself at module scope. Under `"sideEffects": false` — which is what you must declare to
get good tree-shaking — esbuild removed a module whose only purpose was its module-scope
`register(...)` call, *from the bundle that needs it*, shipping an empty registry with no error.
This is a correctness requirement under that declaration, demonstrated, not a style preference; it
is ADR-0017 decision 4, restated here because it is a property of the encoding registry.

It also improves the product: a consumer who only wants `value` and `uncertainty-suppressed` does not
ship `disagreement`, `staleness` and `completeness`, and tree-shaking now works in their favour
rather than against them.

*Rejected:* a `sideEffects` glob array listing the encoding modules. It keeps self-registration
working, but force-retains every encoding the view barrel imports — forfeiting the per-consumer
shaking that motivates the rule — and requires hand-maintaining the glob list as encodings are
added.

**9. What the blend actually buys — this corrects the Context above, and BRIEF.md.** The Context
says the blended view "was the one that changed minds", and BRIEF.md repeats it as the most valuable
single feature. The originating study supports that as a claim about **decisions**, and refutes it as
a claim about **readability** [1]:

| Comparison | Result |
|---|---|
| VSUP vs traditional discrete bivariate (identification accuracy) | F(1,70)=1.4, p=0.24 — **no significant difference** |
| VSUP vs traditional (distribution of choice uncertainty) | KS D=0.5, p=0.03 — VSUP readers avoided the most uncertain options |
| VSUP vs traditional (value accepted) | M=0.32 vs 0.29, t=2.3, p=0.02 — VSUP readers accepted worse expected value to do so |

Read plainly: the blend does not make the matrix easier to read. It makes readers discount thin
evidence. The base is n=24 crowdworkers, one synthetic task, one lab, so the claim is graded
moderate. Nobody writes "research shows the blended encoding improves decisions"; the sentence that
is defensible is "in the study that introduced this technique, participants using it avoided the
most uncertain options and accepted worse expected value to do so."

Two consequences follow, and they are why the Decision's constraints are not decorative. **The score
stays as text in every cell** — text is the channel that is read correctly, the blend is the channel
that changes decisions, and they are different jobs. And **a single-measure `confidence` encoding
stays one click away**, because "where is the evidence thin across this whole analysis?" is a
different question from "how good is this cell?" and the paper concedes that a reader asking the
first is better served by juxtaposition [1].

#### References

1. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer, CHI 2018](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
2. [`vsup` — reference implementation, MIT licence (UW Interactive Data Lab)](https://github.com/uwdata/vsup)
3. [The Pugh Controlled Convergence Method: Model-Based Evaluation and Implications for Design Theory — Frey, Herder, Wijnia, Subrahmanian, Katsikopoulos & Clausing, Research in Engineering Design 20 (2009)](https://dspace.mit.edu/handle/1721.1/49448)
4. [Web Content Accessibility Guidelines (WCAG) 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/)
5. [`apca-w3` — W3-licensed APCA reference implementation, Beta 0.1.9, Somers (2022)](https://github.com/Myndex/apca-w3)
6. [WCAG3 Contrast as of April 2026 — Adrian Roselli (2026)](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)
7. [It's time for a more sophisticated color contrast check for data visualizations — Lisa Charlotte Muth, Datawrapper (2022)](https://www.datawrapper.de/blog/color-contrast-check-data-vis-wcag-apca) — the widely-quoted "half of WCAG-passing pairs are not actually accessible" figure originates with the APCA author's own testing and no independent replication was located; it is motivating, not proof.
8. [Fact Sheet: New Rule on the Accessibility of Web Content and Mobile Apps Provided by State and Local Governments (ADA Title II) — US Department of Justice](https://www.ada.gov/resources/2024-03-08-web-rule/)
9. [CSS Color Adjustment Module Level 1 — Forced Colors Mode — W3C](https://www.w3.org/TR/css-color-adjust-1/)
10. [Understanding SC 1.4.11: Non-text Contrast (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

### 2026-08-22 — `informative` still gets no visual channel, but for one reason instead of two

- **Status:** accepted
- **Date:** 2026-08-22

The amendment below withdraws a visual channel for `informative` and gives two reasons: that
ADR-0009 clause 2 "makes it advisory where `structural` and `terminal` are mandatory", and that
"neither `docs/domain-model.md` nor the shipped `MissingCodeFacts` carries it".

**Both of those premises are now false.** ADR-0009's amendment of 2026-08-22 lands the flag in
`MissingCodeFacts`, in the core table and in the domain model, and reclassifies it from advisory to
load-bearing, because `silenceRate` now keys on it.

**The conclusion is unchanged.** It rested on a third reason that stands on its own: `informative`
is derivable from the reason code the glyph already shows, and a derivable flag does not earn a
third visual variable in a 40 × 30 px cell. It continues to be carried in words — in the cell's
accessible name and in the legend's missingness key, which clause 7 already requires to exist.

Recorded rather than left alone because the next reader would otherwise find a live decision resting
on two dead premises, and could not tell which of the three reasons was load-bearing.

### 2026-08-21 — Clause 7's channel assignment defers to ADR-0028

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

Clause 7 names three non-hue channels for a missing cell — border for `terminal`, glyph shape for the
reason, fill pattern for `informative` — and it should not have named any of them. ADR-0009 clause 9
delegates "which non-colour channel carries which flag" to the accessibility ADR on non-colour
channels, and clause 4 above says in its own words that "ADR-0028 owns the channel details". Clause 7
specified where it was meant to defer, and it collided: fill pattern and ADR-0028's hatch density are
one visual variable, and ADR-0028 gives that variable to confidence.

**ADR-0028's assignment governs**, in its amendment of the same date. What stands in clause 7 is
everything that is not a channel assignment: structural absence as the absence of ink and contingent
absence as the presence of a placeholder, the figure-versus-ground argument for why that survives
greyscale, print and forced colors, and both prohibitions — never take a missing cell's colour from
the sequential value ramp, and never let a missing cell's accessible name be an em dash. The
three-channel list is withdrawn.

One part is withdrawn outright rather than relocated: **`informative` gets no visual channel.**
ADR-0009 clause 2 makes it advisory where `structural` and `terminal` are mandatory, and neither
`docs/domain-model.md` nor the shipped `MissingCodeFacts` carries it. An advisory flag that is
derivable from the reason code the glyph already shows does not earn a third visual variable in a
40 × 30 px cell. It is carried in words instead — in the cell's accessible name and in the legend's
missingness key, which clause 7 already requires to exist.

### 2026-08-22 — The roster grows to nine, and `text-only` is decided in ADR-0032

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The 2026-08-21 amendment fixes the roster at eight. **ADR-0032 adds a ninth, `text-only`, and makes
it the only encoding v1 registers.** It also records a consequence of ADR-0018's amendment of this
date for the parameterised palette here: once a criterion's scale is a declared, extensible thing, a
column's arity is a property of that scale and can no longer be assumed from a fixed level count, so
the build-time contrast test's nine colours for five scores by three confidence levels stops being a
constant.

Nothing here is reversed and no shipped encoding is withdrawn — read the roster as nine, read the
palette's arity as derived rather than fixed, and read ADR-0032 for why the ninth is the one v1
ships first.
