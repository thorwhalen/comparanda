# Examples

**Invented** public domains, or real ones carrying only factual, cited, dated claims — see
ADR-0033. A reader should understand the criteria without a briefing, which rules out anything
drawn from private work. Invented rather than anonymised: an anonymised matrix keeps the criteria
and the disagreements of the original, and that shape identifies to anyone who was in the room.

All three fixtures are **golden**: `tests/fixtures.test.ts` validates them on every push, so a
schema change that breaks one fails the build rather than the next reader.

| fixture | what it is for |
|---|---|
| [`languages.json`](#languagesjson--clean) | the clean one, for documentation and screenshots |
| [`video-generation.json`](#video-generationjson--real-vendors-real-blanks) | the demo — real vendors, and the blanks are real |
| [`relocation.json`](#relocationjson--deliberately-messy-and-the-one-that-matters) | the test asset — synthetic on purpose, and the falsification case |

---

## `languages.json` — clean

Choosing a language for a service two people will maintain. Fully scored, every score with a
reason, every anchor written, nothing outstanding. This is the one for documentation and
screenshots.

It is deliberately not bland: Rust scores 5 on performance and 1 on learning curve, Python the
reverse. A clean fixture where every alternative scores the same is a screenshot of nothing.

## `video-generation.json` — real vendors, real blanks

Comparing six AI video generation products on published capability and stated policy. **This is the
one that shows what the tool is for**, because nothing about its missingness is invented: a quarter
of the matrix is blank, and every blank is a vendor's own documentation failing to answer a question
a buyer would ask.

It is a **dated snapshot** — 2026-08-26 — of a market that moves monthly, and the document says so
in `subject.context` rather than in this file, so a reader who opens the JSON alone still knows.

The discipline it is held to, and the reason it is safe to ship in a public repository naming real
companies (ADR-0033 clause 3):

- **Capability and stated policy only.** No cell is a judgement about a company. Every criterion is
  either a measured quantity or a stated fact, and a test enforces the structural proxy for that:
  no criterion carries anchors, because anchors are where a quality score lives.
- **Every filled cell quotes the vendor's own words**, with the page, a rendition and a stamped
  check. Every blank says what was searched and what was found.
- **A blank is a claim about a document, not about a company.** "We searched their material and it
  does not state this" is checkable; "they are secretive" is not, and does not appear.

It carries a declared extension code, `disclosure-declined`, refining `not-evidenced`. One vendor
addresses provenance and explicitly declines to answer, which is a different finding from silence
and one the core six cannot express. A reader whose build has never heard of the code sees
`not-evidenced` — correct, just less precise. That is `broader` doing its job on real material.

**How it was built, and why that matters.** Six independent research passes, then a second pass that
re-fetched every cited page and re-checked every quote character by character. That pass corrected
four cells, **two of which would have stated something false about a real company** — one cited a
terms clause from the wrong tier, reversing the vendor's actual policy. It also caught the same
criterion being applied unevenly between two named competitors, where the weaker disclosure had
received the stronger verdict. Both are blank now. The document keeps that argument: see the
resolved thread on `training-data-disclosed`.

Refresh it by re-running the research, not by editing figures in place. The tests assert the
**discipline** — quotes, stamps, notes, no anchored scales — and never the data, so a refresh does
not turn them red.

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
- a reference whose `stance` is `contradicts` — the Berlin rent score cites the rent index, and
  also the asking-rent report that disagrees with it — so `contradictedCells` has one cell to count;
- two failed checks, one of each kind: a `stale` quote (the document changed) and an
  `unresolvable` target (the page is gone), both dated and attributed like any other verdict;
- two rejected criteria kept in `rejectedCriteria` rather than discarded: one `merged` into rent,
  one `not-discriminating`;
- three annotation threads: one resolved, one open, one anchored to a criterion rather than a cell;
- two assertions carrying a host `disclosure` label (`household-finances`: the Lisbon income-tax score and one Taipei rent figure), so a reviewer's projection (`projectForReader`) withholds them and every analysis reports the cells widened for that reader — distinct from the Taipei income-tax cell, which its author stored as `withheld` outright.

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
