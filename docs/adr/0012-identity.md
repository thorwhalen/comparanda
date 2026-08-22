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

### 2026-08-22 — A persona is materialised as its own `Author`, carrying a principal

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

The amendment above decides everything about what a persona *means* and nothing about how it is
stored. This is the mechanism, and it is written second rather than folded in because one sentence
of the amendment above reads as a storage decision that will not survive contact with the schema,
and narrowing it explicitly is safer than leaving it to be discovered.

**1. A persona is an `Author` row with its own `id`.** `Assertion.authorId` is one string, and every
shipped path — `validateAnalysis`'s author check, the annotations module, the rater dot strip, the
activity record — resolves attribution by looking that one string up in `Analysis.authors`. Two
personas of one contributor must be **separately attributable per assertion**, or the divergence
that the amendment above calls "the context that makes the divergence readable" cannot be rendered
at all. A second field beside `authorId` would mean every one of those call sites learns about it;
a persona-as-`Author` means none of them changes.

**2. The link back to the person is `Author.principalId`.** Opaque, pseudonymous, never an email and
never a display name. Two personas of one contributor carry the same `principalId`; a contributor
with no persona carries `principalId === id`. `Author.actingAs` carries the amendment's "short
statement of the perspective being taken".

**3. What this narrows.** The amendment above says "The assertion still carries the real `id` and
the real `AuthorKind`." Read that clause as: **the assertion carries the persona's `id`, and the
persona's `Author` retains the real `principalId` and the real `AuthorKind`.** Every one of its four
rules is preserved, and three of them become mechanically enforceable rather than aspirational:

- *not anonymity* — `principalId` is in the document, in plain sight, unhidden from readers.
  Concealment remains the anonymous session's job, honestly labelled.
- *not an independence rung* — ADR-0011's `effectiveIndependence` collapses on `principalId` and
  caps at `resampled`, and ADR-0031's `persona-independence` rule **rejects** a document where two
  personas of one principal both claim `independent` on one cell. A computation *and* a refusal,
  because rule 2 asks for a refusal and a computation alone can be ignored.
- *never changes `AuthorKind`* — the persona's `Author.kind` is copied from the principal's, and a
  persona whose `kind` differs from its principal's is an honesty error.
- *declared, not inferred* — unchanged; `actingAs` is set, never derived.

**4. `Author.attestation` records how well the identity is known.** `method` is one of
`unverified | host-session | oauth | signature`, with an optional `issuer` and `at`. The Decision
says a local identity is "honest about being unverified" and the Consequences say to state that
plainly in the docs; a field states it *in the document*, which is where a reader three months later
actually is. `unverified` is the truthful default and is what a host that asserts nothing leaves in
place.

**5. What this does not fix, stated because the mitigation invites over-reading.** A `principalId`
is pseudonymous, not anonymous. Salting it per analysis stops an outsider holding one analysis from
joining it to another; **inside a team repository the mapping is guessable**, because the set of
accounts is small and known. It must never be described to a contributor as though it hides them
from a colleague. A team needing genuinely unlinkable personas accepts that their independence is
`unknown`, which the ladder already reports honestly.

And the ladder is a **disclosure mechanism, never a control**: `persona-independence` catches the
representable lie and cannot catch a fabricated principal. The system is as honest as the
contributor — which is what the Consequences above already say about local identity, arriving
through a second door.
