# Interaction and accessibility: reordering, grid semantics, sticky layout, progressive disclosure

**Research question(s):** How do we make reordering of alternatives (rows) and criteria (columns)
genuinely accessible — keyboard and screen reader, not just pointer? What is the right ARIA pattern
for a 2-D matrix, given real screen-reader behaviour rather than the spec? How do we build sticky
headers and a sticky first column robustly? How should a dense cell disclose its measures
progressively, without an inaccessible hover tooltip? And which encoding channel survives
colour-vision deficiency, forced-colors mode, and print at the same time?

**Brief section:** `docs/research/visualisation.md` §4 (Interaction) and §5 (Accessibility,
non-negotiable).

**Evidence grade:** **strong** for the library-maintenance facts (npm registry and GitHub API data,
retrieved 2026-08-18), the normative WCAG criteria, the CSS Color Adjust forced-colors rules, and
the published screen-reader test matrices; **moderate** for the "what NVDA/JAWS/VoiceOver actually
say" claims, which rest on a secondary test corpus (PowerMapper) and on practitioner
testing write-ups (Higley, Roselli) rather than on our own AT testing; **weak** for the specific
keystroke choices, which are reasoned from mode-switching behaviour we have not measured ourselves.

---

## Bottom line

1. **Do not build the reorder on `dnd-kit`.** Its stable line is frozen: `@dnd-kit/core@6.3.1` and
   `@dnd-kit/sortable@10.0.0` were both published in early December 2024 and have had no stable
   release in the ~20 months since [1]. The successor (`@dnd-kit/react` / `@dnd-kit/dom`) is still
   at `0.5.0` two years after its first publish [1]. Use
   **`@atlaskit/pragmatic-drag-and-drop`** — Apache-2.0, framework-agnostic, ~4.7 kB core, three
   tiny dependencies, released continuously through August 2026 [1][2]. It matches ADR-0005's
   framework-agnostic boundary and the mailable-bundle constraint better than any React-bound
   alternative. **This amends ADR-0008, which names `dnd-kit` first.**
2. **The keyboard path is not an "equivalent", it is the primary path**, and pointer drag is the
   enhancement. WCAG 2.2 SC **2.5.7 Dragging Movements (AA)** makes a non-drag single-pointer route
   *normative*, not merely good practice [3]. Ship a drag-handle `<button>` on every alternative and
   criterion header that is simultaneously (a) a menu trigger with explicit move commands and (b) a
   grab-mode entry point. Both, not either.
3. **Use a real `<table>`.** Add `role="grid"` **only** when cells are individually focusable, which
   for us they are. Roving `tabindex`, never `aria-activedescendant` [4]. Do not virtualise in v1 —
   our matrices are tens × tens (ADR-0002), so `aria-rowindex`/`aria-colindex` are unnecessary and
   their failure modes are avoidable rather than manageable [5].
4. **Sticky is `position: sticky` on the `<th>` elements, with `border-collapse: separate;
   border-spacing: 0`, separators drawn as `box-shadow`.** Collapsed borders demonstrably do not
   follow sticky cells in any engine and the CSSWG issue is still open [6]. Add
   `scroll-padding-block-start`/`scroll-padding-inline-start` on the scroll container equal to the
   sticky extents, or you fail SC **2.4.11 Focus Not Obscured** the first time a keyboard user
   arrows up [7].
5. **Three tiers, hard rule: the cell carries the value; a tooltip carries at most one line of
   non-interactive text; anything with a link goes in the side panel.** The APG is explicit that a
   tooltip may not contain focusable content [8], and evidence links (ADR-0014) are focusable. This
   is an architectural constraint, not a styling preference.
6. **The only channel that survives CVD simulation, `forced-colors: active`, and print together is
   the foreground: text plus a `currentColor` SVG glyph or stroke.** CSS gradients are the obvious
   hatching mechanism and they are *silently deleted* in forced-colors mode —
   `background-image` computes to `none` unless the value contains a `url()` [9] — and backgrounds
   are omitted from print by default [10]. Draw texture in the foreground, not the background.

---

## Findings

### 1. Reordering: the library choice is a maintenance question, and it has a clear answer

#### 1.1 The evidence on maintenance (EVIDENCE — npm registry + GitHub REST API, retrieved 2026-08-18)

| Package / repo | Latest stable | Published | Last repo commit | Licence |
|---|---|---|---|---|
| `@dnd-kit/core` | 6.3.1 | 2024-12-05 | repo: 2026-07-13 | MIT |
| `@dnd-kit/sortable` | 10.0.0 | 2024-12-04 | — | MIT |
| `@dnd-kit/react` (successor line) | **0.5.0** | 2026-06-11 (betas after) | — | MIT |
| `@dnd-kit/dom` (successor, framework-agnostic) | **0.5.0** | 2026-06-11 | — | MIT |
| `@atlaskit/pragmatic-drag-and-drop` | **3.0.0** | **2026-08-14** | 2026-08-18 | Apache-2.0 |
| `@atlaskit/pragmatic-drag-and-drop-live-region` | 2.0.0 | 2026-06-16 | — | Apache-2.0 |
| `@atlaskit/pragmatic-drag-and-drop-react-accessibility` | 3.1.5 | 2026-07-29 | — | Apache-2.0 |
| `sortablejs` | 1.15.7 | 2026-02-11 | 2026-03-24 | MIT |
| `@react-aria/dnd` | 3.12.1 | 2026-05-28 | 2026-08-18 | Apache-2.0 |

