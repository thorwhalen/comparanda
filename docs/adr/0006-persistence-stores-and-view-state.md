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

## Amendments

### 2026-08-21 — The persistence port is `DataProvider<T>`, not a key-value store

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section corrects the *shape* of the port named in the Decision above. Everything else in that
Decision stands: the fallback chain, the feature-detected `localStorage` write, the visible
in-memory notice, the cross-tab rules, and the schema version with its migration harness written
alongside the first schema. The Context and the Consequences stand unchanged. The evidence is a
source read of the zodal packages, reported in `docs/research/findings-visualisation.md` § 5.4 and
`docs/research/findings-terminology.md` § 6.3, with the port-by-port fit table in
`docs/research/sections/c8-prior-art-and-stack.md` § B.2.

**1. There is no key-value "zodal store".** The Decision's "a zodal store interface — a key-value
mapping the caller supplies" describes an interface that does not exist. `@zodal/store` exports
`DataProvider<T>`: collection CRUD — `getList`, `getOne`, `create`, `update`, `updateMany`,
`delete`, `deleteMany`, plus optional `upsert`, `getCapabilities`, `subscribe`, `getContent`,
`setContent` and `getUrl`. Read that phrase, throughout this ADR, as **a `DataProvider<T>` the
caller supplies**. This is a correction, not a change of mind: an implementer coding to the original
wording would be coding to an API that is not there, and this is the port every adapter is built
against.

**2. The ports, restated.** ADR-0013's injected ports keep their separation; only their common
shape is now stated correctly, and its `PersistenceStore` resolves into the two providers its own
gloss already named.

```
AnalysisSource  = DataProvider<Analysis>    // ADR-0013's DataSource; one-item provider
ViewStateStore  = DataProvider<ViewState>   // one-item provider, per user, per device
SavedViewStore  = DataProvider<SavedView>
AnnotationSink  = DataProvider<Annotation>
AssertionStore  = DataProvider<Assertion>
```

`ViewStateStore` and `SavedViewStore` together are ADR-0013's `PersistenceStore`.

Saved views, annotations and rater assertions are genuine collections, and the fit is exact —
`getList` / `create` / `update` / `delete` is literally the CRUD ADR-0007 specifies. The analysis is
not a queryable set; it is one versioned aggregate, so it is a **degenerate one-item provider**, the
pattern `zodal-dials` already established for a settings document. `getOne` loads it, `update`
writes it, `subscribe` supplies ADR-0013's "load / subscribe" for free, and the standalone frozen
source is simply a provider that reports `canUpdate: false`. View state takes the same one-item
form; over `localStorage` that is `getOne` and `update` against a single key, behind a wrapper
written once.

One shape across every port is what this ADR always did. The separation its Context insists on is
semantic — lifecycle, conflict policy, and who may write — and none of it moves: last-write-wins
remains acceptable for view state and unacceptable for the analysis (ADR-0011), and the schema
version and migrations remain the analysis's alone.

**3. `getCapabilities()` is the single source of truth for what the UI offers.** `DataProvider`
already reports `ProviderCapabilities` — `canCreate`, `canUpdate`, `canDelete`, the bulk and
server-side flags, `realtime`, `bifurcated` — with a documented default for providers that do not
implement it. **The view derives every enable, disable and explanatory label from it, and
`comparanda` never invents a parallel "is this read-only?" flag.** A second source of truth for
editability is precisely how the failure ADR-0013 warns about happens: controls that are present and
silently do nothing. This is also the mechanism ADR-0013 asks for by description and does not name —
standalone showing saved views working locally while annotations are read-only, *and saying so*, is
capability discovery, and it is already implemented upstream.

**4. Considered and rejected: two differently shaped ports.** Keeping a key-value port for view
state and using `DataProvider` only for the collections was raised in adversarial review, on the
argument that a collection interface over the most-exercised write path in the product is ceremony
nobody budgeted for. It was refuted there: the one-item provider covers the non-collection case at
the cost of a two-method wrapper, and a second port shape would buy nothing the semantic separation
above does not already give. Recorded so the next reader need not re-check it — see
`docs/research/phase0-review.md`, the ADR-0006 entry.
