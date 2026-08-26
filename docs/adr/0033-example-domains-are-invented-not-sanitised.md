# ADR-0033: Example domains are invented, not sanitised — and the denylist is withdrawn

- **Status:** accepted
- **Date:** 2026-08-26
- **Deciders:** Thor Whalen
- **Supersedes:** ADR-0016

## Context

ADR-0016 opens: *"This package originates from a private strategic analysis. That analysis is
confidential: it names markets, competitors, internal disagreements and pricing."* From that it
derives a hard constraint — no content from that analysis anywhere — and a mechanism: a pre-publish
CI step that greps the tree against a denylist of terms drawn from the private work, supplied as a
repository secret.

**The framing is wrong, and the mechanism follows from the framing.**

This package is a general tool. A private study *motivated* it, as several earlier ones did. It is
not a sanitised derivative of any of them, and describing it as one has three costs:

1. **It implies a cleanup that never happened.** There is nothing to sanitise. Checked on
   2026-08-26 across both repositories, working tree and full history: **zero occurrences**. The
   shipped fixtures compare programming languages and cities, invented for the purpose.
2. **The denylist is unbounded.** ADR-0016 scopes it to *the* originating analysis, but the owner
   has run many private engagements and will run more. A list that must cover all of them is
   maintained forever, is never demonstrably complete, and grows a term every time a new client
   arrives — for a repository that, by construction, contains none of their material.
3. **It is the wrong control for the risk.** A denylist catches a term that was already pasted in.
   What actually prevents the paste is the positive rule below, and that rule was already working:
   the leak the denylist was built to detect has never occurred.

There is a fourth cost, subtler and worse. A hygiene check that is mandated, never satisfiable
without an out-of-band secret, and therefore permanently warning, teaches everyone to read CI
warnings as noise. That is a real loss, and it was being paid to detect a thing that is not there.

## Decision

**ADR-0016's rule is kept and generalised. Its mechanism is withdrawn.**

**1. No content from any private engagement appears in this repository** — not in tests, examples,
fixtures, docs, screenshots, seed data, benchmark data or git history. No organisation, product,
person or codename from one. This is broader than ADR-0016, which named a single analysis, and it
is the clause that does the work.

**2. Example datasets are invented for the purpose, in public, self-explanatory domains.** Not
anonymised versions of real work — *invented*. The distinction matters: an anonymised matrix keeps
the shape, the criteria and the disagreements of the original, and shape is identifying to anyone
who was in the room. Inventing is both safer and better documentation, because a reader who has to
learn a domain to understand a demo will not understand the demo.

A domain qualifies when a reader understands the criteria without a briefing. Choosing a
programming language, a city, a database, a bicycle. Comparing vendors in a market whose feature
lists are public.

**3. Where an example uses real, named third parties, it carries only factual, checkable claims.**
Capability and stated-policy criteria — does the product do X, what limit does the vendor publish,
does the documentation state a position — each citing a span in that vendor's own public material,
with the retrieval date recorded. **No subjective quality score is attached to a named real party.**
An absence is recorded as an absence: "we searched their documentation and it does not say" is
`not-evidenced`, which is a checkable claim about a document rather than a judgement about a
company. This is the one place where the schema's own honesty machinery is also a courtesy.

**4. The pre-publish denylist check is withdrawn**, and the `ADR_0016_DENYLIST` secret is not
required. The CI steps that remain are the ones that are generic and satisfiable: no absolute local
paths or personal identifiers, and no NUL bytes in tracked files.

## Consequences

The control is now a practice rather than a grep, and the honest reading of that is that it depends
on whoever is writing the fixture — including an agent, which is the likelier author. Two things
make it more than an intention:

- **The examples exist and are golden.** `tests/fixtures.test.ts` validates them on every push and
  asserts what each one is for, so the cheapest path for anyone adding realistic data is to extend
  a fixture that is already invented rather than to paste something.
- **`examples/README.md` states the rule at the point of temptation**, which is where a rule has to
  be to work.

**What this does not catch, stated plainly:** paraphrase, and shape. An example that reproduces a
private analysis's criteria and disagreements under invented names would pass every check here and
violate clause 2. Nothing mechanical will catch that; clause 2 exists so that it is at least a
stated rule rather than a matter of taste.

**Reversibility.** If a genuine leak risk ever appears — a contributor working from real material,
say — the denylist is twenty lines of CI and can come back. Withdrawing it is not a claim that it
could never be useful; it is a claim that maintaining it now costs more than it protects.

## Alternatives considered

- ***Keep ADR-0016 and set the secret.*** Rejected on the unboundedness above. It would also have
  meant putting the very terms the list protects into a place they can be read — a repository
  secret is readable by anyone with admin on the repo, and by any workflow that can be induced to
  echo it. A denylist of confidential terms is itself a small confidential artifact, which is an
  awkward property for a control whose purpose is to keep such terms out of the repository.
- ***Amend ADR-0016 rather than supersede it.*** Its Context is the part that is wrong, and a
  Context cannot be amended into correctness without a rewrite, which ADR-0001 forbids. Withdrawing
  a mandated CI check is an inversion, and an inversion is what a superseding ADR is for.
- ***Keep the check with an empty denylist.*** A guard that cannot fail is worse than no guard —
  this repository has found four of those — and an empty one would report "denylist clean" forever.
- ***A broader secret-scanner instead*** (credentials, keys, tokens). Worth having and unrelated:
  it defends against a different failure, and adopting it as a replacement here would blur what
  either is for. If it is wanted, it is its own decision.
