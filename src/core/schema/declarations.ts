/**
 * Extensible vocabularies: one declaration shape, one resolver, and degradation
 * that is reported rather than swallowed.
 *
 * Three things in this schema are open-ended -- missingness reason codes,
 * reductions, and measurement scales -- and each varies for the same reason:
 * a deployment's criteria are not ours to enumerate. The temptation is a
 * registry, where a build registers implementations under names. That fails the
 * case this package exists for, which is a document travelling to a reader who
 * did not produce it: a name registered in one process means nothing in another,
 * so a shared analysis becomes unreadable somewhere else and nobody finds out
 * until they open it.
 *
 * So the extension point is the **document**, not the process. Every open
 * vocabulary has:
 *
 *   - a **closed core** enum, which every build of every reader understands;
 *   - an open `string` at the point of use, so a cell may name anything;
 *   - a **declaration inside the analysis** naming one core member as its
 *     `broader` parent, what it `means` in prose, and any `params`;
 *   - exactly **one resolver**, which every consumer must call.
 *
 * `broader` is the whole contract. It is what lets a build that has never heard
 * of a code still classify it correctly, because the declarer has said which
 * core thing it is a refinement of.
 *
 * ## Reading never raises; authoring does
 *
 * This asymmetry is the load-bearing rule.
 *
 * **Reading** an id nobody declared, or one whose declaration this build cannot
 * interpret, degrades through `broader` and records a `Degradation`. It does not
 * throw, because throwing would make one reader's limitation into a corrupt
 * document, and it does not silently substitute a default, because that would
 * make the limitation invisible.
 *
 * **Authoring** with a name that does not exist raises, and the error names every
 * name that does. At authoring time you are choosing, and a silent default is
 * precisely the failure -- a typo becoming a scale nobody meant.
 *
 * ## A degradation is a fact about the build, never about the analysis
 *
 * `Degradation` records are accumulated on read and handed back to the caller
 * *beside* the document. They are never written into it. Storing one would make
 * one reader's missing feature look like a property of the data, and the next
 * reader -- who may implement the thing perfectly well -- would inherit a
 * complaint that was never true for them.
 */
import * as z from 'zod/mini';

/**
 * What a resolver returns.
 *
 * Four sources, and the distinction between the last two is the point:
 *
 * - `core`        a member of the closed core set.
 * - `declared`    an extension the document declares and this build interprets.
 * - `degraded`    an extension the document declares that this build does not
 *                 interpret. **Facts are still present**, taken from `broader`,
 *                 so every downstream computation keeps working.
 * - `undeclared`  an id with no declaration anywhere. Facts are `undefined`,
 *                 because there is nothing to fall back to and inventing one is
 *                 the guess this whole package refuses.
 */
export type Resolution<F> =
  | { known: true; id: string; facts: F; source: 'core' | 'declared' }
  | { known: false; id: string; facts: F; source: 'degraded'; broader: string; because: string }
  | { known: false; id: string; facts: undefined; source: 'undeclared'; because: string };

/** The axes that can degrade. One per open vocabulary. */
export type DegradationAxis = 'missing-code' | 'reduction' | 'scale' | 'normaliser' | 'stability';

/**
 * A fact about *this build*, accumulated while reading and returned alongside
 * the document. Never stored in it -- see the module docstring.
 */
export interface Degradation {
  axis: DegradationAxis;
  /** The id that could not be interpreted. */
  id: string;
  /** The core member it fell back to. Absent when nothing was declared. */
  broader?: string | undefined;
  /** Where in the document the id was used, as a JSON path. */
  at: string;
  /** The declaration's own `means`, or why there was nothing to fall back to. */
  because: string;
}

/**
 * The fields every declaration carries, given the core enum it refines.
 *
 * Spread into a vocabulary's own `z.object` rather than returned as a finished
 * schema, so each vocabulary can add its own required facts -- missingness needs
 * `informative`, a scale needs a level of measurement -- while the four fields
 * that make degradation work stay identical across all of them and are written
 * once.
 */
