# ADR-0016: Public repository — no proprietary content in tests, examples or fixtures

- **Status:** accepted
- **Date:** 2026-08-18

## Context
This package originates from a private strategic analysis. That analysis is confidential: it names
markets, competitors, internal disagreements and pricing. It must not travel into a public
repository through a test fixture, a screenshot, a default dataset, or a commit message.

Fixtures are the most likely leak. They get pasted in "just to have realistic data", and they
outlive the intention.

## Decision
No content from the originating analysis appears anywhere in this repository — not in tests,
examples, fixtures, docs, screenshots, seed data, benchmark data or git history. No company names,
product names, personal names or initials from it.

Example datasets are built from **public, uncontroversial, self-explanatory domains** where a
reader immediately understands the criteria without a briefing. Good candidates:

- choosing a programming language for a project (criteria: ecosystem, performance, hiring pool, …);
- choosing a city to live in (cost, climate, transit, …);
- selecting a database for a workload;
- comparing modes of transport for a route;
- picking a bicycle, a laptop, a camera.

At least one example must be deliberately **messy** — missing values of several different kinds,
inapplicable group blocks, multi-rater disagreement, partial evidence — because the clean example
will not exercise the parts of the schema that matter.

A pre-publish check greps the working tree and history for a denylist of terms drawn from the
originating work. Add it to CI before the first publish.

## Consequences
Slightly more effort to invent good examples, and better documentation as a result: a reader who
has to learn a domain to understand a demo will not understand the demo. This is a hard constraint,
not a preference.

---

## Amendments

### 2026-08-21 — Confirmed; the examples moved onto the critical path, and no ADR quotes an unreachable source

- **Deciders:** Thor Whalen

Phase 0 research left this ADR untouched — nothing it found argues with any clause here, and the
denylist check remains owed before the first publish. Two notes attach. The Decision and the
Consequences stand as written; note 2 adds a rule, and replaces nothing.

**1. The example datasets are no longer only documentation.** This ADR prescribed them as a leak
defence and a teaching aid, and required one deliberately messy example "because the clean example
will not exercise the parts of the schema that matter." That turned out to understate it. Several
questions Phase 0 left open are now scheduled to be settled *by building the messy example and
looking at it*, not by more reading:

- what a `target` criterion can honestly report, given that a distance metric smuggles a cardinal
  assumption back into dominance (ADR-0018, ADR-0019);
- whether 2/3 is the right coverage floor for matrices of this size, by simulation over the example
  datasets before the default is fixed (ADR-0015);
- how many hatch densities stay distinguishable in a cell that also carries text, and whether the
  composited uncertainty palette survives colour-vision deficiency at the confidence extremes
  (ADR-0028, ADR-0029);
- whether the rater dot strip beats the spread ramp for finding a contested cell (ADR-0024).

The messy example is therefore on the critical path, and its contents are a design decision rather
than an authoring chore: it must carry every missingness code, an inapplicable group block, a
deliberately stale evidence reference, multi-rater disagreement, and partial evidence, or the
questions above cannot be answered against it. `examples/README.md` remains the authority on that
list. This is confirmation of the requirement and a change of its priority, not a change of its
content.

**2. No ADR in this repository quotes a source that could not be reached at audit time.** The
citation-integrity rule is a sibling of the content rule this ADR already carries: a public
repository should not put words in a source's mouth any more than it should carry private content.
Two sources were unreachable when Phase 0's citations were audited — a data-visualisation style
guide behind the texture-reservation rule, and the ISO/IEC 25012 normative text. Both arguments
survive without them and both are made from other, checkable sources, so **neither is quoted in any
ADR**, and neither may be. A third, the ELECTRE chapter behind ADR-0015's correction, is closed
access and the transcribed copy is offline; its substance rests on Roy's foundational paper
instead, which is available. Each caveat is recorded at the claim itself in the research corpus;
this note records the standing rule so that it does not depend on a working file that is scheduled
for deletion.

#### References for this amendment

The open questions this note reprioritises: `docs/research/README.md` § "Open questions". The
citation caveats: the same file's § "Needs a human, not more research", and the verification notes
in `docs/research/findings-terminology.md` and `docs/research/findings-visualisation.md`.