Read that honestly. dnd-kit is **not abandoned** — the repository received commits as recently as
2026-07-13 [11] — but the code you would actually install has not had a stable release in twenty
months, and the rewrite that is supposed to replace it has spent two years below `1.0` [1]. Users
have been asking about this in public since at least June 2023 (discussion #1156, "Future of DnD
Kit?", one reply, no maintainer response) and again in November 2025 (issue #1830, "Active
Maintenance Status and Suitability for Production Use?") [12][13]. There *is* a maintainer answer
on the 2025 issue: Clauderic closed it the same day, pointing at issue #1194 and `next.dndkit.com`,
saying "All development efforts are currently under the `experimental` branch which will soon
replace the `main` branch. It's ready for production use but there may be breaking API changes
before the `1.0.0` release" [12]. Read straight, that answer *is* the risk rather than a rebuttal
of it: the maintained line is the pre-1.0 one, breaking changes are still expected, and no date is
attached. BRIEF.md asks for "boring, maintained dependencies… that must still build in three
years". A frozen 6.x plus an indefinite 0.x is the opposite shape of risk: you would adopt the
stable one knowing it is a dead end, or the pre-1.0 one knowing its API will move.

#### 1.2 Keyboard and screen-reader support, compared on substance

**`dnd-kit` (6.x).** Genuinely good defaults for its era: it applies `role="button"`,
`aria-roledescription="draggable"` and an `aria-describedby` pointing at off-screen instructions;
it ships a keyboard sensor (Space/Enter to pick up, arrows to move, Space/Enter to drop, Escape to
cancel); and it renders an off-screen live region with customisable announcements, with the docs
recommending position-based phrasing ("position 2 of 5") over indices [14]. The documentation is
candid that these are "starting points" needing per-application customisation [14]. Its weaknesses
for us: React-only in the stable line, and the sortable keyboard coordinate getter is designed for
1-D lists — a 2-D matrix needs a custom coordinate getter.

**`@atlaskit/pragmatic-drag-and-drop`.** Deliberately does *not* try to make pointer drag
accessible. Its README says the pieces it ships are "unopinionated about visual language or
accessibility" [2], and its guidance is explicit that "The core package does not enable accessible
controls automatically, as there is no one pattern that works well for all situations" and that
authors must "Provide other ways for people using assistive technologies to achieve the same
outcomes as pointer based drag and drop operations" [15]. It ships the pieces for that alternative
flow as separate packages — a `DragHandleButton` that is simultaneously a drag handle and a menu
trigger, and a live-region package — and it argues, with a reason we should take seriously, that
**directional controls are the wrong affordance for a screen reader user**: "Directional arrow
movement doesn't always make sense when you can't see the interface you are engaging with", and
"Directional arrow movements require JAWS screen reader users to change screen reader mode to use
it" [15]. Its recommended announcement shape is the "name of the item being moved, as well as its
old and new position" [15]. Its guidance on focus is exactly right and easy to get
wrong: when a moved element remounts in a new location, focus must be explicitly restored to the
trigger button [15].

**React Aria drag and drop.** The most rigorously tested of the four, and the write-up is the best
primary account of *why* drag is hard for AT [16]. Its model is worth stealing even if we do not
adopt the library: `Enter` starts a drag; **`Tab` cycles only between valid drop targets, skipping
everything else**; `Enter` drops; and — the key trick — "while in drag and drop mode, all elements
other than valid drop targets are hidden from screen readers" [16]. Within a collection, arrow keys
choose a drop position with labels of the form "Insert between item A and item B" [16]. Cost: it is
React-only and it is a large ecosystem to adopt for one interaction.

**SortableJS.** Rule it out. It has no keyboard or ARIA story, and this is not an oversight anyone
is fixing: issue #1176 ("Any thought to making this accessible? (keyboard / aria)") dates from 2017
and issue #1951 ("What's the status on making SortableJs accessible?") has been open since
2020-10-28 [17]. (EVIDENCE — GitHub issue search, retrieved 2026-08-18.)

**Native HTML5 drag and drop.** Rule it out. It is not keyboard operable at all, and the ARIA
attributes that were meant to describe it — `aria-grabbed` and `aria-dropeffect` — both carry
`[Deprecated in ARIA 1.1]` in the specification, which advises authors to "treat aria-grabbed as
deprecated" because it "is expected to be replaced by a new feature in a future version of
WAI-ARIA" [36]; MDN repeats that notice [18]. (Neither source gives a reason beyond the planned
replacement. The usual explanation — that support was poor and not expected to improve — is
REASONING, not something either source states.) Do not emit them.

#### 1.3 Recommendation

Use **`@atlaskit/pragmatic-drag-and-drop`** for pointer drag (auto-scroll and drop-indicator
packages optional), and **write our own keyboard and announcement layer** against `core`'s
view-state reorder API rather than adopting the `-react-accessibility` package, which is bound to
React and to the Atlassian Design System.

(REASONING, not evidence) The keyboard layer is perhaps 150 lines. The reason to write it is that
our reorder is not a list reorder — it is a permutation of one axis of a matrix, it must interact
with seriation (ADR-0008) and with grouping, and it must announce in *our* vocabulary
("criterion *Memory safety* moved to column 3 of 12"). No library ships that.

#### 1.4 The keyboard path, specified

Two routes on the same control, because SC 2.5.7 requires a non-drag route [3] and because the fast
route and the discoverable route are not the same route.

Every alternative header (row header) and criterion header (column header) contains one
`<button class="reorder-handle">` that is both a menu trigger and a grab-mode entry point.

**Route A — explicit move commands (the guaranteed path).** Activating the button opens a menu:

```
Move to start          Home
Move earlier           ←   (or ↑ for alternatives)
Move later             →   (or ↓ for alternatives)
Move to end            End
Move before…           opens a list of the other criteria
Group with…            (ADR-0008 grouping)
```

This is the WCAG 2.5.7 conformant route: the Understanding document names exactly this pattern —
"a sortable list of elements may, after tapping or clicking on a list element, provide adjacent
controls for moving the element up or down in the list" [3]. It also answers Atlassian's objection
to directional keys [15] and Roselli's objection that grid interaction models are invisible to
sighted keyboard users [19]: a menu is self-documenting.

**Route B — grab mode (the fast path).** With the handle focused:

| Key | Effect |
|---|---|
| `Space` or `Enter` | pick up / put down |
| `→` `←` (criteria) / `↓` `↑` (alternatives) | move one position while held |
| `Tab` / `Shift+Tab` | **also** move one position while held |
| `Home` / `End` | move to first / last position |
| `Escape` | cancel, return to the original position |

The `Tab` binding is not redundant. In NVDA and JAWS browse mode, bare arrow keys are consumed by
the screen reader's own reading cursor and may never reach our handler; `Tab` is never intercepted.
Atlassian gives the mode problem as one of its reasons to avoid arrow keys outright — "Directional
arrow movements require JAWS screen reader users to change screen reader mode to use it" [15] — and
React Aria independently made `Tab` the drop-target key, though for a different stated reason: it
"reduces the number of elements on the page that must be traversed to find a drop target, and
removes the guess work often found with other implementations" [16]. Binding both costs nothing and
removes a whole class of "it works for me" failure. (REASONING — the browse-mode interception is
inferred from [15] and unmeasured by us; [16] is cited for the `Tab` mechanism, not for the motive.)

Do **not** bind bare `Alt+Arrow`: it is browser Back/Forward on Windows and Linux.

**Announcements.** One `aria-live="assertive"` region for the drag lifecycle (assertive because it
must interrupt; the user has explicitly initiated a mode) and one `aria-live="polite"` region for
completion. Templates, in project vocabulary:

```
grab       "Criterion Memory safety grabbed, column 3 of 12.
            Use arrow keys or Tab to move, Enter to drop, Escape to cancel."
move       "Column 4 of 12, after Startup time."
drop       "Criterion Memory safety moved to column 4 of 12, after Startup time."
cancel     "Move cancelled. Criterion Memory safety returned to column 3 of 12."
menu-move  "Criterion Memory safety moved to column 4 of 12, after Startup time."
```

Note "column 4 of 12" — position-of-total, not an index — per dnd-kit's own guidance [14] and
Atlassian's name + old position + new position shape [15]. Every message names the **criterion or
alternative label**, never a cell reference.

**Focus after a move — the rule.** Focus stays on the moved header's handle button, at its new
location. Nothing else. If the framework remounts the header (it will, if the reorder is a keyed
list re-render), focus must be explicitly restored by id after commit [15]. Add an interaction test
for exactly this; it is the single most commonly broken thing in reorder implementations.

