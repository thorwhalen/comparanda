---
name: comparanda-dev-a11y-gate
description: Use when writing or reviewing any comparanda view code — the matrix, encodings, reordering, grouping, selection, tooltips, the detail panel, or the standalone bundle. Covers the four non-negotiable accessibility constraints (never colour alone, computed contrast from the rendered background, a keyboard path for every drag, distinguishable missingness), the grid ARIA and focus pattern, the zero-network standalone rule, and the acceptance checklist a view PR must pass. Trigger on any view/component work, on adding an encoding or a palette, on reorder/drag interaction, or on the single-file build.
metadata:
  audience: developers
---

# The comparanda view gate

Accessibility here is **not a later pass** — the BRIEF says so explicitly, and every constraint
below exists because the prototype this specification derives from got it wrong in a way that was
invisible until someone switched themes.

## Four constraints that fail a PR on their own

### 1. Never colour alone

Every cell carries its value as text, or a table view is one click away (ADR-0010). This is not
only a colour-vision-deficiency concern: it is what makes the matrix readable in print, in
`forced-colors` mode, and in a screenshot someone pasted into a document.

Missingness must be distinguishable **without colour** too, and not merely different in the data
(ADR-0009). `not-applicable` should read as *"correctly nothing"*; `not-assessed` should read as
*a gap*. They mean opposite things about whether work remains. Use a hatch, a glyph, a rule —
something with a shape.

### 2. Text contrast is computed from the actual rendered background

Not assumed from the score. This is called out as one of the two lessons worth inheriting from
the prototype:

> A fixed lightness threshold produced unreadable cells in one theme and not the other, and
> blended encodings land on arbitrary intermediate colours where no threshold is correct.

So: take the colour the cell actually painted — including an interpolated blend — and pick the
ink that wins on measured contrast. Get the sRGB linearisation right; the naive version of this
computation is wrong in the mid-range, which is exactly where blended encodings live.

### 3. Every drag has a keyboard path

**A drag-only reorder is an accessibility failure** (ADR-0008). Reordering rows and columns is
the analytical act in this tool — Bertin's reorderable matrix — so gating it behind a pointer
gates the product's central feature. Ship: select a header, arrow keys to move, a commit and a
cancel, a live-region announcement of where the item landed, and focus that stays on the moved
item afterwards.

The same applies to select, group, and annotate: full keyboard operation, not partial.

### 4. Encodings are registered explicitly by the composition root

Not self-registered at module scope. Under `"sideEffects": false` a bundler will delete a
self-registering module and ship a renderer with an empty registry **and no error**. This is a
demonstrated correctness bug, not a style preference (see the visualisation findings).

## Grid semantics

Use the real ARIA grid pattern with a roving tabindex, and verify against actual screen-reader
behaviour rather than the spec — they differ. A cell carrying both a value and a confidence needs
an accessible name that conveys both without becoming unlistenable. Sticky headers and a sticky
first column must not break the announced row/column position.

Tooltips are a trap: content on hover must also be reachable by keyboard, dismissible without
moving focus, and persistent enough to move the pointer into. If the tooltip carries the
justification and the confidence flag — which it does — then it carries information available
nowhere else, and that makes it required content, not decoration.

## The standalone bundle

One `fetch()` inside a cell renderer breaks the mailed HTML file, **and only offline** — so it
ships green and fails at the reader's desk. Nothing may reach past its port (ADR-0013).

Degradation must be visible: standalone shows saved views working locally while annotations are
read-only, and *says so*, rather than presenting controls that silently do nothing.

## View PR checklist

- [ ] Value readable as text, or a table view one click away.
- [ ] Contrast computed from the rendered background; verified on both light and dark surfaces
      and on an interpolated blend colour, not just the palette endpoints.
- [ ] Keyboard path for every pointer interaction, with focus management and live-region
      announcements.
- [ ] `not-applicable` and `not-assessed` distinguishable without colour.
- [ ] Palette checked under colour-vision-deficiency simulation, `forced-colors`, and print.
- [ ] New encodings registered explicitly by the composition root; no module-scope registration.
- [ ] Sequential ramps are one hue light-to-dark, validated in both directions against their own
      surface; ordinal data gets no diverging palette unless a midpoint is declared (ADR-0010).
- [ ] No `fetch()` or external URL reachable from a renderer; the standalone build still issues
      zero network requests.
- [ ] Nothing from the private originating analysis in any screenshot or fixture (ADR-0016).

## Where things are

    docs/adr/0008-reordering-grouping-selection.md   seriation, keyboard reorder, groups vs selection
    docs/adr/0009-missingness.md                     absence is visually distinct
    docs/adr/0010-encodings-and-uncertainty.md       pluggable encodings, computed ink
    docs/adr/0013-standalone-and-connected.md        ports, and the zero-network rule
    docs/research/findings-visualisation.md          the research behind all of the above
