# Examples

Public, self-explanatory domains only — see ADR-0016. A reader should understand the criteria
without a briefing, which rules out anything drawn from private strategy work.

Both fixtures are **golden**: `tests/fixtures.test.ts` validates them on every push, so a schema
change that breaks one fails the build rather than the next reader.

---

## `languages.json` — clean

Choosing a language for a service two people will maintain. Fully scored, every score with a
reason, every anchor written, nothing outstanding. This is the one for documentation and
screenshots.

It is deliberately not bland: Rust scores 5 on performance and 1 on learning curve, Python the
reverse. A clean fixture where every alternative scores the same is a screenshot of nothing.

## `relocation.json` — deliberately messy, and the one that matters

Choosing a city to live in. **Most bugs will be found by this fixture**, and it has already found
two: `Measurement.levels` could not declare a boolean column, and the schema artifact was being
emitted in its output shape.

It exercises what the clean example does not:

- all six core missingness codes, plus a whole `not-applicable` group block;
- criterion groups (cost / climate / logistics / EU residency) and alternative groups
  (Europe / Asia / Americas);
- an inapplicable group pair — EU residency against both non-EU alternative groups;
- multi-rater disagreement on three cells, including one between a contributor and her own
  declared persona;
- an `acceptability` floor with a threshold, which bites on exactly one alternative;
- mixed levels of measurement in one document — ordinal ratings, a ratio-scaled rent, a nominal
  climate category and a boolean;
- evidence links, some with embedded excerpts, one deliberately stale and one whose source has
  changed since ingest;
- three annotation threads: one resolved, one open, one anchored to a criterion rather than a cell.

### It is also the falsification fixture

This is what makes it more than a big example. It is the document that decides whether the
extension model of ADR-0030 is a design or a paragraph, and it is built to fail loudly if it is
the second:

| what it carries | what must happen |
|---|---|
| a criterion on scale `bt-latent`, which **no build implements** | the document still validates, dominates and screens; **exactly one** degradation is reported, and its JSON path resolves to that criterion |
| a missingness code `paywalled`, **declared in the document**, refining `not-evidenced` with `informative: false` | it resolves without degrading, because its facts travel with it — and it is **excluded from `silenceRate`**, which is the whole point |
| a citation whose `originalSha256` no longer matches | it renders with a caveat, and `checkStanding` reports `sourceChanged` independently of the verdict |

The `paywalled` row is the one to read twice. It is *terminal*, so a completeness rate keyed on
`terminal` would count it — and it is a fact about our access rather than about the city, so the
honesty metric must not move for it. The override that says so travels inside the document, from a
declaration the reading build never shipped and knows nothing about.

**If the falsification tests are green, every declaration seam works. If this fixture could not be
written, the architecture is prose.**

---

## Editing them

These are curated, not generated. Edit the JSON. Then run `pnpm test` — the fixture suite checks
both the schema and the properties described above, so a change that quietly removes the boolean
column or the unimplemented scale will be caught rather than silently making the fixture easier.