**Seriation interaction (ADR-0008).** After "arrange to reveal structure" runs, announce the result
politely — `"Criteria rearranged by structure. New order: Memory safety, Startup time, …"` for a
short axis, or `"Criteria rearranged by structure. 12 columns reordered. Press U to undo."` for a
long one — and leave focus where it was. An automatic reorder that steals focus is the thing that
makes automatic reordering feel like a mode that fights you.

---

### 2. The ARIA pattern for a 2-D matrix

#### 2.1 grid vs table vs treegrid

The APG's own justification for `grid` is efficiency of traversal, not structure: implementing it
"provides users with intuitive and efficient keyboard navigation of the grid contents as well as a
shorter tab sequence for the page", and a `grid` "always contains multiple focusable elements" of
which "only one … is included in the page tab sequence" [20]. That is precisely our situation: a
22 × 12 matrix has 264 cells, each of which must be openable into the detail panel. As a plain
table with a button per cell that is 264 tab stops. As a grid it is one.

Higley's framing is the cleanest decision rule and we pass it. Consider a table when "The primary
purpose is for the user to read that data" and "Discoverability and a low barrier to entry are more
important than efficiency"; consider a grid when "The primary purpose is to enable user interaction"
and "Efficiency is more important than a low barrier to entry" [21].

Roselli's counter-argument is real and should be honoured, not dismissed. His case is that `grid`
is routinely applied to things that are not grids (lists of links, pill lists, search results),
that it strips native semantics when it does, and — the part that applies to *us* — that "as of now
`grid` semantics are only exposed to screen reader users. While a screen reader user will hear the
`grid` role announcement, and may even understand that the interaction will change, a keyboard-only
user will have no idea" [19]. His documented failures ("table navigation indicates I am always in
the only cell"; "Using table navigation commands revealed no column headers and verbose cell
announcements") were against `<div>`-based APG examples, not against a `<table role="grid">` [19].

That distinction is load-bearing, and the published test matrix supports it: a real data table with
`role="grid"` is announced correctly by every NVDA tested from 2012.3 to 2025.3 ("Table with two
rows and two columns…" — Firefox and IE11 for the oldest builds, Chrome, Firefox and Edge from
2018.4 on), by JAWS 15 and later ("Grid with two columns and two rows…"; JAWS 13 and 14 fail), and
by VoiceOver macOS 10.10–15.7 (10.9 fails); VoiceOver iOS was broken through 16.6 and is correct
in 17.7 and 18.6 [22]. So: **`role="grid"` on a `<table>` element is safe; `role="grid"` on a
`<div>` tree is where the failures live.**

**Treegrid: no.** Groups (ADR-0008) are many-to-many tags, not a partition, so the data is not a
tree and `treegrid` would be a lie about the structure. Render group bands as `<tr>` rows with a
spanning `<th scope="rowgroup">`, or use a `<tbody>` per group with a caption row.

Roselli's objection is answered with product, not markup: **a visible, persistent keyboard-help
affordance** ("Keyboard: arrows to move, Enter to open, / to search" in the toolbar, expandable),
so the interaction model is not screen-reader-only knowledge.

#### 2.2 Roving tabindex, not `aria-activedescendant`

Decided. `aria-activedescendant` is an ARIA construct that exists for the benefit of screen reader
users: it is not focus, it receives no keyboard events, and there is no DOM query for it [4]. With
NVDA or Narrator "the element identified through aria-activedescendant will not update to match the
screen reader's cursor location", and "Switching between browse mode and forms mode may cause
unintended side effects" — JAWS is the one Windows screen reader Higley credits with handling that
switching gracefully [4]. On mobile, an "iOS VoiceOver or Android Talkback user will generally swipe
through all the options without the aria-activedescendant value changing at all", and "VoiceOver on
Safari on macOS will ignore aria-activedescendant if you so much as look at it funny" [4]. Its
legitimate use is comboboxes [4]. Even "in complex use cases of giant virtualized trees, data
tables, tree grids, and SVG charts and graphs, managing keyboard focus ends up being simpler to
implement and more robust" [4].

Implementation: exactly one cell in the matrix carries `tabindex="0"` at any time; every other cell
carries `tabindex="-1"`. Arrow keys move the `0` and call `.focus()`. Persist the roving position
in view state so that returning from the detail panel lands you back in the same cell.

#### 2.3 Virtualisation: don't, in v1

ADR-0002 caps us at "tens to low hundreds of alternatives". 100 × 30 = 3,000 cells is well within
what a browser renders and what a screen reader can traverse. Virtualising would force
`aria-rowcount`/`aria-rowindex`/`aria-colcount`/`aria-colindex`, and Higley's finding is that these
attributes "will affect what a screen reader says when encountering a specific element, but will
not change any other behavior or navigation" — NVDA "will still move through rows following DOM
order rather than visual order, but will read the defined row index, resulting in a disorienting
experience", and where a library recycles and visually reorders row elements "the screen reader
accessibility is entirely broken" [5]. Her rule is scoped rather than thresholded: "None of these
attributes are necessary if all the rows and columns are present in the DOM at all times" [5] —
they exist for lazy-loaded content, which we do not have. There is also live churn in this area:
JAWS 2025/2026 regressed on `aria-current` and `aria-description` on grid rows where JAWS 2024 and
NVDA were correct [23].

So: **no virtualisation in v1**, and a documented trigger — if a real analysis exceeds ~500 rows,
revisit, and if you virtualise, emit `aria-rowcount`/`aria-rowindex` and keep DOM order identical
to visual order without exception.

#### 2.4 A cell that carries both a score and a confidence

This is the specific problem the reference prototype created and the one most implementations get
wrong. Three candidate mechanisms, and only one of them is robust:

- ❌ `aria-label` on the `<td>`. Overrides the visible text and diverges from what a sighted user
  reads out loud in a meeting. Roselli avoids `aria-label` for translation reasons: "Experience
  doing localization work has taught me the attribute is too often missed when handling strings for
  translation" [24].
- ⚠️ `aria-describedby` pointing at a hidden justification. Fine for *static* content. There is a
  widely-repeated failure mode in which a **dynamically changed** accessible description sits
  correctly in the accessibility tree but is never spoken; we could not locate a citable primary
  test for it (UNVERIFIED — could not locate source; it is *not* in [24], which covers static
  `aria-describedby` sort hints only). Our justification text is static per cell, so this is
  acceptable either way — but do not rely on a description that changes in response to an action
  without testing it first.
- ✅ **Visually-hidden text inside the cell.** Screen readers read a cell's full text content during
  table navigation. Put the visible glyph/number in one span and the qualifiers in a
  `.visually-hidden` sibling. Nothing to support, nothing to regress, translates correctly.

Announcement target, in vocabulary: **"Memory safety, Rust, 5 of 5, confidence low."** Criterion
(column header) and alternative (row header) come free from `<th scope>`; the rest is ours.

