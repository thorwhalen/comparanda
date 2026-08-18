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
