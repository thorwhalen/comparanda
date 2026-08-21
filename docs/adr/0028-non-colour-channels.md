# ADR-0028: Non-colour channels — texture, forced colors, print

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0009 requires that a reader tell one missingness reason from another without colour, and
ADR-0010 forbids colour alone for any encoding. Neither says *which* channel carries the meaning,
and the obvious implementation destroys both requirements in the same instant.

Under `forced-colors: active` the user agent overrides background, border, text, fill, stroke and
outline colours with system colours, `box-shadow` computes to `none`, and `background-image`
computes to `none` unless the original value contained a `url()` [1]. A `repeating-linear-gradient()`
is the near-universal way to build a texture channel in CSS, and it is a background image. So a
matrix built from a background-colour ramp plus gradient hatching loses **both** channels at once
and renders as a grid of identical Canvas-coloured boxes. Print does the same thing more quietly:
backgrounds are omitted by default.

That is the exact failure ADR-0009 and ADR-0010 each exist to prevent, arriving through a mechanism
neither of them names.

## Decision
**Every meaning-bearing non-colour channel is drawn in the foreground.** Inline `<svg>` inside the
cell, `stroke="currentColor"` — never a `background-image`, never a `box-shadow`. Foreground strokes
are *recoloured* by forced-colors mode rather than deleted, and they print. The rule is absolute: if
a channel carries meaning, it is not in the background.

**Two channels, never overloaded.**

- **Hatch density carries confidence**, at most three levels, aligned to the uncertainty layers of
  the value-suppressing palette (ADR-0010).
- **Glyph shape carries the missingness reason**, because shape has no degradation path.
  `not-applicable` and `not-assessed` are different *facts*, not different amounts of one fact, and
  that distinction must never ride on a density the reader has to compare against a neighbouring
  cell.

Neither channel ever does the other's job. Three densities is a deliberately coarse ceiling: texture
reads well as an uncertainty signifier [8], but no controlled study of hatch discriminability at
24–40 px cell height was found, so the cap sits where craft is confident rather than where the
channel might stretch (`docs/research/findings-visualisation.md` § 3.4). Confidence read more finely
than three levels belongs in the detail panel, not in the cell.

**Glyphs key on the core reason codes, and custom codes inherit.** ADR-0009's reason-code set is
open, and every code declares a `broader` ancestor among the closed core six. The glyph table is
defined over those six; a deployment's custom code renders its ancestor's glyph beside its own text
label. No renderer switches on a literal code — that is ADR-0009's rule applied to the view.

**`texture` is a required field of an encoding registration**, and registration refuses an encoding
that omits it (ADR-0010). An encoding with no texture is an encoding that disappears under forced
colors.

**A `@media (forced-colors: active)` block is part of the matrix stylesheet, not a polish pass.** It
restores an explicit border on every cell — the ramp that gave the grid its structure is gone —
swaps the colour legend for a text legend, and sets `forced-color-adjust: none` on nothing except
the small legend swatches whose only job is to demonstrate the palette.

**Print is designed to be legible in greyscale with backgrounds off.** `print-color-adjust: exact`
is set as a hint and treated as one, because no user agent guarantees to honour it [2]. The print
stylesheet must be correct without it; if the printed page needs the hint, the stylesheet is wrong.

**Colour-vision-deficiency simulation runs in CI against a rendered screenshot**, so what is tested
is the composited blend rather than palette tokens in isolation. Machado 2009 [4] or Viénot 1999 for
protan and deutan; **Brettel 1997 for tritan**, because the others were not designed for it; never
the Coblis V1 / "ColorMatrix" matrices, disowned by their own author [5]. Decode sRGB to linear
light before applying the matrix and re-encode after — applying the right matrix to gamma-encoded
sRGB is the common failure, not choosing the wrong paper [5]. DaltonLens's published SVG
`feColorMatrix` filters are the implementation [6]. For *designing* the palette rather than checking
it, Okabe & Ito [7]: redundant coding and direct labels, never a colour-coded key.

**Contrast thresholds are named constants, not literals at call sites:** `TEXT_CONTRAST_MIN = 4.5`
for cell text, and `GRAPHIC_CONTRAST_MIN = 3` for the texture stroke, cell borders, the focus ring
and every meaning-bearing glyph. SC 1.4.11 glosses "graphical objects" as covering the important
parts of a more complex diagram, and a confidence hatch is one [3].

ADR-0029 owns the gate that enforces all of this.

## Consequences
The matrix stays readable under forced colors, in greyscale print and under every simulated
deficiency, because the meaning was never in the background to begin with. The property that
survives forced colors is the same property that survives print, so one rule buys both.