For a `missing` cell (ADR-0009): **"Memory safety, Rust, not applicable."** Never a bare silence,
never "blank".

#### 2.5 Concrete DOM + ARIA sketch

```html
<div class="matrix-scroll" role="region" aria-labelledby="subject-h" tabindex="0">
  <table role="grid"
         aria-labelledby="subject-h"
         aria-describedby="matrix-keyboard-help">
    <caption id="subject-h" class="visually-hidden">
      Which language for the ingest service? 3 alternatives, 3 criteria.
    </caption>

    <thead>
      <tr>
        <th scope="col" class="corner" role="columnheader">Language</th>

        <th scope="col" role="columnheader" aria-sort="descending" style="--col:1">
          <span class="crit-label">Memory safety</span>
          <button type="button" class="sort" aria-describedby="sort-hint">
            <svg aria-hidden="true" focusable="false">…</svg>
            <span class="visually-hidden">sort by Memory safety</span>
          </button>
          <button type="button" class="reorder-handle"
                  aria-haspopup="menu"
                  aria-describedby="reorder-hint">
            <svg aria-hidden="true" focusable="false">…</svg>
            <span class="visually-hidden">move Memory safety, column 1 of 3</span>
          </button>
        </th>

        <th scope="col" role="columnheader" style="--col:2">…Startup time…</th>
        <th scope="col" role="columnheader" style="--col:3">…Ecosystem breadth…</th>
      </tr>
    </thead>

    <tbody>
      <tr>
        <th scope="row" role="rowheader">
          <span class="alt-label">Rust</span>
          <button type="button" class="reorder-handle" aria-haspopup="menu">
            <span class="visually-hidden">move Rust, row 1 of 3</span>
          </button>
        </th>

        <!-- measure: score = 5, confidence = low -->
        <td role="gridcell" tabindex="0"
            data-encoding="uncertainty-suppressed"
            aria-describedby="j-rust-mem">
          <span class="cell-value" aria-hidden="true">5</span>
          <svg class="cell-texture" aria-hidden="true" focusable="false">
            <!-- confidence hatch, stroke="currentColor" -->
          </svg>
          <span class="visually-hidden">5 of 5, confidence low</span>
        </td>

        <!-- missing: not-applicable -->
        <td role="gridcell" tabindex="-1" data-missing="not-applicable">
          <span class="cell-value" aria-hidden="true">—</span>
          <span class="visually-hidden">not applicable</span>
        </td>

        <td role="gridcell" tabindex="-1">
          <span class="cell-value" aria-hidden="true">4</span>
          <span class="visually-hidden">4 of 5, confidence high</span>
        </td>
      </tr>
    </tbody>
  </table>
</div>

<p id="j-rust-mem" class="visually-hidden">
  Ownership model eliminates whole classes of memory error at compile time.
</p>
<p id="matrix-keyboard-help" class="visually-hidden">
  Arrow keys move between cells. Enter opens the cell detail panel.
  On a header, Enter opens the move menu.
</p>

<div class="visually-hidden" aria-live="assertive" aria-atomic="true" id="drag-live"></div>
<div class="visually-hidden" aria-live="polite"    aria-atomic="true" id="status-live"></div>
```

Notes on the sketch:

- The visible number is `aria-hidden="true"` and restated inside the visually-hidden span. That is
  deliberate: it lets the spoken form ("5 of 5") differ from the printed form ("5") without an
  `aria-label`.
- `aria-sort` appears only on the currently sorted column and is omitted (not set to `"none"`)
  elsewhere [24].
- Sorting must also fire a polite live-region message, because VoiceOver/macOS + Safari and TalkBack
  do **not** announce a sort on activation, while JAWS+Chrome, NVDA+Firefox, Narrator+Edge and
  VoiceOver/iPadOS do [24].
- The scroll container gets `tabindex="0"` and a `role="region"` with a name, so that a keyboard
  user who is not using the grid's arrow navigation can still scroll it. This is a real WCAG issue
  for any scrollable region and is easy to forget.

---

### 3. Sticky headers and a sticky first column

#### 3.1 The four traps (EVIDENCE)

1. **`position: sticky` on `<thead>`/`<tr>` was not supported in Chromium until Chromium 91**, which
   shipped it as part of the TablesNG rewrite; before that such headers were silently demoted to
   `position: static` [25]. In 2026 this is history, but it is why so much sticky-table advice on the
   web is written against `<th>` rather than `<thead>` — and `<th>` remains the safer target.
2. **Collapsed borders do not follow sticky cells.** With `border-collapse: collapse`, the cell and
   its background move but the collapsed borders — which belong to the table, not the cell — stay
   behind, leaving the sticky header apparently borderless over scrolling content. CSSWG issue
   #3136 has been open since 2018, is labelled "Needs Design / Proposal", and affects Chromium,
   Gecko and WebKit alike [6].
3. **Any ancestor with `overflow: hidden|auto|scroll` becomes the sticky containing block.** A
   single `overflow: hidden` on a wrapper (added for a rounded corner, usually) silently kills
   stickiness. This is the most common "sticky doesn't work" cause.
4. **Stacking.** Sticky elements create a stacking context only when `z-index` is set. The top-left
   corner cell is simultaneously a sticky row header and a sticky column header and must paint above
   both.

#### 3.2 The recommendation: native `<table>`, sticky `<th>`, separated borders

```css
.matrix-scroll {
  overflow: auto;
  max-block-size: 70vh;
  /* SC 2.4.11 — keep focused cells out from under the sticky chrome */
  scroll-padding-block-start: var(--header-h);
  scroll-padding-inline-start: var(--rowhead-w);
}

.matrix-scroll > table {
  border-collapse: separate;   /* NOT collapse — see trap 2 */
  border-spacing: 0;
}

/* separators as shadows, so they travel with the sticky cell */
.matrix-scroll th,
.matrix-scroll td {
  box-shadow:
    inset -1px 0 0 var(--rule),
    inset 0 -1px 0 var(--rule);
}

thead th            { position: sticky; inset-block-start: 0;  z-index: 2; }
tbody th[scope=row] { position: sticky; inset-inline-start: 0; z-index: 1; }
thead th.corner     { position: sticky; inset-block-start: 0;
                      inset-inline-start: 0; z-index: 3; }

/* sticky cells must be opaque or content shows through */
thead th, tbody th[scope=row] { background: var(--surface); }

@media (prefers-reduced-motion: no-preference) {
  .matrix-scroll { scroll-behavior: smooth; }
}
```

`scroll-padding` on the container is the part everyone omits and it is the part that is normative:
SC 2.4.11 Focus Not Obscured (Minimum, AA) says "when a user interface component receives keyboard
focus, the component is not entirely hidden due to author-created content", and the Understanding
document names sticky headers as a typical cause, resolved by scrolling "to always display the item
with keyboard focus using scroll padding" [7]. With roving tabindex and arrow-key navigation, a cell
that scrolls under the sticky header on `.focus()` is a conformance failure, not a polish issue.

