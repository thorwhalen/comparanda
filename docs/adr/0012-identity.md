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
