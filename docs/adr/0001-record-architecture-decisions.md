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

## Amendments

### 2026-08-21 — The specification is 0002–0029, not 0002–0016

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

The Decision's "ADRs numbered 0002–0016 in this repo were written *before* implementation. They are
the specification" was true when it was written and is now an undercount. ADR-0017 through ADR-0029
were written in the same condition — before any code existed, on the Phase 0 research — and they are
specification on the same footing. Read the sentence as **0002–0029**, and as covering any ADR
accepted before the implementation it governs.

Two consequences of that reading, both already true of the set. The paragraph about a **proposed**
status now describes an empty case: every ADR here is accepted, and `README.md` records it. And the
immutability rule binds the 2026-08-21 amendments exactly as it binds a Decision — an amendment is
corrected by a later dated amendment, never by an edit.
