# ADR-0027: Matrix accessibility semantics

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
The matrix is the product. It is also a dense field of interactive cells, and a 22 × 12 analysis is
264 openable cells — 264 tab stops if it is built as a plain table. The ARIA `grid` pattern exists
for exactly this: a grid "always contains multiple focusable elements" of which only one is in the
page tab sequence [1]. That collapses 264 stops to one.

The objection to `grid` is real and has to be answered rather than waved off: the role is routinely
applied to things that are not grids, it strips native semantics when it is, and grid semantics are
exposed to screen-reader users while a keyboard-only user gets no announcement of the model at all
[2]. But the documented failures behind that objection were against **`<div>`-based** grids, and the
published compatibility matrix separates the two cases cleanly — a real data table carrying
`role="grid"` is announced correctly by every NVDA tested from 2012.3 to 2025.3, by JAWS 15 and
later, and by VoiceOver on macOS 10.10 onward [3]. The choice is not "grid or not"; it is which
element the role sits on.

Two further forces shape the rest. Reordering is a WCAG 2.2 obligation, not an accessibility
courtesy: SC 2.5.7 requires a non-drag single-pointer route and names our exact pattern — adjacent
controls that move an element up or down [4]. And progressive disclosure runs into a hard ARIA
boundary that decides our build order, not just our markup.

## Decision
**The matrix is a real `<table>` carrying `role="grid"`** — not a `<div>` tree, not a CSS Grid of
`<div>`s, and not a plain table. Navigation uses **roving `tabindex`**, never
`aria-activedescendant`: `aria-activedescendant` is not focus, receives no keyboard events, and with
NVDA or Narrator the referenced element does not track the screen reader's cursor [5]. The roving
position is **persisted in view state** (ADR-0006), so returning from the detail panel lands in the
cell you left.

**No virtualisation in v1.** ADR-0002 caps the product at tens to low hundreds of alternatives, and
`aria-rowindex`/`aria-colindex` exist for lazy-loaded content we do not have; used without it they
change what is announced without changing navigation, which is a disorienting mismatch [6]. The
documented trigger to revisit is roughly **500 rows**. If virtualisation is ever added, one rule is
absolute: **DOM order equals visual order**, without exception.

**Not `treegrid`.** Groups are many-to-many tags, not a partition (ADR-0008), so `treegrid` would
assert a hierarchy the data does not have.

**A cell announces its measures through visually-hidden text inside the cell** — not `aria-label`,
which overrides the visible text and so diverges from what a sighted colleague reads aloud, and not
a dynamically-changing description. The target string is *"Memory safety, Rust, 5 of 5, confidence
low."* **A missing cell announces its reason in words and is never silent**: *"Memory safety, Rust,
not applicable."* Never a bare blank, never the word "blank". This is the ADR-0009 reason set made
audible, and it is the same commitment: a qualified blank, not a confident guess.

**Sticky headers** use `position: sticky` on the `<th>`s with `border-collapse: separate;
border-spacing: 0` and separators drawn as `box-shadow`, because collapsed borders belong to the
table rather than the cell and do not travel with a sticky cell in any engine [7]. The scroll
container carries **`scroll-padding-block-start` and `scroll-padding-inline-start` equal to the
sticky extents**. Omitting them is not a polish defect: with roving `tabindex` and arrow navigation,
the first arrow press scrolls the focused cell under the sticky header, which **fails SC 2.4.11
Focus Not Obscured (Minimum)** — a conformance failure on the first keystroke of the primary
interaction [8].

**Disclosure has three tiers — cell, tooltip, side panel — with one hard boundary: a tooltip may
never contain focusable content** [9]. Evidence links are focusable (ADR-0014), therefore evidence
links can only live in the panel. **This is what forces the detail panel into Phase 3 rather than
Phase 4**: without it the matrix has no accessible route to the citations, and citations are the
thing that separates an agent-produced analysis from a spreadsheet. The panel is a non-modal
`<aside role="complementary" aria-labelledby>`, not `role="dialog"`, because the matrix must stay
readable beside it. The tooltip satisfies all three legs of SC 1.4.13 — dismissible with `Escape`
without moving focus, hoverable, and persistent with **no auto-dismiss timer** [10] — opens on focus
as well as hover, and is never the `title` attribute.

**Reordering offers two routes on one handle**, a single `<button>` on every alternative header and
criterion header:

- **A move menu** — move to start / earlier / later / to end / before… / group with… — normative
  under SC 2.5.7 [4] and available to pointer users, not keyboard users only.
