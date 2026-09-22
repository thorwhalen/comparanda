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

- **Public repo.** No content from **any** private engagement, and example domains are *invented*
  rather than anonymised — an anonymised matrix keeps the shape, and shape identifies. ADR-0033.
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
    docs/adr/                decisions, all settled; corrections go in as dated amendments
    docs/adr/README.md       the ADR index, grouped by theme
    docs/research/README.md  the research ledger — start here to find out what is known
    docs/research/           briefs (questions), sections/ (working notes), findings-*.md (synthesis)
    examples/                invented public-domain example datasets (ADR-0033)
    skills/                  dev skills — tooling for the agent building this repo

## Dev skills

Real files in `skills/`, surfaced through relative symlinks in `.claude/skills/`. These are for
the agent *building* comparanda, not for end users.

- **`comparanda-dev-schema-change`** — read before touching the schema, JSON Schema emission, or
  migrations. Owns the migration-with-version-1 rule, the policy-vs-mechanism line, and the
  cross-repo protocol with `rubricator`.
- **`comparanda-dev-a11y-gate`** — read before writing any view code. Owns the four constraints
  that fail a PR on their own: never colour alone, contrast computed from the rendered
  background, a keyboard path for every drag, missingness distinguishable without colour.

## Companion repo

`rubricator` is the agent that produces analyses in this schema. The JSON Schema emitted here is
the contract between them. Breaking it is a coordinated change across both repos.