#### 3.3 Why not CSS Grid over `<div>`s

It works and it is easier to reason about for the sticky/stacking problem. Reject it anyway, for
three reasons:

- **Semantics.** A `<div>` tree with `role="grid"` is exactly the configuration that produced
  Roselli's documented failures ("table navigation reveals no column headers") [19]. A `<table>`
  gets row/column header association from `scope` for free, in every AT, forever.
- **Print.** `<thead>` is `display: table-header-group`, and CSS Tables Level 3 devotes §6.2 to
  repeating headers across pages [26]. Support is uneven enough that we must verify it rather than
  assume it, but a `<div>` grid cannot get it at all.
- **Forced-colors and zoom.** Native table rendering degrades predictably; a CSS-Grid layout whose
  column tracks are set in JS does not.

A middle option — `<table>` markup with `display: grid` applied — is now largely safe (Chrome 80
stopped dropping table semantics for `flex`, `grid`, `inline-block` and `contents` in February 2020
with the new Edge following, Firefox's only remaining casualty at that point being
`display: contents`, and Apple "addressed its table bugs in Safari 17. It only took 5¾ years")
[27]. **Don't do it anyway.** The reward is small and the failure mode — silently losing table
semantics on some browser we have not tested — is exactly the class of bug this project cannot
afford. If someone does apply a display property to the table later, ADR-worthy rule: they must
add the full role set (`table`/`grid`, `rowgroup`, `row`, `cell`/`gridcell`, `columnheader`,
`rowheader`) explicitly [27].

---

### 4. Progressive disclosure for dense cells

#### 4.1 The tier rule

| Tier | Carries | Constraint |
|---|---|---|
| **Cell** | the score as text or glyph; the confidence as a foreground texture; a missing reason as a distinct glyph | must be legible with colour removed entirely |
| **Tooltip / hovercard** | the one-line justification, the confidence in words, the reason code in words | **no focusable content, ever** [8] |
| **Side panel** | full justification, evidence links (ADR-0014), author and timestamp, per-rater values and spread (ADR-0011), annotations | opened on `Enter`, closable on `Escape`, focus returns to the originating cell |

The hard boundary between tier 2 and tier 3 is the APG's: "Tooltip widgets do not receive focus. A
hover that contains focusable elements can be made using a non-modal dialog" [8]. Evidence links
are focusable. Therefore **evidence links may never appear in a tooltip.** This is why the detail
panel is not optional — it is the only accessible home for the capability that distinguishes an
agent-produced analysis from a spreadsheet.

#### 4.2 The hover-tooltip accessibility problem, concretely

WCAG 2.1/2.2 SC **1.4.13 Content on Hover or Focus (AA)** requires all three of [28]:

- **Dismissible** — "a mechanism is available to dismiss the additional content without moving
  pointer hover or keyboard focus" ⇒ `Escape` closes the tooltip and focus stays on the cell.
- **Hoverable** — "the pointer can be moved over the additional content without the additional
  content disappearing" ⇒ no gap between cell and tooltip; a grace timeout on `mouseleave`.
- **Persistent** — "the additional content remains visible until the hover or focus trigger is
  removed, the user dismisses it, or its information is no longer valid" ⇒ no auto-dismiss timer.
  Ever.

And the named failure modes are exactly the three things a naive implementation does: content that
cannot itself be hovered, content that cannot be dismissed without moving focus, and content that
disappears too fast to read [28].

Two further rules:

- **Never use the `title` attribute** for the justification. It is not keyboard reachable, not
  available on touch, styling is not controllable, and its presentation varies by AT.
- **The tooltip must open on focus, not only on hover.** The cell is focusable (roving tabindex), so
  bind `focus`/`blur` alongside `pointerenter`/`pointerleave`. On touch, skip the tooltip entirely
  and go straight to the panel on tap.

#### 4.3 Detail panel behaviour

Non-modal by default (the matrix stays readable and operable alongside it — this is the whole point
of side-by-side comparison). On open, move focus to the panel's heading (`tabindex="-1"`). `Escape`
closes and returns focus to the exact cell. Announce open/close through the polite live region.
Keep it a `<aside role="complementary" aria-labelledby>`, not `role="dialog"`, because it is not
modal and does not trap focus.

---

### 5. Colour-vision deficiency, forced colors, and print — and the channel that survives all three

#### 5.1 CVD simulation: use the right algorithm, and put it in CI

**EVIDENCE.** The canonical physiologically-based model is Machado, Oliveira & Fernandes (2009),
which handles normal vision, anomalous trichromacy and dichromacy in one framework and was
validated experimentally against CVD and normal-vision observers [29]. It is what Chromium and
Firefox now use for their built-in vision-deficiency emulation [30]. DaltonLens's review of open
source implementations is the practical guide and its findings are specific and actionable [30]:

- For **protanopia and deuteranopia**: Viénot 1999, Brettel 1997 and Machado 2009 are all reliable.
- For **tritanopia**: **only Brettel 1997** — the others were not designed for it.
- **Never use the Coblis V1 / "ColorMatrix" matrices** — derived from three RGB primaries, ignoring
  sRGB non-linearity, and disowned by their own author. The HCIRN/Coblis V2 variant was never
  experimentally validated and has a restrictive licence.
- Many Viénot 1999 implementations found in the wild **skip sRGB decoding**, which makes simulated
  colours too dark, and use CRT-era primaries rather than sRGB.

That last point matters more than the algorithm choice: the common failure is not picking the wrong
paper, it is applying the right matrix to gamma-encoded sRGB values. Decode to linear light, apply
the matrix, re-encode.

Two implementation routes, both fine: (a) DaltonLens publishes accurate **SVG `feColorMatrix`
filters** for CVD simulation, which need no library and can be applied to a screenshot in a test
[31]; (b) `@cantoo/color-blindness` is a TypeScript implementation of Brettel–Viénot–Mollon [32].
Prefer (a) for CI, because a filter applied to a rendered screenshot tests the *composited* result —
including the blended `uncertainty-suppressed` encoding from ADR-0010 — rather than the palette
tokens in isolation.

Palette design guidance, not just checking: Okabe & Ito's Color Universal Design set is the
practical reference — vermilion rather than red, bluish-green rather than green, avoid anything
between yellow and green, and above all use **redundant coding**: shape, hatching, direct labels,
and brightness differences rather than hue differences [33]. Their point that direct labels beat a
colour-coded key is directly applicable to our legend.

#### 5.2 Forced colors: the finding that decides the texture channel

**EVIDENCE, and this is the single most consequential technical fact in this section.** In forced
colors mode the UA overrides `background-color`, `border-color`, `color`, `fill`, `stroke`,
`outline-color`, `text-decoration-color`, `caret-color`, `accent-color`, `scrollbar-color` and
others with system colours; `box-shadow` and `text-shadow` compute to `none`; and —

> `background-image` computes to `none` unless the original value contains a `url()` function [9]

