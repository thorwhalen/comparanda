# ADR-0024: The disagreement encoding is a rater dot strip

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0011 point 4 decides that disagreement is an encoding, and leaves the glyph open. This ADR
closes it.

The brief is a cell of roughly 40 × 30 px holding two to five assertions on a K-level ordinal
scale. At that size the instinct is to compress, and compression is exactly the wrong move: ADR-0011
calls a cell where two experienced people scored 2 and 5 the most decision-relevant cell on the
page, and a mean of 3.5 the one representation guaranteed to destroy that information. The design
problem is not fitting the distribution into the cell but **refusing to summarise it**. This is the
one place in the view where a mean can re-enter wearing a different name — as a centroid, a density
peak, a bar's midpoint — and every candidate glyph has to be judged on whether it lets that happen.

Size is the binding constraint on the answer. 40 × 30 px is about 10 × 8 mm, *smaller* than the
stimuli in the closest published glanceable-reading study [2]. Cleveland and McGill's ordering puts
position along a common scale first and shading or saturation last [1]. At this size position
survives; area, angle and saturation degrade.

## Decision
**The `disagreement` encoding is a rater dot strip.** The criterion's K ordinal levels are fixed
slots across the cell, one filled dot per assertion sits in its level's slot, and ties stack.

It is chosen for five properties, in this order:

- It uses **position along a common scale**, the most accurately read channel [1].
- **`n` is countable, not encoded.** The reader counts dots rather than decoding an area.
- **Bimodality is a literal gap.** The most decision-relevant cell becomes the most visually
  distinctive one on the page with no statistic in the loop.
- **No mark sits where a mean would be.** This is a *structural requirement, not a guideline*: any
  candidate for the cell that places ink at the centroid, the density peak or the midpoint of the
  assertion set is disqualified, whatever else it does well. The strip meets the requirement by
  construction rather than by convention, which is the point — a convention erodes under the next
  parameter change, and a construction does not.
- **Its text alternative is the exact multiset.** The cell's accessible name states the count and
  then every asserted level in ascending order, with repeats repeated: *"3 raters: 2, 2, 5."* Not a
  range, not a mode, not "mixed" — the multiset, in full. It is delivered as ADR-0027's
  visually-hidden cell text, so a screen-reader user and a sighted colleague read the same thing
  aloud. This satisfies ADR-0010's "never colour alone" trivially and survives forced colors, print
  and every colour-vision deficiency.

It is the same discrete-outcomes idea validated as quantile dotplots on small screens [3], except
that at n ≤ 5 the dots *are* the data rather than a sample of it.

**Degradation is by available width, in two steps, both parameters of the encoding.** Below a
configurable width the strip degrades to a **range bracket** — min to max with the mode or modes
marked, no central mark. Below a second threshold it degrades to the `disagreement-spread` ramp.
The thresholds are registered parameters, not constants in the renderer, and are set against
measured glyph legibility rather than guessed. Neither degraded form introduces a mark at the mean.

**Ship `disagreement-spread` as the zoom-out companion.** A sequential ramp — one hue, light to
dark, per ADR-0010 — whose domain is the per-cell dispersion statistic ADR-0022 defines **and
nothing else**. Value never enters the mapping. That is what makes the ramp honest, and it is why
the ramp is the thing you sort on, thumbnail and print small, while the strip is the thing you read.

**Ship `consensus-suppressed` as a parameter change on `uncertainty-suppressed`**, not as a new
encoding family: the same value-suppressing palette [4] with disagreement substituted for
confidence. It costs a registration.

**The diverging stacked bar lives in the detail panel and the column summary only**, never in a
matrix cell.

**The strip enumerates assertions, and names what kind of assertions they are.** Five draws of one
model must not read as five independent raters. Where the assertion set carries a per-assertion
independence rung — the cross-repo field requested in `docs/cross-repo-coordination.md` §5.1 — the
strip's label and accessible name carry the lowest rung present in the set, and below the
independent rung the cell reads as self-consistency rather than as rater disagreement. The rule for
labelling the *statistic* is ADR-0022's; this is its view-side half, and it is stated here because
a glyph that shows a shape without saying whose shape it is has the same gap the statistic does.

