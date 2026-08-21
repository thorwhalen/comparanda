# ADR-0021: Disclosure is orthogonal to presence

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
A measure may be present in the authoring store and withheld from a particular reader. ADR-0009
puts `withheld` in the missingness reason set, which conflates "there is no value" with "there is a
value you may not see". Those are different facts about a cell and they have different consequences
for every analysis run over it. SDMX keeps them apart deliberately, carrying confidentiality status
beside observation status rather than folding one into the other [1, 2].

Left conflated, the two failures are concrete. Rendering a restricted view requires *destroying*
data, so an owner and a reviewer no longer read the same document. And a dominance front computed
for a restricted reader silently depends on measures that reader cannot see — the reader is given a
result they have no way to audit and no way to know they cannot audit.

## Decision
Disclosure is an orthogonal, **view-time** property of a measure. Redaction is a **projection**,
never an edit. `withheld` remains in the reason set of ADR-0009, because it genuinely is the reason
a reader sees nothing — it is the representation of a projected-out cell.

**Name the enforcement point.** The projection is applied wherever the analysis crosses to the
reader, and never in the renderer:

- **connected** — by the `DataSource` behind the port (ADR-0013), before the analysis reaches the
  view;
- **standalone** — by `comparanda build`, before the payload is inlined into the single-file
  bundle.

"View-time" read as "renderer-time" would inline withheld measures into a mailed HTML file, where
View Source recovers every one of them. The projected bundle is the artefact this feature exists
for, so it is the bundle the projection must precede.

`comparanda` does not decide who may see what. It consumes a disclosure decision the host asserts,
exactly as it consumes identity (ADR-0012), and invents no permission model.

A reader without access computes dominance over the **widened** interval (ADR-0019) and is **told**:
"computed with 3 cells withheld from you". Two readers with different access may legitimately see
different fronts — the restricted reader's front is conservative, which is correct, because they
genuinely do not know. That is the honest outcome, provided the difference is announced rather than
discovered.

Two requirements follow and are not optional:

- **Every analysis result carries a count of cells widened by disclosure**, and the view surfaces
  it at the point of use.
- **Aggregates over partially-disclosed data are labelled or suppressed** — never returned bare.

## Consequences
Redaction never mutates the analysis, so the owner's document and the reviewer's document are the
same document under two projections. The cost is that every analysis result grows a field it must
populate honestly and every view grows a place to show it; an analysis that forgets is not merely
imprecise, it is misleading, so the count belongs in the result type rather than in a convention.
Projection at the boundary also means the standalone build gains a real confidentiality
responsibility, and Phase 5 should assert on the bytes it emits.

## Alternatives considered
- *`withheld` as a missingness reason only.* Rendering a restricted view then requires destroying
  data, which is the failure this ADR exists to prevent.
- *Deriving `withheld` entirely at render time and removing it from the reason set.* More correct
  and more work. Revisit if a deployment ever needs an analysis in which nobody, the owner
  included, may store the value.
- *Projecting in the renderer.* Ships the withheld measures to the reader and hides them with CSS.
- *Splitting this ADR by deployment shape.* Rejected: one projection, two enforcement points. The
  reading that disclosure contradicts ADR-0012's "never invents a permission model" was raised in
  adversarial review and refuted there — the host asserts the disclosure decision, `comparanda`
  only honours it and announces its effect. Recorded so the next reader need not re-check it. See
  `docs/research/phase0-review.md`, the ADR-0021 entry.

## Amendments

### 2026-08-21 — The connected enforcement point is the `AnalysisSource`

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

The Decision names the connected enforcement point "the `DataSource` behind the port (ADR-0013)".
ADR-0013's amendment of the same date retires that name: every port is a `DataProvider<T>`
(ADR-0006), so `DataSource` distinguishes none of the five, and the analysis port is
**`AnalysisSource`**. Read this ADR's `DataSource` as `AnalysisSource`. The name `DataSource` is
reserved for nothing and no port in this package may carry it.

Nothing about the enforcement changes: the projection is still applied where the analysis crosses to
the reader — by the port's provider in connected mode, by `comparanda build` before the payload is
inlined in standalone mode.

## References
The reasoning is in `docs/research/findings-terminology.md` § 7, Conflict B, and the enforcement
clause comes from the surviving review finding on this draft in `docs/research/phase0-review.md`.

1. [CL_OBS_STATUS v2.3 — SDMX cross-domain code list for Observation Status, SDMX Global Registry (2025)](https://registry.sdmx.org/sdmx/v2/structure/codelist/SDMX/CL_OBS_STATUS/+/?format=sdmx-json&detail=full)
2. [Possible Ways of Implementing CL_OBS_STATUS Code List — SDMX Statistical Working Group / Technical Working Group (2014)](https://sdmx.org/wp-content/uploads/CL_OBS_STATUS_implementation_20-10-2014.pdf)
