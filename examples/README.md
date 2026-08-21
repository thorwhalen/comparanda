# Examples

Public, self-explanatory domains only — see ADR-0016. A reader should understand the criteria
without a briefing, which rules out anything drawn from private strategy work.

Build at least these two:

**`languages.json` — clean.** Choosing a programming language for a project. Criteria such as
ecosystem maturity, runtime performance, hiring pool, learning curve, tooling. Ordinal 1–5 scores
with confidence. Complete, tidy, good for a first look and for docs screenshots.

**`relocation.json` — deliberately messy.** Choosing a city to live in. Must exercise the parts of
the schema the clean example does not:

- all six missingness codes, including a whole `not-applicable` group block;
- criterion groups (cost / climate / logistics) and alternative groups (Europe / Asia / Americas);
- an inapplicable group pair;
- multi-rater values with real disagreement on at least three cells;
- a criterion carrying an `acceptability` floor with a threshold (a "veto criterion" in UI prose);
- mixed levels of measurement — ordinal ratings, a ratio-scaled cost, a nominal category, a boolean;
- evidence links, some with embedded excerpts, at least one deliberately stale;
- annotation threads, one resolved, one open, one anchored to a criterion rather than a cell.

The messy one is the more important fixture. Most bugs will be found by it.