That deletes `repeating-linear-gradient()` hatching, which is the obvious and near-universal way to
implement a texture channel in CSS. In `forced-colors: active`, a heatmap built from background
colours plus gradient hatching loses **both** channels simultaneously and renders as a grid of
identical Canvas-coloured boxes.

What survives:

| Mechanism | CVD-safe | forced-colors | print (backgrounds off) |
|---|---|---|---|
| `background-color` ramp | ✗ alone | ✗ forced to Canvas | ✗ omitted by default |
| `repeating-linear-gradient` hatch | ✓ | ✗ computes to `none` [9] | ✗ background |
| `background-image: url(data:…svg)` | ✓ | ✓ preserved [9] | ✗ background, and colours are frozen |
| **foreground `<svg>` with `stroke="currentColor"`** | ✓ | ✓ forced to `CanvasText`, stays visible | ✓ foreground, always printed |
| **text (the numeral, the reason word)** | ✓ | ✓ | ✓ |
| `border` / `outline` | ✓ | ✓ forced but visible | ✓ |

**The answer to "what is the texture channel that survives all three" is: the foreground.** Render
confidence hatching, missingness glyphs and any pattern as an inline `<svg>` **inside the cell**
with `stroke="currentColor"` / `fill="currentColor"`, not as a background. `currentColor` is forced
to the system text colour in forced-colors mode, so the pattern remains visible and correctly
contrasted, and foreground content is printed even when the user's print dialog omits backgrounds.

Additional forced-colors rules:

- Add a `@media (forced-colors: active)` block that: restores explicit `border` on every cell (the
  colour ramp is gone, so the grid needs structure); replaces the colour legend with the text
  legend; and sets `forced-color-adjust: none` **only** on the small legend swatches that
  demonstrate the palette — nowhere else. Roselli notes the `forced-colors` media query as standard
  practice for exactly this sort of component [24].
- Use system colour keywords (`Canvas`, `CanvasText`, `GrayText`, `Highlight`, `HighlightText`,
  `ButtonBorder`) inside that block rather than our tokens.
- The `not-applicable` vs `not-assessed` distinction (ADR-0009) must be carried by **glyph shape**,
  not by hatch density and not by colour — a diagonal rule versus an empty cell, for instance —
  because glyph shape is the only channel with no degradation path.

#### 5.3 Print

`print-color-adjust: economy` is the initial value, meaning the UA "might opt to leave out all
background images and to adjust text colors" [10]. `print-color-adjust: exact` requests otherwise,
but MDN is blunt about the limits: "There isn't any guarantee that `print-color-adjust` will do
anything. Not only can the user override the behavior, but each user agent is allowed to decide for
itself how to handle `print-color-adjust` in any given situation." [10]. It is Baseline as of
May 2025 [10].

Therefore: set `print-color-adjust: exact` on the matrix as a *hint*, and design the print
stylesheet so it is legible without it — foreground glyph + numeral in every cell, explicit cell
borders, the legend rendered as a text table rather than swatches. Add `thead { display:
table-header-group }` for repeated headers, accepting that CSS Tables Level 3 §6.2 is the only
normative hook and browser support has historically varied [26]; verify it rather than assume it.

#### 5.4 Contrast, computed

BRIEF.md and ADR-0010 already require computing ink colour from the rendered background. Two
thresholds to encode as named constants rather than magic numbers:

- Text in cells: **4.5:1** (SC 1.4.3) for the numeral at body size.
- The texture stroke, cell borders, focus ring and any glyph that carries meaning: **3:1** against
  adjacent colours, per SC **1.4.11 Non-text Contrast (AA)** — "The visual presentation of the
  following have a contrast ratio of at least 3:1 against adjacent color(s): User Interface
  Components … Graphical Objects", the latter being "Parts of graphics required to understand the
  content". The Understanding document glosses the term as covering "the important parts of a more
  complex diagram such as each line in a graph" [34]. Our confidence hatch is exactly such a part.

---

## What this means for the schema / the view / the agent

**Schema (`core`): nothing changes.** Everything in this section is view-layer. That is a
confirmation of ADR-0005's boundary, and worth saying explicitly: accessibility did not leak into
the schema.

**View-state additions** (ADR-0006/0007 view state, not the analysis document):

```ts
type Axis = 'alternatives' | 'criteria';

interface RovingFocus {          // persisted, so returning from the panel restores position
  alternativeId: string;
  criterionId: string;
}

interface GrabState {            // transient, never persisted
  axis: Axis;
  id: string;
  originIndex: number;
  currentIndex: number;
}
```

**Functions to name and test in `core` (pure, no DOM):**

- `moveAlong(order: string[], id: string, delta: number): string[]`
- `moveTo(order: string[], id: string, index: number): string[]`
- `describeMove(axis, label, fromIndex, toIndex, total, neighbourLabel?): string` — the single
  source of truth for every reorder announcement, so that the menu path, the grab path and the drag
  path say identical things. Test this directly; it is the cheapest accessibility test in the
  project.
- `describeCell(measures, missing, criterion, alternative): string` — the visually-hidden cell
  text, e.g. `"5 of 5, confidence low"` / `"not applicable"`.
- `contrastRatio(fg, bg)` and `pickInk(bg, inks, minRatio)` — with `minRatio` defaulting to
  `TEXT_CONTRAST_MIN = 4.5` and a separate `GRAPHIC_CONTRAST_MIN = 3`.

**View ports and components:**

- `ReorderHandle` — one component, two routes (menu + grab). It owns focus restoration.
- `LiveAnnouncer` — two regions (`assertive` for the drag lifecycle, `polite` for results), one API,
  injected as a port so `core` logic can be tested without a DOM.
- `CellTexture` — inline SVG, `currentColor`, never a background image.
- Encoding registry entries (ADR-0010) gain a required `texture` field alongside `colour`; an
  encoding that cannot describe itself without colour must fail registration. Make that a runtime
  invariant, not a convention.

