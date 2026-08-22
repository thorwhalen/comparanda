# ADR-0030: Extensible vocabularies — one declaration shape, one resolver, and degradation that is reported

- **Status:** accepted
- **Date:** 2026-08-22
- **Deciders:** Thor Whalen

## Context
Three vocabularies in this schema must be extensible by an analysis: missingness reason codes
(ADR-0009), reductions over assertions (ADR-0011), and measurement scales (ADR-0018). One of them
was built extensible and two were not, and the one that was is the best-built thing in this
repository: a declaration carrying a `broader` parent, one resolver, and consumers keying on flags
rather than on literals.

Copying that twice more is obviously right. But it has a gap that only shows up once there are three
of them, and it is the gap that decides whether an open vocabulary is a feature or a hole: **a
reader that meets an id it does not implement currently has no way to say so.** `resolveMissingCode`
returns `undefined`, which is the correct *value* and an unusable *signal* — a caller either ignores
it or invents a default, and inventing a default for an unknown absence is the exact failure
ADR-0009 exists to abolish.

The alternative everyone reaches for first is a registry: a build registers implementations under
names. That fails the case this package exists for — a document travelling to a reader who did not
produce it. A name registered in one process means nothing in another, so a shared analysis becomes
unreadable somewhere else and nobody finds out until they open it. ADR-0017 clause 4 makes it worse
still: under `sideEffects: false`, a module whose only purpose is a module-scope `register(...)` call
is provably deleted by the bundler.

## Decision

**1. One declaration shape.** Every extensible vocabulary declares
`{ <identifier>, broader, means, params }`, where `broader` is a member of that vocabulary's
**closed core** and `means` is one line of prose a human reads. `params` is an open record,
reserved.

The four fields are written once — `declarationFields(core)` in `src/core/schema/declarations.ts` —
and spread into each vocabulary's own object, so a vocabulary can add its own required facts while
the fields that make degradation work stay identical across all of them.

The identifier field is named for what it identifies: `code` for a missingness code (matching
`Missing.code` at the point of use, as shipped), `id` for a scale or a reduction. **The shared thing
is the resolver contract, not a field name**; renaming `MissingCodeDeclaration.code` to `id` would
break its symmetry with the field it declares and buy nothing.

**2. One resolution result, and it is never a bare `undefined`.**

    Resolution<F> =
      | { known: true;  id; facts: F;         source: 'core' | 'declared' }
      | { known: false; id; facts: F;         source: 'degraded';   broader; because }
      | { known: false; id; facts: undefined; source: 'undeclared'; because }

`undefined` facts is a real answer — "nobody declared this" — and is distinguishable from "declared,
and this build interprets it as its parent". Those two are opposite instructions to a caller and
were previously the same return value.

**3. Reading never raises on an unknown id. Authoring does.** This asymmetry is the whole design.

- **Reading** degrades through `broader` and records the fact. A document written by a team using a
  code, a scale or a reduction this build has never heard of **loads, validates, dominates, screens
  and renders** — degraded, and labelled. Without this, a locally-declared name makes a document
  unreadable everywhere else, which is what a plain registry gives you and is a worse failure than
  the closed enum it replaced.
- **Authoring** raises, naming every known member. At authoring time you are *choosing*, and a
  silent default is the failure — a typo becoming a scale nobody meant.

**4. Degradation is reported, never stored.**

    Degradation { axis: 'missing-code' | 'reduction' | 'scale' | 'normaliser' | 'stability',
                  id, broader?, at, because }

`at` is the JSON path where the unknown id was used; `because` is the declaration's own `means`, or
why there was nothing to fall back to. These accumulate **on read** and are returned to the caller
alongside the document.

**They are never written back into it.** A degradation is a fact about *this build*, not about the
analysis. Storing one would make one reader's limitation look like a property of the data, and the
next reader — who may implement the thing perfectly well — would inherit a permanent record of
somebody else's ignorance.

**5. Strictness is asymmetric, and the axis decides which side.** An open vocabulary must not become
a channel through which unverifiable claims travel. Under ADR-0031's families:

| situation | family | why |
|---|---|---|
| unknown **missingness** code | completeness `info` | degrade via `broader`, count as outstanding — over-report work, never under-report it |
| unknown **reduction** name | completeness `info` | degrade via `broader`; the reduction is disclosed either way |
| unknown **scale** on a cell claiming **high** confidence | honesty **error** | admissibility is uncheckable, and the document asserts checkability |
| unknown **normaliser** on a reference carrying a `check` | honesty **error** | the verdict is not reproducible, so it is not a verdict |

The rule underneath: degrading an *absence* is safe, because the worst outcome is over-reporting
work. Degrading a *claim about how a value was checked* is not, because the worst outcome is a claim
nobody can check rendered as one that was.

**6. Falsification.** `examples/relocation.json` declares a scale and a missingness code **this
build does not implement**. One integration test asserts the document validates, dominates and
screens; that `silenceRate` treats the custom code according to its declared flags; and that
**exactly two** `Degradation` records surface, with the exact axes. If that test is green, every
declaration seam in this ADR exists. If it cannot be written, this ADR is prose.

## Consequences
Every read of an extensible field goes through a resolver, every consumer handles `known === false`,
and the document grows three arrays. **For a solo user with one scale and six core codes this is
pure overhead** — the missingness machinery, which is the best thing in this codebase, currently
buys nothing because nobody has declared a code. The falsification fixture is the only thing that
keeps that honest, which is why it is a merge-blocking fixture and not an example.

Two costs are real, unrepaired, and recorded so they are not rediscovered as surprises.

`broader` degradation can be **honestly wrong**. A future latent-strength scale degrading to Stevens
`ordinal` renders a derived quantity as though a contributor chose it. The high-confidence case is a
rejection (clause 5) and the degradation is reported — but a medium-confidence cell degrades
quietly-but-loudly, and somebody will not read the banner. The mitigation can only be *enforced* by
an interpreter that understands the scale, which is precisely the reader that is missing.

And `params` is a hole in the cross-repo contract. JSON Schema can say "an object"; it cannot say
"the parameters *this* scale needs". So declaration parameters are validated only by a build that
already knows the extension — which is exactly the build that might not be present. This is
unavoidable if declarations are open, and it is the precise point at which ADR-0004's JSON-Schema
contract stops being load-bearing.

## Alternatives considered
- *A module-level registry keyed by name.* Makes a document written under a locally-registered name
  unreadable elsewhere, with no diagnostic, and it self-registers — which ADR-0017 clause 4 shows
  the bundler deletes.
- *Keep the enums closed and add members on request.* Every new member is a schema-major event and a
  lockstep two-language release. ADR-0009's `insufficient-evidence-to-discriminate` request is the
  worked example: under this ADR it is a row in a document and zero code changes in either
  repository.
- *Return `undefined` and let callers decide.* The status quo. Every caller invents its own default,
  the defaults disagree, and nobody can enumerate what a build failed to interpret.
- *Store the degradation on the document.* Rejected in clause 4.
