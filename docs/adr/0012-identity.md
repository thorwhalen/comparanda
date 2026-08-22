# ADR-0012: Identity is an injected adapter with a usable anonymous default

- **Status:** accepted
- **Date:** 2026-08-18

## Context
Attribution is required — every value, edit and comment names an author. But this package will be
embedded in contexts with wildly different identity stories: inside an app with real auth, behind
an SSO proxy, in a standalone HTML file mailed to a colleague, in a notebook, or driven by an
agent with no human present at all. Baking in any one of those makes the rest awkward.

## Decision
Identity is a **pluggable adapter** supplied by the host, satisfying a minimal interface: a stable
`id`, a `displayName`, and optionally an avatar and a role. `comparanda` never authenticates
anybody; it consumes an identity the host asserts.

Defaults, in order:
1. a host-supplied adapter;
2. a **local identity** — a name the user types once, stored in the local store, with a generated
   stable id. Sufficient for the mailed-HTML case, and honest about being unverified.
3. `anonymous`, with edits permitted but visibly attributed to an anonymous session.

**Agents are identities too.** A value produced by `rubricator` is authored by a named agent run,
carrying the model, the prompt version and the run id. Human and machine assertions must be
distinguishable at a glance — a reader deciding how much to trust a score needs to know whether a
person or a model asserted it. This is not an afterthought; it is a primary requirement of the
whole system.

Authorisation is likewise host-supplied: the schema declares *what is editable*, the host decides
*who may edit*. `comparanda` enforces the intersection and never invents a permission model.

## Consequences
Trivially embeddable; no auth code to maintain or get wrong. The trade is that local identity is
unverified — appropriate for a decision aid among colleagues, not for anything requiring
non-repudiation. State that plainly in the docs rather than implying more assurance than exists.

## Amendments

### 2026-08-22 — a contributor may sign under a declared persona, and a persona is not a disguise

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The Decision covers a host-asserted identity, a typed-name local identity, an anonymous session, and
agents as identities. It does not cover one thing the v1 workflow needs: **one contributor
deliberately writing from more than one point of view.**

> "'signed' by the user, but also with the possibility of signing it with a custom name (because
> perhaps they want to look at things from different perspectives, taking on or telling claude to
> take on specific roles when they analyze this)."

That is a real practice and a good one — scoring a matrix once as the operator and once as the buyer
surfaces disagreements a single pass hides. It needs a representation, and the representation must
not quietly become three other things.

**A persona is a declared alternate presentation on an existing identity.** The assertion still
carries the real `id` and the real `AuthorKind`. The persona adds the name shown and, optionally, a
short statement of the perspective being taken, which is worth capturing because "I scored this as
the buyer" is the context that makes the divergence readable rather than confusing.

Four rules, each of which exists because the obvious misreading is worse than the feature:

1. **A persona is not anonymity.** The underlying identity is retained in the document and is not
   hidden from readers. Someone who wants to contribute unattributed uses the anonymous session the
   Decision already provides, and gets what that honestly offers. A persona that a contributor
   *believed* was concealing them would be the worst outcome available here, so it conceals nothing.
2. **A persona is not an independence rung.** One person signing under three personas is **one**
   person, at whatever independence the sessions actually had. An agreement statistic must never read
   a persona as a rater — that is manufactured rigour of exactly the kind ADR-0011 clause 4 and
   `provenance.ts` exist to prevent. `rubricator`'s ADR-0018 states the same rule from the producing
   side, so both repositories say one thing.
3. **A persona never changes `AuthorKind`.** An agent asked to reason as the buyer is still
   `kind: 'agent'`, with the persona recorded and the model, prompt version and run id unchanged. A
   role-played agent presenting as a human would defeat the Decision's primary requirement — that
   human and machine assertions be distinguishable at a glance — in the one case where the confusion
   is deliberate rather than accidental.
4. **A persona is declared, not inferred.** It is a field a contributor sets, never something derived
   from the content of what they wrote.

**Authorisation is unchanged.** The host still decides who may act; the schema still declares only
what is editable. A persona grants nothing.

**Consequence.** The unverified-local-identity caveat in Consequences now has a second sentence
worth stating plainly in the docs: a persona is a *label a contributor chose*, carrying exactly as
much assurance as the identity underneath it — which, for a local identity, is none.
