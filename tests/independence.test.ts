/**
 * `independence` is the field that stops five draws of one model rendering as
 * five raters. It defaulted to `independent` — the *least* cautious rung — so an
 * assertion set that recorded nothing was reported as that many separate
 * assessors, which is the exact failure the field exists to prevent.
 *
 * These tests pin the safe behaviour: absent means unknown, and unknown never
 * counts as independent.
 */
import { describe, it, expect } from 'vitest';
import {
  countsAsIndependentRater,
  weakestIndependence,
  effectiveIndependence,
  distinctPrincipals,
  type Independence,
} from '../src/core/schema/provenance.js';
import { Assertion } from '../src/core/schema/values.js';
import { tallyCompleteness } from '../src/core/schema/missingness.js';

describe('independence', () => {
  it('is not defaulted when a document omits it', () => {
    const parsed = Assertion.parse({
      id: 'a1', authorId: 'someone', at: '2026-01-01T00:00:00Z', value: 3,
    });
    expect(parsed.independence).toBeUndefined();
  });

  it('unknown independence never counts as an independent rater', () => {
    expect(countsAsIndependentRater(undefined)).toBe(false);
    expect(countsAsIndependentRater('shared-context')).toBe(false);
    expect(countsAsIndependentRater('resampled')).toBe(false);
    expect(countsAsIndependentRater('perturbed')).toBe(false);
    expect(countsAsIndependentRater('consensus')).toBe(false);
    expect(countsAsIndependentRater('independent')).toBe(true);
  });

  it('labels a set by its weakest rung, not its best', () => {
    // Four genuinely independent assessors and one that shared a transcript
    // makes the whole set correlated. Reporting it as five-rater agreement
    // overstates it, so the label follows the weakest member.
    expect(
      weakestIndependence([
        { independence: 'independent' },
        { independence: 'independent' },
        { independence: 'independent' },
        { independence: 'independent' },
        { independence: 'shared-context' },
      ]),
    ).toBe('shared-context');
  });

  it('one unrecorded rung makes the whole set unknown', () => {
    expect(
      weakestIndependence([{ independence: 'independent' }, {}]),
    ).toBe('unknown');
  });

  it('an empty set is unknown, not independent', () => {
    expect(weakestIndependence([])).toBe('unknown');
  });
});

describe('completeness rates', () => {
  // Renamed from assessedRate/settledRate, which both read naturally as "looked
  // at" AND as "carries a value" -- which is how an ADR and the implementation
  // came to define them as each other's opposite.
  it('separates looked-at from carries-a-value', () => {
    const c = tallyCompleteness([
      { hasValue: true },
      { hasValue: true },
      { hasValue: false, code: 'not-evidenced' },   // looked at, came back empty
      { hasValue: false, code: 'not-assessed' },    // nobody has reached it
      { hasValue: false, code: 'not-applicable' },  // structural: excluded
    ]);

    expect(c.total).toBe(5);
    expect(c.structural).toBe(1);
    expect(c.applicable).toBe(4);
    expect(c.present).toBe(2);
    expect(c.settledAbsent).toBe(1);
    expect(c.outstanding).toBe(1);

    expect(c.examinedRate).toBeCloseTo(3 / 4);  // two valued + one silent
    expect(c.valuedRate).toBeCloseTo(2 / 4);
    expect(c.silenceRate).toBeCloseTo(1 / 4);
    expect(c.examinedRate).toBeGreaterThan(c.valuedRate);
  });

  it('counts an undeclared code as outstanding, never as done', () => {
    // Over-reporting work remaining is the safe direction; under-reporting it
    // makes an analysis look finished when nobody knows what the code meant.
    const c = tallyCompleteness([{ hasValue: false, code: 'invented-by-someone' }]);
    expect(c.outstanding).toBe(1);
    expect(c.settledAbsent).toBe(0);
    expect(c.structural).toBe(0);
  });

  it('a structural absence is excluded from the denominator', () => {
    const c = tallyCompleteness([
      { hasValue: true },
      { hasValue: false, code: 'not-applicable' },
    ]);
    expect(c.applicable).toBe(1);
    expect(c.valuedRate).toBe(1);
  });
});

describe('personas do not multiply into raters', () => {
  const authors = [
    { id: 'ana', principalId: undefined },
    { id: 'ana-as-buyer', principalId: 'ana' },
    { id: 'ana-as-operator', principalId: 'ana' },
    { id: 'ben', principalId: undefined },
  ];

  const asserted = (authorId: string, independence: Independence) => ({ authorId, independence });

  it('collapses two personas of one analyst, even when both say independent', () => {
    // Both assertions are honestly `independent` -- neither consulted the other.
    // They are still one head, and an agreement statistic over them is not
    // inter-rater agreement.
    const set = [asserted('ana-as-buyer', 'independent'), asserted('ana-as-operator', 'independent')];
    expect(weakestIndependence(set)).toBe('independent');   // what was recorded
    expect(effectiveIndependence(set, authors)).toBe('resampled'); // what is true
  });

  it('leaves a genuinely independent pair alone', () => {
    const set = [asserted('ana', 'independent'), asserted('ben', 'independent')];
    expect(effectiveIndependence(set, authors)).toBe('independent');
  });

  it('collapses a persona against its own principal', () => {
    const set = [asserted('ana', 'independent'), asserted('ana-as-buyer', 'independent')];
    expect(effectiveIndependence(set, authors)).toBe('resampled');
  });

  it('never raises a rung -- a weaker record still wins', () => {
    const set = [asserted('ana', 'shared-context'), asserted('ben', 'independent')];
    expect(effectiveIndependence(set, authors)).toBe('shared-context');
  });

  it('stays unknown when any assertion recorded nothing', () => {
    const set = [{ authorId: 'ana' }, asserted('ben', 'independent')];
    expect(effectiveIndependence(set, authors)).toBe('unknown');
  });

  it('counts principals, not authors', () => {
    const set = [
      asserted('ana-as-buyer', 'independent'),
      asserted('ana-as-operator', 'independent'),
      asserted('ben', 'independent'),
    ];
    expect(set.length).toBe(3);
    expect(distinctPrincipals(set, authors)).toBe(2);
  });

  it('treats an author nobody declared as its own principal', () => {
    // The cautious direction: an unknown author is one more distinct head, not
    // silently folded into someone else's.
    expect(distinctPrincipals([{ authorId: 'stranger' }], authors)).toBe(1);
  });
});
