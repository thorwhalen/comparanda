# Research brief — terminology, methods, and what to steal

**Do this before writing schema code.** The output is a short report in this folder plus, where it
changes a decision, a new or amended ADR. Cite sources; prefer primary literature and real product
documentation over blog summaries.

The point is not scholarship for its own sake. It is that this problem has been worked on for
fifty years and the names, failure modes and algorithms already exist. Reinventing them badly is
the default outcome of not looking.

## 1. Confirm or correct the vocabulary

[../domain-model.md](../domain-model.md) adopts MCDA terms — alternatives, criteria, decision
matrix. Verify against the actual literature and note where practice diverges:

- MCDA / MADM standard vocabulary; who uses "attribute" vs "criterion" and why.
- **Pugh matrix** / controlled convergence (Stuart Pugh) — the concept-selection matrix, and its
  datum-column convention. Does it suggest anything we are missing?
- **Consequence tables** (Hammond, Keeney & Raiffa, *Smart Choices*) — an accessible framing for
  non-specialists that may be a better UI metaphor than "decision matrix".
- **Even-swaps** — their technique for eliminating criteria without weighting. Possibly a feature.
- Product vocabulary: what do Airtable, Notion, Causal, Loomio, or dedicated decision tools call
  these things? We may adopt MCDA internally and a friendlier alias externally.

## 2. Levels of measurement and the averaging question

Stevens's typology, and the long argument about whether Likert data may be treated as interval.
We have taken a position (ADR-0003, ADR-0015) that ordinal data should not be silently averaged.
Find the strongest counter-argument and record it; if it is compelling, amend the ADR rather than
quietly softening the implementation.

Also: how do established tools *communicate* this to users without lecturing them?

## 3. Aggregation methods, if we offer them at all

For each, record what it assumes, when it misleads, and how hard it is to implement well:

- weighted sum (SAW/WSM) — the naive default, and its failure modes;
- **TOPSIS**, **AHP** (and the criticism of AHP's rank reversal), **PROMETHEE**, **ELECTRE**;
- **ELECTRE's veto thresholds** specifically — our "veto axis" concept appears to be exactly this,
  and we should adopt the established name and semantics if so;
- **Pareto dominance** and skyline queries — our preferred non-aggregating reduction;
- **sensitivity analysis** — the standard techniques for "how stable is this ranking".

## 4. Missingness

- Standard vocabularies for observation status: SDMX observation-status codes, survey research
  conventions (not applicable / don't know / refused / not asked), and the statistical
  MCAR/MAR/MNAR framing (which is about *why data is missing* and may or may not be useful here).
- How do MCDA methods handle incomplete matrices? There is a literature on this and it bears
  directly on whether we can offer aggregation over sparse data at all.

## 5. Multi-rater agreement

- **Krippendorff's alpha** — handles ordinal data and missing values, which is our exact case.
  Confirm, and find a reference implementation to port or depend on.
- Cohen's / Fleiss's kappa and why they are probably wrong for us.
- **Delphi method** — structured multi-round expert elicitation with controlled feedback. Our
  multi-rater + discussion + revise loop is close to this; find out what the method says about
  doing it well, and whether the tool should support rounds explicitly.
- How to *display* disagreement without implying a mean.

## 6. Prior art to examine directly

Use them, do not just read about them. Note the single best idea and the single worst mistake in
each: Airtable / Notion (grouping, saved views, permissions), Loomio and Polis (group deliberation),
Google Docs (suggestion mode, comment anchoring, resolve), Miro (spatial arrangement),
Figma (multiplayer, saved states), Observable (reproducible published analysis),
Jupyter/Quarto (narrative + data), any dedicated MCDA tool (1000minds, TransparentChoice,
Criterium DecisionPlus), and academic reorderable-matrix tools.

## Deliverable
`docs/research/findings-terminology.md`: what we got right, what to rename, what to add, what to
drop — each with a citation and a recommended ADR action.
