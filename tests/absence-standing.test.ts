/**
 * `absenceStanding` (#101): what an absence says about the work, read from the
 * flags, so an extension stands where the core code it refines stands unless
 * it overrides a flag.
 */
import { describe, expect, it } from 'vitest';

import { absenceStanding, CORE_MISSING_CODES, resolveMissingCode } from '../src/core/schema/missingness.js';

describe('absenceStanding', () => {
  it('reads the core table: not-applicable is structural, not-assessed and deferred outstanding, the rest answered', () => {
    const standing = Object.fromEntries(Object.entries(CORE_MISSING_CODES).map(([code, facts]) => [code, absenceStanding(facts)]));
    expect(standing).toEqual({
      'not-applicable': 'structural',
      'not-assessed': 'outstanding',
      deferred: 'outstanding',
      'not-evidenced': 'answered',
      indeterminate: 'answered',
      withheld: 'answered',
    });
  });

  it('follows the flags, not the code: an extension inherits, and an override moves it', () => {
    const declarations = [
      { id: 'awaiting-vendor', broader: 'not-assessed' as const, means: 'Asked; no reply yet.', params: {} },
      { id: 'out-of-scope', broader: 'deferred' as const, means: 'Out of scope this round.', terminal: true, params: {} },
    ];
    expect(absenceStanding(resolveMissingCode('awaiting-vendor', declarations).facts!)).toBe('outstanding');
    expect(absenceStanding(resolveMissingCode('out-of-scope', declarations).facts!)).toBe('answered');
  });
});
