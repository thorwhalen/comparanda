# comparanda — agent guide

A schema and a view for structured comparison. Read `BRIEF.md` first, then
`docs/domain-model.md`, then `docs/adr/` in order.

## Vocabulary — use these words

**alternatives** (rows), **criteria** (columns), **subject** (the question), **measure** (a stored
quantity per cell: score, confidence), **encoding** (a view-layer mapping from measures to colour —
`blended` is an encoding, not a measure), **missing** (always with a reason code).

Never say "items" or "features"; those were the sketch's words and were replaced deliberately —
see ADR-0003. Display aliases are a per-analysis setting, never hard-coded.

## Standing constraints

- **Public repo.** No content from the private analysis this originated in. ADR-0016.
- **Measures are stored; encodings are derived.** Do not add a stored measure for something
  computed.
- **1–5 ratings are ordinal.** Do not average them by default; the schema records the level of
  measurement so the tooling can refuse.
- **No bare nulls.** Every absence carries a reason.
- **Core has no DOM.** If you need a DOM API in `core`, the design is wrong.
- **Nothing reaches past its adapter.** One stray `fetch()` in a renderer breaks the standalone
  bundle, and only offline.

## Where things live

    docs/domain-model.md     vocabulary and the corrections to the original sketch
    docs/adr/                decisions; `proposed` means genuinely open
    docs/research/           what to research before building, and the findings
    examples/                public-domain example datasets (ADR-0016)

## Companion repo

`rubricator` is the agent that produces analyses in this schema. The JSON Schema emitted here is
the contract between them. Breaking it is a coordinated change across both repos.
