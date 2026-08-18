# ADR-0003: Adopt MCDA terminology, and separate measures from encodings

- **Status:** accepted
- **Date:** 2026-08-18

## Context
The originating sketch used ad-hoc terms — "items", "features", "metric" — for concepts that
already have standard names in multi-criteria decision analysis. It also grouped `score`,
`confidence` and `blended` into a single dimension called "metric".

## Decision
1. Adopt MCDA vocabulary internally: **alternatives**, **criteria**, **decision matrix**,
   **subject**. Support per-analysis display aliases so the UI can say "directions" and "axes"
   without the data changing.
2. Separate **measures** (stored: `score`, `confidence`) from **encodings** (derived, view-layer:
   `score`, `confidence`, `blended`). The data tensor is `alternatives × criteria × measures`;
   encodings are named mappings from measures to visual channels.
3. Type every value by **level of measurement** (nominal / ordinal / interval / ratio), declared
   per `(criterion, measure)` with a per-criterion default.

See [../domain-model.md](../domain-model.md) for the full treatment and the reasoning.

## Consequences
- Adding a new way to *look* at existing data costs nothing in the schema.
- The tooling can refuse illegal operations — most importantly, it knows that a 1–5 rating is
  ordinal and that averaging it is a category error rather than a rounding concern.
- Anyone arriving from an MCDA background reads the codebase without translation, and the
  research phase can cite literature directly.

## Alternatives considered
- *Keep "items" and "features".* Friendlier, but disconnects the project from a literature it
  will need repeatedly, and collides with "feature" in the ML sense.
- *Treat `blended` as a stored measure.* Would require storing derived data and special-casing one
  member of a uniform dimension.