- **A grab mode** binding `Space`/`Enter` to pick up and put down, arrows to move, **`Tab` and
  `Shift+Tab` to move as well**, `Home`/`End` to jump, and `Escape` to cancel and restore. The dual
  `Tab` binding is not redundant: in NVDA and JAWS browse mode bare arrows can be consumed by the
  reading cursor and never reach our handler.

**Never bind bare `Alt+Arrow`** — it is browser Back/Forward on Windows and Linux. Focus stays on
the moved handle at its new location, restored by id after commit.

**Every announcement comes from one `describeMove()` in `core`.** Not one per route, and not in the
view: the move menu, the grab mode and the pointer drag must say identical things, and the only way
to guarantee that is a single function on the headless side of the ADR-0005 boundary. Phrasing is
position-of-total in project vocabulary — *"Criterion Memory safety moved to column 4 of 12, after
Startup time."* Seriation (ADR-0025) announces politely and leaves focus where it was.

## Consequences
The whole matrix becomes one tab stop and every operation has a keyboard route, which is what makes
the dense view usable at all. In exchange we own the interaction: no drag library gives us an
accessible reorder — they sell a pointer abstraction, and the keyboard path and the announcements
are ours either way.

The detail panel moves into Phase 3. That is the largest scheduling consequence in this ADR and it
follows from a specification constraint, not from ambition.

Roselli's residual objection survives our markup choice and is answered with product rather than
markup: the grid model is announced to screen-reader users and invisible to keyboard-only users, so
the view carries a **visible, persistent keyboard-help affordance**. Sticky-header configuration
also becomes load-bearing rather than cosmetic — the `border-collapse`, stacking-context and
opacity traps are now correctness requirements, and `scroll-padding-*` is a conformance one.
ADR-0029 promotes these into merge-gate checks.

## Alternatives considered
- *`role="grid"` on a `<div>` tree.* Maximum styling freedom, and precisely where the documented
  screen-reader failures live [2, 3].
- *CSS Grid over `<div>`s.* Easier to reason about for layout, but it is the same `<div>` grid, and
  `<thead>` is the only route to repeated headers across printed pages [11]; native table rendering
  also degrades predictably under forced colors and zoom where a JS-sized grid does not.
- *A plain `<table>` with no grid role.* 264 tab stops. A low barrier to entry, and unusable.
- *`aria-activedescendant`.* Focus and the announced position diverge [5].
- *`treegrid`.* Asserts a partition; groups are tags.
- *Virtualisation in v1, with `aria-rowindex`/`aria-colindex`.* Solves a problem ADR-0002 says we do
  not have, at the cost of the one invariant screen-reader navigation depends on.
- *Adopting a drag-and-drop library for the keyboard story.* The leading framework-agnostic
  candidate's own guidance says it does not enable accessible controls automatically. See
  `docs/research/findings-visualisation.md` § 4.1, which also records the maintenance evidence
  against `dnd-kit` and so amends ADR-0008's recommendation to evaluate it first.

## References
The full reasoning, including the screen-reader compatibility evidence and the four sticky-header
traps, is in `docs/research/findings-visualisation.md` §§ 4.1–4.4.

1. [ARIA Authoring Practices Guide — Grid Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
2. [ARIA Grid As an Anti-Pattern — Adrian Roselli (2020, updated 2022)](https://adrianroselli.com/2020/07/aria-grid-as-an-anti-pattern.html)
3. [Data table with `role=grid` — Screen reader compatibility tests — PowerMapper Software](https://www.powermapper.com/tests/screen-readers/tables/table-role-grid/)
4. [Understanding SC 2.5.7: Dragging Movements (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
5. [Aria-activedescendant is not focus — Sarah Higley (2024)](https://sarahmhigley.com/writing/activedescendant/)
6. [Grids Part 2: Semantics — Sarah Higley (2021)](https://sarahmhigley.com/writing/grids-part2/)
7. [\[css-tables\] Collapsed table borders don't follow sticky rows/cells when they stick — csswg-drafts issue #3136, open since 2018](https://github.com/w3c/csswg-drafts/issues/3136)
8. [Understanding SC 2.4.11: Focus Not Obscured (Minimum) (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
9. [ARIA Authoring Practices Guide — Tooltip Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
10. [Understanding SC 1.4.13: Content on Hover or Focus (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
11. [CSS Table Module Level 3 — §6.2 Repeating headers across pages — W3C](https://www.w3.org/TR/css-tables-3/)
