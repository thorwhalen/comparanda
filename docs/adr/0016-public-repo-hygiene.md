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
