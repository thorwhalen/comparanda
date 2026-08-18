# ADR-0006: Persistence through zodal stores, with a notified in-memory fallback

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Three quite different things need persisting, and conflating them is a common failure:

1. **the analysis** — alternatives, criteria, values, annotations. Shared, authored, versioned.
2. **view state** — column order, grouping, selection, active encoding. Per-user, per-device,
   ephemeral, changes constantly.
3. **saved views** — named, deliberate snapshots of view state. Per-user or shared.

## Decision
All persistence goes through a **zodal store** interface — a key-value mapping the caller supplies.
The package never talks to `localStorage` or to a network directly; it talks to a store.

Default resolution order when no store is supplied:
1. a caller-provided store, if given;
2. `localStorage`, if available and writable (feature-detected by attempting a write — private
   browsing modes expose the API and then throw);
3. an in-memory object, **with a visible, non-dismissable-by-accident notice to the user** that
   their arrangement and saved views will be lost when the tab closes.

That third case must be surfaced in the UI. Silently discarding someone's saved views is the worst
available outcome, and it happens on exactly the platforms where nobody tests.

Cross-tab synchronisation: view state syncs across tabs of the same origin (the `storage` event for
the localStorage adapter; a `BroadcastChannel` where richer coordination is wanted). Last-write-wins
is acceptable for view state. It is *not* acceptable for the analysis — see ADR-0011.

The analysis carries a **schema version**; loading an older version runs registered migrations.
Write the migration harness with the first schema, not when it is first needed.

## Consequences
- The same code runs against localStorage, a server, a file, or a test double.
- The standalone bundle uses a read-only store for the analysis and localStorage for view state,
  with no code path difference from connected mode.
- Storage-quota failure has to be handled: `localStorage` is small, and an analysis with evidence
  links and annotation threads can approach the limit. Fail loudly toward the user.
