/**
 * The declaration substrate: four resolution sources, and the read/author
 * asymmetry that makes an open vocabulary safe.
 *
 * The property under test is not "the resolver returns the right facts". It is
 * that **reading a document never throws and never silently substitutes**, while
 * **authoring never silently substitutes and does throw**. Get either direction
 * backwards and one of two failures follows: a document that is unopenable by a
 * reader who lacks one extension, or a typo that quietly becomes a scale nobody
 * meant.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveDeclaration,
  degradationOf,
  requireKnown,
  type DeclarationLike,
  type Degradation,
} from '../src/core/schema/declarations.js';

interface Facts { weight: number; label: string }

const CORE: Readonly<Record<string, Facts>> = Object.freeze({
  alpha: { weight: 1, label: 'the first' },
  beta: { weight: 2, label: 'the second' },
});

const DECLS: DeclarationLike[] = [
  { id: 'alpha-prime', broader: 'alpha', means: 'a sharper alpha' },
  { id: 'orphan', broader: 'nonexistent', means: 'refines something that is not core' },
];

/** An interpreter that understands exactly one extension, and no others. */
const partial = (d: DeclarationLike, base: Facts): Facts | undefined =>
  d.id === 'alpha-prime' ? { weight: base.weight + 0.5, label: d.means } : undefined;

describe('the four sources', () => {
  it('resolves a core member as core', () => {
    const r = resolveDeclaration('beta', CORE, DECLS, partial);
    expect(r).toMatchObject({ known: true, source: 'core', facts: { weight: 2 } });
  });

  it('resolves a declaration this build understands as declared', () => {
    const r = resolveDeclaration('alpha-prime', CORE, DECLS, partial);
    expect(r).toMatchObject({ known: true, source: 'declared' });
    expect(r.facts).toEqual({ weight: 1.5, label: 'a sharper alpha' });
  });

  it('degrades a declaration this build does NOT understand, keeping facts', () => {
    // No interpreter at all: every declaration degrades. The facts are the
    // parent's, so everything downstream keeps computing -- which is the whole
    // point of `broader`.
    const r = resolveDeclaration('alpha-prime', CORE, DECLS);
    expect(r).toMatchObject({ known: false, source: 'degraded', broader: 'alpha' });
    expect(r.facts).toEqual(CORE.alpha);
    if (r.source === 'degraded') expect(r.because).toBe('a sharper alpha');
  });

  it('leaves an undeclared id without facts rather than inventing them', () => {
    const r = resolveDeclaration('never-heard-of-it', CORE, DECLS, partial);
    expect(r).toMatchObject({ known: false, source: 'undeclared', facts: undefined });
  });

  it('treats a declaration whose broader is not core as undeclared, not as core', () => {
    // The document is internally inconsistent. Picking a core member anyway
    // would be a guess dressed as a fallback.
    const r = resolveDeclaration('orphan', CORE, DECLS, partial);
    expect(r).toMatchObject({ known: false, source: 'undeclared', facts: undefined });
    if (!r.known) expect(r.because).toContain('not a core member');
  });
});

describe('reading never raises', () => {
  it('survives every hostile id a document could carry', () => {
    const hostile = ['', ' ', 'constructor', '__proto__', 'toString', 'orphan', '💥', 'a'.repeat(500)];
    for (const id of hostile) {
      expect(() => resolveDeclaration(id, CORE, DECLS, partial)).not.toThrow();
      const r = resolveDeclaration(id, CORE, DECLS, partial);
      // Whatever happens, it is one of the four sources and nothing else.
      expect(['core', 'declared', 'degraded', 'undeclared']).toContain(r.source);
    }
  });

  it('does not let a prototype key masquerade as a core member', () => {
    // `'toString' in CORE` is true via the prototype chain if the table is not
    // a null-prototype object, which would resolve a nonsense id as core.
    const r = resolveDeclaration('toString', CORE, [], partial);
    expect(r.known).toBe(false);
  });
});

describe('authoring does raise, and names the alternatives', () => {
  it('throws on an unknown id', () => {
    expect(() => requireKnown('alfa', CORE, 'scale')).toThrow(/unknown scale "alfa"/);
  });

  it('lists every known name, so a typo is one glance from fixed', () => {
    try {
      requireKnown('alfa', CORE, 'scale');
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('alpha');
      expect(msg).toContain('beta');
      // And it says what to do if the name was deliberate rather than a typo.
      expect(msg).toContain('broader');
    }
  });

  it('returns the facts when the name is known', () => {
    expect(requireKnown('alpha', CORE, 'scale')).toEqual({ weight: 1, label: 'the first' });
  });
});

describe('degradation records', () => {
  it('are absent for anything that resolved', () => {
    for (const id of ['alpha', 'alpha-prime']) {
      expect(degradationOf(resolveDeclaration(id, CORE, DECLS, partial), 'scale', 'x')).toBeUndefined();
    }
  });

  it('carry the parent when there was one to fall back to', () => {
    const d = degradationOf(resolveDeclaration('alpha-prime', CORE, DECLS), 'scale', 'criteria[0].scale');
    expect(d).toEqual<Degradation>({
      axis: 'scale',
      id: 'alpha-prime',
      broader: 'alpha',
      at: 'criteria[0].scale',
      because: 'a sharper alpha',
    });
  });

  it('omit the parent when there was not, rather than inventing one', () => {
    const d = degradationOf(resolveDeclaration('missing', CORE, [], partial), 'missing-code', 'cells[3]');
    expect(d?.broader).toBeUndefined();
    expect(d?.because).toContain('no declaration');
  });
});