## Consequences
Adding all three encodings costs registrations, not a schema change — ADR-0003 decision 2 paying
for itself again.

The cell's data path must reach the assertion set, not a pre-computed reduction. ADR-0011 point 3
already stores every assertion, so nothing new is stored; but a view that reduces before it renders
cannot fall through to this encoding, and that constrains the core-to-view boundary of ADR-0005.

What becomes hard is deliberate: the strip cannot be sorted on, thumbnailed or summarised into a
column header, because a picture of a gap does not order. That work belongs to the ramp, which is
why the ramp is a shipped encoding rather than a fallback.

The layout parameterises over K and n rather than being tuned for n = 3. How many raters real
analyses carry is unknown, and a design tuned to the guess would have to be rebuilt when the guess
is wrong.

## Open question
**Does the strip actually beat the ramp for the "find the contested cell" task?** The perceptual
argument is strong but indirect — nobody has tested distribution glyphs at 40 × 30 px for that
task. It is settled by a small within-subjects study once the view exists, not by argument.

**Interim position: ship both, and make switching between them one keystroke.** That obligation
falls on the view now, while it is cheap, rather than after the study.

## Alternatives considered
- *Gradient or violin cells.* Displays of mean and error by construction [5] — a rejection on fit,
  not on quality — and a kernel density estimate over three integers is fabricated data.
- *In-cell diverging stacked bars.* The right chart for Likert data [6], but they need a declared
  midpoint, which ADR-0010 forbids on ordinal data, and an `n` large enough for proportions to mean
  anything. Hence the detail panel and the column summary.
- *Jitter to separate ties.* Random displacement that carries no information at n ≤ 5 and changes
  between renders.
- *Any central-tendency glyph — mean with error bars, box plot, a single mark at the median.* The
  thing this ADR exists to forbid. A box plot additionally spends most of its ink on quartiles that
  are undefined at this `n`.
- *Tastle and Wierman's consensus measure as the ramp's domain.* It computes the arithmetic mean of
  the ordinal codes internally; rejected in ADR-0022, where the ramp's domain is decided.

## References
The full reasoning, including the per-cell shape statistic and the rejected agreement coefficients,
is in `docs/research/findings-terminology.md` § 5; open question 11 in that document's § 9 is the
one recorded above.

1. [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods — Cleveland & McGill (1984), JASA 79(387):531–554](https://www.jstor.org/stable/2288400)
2. [Glanceable Visualization: Studies of Data Comparison Performance on Smartwatches — Blascheck, Besançon, Bezerianos, Lee & Isenberg (2018), IEEE TVCG](https://www.microsoft.com/en-us/research/wp-content/uploads/2018/08/GlanceableVis-InfoVis2018.pdf) — stimuli 28.73 mm square.
3. [When (ish) is My Bus? User-centered Visualizations of Uncertainty in Everyday, Mobile Predictive Systems — Kay, Kola, Hullman & Munson (2016), CHI](https://dl.acm.org/doi/10.1145/2858036.2858558)
4. [Value-Suppressing Uncertainty Palettes — Correll, Moritz & Heer (2018), CHI](https://www.domoritz.de/papers/2018-VSUPs-CHI.pdf)
5. [Error Bars Considered Harmful: Exploring Alternate Encodings for Mean and Error — Correll & Gleicher (2014), IEEE TVCG 20(12):2142–2151](https://graphics.cs.wisc.edu/Papers/2014/CG14/Preprint.pdf)
6. [Design of Diverging Stacked Bar Charts for Likert Scales and Other Applications — Heiberger & Robbins (2014), Journal of Statistical Software 57(5):1–32](https://www.jstatsoft.org/v57/i05/)