**Dependencies to add:** `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0, ~4.7 kB core, deps
`raf-schd`, `bind-event-listener`, `@babel/runtime`) and optionally
`@atlaskit/pragmatic-drag-and-drop-auto-scroll`. Do **not** add
`@atlaskit/pragmatic-drag-and-drop-react-accessibility` — it is React-bound and design-system-bound;
write the 150-line keyboard layer instead.

**For the agent (`rubricator`):** nothing here constrains the agent, but two things it produces are
consumed by the accessible view and should be authored with that in mind — the one-line
justification is spoken aloud through `aria-describedby`, so it must read as a sentence, not as
fragments; and the `missing` reason code drives a glyph with no colour fallback, so extending the
reason-code set (ADR-0009 permits it) requires a matching glyph, which the view should enforce.

---

## v1 accessibility acceptance checklist

### A. Automated, in CI (must be green to merge)

| # | Check | Mechanism |
|---|---|---|
| A1 | No axe-core violations on the standalone bundle, light and dark | `@axe-core/playwright`, `emulateMedia({ colorScheme })` |
| A2 | Exactly one element inside the matrix has `tabindex="0"` at all times | DOM assertion after each simulated arrow key |
| A3 | Every `<td>` has non-empty accessible text; no `<td>` is announced as blank | traverse + assert `textContent` incl. visually-hidden |
| A4 | Every `missing` cell's text matches its reason code's phrase | table-driven over all reason codes |
| A5 | `describeMove` unit tests: start, middle, end, single-element axis, cancel | pure unit test, no DOM |
| A6 | Keyboard reorder round-trip: focus handle → Enter → ArrowRight ×2 → Enter ⇒ order changed **and** `document.activeElement` is the same handle | Playwright |
| A7 | Same round-trip using `Tab` instead of `ArrowRight` produces the identical order | Playwright |
| A8 | `Escape` during grab restores the original order and focus | Playwright |
| A9 | Every reorder emits exactly one assertive announcement containing the label and "of *N*" | spy on `LiveAnnouncer` port |
| A10 | Arrowing to a cell at the top/left edge leaves it fully visible — bounding box does not intersect the sticky header or row header (SC 2.4.11) | Playwright geometry assertion |
| A11 | Tooltip: `Escape` closes it, focus stays on the cell; no timer-based auto-dismiss exists | Playwright + source grep for `setTimeout` in the tooltip module |
| A12 | Tooltip subtree contains **zero** focusable elements | DOM query for focusables inside `[role=tooltip]` |
| A13 | Contrast: every rendered cell's ink vs its **computed composited** background ≥ 4.5:1; texture stroke vs cell fill ≥ 3:1 — for every encoding × every theme | canvas readback in a headless browser |
| A14 | CVD: render the matrix, apply protanopia / deuteranopia (Viénot 1999 or Machado 2009) and tritanopia (Brettel 1997) filters, assert adjacent palette steps remain ≥ ΔE threshold apart | SVG `feColorMatrix` on a screenshot [31] |
| A15 | `forced-colors: active`: every cell still shows its numeral and its texture glyph; cell borders present; snapshot diff reviewed | `page.emulateMedia({ forcedColors: 'active' })` [35]; the docs list the option without stating engine coverage, so confirm which engines honour it at the version you pin |
| A16 | Source contains **no** `repeating-linear-gradient` or `background-image` used as a meaning-bearing channel | lint rule / grep |
| A17 | Source contains no `aria-grabbed`, no `aria-dropeffect`, no `title=` on a cell | grep |
| A18 | `emulateMedia({ media: 'print' })`: every cell's numeral and glyph present in the print snapshot with backgrounds suppressed | Playwright |
| A19 | Standalone bundle issues zero network requests (already required by ADR-0013) | Playwright request interception |
| A20 | `prefers-reduced-motion: reduce` disables drag animation and smooth scroll | Playwright |

Note on A1: axe-core catches a minority of real accessibility defects. It is a floor, not a gate on
quality — A2–A20 are where the value is.

### B. Manual pass (once per release, recorded in the release notes)

1. **NVDA + Firefox, NVDA + Chrome.** Enter the matrix; confirm it is announced as a table/grid with
   correct dimensions. Use `Ctrl+Alt+Arrow` table navigation; confirm the criterion and alternative
   headers are announced with each cell, followed by "*n* of 5, confidence *x*".
2. **JAWS + Chrome.** Same, plus `Ctrl+Alt+Arrow`. Confirm the grab-mode arrow keys reach the
   handler; if they do not, confirm the `Tab` route works and the menu route works.
3. **VoiceOver + Safari (macOS).** Confirm sort announcements arrive via the live region —
   VoiceOver/macOS is documented **not** to announce `aria-sort` changes on activation [24].
4. **VoiceOver + Safari (iOS 17+).** Confirm cells and headers are announced; confirm tap opens the
   panel (no tooltip on touch).
5. **Keyboard only, no screen reader.** Reorder a criterion by menu and by grab. Confirm the
   keyboard-help affordance is discoverable without a screen reader (this is Roselli's objection
   [19] and the only way to check it is to look).
6. **Windows High Contrast Mode**, real, not emulated. Compare against the A15 snapshot.
7. **400 % browser zoom, 320 px viewport.** Sticky headers, panel, and menus still usable.
8. **Print to PDF** with "background graphics" **off**, on Chrome and on Safari. Every cell legible;
   note whether headers repeated on page 2 and record the answer per browser [26].

---

## Recommended ADR actions

| ADR | Action | Reason |
|---|---|---|
| ADR-0008 | **amend** | Currently `proposed` and names `dnd-kit` as the first candidate; registry data shows its stable line has had no release since 2024-12-05 and its successor is pre-1.0. Replace with `@atlaskit/pragmatic-drag-and-drop`, and upgrade "keyboard-accessible equivalent" to "keyboard-and-menu primary path", citing WCAG 2.2 SC 2.5.7 as normative. |
| ADR-0005 | **confirm** | Nothing in this section requires a DOM API in `core`; the framework-agnostic DnD choice actively supports the "framework undecided" position. |
| ADR-0010 | **confirm** | The computed-ink rule and "never colour alone" both hold up. One addition belongs in a new ADR rather than an edit: `texture` becomes a required field of an encoding registration. |
| ADR-0009 | **confirm** | Reason codes survive contact with AT. Add the view-side requirement (glyph shape per code, no colour dependence) in the new ADR below rather than editing this one. |
| — | **new ADR-0017: Matrix accessibility semantics** | Settles: `<table role="grid">` rather than `<div>`s or a plain table; roving tabindex, never `aria-activedescendant`; no virtualisation in v1 with a documented trigger; visually-hidden cell text rather than `aria-label`; the three-tier disclosure rule and the "no focusable content in a tooltip" boundary. |
| — | **new ADR-0018: Non-colour channels — texture, forced colors, print** | Settles: texture is foreground `currentColor` SVG, never `background-image`, because `background-image` computes to `none` in forced-colors mode; the CVD algorithm choice (Viénot 1999 / Machado 2009 for protan/deutan, Brettel 1997 for tritan, always sRGB-decoded); `print-color-adjust: exact` as hint only; the 4.5:1 / 3:1 threshold constants; `texture` required on every registered encoding. |
| — | **new ADR-0019: Accessibility acceptance criteria** | Promotes the checklist above to a merge gate, so "accessibility is not a later pass" (BRIEF.md) has an enforcement mechanism rather than an aspiration. |

---

## Open questions

1. **Do bare arrow keys reach a grab-mode handler in NVDA and JAWS browse mode when the focused
   element is a `<button>` inside a `role="grid"`?** I could not settle this from published sources;
   the mode-switching behaviour is documented as complex but not tabulated for this exact case
   [4][19][21]. **Settled by:** one hour of testing with NVDA 2025.x + Firefox and JAWS 2026 +
   Chrome. Until then the dual `Tab` binding makes the answer not matter, which is why it is in the
   spec.
2. **Does the composited `uncertainty-suppressed` encoding (ADR-0010) remain CVD-separable at the
   confidence extremes?** The value ramp and the suppression pull interact, and a value-suppressing
   palette compresses toward the surface colour exactly where discrimination is hardest.
   **Settled by:** running check A14 against the actual palette before it is frozen. If steps
   collapse, the fix is fewer value steps, not a different hue.
3. **Does `<thead>` repeat across printed pages in current Chrome and Safari?** CSS Tables Level 3 §6.2 covers it [26] but the
   readily-available write-ups on browser support are old enough to be unreliable.
   **Settled by:** manual check B8, recorded per browser.
4. **Is a non-modal side panel the right shape at 320 px?** At small viewports it must become modal
   or a full-screen sheet, which changes the focus-trap answer. **Settled by:** manual check B7,
   and a decision recorded in ADR-0017 if it changes the pattern.
5. **Should the grab-mode announcement be assertive or polite?** Assertive is specified above
   because the user initiated a mode, but assertive regions interrupt, and a rapid sequence of
   arrow presses will queue. **Settled by:** listening to it. If it is unpleasant, debounce the move
   announcements and keep only grab/drop/cancel assertive.

---

## REFERENCES

1. [npm registry metadata for `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/react`, `@dnd-kit/dom`, `@atlaskit/pragmatic-drag-and-drop`, `sortablejs`, `@react-aria/dnd` — npm, Inc. (retrieved 2026-08-18)](https://registry.npmjs.org/)
2. [Pragmatic drag and drop — README — Atlassian (2026)](https://github.com/atlassian/pragmatic-drag-and-drop)
3. [Understanding SC 2.5.7: Dragging Movements (Level AA) — W3C WAI, WCAG 2.2 (2023)](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
4. [Aria-activedescendant is not focus — Sarah Higley (16 October 2024)](https://sarahmhigley.com/writing/activedescendant/)
5. [Grids Part 2: Semantics — Sarah Higley (7 January 2021)](https://sarahmhigley.com/writing/grids-part2/)
6. [\[css-tables\] Collapsed table borders don't follow sticky rows/cells when they stick — csswg-drafts issue #3136 (2018–, open)](https://github.com/w3c/csswg-drafts/issues/3136)
7. [Understanding SC 2.4.11: Focus Not Obscured (Minimum) (Level AA) — W3C WAI, WCAG 2.2 (2023)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
8. [ARIA Authoring Practices Guide — Tooltip Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
9. [CSS Color Adjustment Module Level 1 — Forced Colors Mode — W3C](https://www.w3.org/TR/css-color-adjust-1/)
10. [print-color-adjust — MDN Web Docs, Mozilla](https://developer.mozilla.org/en-US/docs/Web/CSS/print-color-adjust)
11. [clauderic/dnd-kit — repository metadata via GitHub REST API (retrieved 2026-08-18)](https://github.com/clauderic/dnd-kit)
12. [\[Question\] Active Maintenance Status and Suitability for Production Use? — dnd-kit issue #1830 (opened and closed 2025-11-04; answered by the maintainer)](https://github.com/clauderic/dnd-kit/issues/1830)
13. [Future of DnD Kit? — dnd-kit discussion #1156 (2023-06-20; one reply, no maintainer response)](https://github.com/clauderic/dnd-kit/discussions/1156)
14. [dnd-kit — Accessibility guide (legacy 6.x docs; `/guides/accessibility` now redirects here)](https://dndkit.com/legacy/guides/accessibility/)
15. [Pragmatic drag and drop — Accessibility guidelines — Atlassian Design System](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)
16. [Taming the dragon: Accessible drag and drop — Devon Govett, React Aria / Adobe (16 November 2022)](https://react-aria.adobe.com/blog/drag-and-drop)
17. [What's the status on making SortableJs accessible? — SortableJS issue #1951 (open since 2020-10-28); see also issue #1176, "Any thought to making this accessible? (keyboard / aria)" (opened 2017-09-11, closed 2017-09-18 without an accessibility implementation)](https://github.com/SortableJS/Sortable/issues/1951)
18. [ARIA: aria-grabbed attribute (deprecated in ARIA 1.1) — MDN Web Docs, Mozilla](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-grabbed)
19. [ARIA Grid As an Anti-Pattern — Adrian Roselli (July 2020, updated November 2022)](https://adrianroselli.com/2020/07/aria-grid-as-an-anti-pattern.html)
20. [ARIA Authoring Practices Guide — Grid Pattern — W3C WAI](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
21. [Grids Part 1: To grid or not to grid — Sarah Higley (10 July 2020)](https://sarahmhigley.com/writing/grids-part1/)
22. [Data table with `role=grid` — Screen reader compatibility tests — PowerMapper Software](https://www.powermapper.com/tests/screen-readers/tables/table-role-grid/)
23. [JAWS 2025/2026 do not announce aria-current or aria-description on ARIA grid rows with role="row" — FreedomScientific/standards-support issue #927](https://github.com/FreedomScientific/standards-support/issues/927)
24. [Sortable Table Columns — Adrian Roselli (2021)](https://adrianroselli.com/2021/04/sortable-table-columns.html)
25. [TablesNG Resolves 72 Chromium Bugs for Better Interoperability — Chrome for Developers (2021)](https://developer.chrome.com/blog/tablesng)
26. [CSS Table Module Level 3 — §6.2 Repeating headers across pages — W3C](https://www.w3.org/TR/css-tables-3/)
27. [Tables, CSS Display Properties, and ARIA — Adrian Roselli (February 2018, updated 29 January 2024)](https://adrianroselli.com/2018/02/tables-css-display-properties-and-aria.html)
28. [Understanding SC 1.4.13: Content on Hover or Focus (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
29. [A Physiologically-based Model for Simulation of Color Vision Deficiency — Machado, Oliveira & Fernandes, IEEE TVCG 15(6) (2009)](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)
30. [Review of Open Source Color Blindness Simulations — DaltonLens (2021)](https://daltonlens.org/opensource-cvd-simulation/)
31. [Accurate SVG filters for color blindness simulation — DaltonLens](https://daltonlens.org/cvd-simulation-svg-filters/)
32. [@cantoo/color-blindness — TypeScript implementation of the Brettel–Viénot–Mollon algorithm](https://github.com/cantoo-scribe/color-blindness)
33. [Color Universal Design — How to make figures and presentations friendly to colorblind people — Okabe & Ito](https://jfly.uni-koeln.de/color/)
34. [Understanding SC 1.4.11: Non-text Contrast (Level AA) — W3C WAI, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
35. [`page.emulateMedia()` (media, colorScheme, reducedMotion, forcedColors, contrast) — Playwright](https://playwright.dev/docs/api/class-page#page-emulate-media). The `colorScheme` fixture used in check A1 is on [TestOptions](https://playwright.dev/docs/api/class-testoptions).
36. [Accessible Rich Internet Applications (WAI-ARIA) 1.1 — `aria-grabbed`, `aria-dropeffect` (“Deprecated in ARIA 1.1”) — W3C](https://www.w3.org/TR/wai-aria-1.1/)
