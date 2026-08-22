/**
 * A stored citation check must never read as current when it is not.
 *
 * ADR-0014's amendment persists the check inside the analysis so a bundle sent
 * to someone with no resolver and no corpus can still show something real. The
 * price is that it can arrive stale, and the mitigation is structural rather
 * than hopeful: a verdict is undisplayable without its stamp, and every
 * non-current standing carries `needsCaveat`.
 *
 * The assertions to read twice are the ones where the *verdict* is `verified`
 * and the *standing* still demands a caveat. Those are the cases a naive
 * renderer gets wrong, and getting them wrong is how a document says something
 * false to a reader who cannot check it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkStanding,
  validateCitationCheck,
  validateEvidence,
  type CitationCheck,
  type EvidenceRef,
} from '../src/core/schema/evidence.js';

const NOW = new Date('2026-08-22T00:00:00Z');
const V = 'checker/2.0.0';

const check = (over: Partial<CitationCheck> = {}): CitationCheck => ({
  status: 'verified',
  checkedAt: '2026-08-20T00:00:00Z',
  checkerVersion: V,
  ...over,
});

describe('the requiredness rule', () => {
  it('rejects a verdict with no date and no checker', () => {
    const problems = validateCitationCheck({ status: 'verified' });
    expect(problems.map((p) => p.path)).toEqual(['check.checkedAt', 'check.checkerVersion']);
    // Informative errors: the message says what is wrong AND why it matters.
    expect(problems[0]!.message).toContain('reads as current forever');
  });

  it('exempts unchecked, which is an absence of a verdict rather than an undated one', () => {
    expect(validateCitationCheck({ status: 'unchecked' })).toEqual([]);
    expect(validateCitationCheck(undefined)).toEqual([]);
  });

  it('applies to every other status, including the failures', () => {
    for (const status of ['not-found', 'drifted', 'unresolvable'] as const) {
      expect(validateCitationCheck({ status })).toHaveLength(2);
    }
  });

  it('is enforced at the evidence boundary, not only in isolation', () => {
    const ref: EvidenceRef = {
      id: 'e1',
      target: 'doc:1',
      selectors: [{ type: 'TextQuoteSelector', exact: 'a quoted span' }],
      sourceType: 'primary',
      stance: 'supports',
      derivedFrom: [],
      check: { status: 'verified' }, // no stamp
    };
    const paths = validateEvidence([ref]).map((p) => p.path);
    expect(paths).toContain('evidence[0].check.checkedAt');
    expect(paths).toContain('evidence[0].check.checkerVersion');
  });
});

describe('freshness', () => {
  it('is current only when the checker version matches', () => {
    const s = checkStanding(check(), { currentCheckerVersion: V, now: NOW });
    expect(s.freshness).toBe('current');
    expect(s.needsCaveat).toBe(false);
    expect(s.ageDays).toBe(2);
  });

  it('demands a caveat for an older checker however recent the run', () => {
    // Checked one second ago, by the previous checker. Recency does not help:
    // what changed is the thing doing the checking.
    const s = checkStanding(
      check({ checkedAt: '2026-08-21T23:59:59Z', checkerVersion: 'checker/1.9.0' }),
      { currentCheckerVersion: V, now: NOW },
    );
    expect(s.freshness).toBe('older-checker');
    expect(s.needsCaveat).toBe(true);
    // The verdict itself is still "verified" -- that is exactly why the
    // standing has to travel beside it.
  });

  it('treats a missing check and an unchecked one alike, and both need a caveat', () => {
    for (const c of [undefined, check({ status: 'unchecked' })]) {
      const s = checkStanding(c, { currentCheckerVersion: V, now: NOW });
      expect(s.freshness).toBe('unchecked');
      expect(s.needsCaveat).toBe(true);
      expect(s.ageDays).toBeUndefined();
    }
  });
});

describe('age', () => {
  it('is reported but never acted on unless a caller chooses a threshold', () => {
    // Two years old, same checker. No threshold supplied, so it is current --
    // deliberately. Expiring on an age nobody can justify would blind a shared
    // bundle with no way for its recipient to refresh it.
    const old = check({ checkedAt: '2024-08-22T00:00:00Z' });
    const s = checkStanding(old, { currentCheckerVersion: V, now: NOW });
    expect(s.freshness).toBe('current');
    expect(s.ageDays).toBe(730);
  });

  it('ages out only when the caller owns the number', () => {
    const old = check({ checkedAt: '2024-08-22T00:00:00Z' });
    const s = checkStanding(old, { currentCheckerVersion: V, now: NOW, staleAfterDays: 365 });
    expect(s.freshness).toBe('aged');
    expect(s.needsCaveat).toBe(true);
  });

  it('does not age out exactly at the threshold', () => {
    const s = checkStanding(check({ checkedAt: '2026-08-12T00:00:00Z' }), {
      currentCheckerVersion: V, now: NOW, staleAfterDays: 10,
    });
    expect(s.ageDays).toBe(10);
    expect(s.freshness).toBe('current');
  });
});

describe('the property a renderer must not violate', () => {
  it('never reports needsCaveat false for anything but a current check', () => {
    const cases: (CitationCheck | undefined)[] = [
      undefined,
      check({ status: 'unchecked' }),
      check({ checkerVersion: 'checker/1.0.0' }),
      check({ status: 'drifted', checkerVersion: 'checker/1.0.0' }),
      check({ checkedAt: '2020-01-01T00:00:00Z' }),
    ];
    for (const c of cases) {
      const s = checkStanding(c, { currentCheckerVersion: V, now: NOW, staleAfterDays: 30 });
      if (s.freshness !== 'current') expect(s.needsCaveat).toBe(true);
    }
  });
});
