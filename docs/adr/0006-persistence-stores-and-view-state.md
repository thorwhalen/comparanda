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

### 2026-08-22 — v1 uses one port, and multi-writer safety is a property of the key layout

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The 2026-08-21 amendment above fixes a **five-port** set — `AnalysisSource`, `ViewStateStore`,
`SavedViewStore`, `AnnotationSink`, `AssertionStore` — with `getCapabilities()` as the single source
of truth. Everything it says about *shape* stands. This narrows *how many of them v1 builds*, and
adds one constraint the port set cannot express on its own.

**1. v1 implements exactly one port: `DataProvider<Analysis>`.** The other four are view-state and
collaboration conveniences, and **splitting a port set before any of its members has two
implementations freezes a guess about which axes vary.** Saved views, annotations and assertions all
travel *inside* the analysis document in v1 — annotations because ADR-0011 anchors them to ids in
the document, assertions because ADR-0011 clause 3 puts them in the cell. A separate provider for
each is four interfaces over one aggregate. They arrive when a second implementation of one of them
exists, and the 2026-08-21 shape is what they arrive as.

This narrowing is recorded rather than taken silently because a reader comparing the code to that
amendment would otherwise read four missing ports as drift.

**2. `getCapabilities()` remains the single source of truth, unchanged.** Clause 3 above is not
narrowed by clause 1 and is not weakened by there being one port: v1's provider evaluates sort,
filter, search and pagination client-side and **declares exactly that**, which is true and is
correct for a handful of contributors. Moving any of them to the server later is a change to a
declaration, not to a component. `comparanda` still never invents a parallel read-only flag.

**3. `multiWriter` may be true only where `perContributorFiles` is.** `DataProvider.update(id,
partial)` is last-write-wins with no version field. ADR-0011 clause 6 says last-write-wins is not
acceptable for the analysis — and those two facts are compatible only under one condition: **that
two contributors never write the same key.** A store that keeps one file per contributor per
analysis satisfies it by construction; a store that keeps one shared document does not, and would
lose contributions silently.

So the capability report grows a **pair**, and the pair is the rule: a provider reporting
`multiWriter: true` while `perContributorFiles` is false is a defect, not a configuration. This is
the load-bearing invariant behind the whole shared-repository story, and it is written into the
capability report precisely so it stops being folklore.

**4. Below the port, everything is bytes, and that layer is the dependent's.** A consumer that
persists analyses to a filesystem or to a shared git repository does so through a mutable
string-to-bytes mapping in its own language, with the JSON codec, the key template and its
write-time validation *above* the seam and only the leaf byte store varying. **`comparanda` does not
own that layer and must not grow an opinion about it.** It is named here only so the next reader
knows the absence is deliberate: the analysis reaches this package as a `DataProvider<Analysis>`
and this package cannot tell, and must not be able to tell, whether it came from a directory, a
clone or an object store (ADR-0002).

**5. Merge is not `comparanda`'s in v1, and that is a decision.** Reconstituting one `Analysis` from
N contributor files is pure, deterministic, and belongs beside the schema — but it is written once,
in the repository that writes the files. A TypeScript port is deferred; when it lands it shares
**golden fixtures** with the first implementation, byte-compared, because two hand-written merges
that agree by inspection is exactly the drift ADR-0004's amendment of this date says a key-parity
check cannot see. The fixtures are `comparanda`'s to author (ADR-0016 governs their content) and are
the prerequisite for the port, not a follow-up to it.
