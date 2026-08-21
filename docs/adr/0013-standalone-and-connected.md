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

## Amendments

### 2026-08-21 — Zero-network is a property the browser enforces, checked at build time

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

This section replaces the last sentence of the Consequences above — "Add a CI check that the
standalone bundle makes zero network requests when loaded" — and names the mechanism the Decision's
graceful-degradation paragraph asks for by description and does not name. The Context, the
Decision, and the rest of the Consequences stand exactly as written. The evidence is
`docs/research/findings-terminology.md` § 6.3; the port shape it depends on is ADR-0006's
2026-08-21 amendment, and the build pipeline it rides on is ADR-0017 clause 6.

**1. The artifact carries a Content-Security-Policy meta tag, and this is the directive set.**

```
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data:;
font-src data:;
connect-src 'none';
form-action 'none';
base-uri 'none'
```

`connect-src 'none'` is the clause that does the work. It makes `fetch`, `XMLHttpRequest`,
`EventSource`, `WebSocket` and `navigator.sendBeacon` *fail at runtime* rather than merely be absent
from the source — which turns this ADR's "no component may reach past its port" from a code-review
convention into a property the browser enforces. It is written out even though `default-src 'none'`
already implies it, so that a later relaxation of `default-src` cannot silently re-open the network.

`'unsafe-inline'` for script and style is not a concession here: the bundle is inlined by
construction (ADR-0017), there is no origin to fetch from, and hashing generated bundles buys
nothing once `default-src` is `'none'`. Delivery is the meta tag because a `file://` artifact has no
response headers; directives that work only as a header — `frame-ancestors`, `sandbox`, `report-*` —
are therefore unavailable, and none of them is load-bearing for this artifact.

**2. Three checks, and they run in `comparanda build`.**

- **A static grep**, as a cheap pre-filter, so the failure message names the offending string rather
  than a request that did not happen.
- **A browser test that exercises the view.** Loading the file and asserting on the request log
  misses exactly the bug this ADR names: a `fetch()` inside a cell renderer only fires when that
  renderer runs. The test drives the view — mount, reorder both axes, group and ungroup, switch
  through every registered encoding, expand a missing cell's reason and an evidence excerpt — and
  asserts the **absence of console errors**, because that is how a CSP violation surfaces. The real
  browser is already in CI for ADR-0029's accessibility gate; this rides the same harness.
- **A byte assertion on the emitted payload**: no measure the disclosure projection removed appears
  anywhere in the file. ADR-0021 makes `comparanda build` the enforcement point for that projection
  in the standalone shape, and View Source is the attack, so the check belongs on the bytes.

**The checks fail `comparanda build`, not only CI.** A CI-only check does not protect the person who
builds locally and mails the result — and that person is the entire scenario the build command
exists for. CI runs them too, over the fixture set.

**3. Graceful degradation is `getCapabilities()`, and nothing else.** The Decision above requires
that standalone "shows saved views working locally while annotations are read-only, and says so".
That is capability discovery, and it already exists: every `DataProvider` reports
`ProviderCapabilities`, with a documented default for providers that do not implement it (ADR-0006).
**The view derives every enable, disable and explanatory label from it, and `comparanda` never
invents a parallel "is this read-only?" flag.** A second source of truth for editability is precisely
how the failure this ADR warns about happens: controls that are present and silently do nothing.

**4. The mailed file may be rejected, and the CLI says so up front.** Enterprise mail filtering lists
`htm` and `html` among selectable attachment types and matches them by true type regardless of the
filename extension, so renaming the file does not evade it [1]. The option is opt-in rather than
default, but it exists because HTML attachments are a common phishing vector, so expect rejection at
some recipients whatever the file weighs. This changes what the CLI prints, not the architecture:
`comparanda build` reports raw bytes, gzip bytes and this limitation together, and the docs give the
workaround. A user should learn it from the tool, not from a bounce.

#### References

1. [Anti-malware protection for email in Microsoft 365 — common attachments filter, Microsoft Learn](https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-about) — `htm`/`html` sit on the opt-in additional list rather than the default blocked set, and the true-type matcher recognises them regardless of extension.
