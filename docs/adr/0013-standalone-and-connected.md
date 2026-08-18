# ADR-0013: One view, two deployment shapes, adapters as the only difference

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Two requirements that usually produce two codebases: a page that works with no network at all and
the data baked in, and a page wired to live data providers, persistence and identity.

## Decision
**Adapters are the only difference.** The view is written once against a set of injected ports:

    DataSource      load / subscribe to the analysis
    PersistenceStore  view state, saved views  (a zodal store, ADR-0006)
    IdentityProvider  who is acting            (ADR-0012)
    EvidenceResolver  turn an evidence ref into something openable (ADR-0014)
    AnnotationSink    where comments go        (may equal PersistenceStore)

Standalone mode is those ports bound to inert implementations: a frozen in-memory `DataSource` over
bundled JSON, a localStorage `PersistenceStore`, a local `IdentityProvider`, an `EvidenceResolver`
that opens embedded excerpts. Connected mode binds the same ports to HTTP.

Ship a **build command** that takes an analysis and emits a single self-contained HTML file — no
external requests, CSP-safe, openable from a file:// URL and mailable. This is the format for
sharing a finished comparison, and it is a first-class output, not a demo mode.

Degradation must be graceful and visible: standalone shows saved views working locally while
annotations are read-only, and says so, rather than presenting controls that silently do nothing.

## Consequences
Testing the whole view against in-memory adapters is trivial and fast. The discipline required is
that no component may reach past its port — one `fetch()` inside a cell renderer and the standalone
build breaks in a way that only shows up offline. Add a CI check that the standalone bundle makes
zero network requests when loaded.