The costs are real. Every encoding author must supply a texture, and registration refuses without
one. Confidence gets three levels in the cell and no more. Inline SVG per cell is more DOM than a
background gradient, affordable only because ADR-0002 caps the matrix at tens to low hundreds of
alternatives. And CVD checking needs a real browser rendering a real screenshot in CI, which is a
slower pipeline.

## Alternatives considered
- *CSS gradient hatching.* Vanishes exactly when it is needed most, and takes the colour ramp with
  it.
- *One channel carrying both confidence and missingness reason.* Two meanings in one visual
  variable; the collision is guaranteed, and it lands on the distinction ADR-0009 cares most about.
- *More than three hatch densities.* Buys resolution nobody has shown to be readable at cell size.
- *A colour ramp plus the text numeral, and no texture at all.* Satisfies "never colour alone"
  literally, and leaves confidence with no visual channel in the one view built to show it.
- *Checking CVD against palette tokens instead of a screenshot.* Cheaper, and blind to the
  composited blend, which is the thing a reader actually sees.
- *Treating forced colors and print as a later accessibility pass.* Precisely what BRIEF.md's
  "accessibility is not a later pass" refuses.

## Amendments

### 2026-08-21 — The missing-cell channels, and the forced-colors block never overwrites a meaning-bearing border

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

ADR-0009 clause 9 delegates the flag-to-channel assignment here; ADR-0010 clause 7 pre-empted it with
a different one, and the two collide on fill pattern versus hatch density. This section takes the
delegation and rules. ADR-0010's list is withdrawn in its amendment of the same date.

**A missing cell and a valued cell are disjoint populations, and "two channels, never overloaded" is
stated over each.** A missing cell carries no value and therefore no confidence, so the hatch channel
is not in play there; a valued cell carries no reason code, so the glyph channel is not in play
there. Within each population no channel does another's job, which is what the Decision's rule was
protecting.

For a **missing** cell, three channels:

- **figure versus ground carries `structural`** — a structurally absent cell has no ink and reads as
  though there were no cell there, a contingently absent one carries a placeholder (ADR-0010
  clause 7).
- **glyph shape carries the reason code**, keyed on the closed core six, custom codes rendering their
  `broader` ancestor's glyph beside their own text label. Unchanged from the Decision.
- **border style carries `terminal`** — dashed means work remains, solid means this is the answer.
  Style is the right variable for it: forced-colors mode overrides border *colour* and leaves border
  *style* alone [1], and a dashed rule prints with backgrounds off.

For a **valued** cell, hatch density carries confidence at no more than three levels, exactly as the
Decision says, and nothing else ever rides on it.

**The forced-colors block restores border colour and width, never border style.** The Decision
requires that block to restore "an explicit border on every cell" because the ramp that gave the grid
its structure is gone. Written as a blanket `border: 1px solid`, it would delete the one missing-cell
channel that survives forced colors by construction. Restore the colour and the width; take the style
from the cell's `terminal` flag there as everywhere else.

`informative` is deliberately absent from this assignment. ADR-0010's amendment of the same date
records why: it is advisory, it is not in the shipped schema, and it is derivable from the reason code
the glyph already carries.

## References
The evidence and the full argument are in `docs/research/findings-visualisation.md` § 4.5; the
coarse-channel reasoning is in § 3.4 and the two-channel resolution in § 7.6. Viénot (1999) and
Brettel (1997) are named as the right models for their respective deficiency types on the authority
of [5]; the primary papers were not read for this decision.

1. [CSS Color Adjustment Module Level 1 — Forced Colors Mode, W3C](https://www.w3.org/TR/css-color-adjust-1/)
2. [`print-color-adjust` — MDN Web Docs, Mozilla](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)
3. [Understanding SC 1.4.11: Non-text Contrast (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
4. [A Physiologically-based Model for Simulation of Color Vision Deficiency — Machado, Oliveira & Fernandes, IEEE TVCG 15(6) (2009)](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)
5. [Review of Open Source Color Blindness Simulations — DaltonLens (2021)](https://daltonlens.org/opensource-cvd-simulation/)
6. [Accurate SVG filters for color blindness simulation — DaltonLens](https://daltonlens.org/cvd-simulation-svg-filters/)
7. [Color Universal Design — How to make figures and presentations friendly to colorblind people — Okabe & Ito](https://jfly.uni-koeln.de/color/)
8. [Visual Semiotics & Uncertainty Visualization: An Empirical Study — MacEachren, Roth, O'Brien, Li, Swingley & Gahegan, IEEE TVCG 18(12) (2012)](https://dl.acm.org/doi/abs/10.1109/TVCG.2012.279)
