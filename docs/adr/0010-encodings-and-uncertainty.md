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
