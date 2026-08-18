# Research brief — visualisation and interaction

**Deliverable:** `docs/research/findings-visualisation.md`, plus a ranked, justified recommendation
of which views to ship in v1. Then implement the top ones.

## 1. The reorderable matrix, properly

Our heatmap-with-drag is a rediscovery of **Jacques Bertin's reorderable matrix** (*Sémiologie
graphique*, 1967; *La Graphique et le traitement graphique de l'information*, 1977). Read the
actual idea before implementing it — the claim is that permuting rows and columns is itself the
analytical act.

Then the algorithmic form, **seriation**:

- survey the algorithm families: spectral / eigenvector ordering, optimal leaf ordering over
  hierarchical clustering, TSP-based ordering, barycentre and crossing-minimisation heuristics,
  bond energy algorithm;
- what does the R `seriation` package implement, and what does its literature recommend as a
  sensible default for a small ordinal matrix with missing values?
- how do you present an automatic ordering so that it *invites* manual adjustment rather than
  fighting it?

Note that our matrices are small (tens × tens). Algorithms that are impractical at 10,000 rows are
entirely available to us — do not choose the fast approximation by reflex.

## 2. Other views worth having

For each: what question does it answer better than the matrix, and when does it mislead?

- **Parallel coordinates** — the classic multi-criteria view; each alternative is a line across
  criteria. Excellent for spotting trade-off shapes; sensitive to axis order (which is seriation
  again).
- **Scatter with a Pareto frontier** — two criteria at a time, with the non-dominated set marked.
- **Slope / bump charts** — how ranking changes between two criteria, or between raters.
- **Small multiples of dot plots** — one panel per criterion, alternatives as dots. Often the most
  honest view of ordinal data.
- **Radar / spider charts** — popular and *deeply* flawed (area scales with the square, shape
  depends on arbitrary axis order, encourages bogus area comparison). Investigate, and if the
  evidence is as damning as expected, either omit it or ship it with an explicit caveat. Do not
  ship it merely because users expect it.
- **Bump/rank-flow under weight changes** — the visual form of sensitivity analysis.
- **Stacked or diverging bars for multi-rater spread.**

## 3. Uncertainty visualisation

- **Value-suppressing uncertainty palettes** (Correll & Gleicher, 2018) — the basis of our blended
  encoding. Read the paper; implement as specified rather than by eye.
- Alternatives: bivariate colour schemes, texture and hatching, glyph size, blur, hypothetical
  outcome plots. Which survive contact with a dense table?
- The literature on whether people *correctly read* uncertainty encodings, which is less
  encouraging than the design literature implies.

## 4. Interaction

- Drag-and-drop for row/column reordering that is genuinely accessible — evaluate `dnd-kit` and
  alternatives on keyboard and screen-reader support, not just on feel. **A drag-only reorder is an
  accessibility failure**; there must be a keyboard path.
- Sticky headers and a sticky first column in a scrollable matrix, done robustly across browsers.
- Focus management, roving tabindex, and the right ARIA pattern for a 2-D grid (`role="grid"`
  semantics and their real screen-reader behaviour, which differs from the spec).
- Progressive disclosure for dense cells: what belongs in the cell, the tooltip, the side panel.

## 5. Accessibility, non-negotiable

- Never colour alone; always a text value or a one-click table view.
- Compute text contrast from the *rendered* background, including interpolated blend colours.
- Colour-vision-deficiency simulation for every palette; a texture channel for the print and
  forced-colors cases.
- Full keyboard operation of reorder, select, group, annotate.
