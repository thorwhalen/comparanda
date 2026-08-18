# ADR-0001: Record architecture decisions

- **Status:** accepted
- **Date:** 2026-08-18

## Context
This repository is specified before it is implemented, and much of the specification will be
executed by agents across sessions that do not share memory. Decisions made once must not be
silently relitigated three sessions later, and the reasoning behind a constraint has to survive
the person who set it.

## Decision
Use Architecture Decision Records in the Nygard format, numbered, immutable once accepted.
Change a decision by writing a new ADR that supersedes the old one; never edit an accepted ADR's
Decision section in place.

ADRs numbered 0002–0016 in this repo were written *before* implementation. They are the
specification. An ADR marked **proposed** is a genuine open question and its Decision section
records a recommendation, not a ruling — the implementer is expected to settle it and change the
status, with reasoning.

## Consequences
An agent picking up this repo can read `docs/adr/` in order and know both what was decided and
what is still live. The cost is discipline: a change of direction requires a new file, not a
quiet edit.
