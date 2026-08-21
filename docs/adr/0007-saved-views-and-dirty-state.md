# ADR-0007: Saved views are named snapshots with explicit, visible dirty state

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Arranging a large matrix to make a point is real work, and it should be nameable, re-openable and
shareable. But an auto-saving view silently rewrites the arrangement someone else is reading.

## Decision
A **view** is a named, saved snapshot of view state: alternative order, criterion order, grouping,
selection, active encoding, sort, and any filter. Full CRUD: create (with a name), load, rename,
update, delete.

**No autosave.** Editing while a saved view is loaded produces a *modified* state that is not
written back until explicitly saved. The UI must make the distinction unmissable — a persistent
"Modified" marker next to the view name, with `Save`, `Save as new`, and `Revert` available from
where the marker is. The moment state diverges from the loaded view, the indicator appears.

There is always an implicit unsaved working state, so a user who never saves anything is never
blocked or nagged.

Views are addressable — loading one should be expressible in a URL so an arrangement can be sent
to somebody. In standalone mode this is a fragment; in connected mode a shareable link.

## Consequences
The interaction is familiar (it is how design tools and query editors behave) and it protects the
shared artifact from drive-by mutation. It costs a dirty-state comparison on every view-state
change: compare structurally against the loaded snapshot rather than tracking a boolean, so that
undoing a change back to the original correctly clears the marker.

## Amendments

### 2026-08-21 — `AxisOrder`, locked views, per-dimension revert, and view sequences

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section adds to the Decision above and corrects one thing the Decision could not have known:
what "order" is. The Context and the Consequences stand as written, and every clause of the
Decision stands — no autosave, full CRUD, the unmissable marker, the implicit working state,
addressability. The evidence is the prior-art survey in `docs/research/findings-terminology.md`
§ 6.1 and the ordering work in `docs/research/findings-visualisation.md` § 1.4 and summary row 5.

**1. Order is an `AxisOrder`, and dirty-state ignores `provenance`.** ADR-0025 replaces the bare
permutation this ADR assumed: the alternative order and the criterion order are each
`AxisOrder = { order, provenance, constraints }`, where `provenance` discriminates `authored`,
`manual`, `sorted` and `seriated` (carrying method and parameters in the seriated case) and
`constraints` holds pins and locked runs.

**Dirty-state compares `order` and `constraints`, and ignores `provenance`.** The reason is not
economy, it is correctness: `provenance` records *how* an arrangement was arrived at, not what the
arrangement is, so a re-run of seriation that lands on the identical order would otherwise mark a
clean view modified. A marker that fires on a change nobody made is a marker people learn to
ignore, which costs this ADR its entire protection. `provenance` is still saved with the view and
still restored on load — it is what lets the UI answer "why is it in this order" — it is simply not
part of the comparison.

This generalises. The comparison is over the **arrangement**, never over the derivation. Any field
added later that records how a state was reached rather than what it is is excluded on the same
grounds, and the exclusion is declared in the view-state schema rather than hand-maintained in the
comparison function.

**2. Dirty-state is a set of dimensions, and revert is per dimension.** The Consequences already
require a structural comparison rather than a boolean. Make its result first-class: the comparison
returns **the set of view-state dimensions that differ** from the loaded view, and the "Modified"
marker is that set being non-empty. One computation, two uses.

Each differing dimension gets its own **Revert**, alongside the whole-view `Revert` this ADR
already specifies — revert the criterion order without losing the grouping you spent ten minutes
building. This is Figma's per-property revert [3] applied to view state, and the marker names which
dimensions differ rather than only that something does.

The dimensions are those the view-state schema declares — alternative order, criterion order,
grouping, selection, active encoding, sort, filter, and `transposed` (ADR-0008) — so a dimension
added later gets its revert for free. They are keyed by schema field, never by label. Figma's other
half is the anti-pattern: identity by name and hierarchy means a rename silently orphans the
override with no diagnostic [3], and the same mistake here would silently attach a revert to the
wrong dimension.

**3. Locked is a third view mode, beside personal and shared.** No-autosave protects a view from
*accidental* mutation. It does nothing about the colleague who deliberately saves over the view the
steering group is reading, because they did not know it was load-bearing. Locking is what says so
[1, 2].

- **personal** — lives in the owner's own store; nobody else's client ever holds it.
- **shared** — lives with the analysis; anyone the host permits to edit may save over it.
- **locked** — shared, and **no in-place write is offered to anybody** until it is explicitly
  unlocked. Unlocking is a deliberate, attributed act, recorded like any other change to the shared
  artifact (ADR-0011).

`comparanda` still invents no permission model (ADR-0012): the mode declares what kind of write is
*intended*, the host decides *who* may write, and the UI offers a control only where both permit
it. Provider capability remains the source of truth for what the store will accept
(`getCapabilities()`, ADR-0006 as amended); mode is a property of the saved-view record and
composes with it. Two sources of truth for editability is the bug, one composition of two facts is
not.

Locking never dead-ends a reader, because **`Save as new` is always available** — the same escape
ADR-0011's suggestion mode gives an editor without rights. In standalone mode there is one user and
the personal/shared split collapses, but the lock still carries: it travels in the mailed file and
tells the recipient which arrangement is the argument.

**4. A view sequence is an ordered list of saved views, and nothing more.** Add a `ViewSequence`: a
named, ordered list of references to saved views, each step carrying an optional caption, and each
step addressable in the URL exactly as a single view already is. Walking it loads each view in
turn. This is the cheapest high-value feature the prior-art survey found — a named, ordered,
re-enterable walk through the artifact [4] — because once saved views exist it is a list.

The scope is a hard boundary, not an opening position. **A step is a saved view.** No slide
layouts, no transitions, no drawing surface, no per-step arrangement that is not itself a saved
view, and no step state that the view-state schema cannot express. A sequence is a reading order
over the analysis; the moment it can hold anything else, arrangement starts carrying meaning the
data model cannot represent, and the artifact stops being the argument.

A step whose view has been deleted renders as a **visibly broken step** naming what is missing. It
never silently closes up, for the same reason a `Missing` measure is never a blank (ADR-0009).

**What this costs.** The comparison function grows a dimension map and an exclusion list, both
schema-driven. Locking adds one field, one state to the marker area, and an attributed unlock
event. Sequences add one small collection to the same `DataProvider<T>` shape everything else
already uses (ADR-0006 as amended), so they cost a store registration rather than an architecture.

## References
1. [Getting started with Airtable views — Airtable Support](https://support.airtable.com/docs/getting-started-with-airtable-views)
2. [Database views, filters, sorts & groups — Notion Help Center](https://www.notion.com/help/views-filters-and-sorts)
3. [Apply overrides to instances — Figma Help Center](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)
4. [Presentation mode — Miro Help Center](https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode) — **unverified:** the page refused automated retrieval and was not content-verified, so it is cited as the origin of the idea and never quoted. Clause 4 does not depend on it; the mechanism is a list of our own saved views.
