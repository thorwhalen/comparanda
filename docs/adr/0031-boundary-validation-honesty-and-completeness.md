# ADR-0031: Boundary validation — two rule families; honesty rejects, completeness informs

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

## Context
`validateAnalysis` returns every problem rather than the first, sorted deterministically, with a
`severity` of `error` or `warning`. The collection contract is right. What it lacks is a *reason* —
`severity` is chosen per call site, so whether a missing rationale is an error is currently a
property of whoever wrote the check.

That matters because the two things validation is for pull in opposite directions. An analysis where
23 of 24 cells are `not-assessed` is **valid**: ADR-0009 makes a qualified blank a first-class state
and ADR-0011 makes resumption normal. An analysis carrying a score with no rationale and no named
contributor is **not valid**, however complete it looks. Grading both on one severity axis means
either unfinished work is rejected or unverifiable work is accepted, and both are wrong.

## Decision

**1. Every problem declares a `family`, and the family — not the author of the rule — decides the
severity.**

    Family = 'schema' | 'honesty' | 'completeness'
    Problem { path, message, family, severity, fix, ruleId }

- **`schema`** — the document is not the shape. Always `error`.
- **`honesty`** — the document asserts something it does not carry what is needed to check. Always
  `error`.
- **`completeness`** — work is outstanding. Never above `warning`.

`fix` is **required**, not optional: the settled requirement is that every rejection names the exact
path *and the fix*, and a `fix` field that may be empty is a `fix` field that is empty. `ruleId` is
stable, so that a suppression is auditable.

**2. Honesty rules can never be suppressed.** Not by `strict=false`, not by choosing a ruleset, not
by configuration. `strict=false` drops the **completeness** family and nothing else.

This is what makes a strictness flag meaningful without a boolean maze, and it forecloses a
deployment configuring its way out of the honesty bar — which is the product. A rule that a
deployment can turn off is a rule the analysis cannot be trusted to have passed.

**3. Rules are injected, because there are two call sites with different compositions on day one.**
Validation on the way *in* to a store runs honesty only, at write time, through a hook no backend
can bypass: there must be no path that stores an unverifiable document. Validation on *demand* runs
both families and reports. Same rules, two compositions; a single hardcoded list cannot serve both,
and that is the entire justification for the injection point.

    Rule { id, family, (doc, ctx) => Iterable<Problem> }
    RULESETS: { draft, default, 'strict-publication', conformance }

`draft` is honesty-only, for the scoring loop where half the matrix is legitimately unassessed.
`strict-publication` adds rules that only make sense when an analysis leaves the team.
`conformance` is for an evaluation harness, where a violation is a measured outcome rather than a
refusal. Following ADR-0017 clause 4, the ruleset table is frozen and passed in by the composition
root; no rule module registers itself.

**4. Every rule reads one context, so no rule re-derives an interpreter.** `DocumentContext` carries
the missingness vocabulary, the scale and reduction resolvers, an author index, the renditions, an
injected `now`, and — this is the one that is easy to miss — **the accumulated `Degradation`s**, so
the honesty rules of ADR-0030 clause 5 can see what this build failed to interpret. A rule that
built its own resolver would disagree with the renderer about the same document.

**5. The v1 rule set.** Honesty: `score-needs-rationale`, `score-needs-named-contributor`,
`citation-must-resolve`, `confidence-needs-evidence`, `inference-needs-derived-from`,
`persona-independence`, `no-bare-null`, `cells-unique`, `undated-verdict`,
`unchecked-scale-under-confidence`. Completeness: `cells-outstanding`, `criteria-without-anchors`,
`alternatives-unsourced`. Each is roughly ten lines; the design is in the families, not in any rule.

**6. Cross-field rules are plain predicates in both languages, and that is deliberate.** None of
these is expressible in JSON Schema — "an assertion claiming `independent` whose author shares a
`principalId` with another contributor on the same cell" is not a shape. So the shape is validated
by the emitted artifact (ADR-0004) and the rules are composed on top, mirrored, with ADR-0004's
vocabulary artifact keeping the *sets* they key on in step. This is the precise boundary at which
the language-neutral contract stops covering us, and naming it is better than discovering it.

## Consequences
`ValidationProblem` grows three fields and `validateAnalysis` grows an injection point; the existing
determinism and completeness of its output are preserved unchanged. The visible cost is that every
rule author must write a `fix`, which is the point. The invisible cost avoided is a `strict` flag
that becomes, over three deployments, a way to ship an analysis nobody checked.

The mirroring cost is real and is not paid down by anything here: a rule written in one language and
not the other is a rule that half the ecosystem does not enforce, and only a shared fixture with a
byte-compared problem list catches it.

## Alternatives considered
- *One list, three severities.* What exists. It cannot express "always an error regardless of
  flags", so the suppression rule in clause 2 has nowhere to live.
- *Honesty rules enforced only in the producer.* Puts the guarantee in the repository that has an
  incentive to relax it, and leaves a document authored by anything else unchecked.
- *Schema refinements instead of predicates.* Cross-field rules would then be invisible to every
  consumer of the emitted JSON Schema, which is every non-TypeScript consumer.