export function declarationFields<T>(broader: T) {
  return {
    /** The extension's own id. Must not collide with a core member. */
    id: z.string(),
    /**
     * The core member this refines. A reader that cannot interpret the
     * extension uses this one's facts instead, which is what keeps a document
     * readable by a build that has never heard of it.
     */
    broader,
    /**
     * One line of prose, shown to a reader whose build degraded this id. It is
     * the only thing standing between them and a silent substitution, so it is
     * required and should say what the extension means, not what it is called.
     */
    means: z.string(),
    /**
     * Anything the extension's own interpreter needs.
     *
     * Deliberately untyped. JSON Schema can say "an object" and cannot say "the
     * parameters *this* scale needs", so these are validated only by a build
     * that knows the extension -- which is exactly the build that might not be
     * present. This is the precise point where the cross-repo JSON Schema
     * contract stops being load-bearing, and it is the price of an open
     * vocabulary rather than an oversight.
     */
    params: z._default(z.record(z.string(), z.unknown()), {}),
  } as const;
}

/** The minimum a declaration must look like for `resolveDeclaration` to use it. */
export interface DeclarationLike {
  id: string;
  broader: string;
  means: string;
}

/**
 * The one resolver every open vocabulary delegates to.
 *
 * Written once so that "unknown ids degrade through `broader` and are reported"
 * cannot be implemented three times and drift twice.
 *
 * @param id           the id used in the document
 * @param core         the closed core table, keyed by core member
 * @param declarations the document's declarations for this vocabulary
 * @param factsOf      how to build this vocabulary's facts from a declaration
 *                     that this build *can* interpret. Return `undefined` to say
 *                     "declared, but I do not interpret it" -- which degrades.
 */
export function resolveDeclaration<F>(
  id: string,
  core: Readonly<Record<string, F>>,
  declarations: readonly DeclarationLike[],
  factsOf?: (decl: DeclarationLike, base: F) => F | undefined,
): Resolution<F> {
  // `hasOwn`, never `in`. A document is untrusted input, and `'toString' in
  // core` is true through the prototype chain -- so `in` resolves a cell whose
  // code is `toString`, `constructor` or `__proto__` as a *core* member and
  // hands back a function where facts should be. Every consumer then reads
  // `facts.structural` as undefined and quietly miscounts it.
  if (Object.prototype.hasOwnProperty.call(core, id)) {
    return { known: true, id, facts: core[id]!, source: 'core' };
  }

  const decl = declarations.find((d) => d.id === id);
  if (!decl) {
    return {
      known: false,
      id,
      facts: undefined,
      source: 'undeclared',
      because: 'no declaration for this id in the document, and nothing to fall back to',
    };
  }

  const base = Object.prototype.hasOwnProperty.call(core, decl.broader)
    ? core[decl.broader]
    : undefined;
  if (base === undefined) {
    // A declaration whose `broader` is not a core member. The document is
    // internally inconsistent; say so rather than picking a core member.
    return {
      known: false,
      id,
      facts: undefined,
      source: 'undeclared',
      because: `declared with broader "${decl.broader}", which is not a core member`,
    };
  }

  const facts = factsOf?.(decl, base);
  if (facts !== undefined) return { known: true, id, facts, source: 'declared' };

  return { known: false, id, facts: base, source: 'degraded', broader: decl.broader, because: decl.means };
}

/**
 * Turn a resolution into a `Degradation` record, or `undefined` when there is
 * nothing to report.
 *
 * Callers append the result to the list they hand back beside the document.
 */
export function degradationOf<F>(
  r: Resolution<F>,
  axis: DegradationAxis,
  at: string,
): Degradation | undefined {
  if (r.known) return undefined;
  return {
    axis,
    id: r.id,
    ...(r.source === 'degraded' ? { broader: r.broader } : {}),
    at,
    because: r.because,
  };
}

/**
 * The authoring half of the asymmetry: choose a name, or fail naming every name.
 *
 * Used by anything that *writes* a document. Never used on a read path -- see the
 * module docstring for why the two directions must behave differently.
 */
export function requireKnown<F>(
  id: string,
  table: Readonly<Record<string, F>>,
  what: string,
): F {
  // Same `hasOwn` rule as the read path, for the same reason.
  const facts = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
  if (facts === undefined) {
    const known = Object.keys(table).sort().join(', ');
    throw new Error(
      `unknown ${what} "${id}". Known ${what}s: ${known}. ` +
        `To use a new one, declare it in the analysis with a "broader" parent so that a reader ` +
        `which does not implement it can still classify it.`,
    );
  }
  return facts;
}
