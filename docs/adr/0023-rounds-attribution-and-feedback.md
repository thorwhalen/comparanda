# ADR-0023: Rounds, attribution policy and feedback policy

- **Status:** accepted
- **Date:** 2026-08-21
- **Deciders:** Thor Whalen

## Context
ADR-0011's multi-rater loop — rate, discuss, revise — is the Delphi method with the serial numbers
filed off. The Delphi literature's best-evidenced structural claim is that round-one rating should
be **anonymous**, because anonymity reduces the inhibition that group settings impose on
individual judgement [1]. The best-documented operationalisation, the RAND/UCLA appropriateness
method, rates individually with no interaction among panellists in round one, then re-rates after
discussion with each panellist shown the group's distribution alongside their own response — group
visible, individuals not [2].

ADR-0011 point 7 says activity is legible: what moved, who moved it, when. As stated, that makes
anonymous round-one rating impossible. The two are reconcilable only if anonymity is *scoped and
temporary*, and scoping it requires the round to be a thing the schema knows about rather than a
boundary someone infers from timestamps.

The evidence and the ~15-line cost estimate are in `docs/research/findings-terminology.md` §5.

## Decision

**A `round?: RoundId` on every assertion, plus a small `rounds` collection, enters the schema in
Phase 1.** Both are optional. An analysis that never declares a round behaves exactly as it does
today: assertions belong to an implicit single round that is attributed and gives no feedback.

Each declared round carries two policies:

- **`attribution`**: `attributed` | `blind-until-close`;
- **`feedback`**: `none` | `distribution` | `distribution-and-rationales`.

**The author is always stored; the view redacts until the round closes.** Redaction is a property
of the read path in `core` (ADR-0005), applied once, not a rule each view component remembers.
ADR-0011 point 7 is **qualified by round scope, not withdrawn**: activity inside an open
`blind-until-close` round is legible as *what moved and when*, and becomes legible as *who* the
moment the round closes. Attribution is never destroyed, which is what ADR-0012 requires.

**Stopping is a stability trace, never a consensus threshold.** Consensus is assessed *within* a
round; stability is assessed *between* rounds; the literature has no agreed criterion for when
consensus has been reached [1]. So we ship the trace and no number gates on it — "the trend
flattened" is a chart a human reads, which is the same stance ADR-0015 takes toward aggregation.
The between-round statistic is **churn** — the fraction of raters who changed, plus the change in
spread — and it **must never be conflated with alpha**, which is the within-round statistic owned
by ADR-0022. They answer different questions and a single label over both would be wrong in
whichever direction it was read.

**v1 stores the field, computes the trace, and redacts by policy — nothing else.** Round locking,
deadlines, and any round-transition workflow are deliberately out of scope. They can be added
later without a migration, which is the whole reason for adding the field now.

## Consequences
Multi-round elicitation becomes possible without a schema change, and the anonymity requirement
becomes a policy on data rather than a behaviour of one particular UI — so an agent, an export and
a second view all honour it or all visibly fail to.

What becomes hard: the view must redact an author it can plainly see. That is a rule enforced in
one place and tested there, and it must be documented for what it is — **a presentation policy,
not a security boundary**. The author is in the document; anyone holding the raw JSON can read it.
`blind-until-close` buys a Delphi panel's honesty, not confidentiality, and claiming otherwise
would be the same over-promise ADR-0012 refuses to make about local identity.

The cost of *not* doing it now is a migration through every stored analysis, because round
boundaries would otherwise have to be reconstructed from timestamps.

## Alternatives considered
- *Infer rounds from timestamps.* Fragile, and unrecoverable the moment anyone edits late or
  assertions from two rounds interleave.
- *Add rounds in Phase 4, when multi-rater ships.* A migration through every stored analysis, for
  a field that is nearly free before anything is stored.
- *Anonymise by not storing the author.* Destroys attribution, which ADR-0012 requires and which
  the round's own close is supposed to restore.
- *A single `anonymous` flag on the analysis.* Anonymity is a property of a round, not of an
  analysis — round one blind and round two attributed is the design the evidence supports.

## References
1. [An exploration of the use of simple statistics to measure consensus and stability in Delphi
   studies — Holey, Feeley, Dixon & Whittaker (2007), BMC Medical Research Methodology
   7:52](https://pmc.ncbi.nlm.nih.gov/articles/PMC2216026/)
2. [The RAND/UCLA Appropriateness Method User's Manual — Fitch et al. (2001), RAND
   MR-1269](https://www.rand.org/content/dam/rand/pubs/monograph_reports/2011/MR1269.pdf)
