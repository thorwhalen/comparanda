/**
 * `silenceRate` counts informative absence only (ADR-0009 clauses 2 and 5).
 *
 * The whole point of this file is the `withheld` cell. `withheld` and
 * `not-evidenced` are both terminal absences and they mean opposite things
 * about the subject -- "we know and are not saying" against "nobody documents
 * this" -- so a rate that counts both is measuring something weaker than the
 * honesty guarantee it is supposed to report on.
 *
 * Every assertion below that mentions `withheld` fails against the previous
 * `settledAbsent / applicable` definition. That is deliberate: a guard that
 * cannot fail is not a guard, and this codebase has shipped three of those.
 */
import { describe, it, expect } from 'vitest';
import {
  CORE_MISSING_CODES,
  resolveMissingCode,
  tallyCompleteness,
  type MissingCodeDeclaration,
} from '../src/core/schema/missingness.js';
import type { Degradation } from '../src/core/schema/declarations.js';

describe('the informative flag', () => {
  it('separates the two terminal absences that mean opposite things', () => {
    expect(CORE_MISSING_CODES['not-evidenced'].informative).toBe(true);
    expect(CORE_MISSING_CODES.withheld.informative).toBe(false);
    // Both are terminal. `terminal` alone cannot tell them apart, which is why
    // a third flag exists rather than a cleverer reading of the first two.
    expect(CORE_MISSING_CODES['not-evidenced'].terminal).toBe(true);
    expect(CORE_MISSING_CODES.withheld.terminal).toBe(true);
  });

  it('marks contested sources informative, because the conflict is the finding', () => {
    expect(CORE_MISSING_CODES.indeterminate.informative).toBe(true);
  });

  it('never marks an absence about our own process informative', () => {
    expect(CORE_MISSING_CODES['not-assessed'].informative).toBe(false);
    expect(CORE_MISSING_CODES.deferred.informative).toBe(false);
  });
});

describe('silenceRate', () => {
  it('excludes withheld cells, which the old settled-absent rate counted', () => {
    const c = tallyCompleteness([
      { hasValue: true },
      { hasValue: false, code: 'not-evidenced' }, // informative: counts
      { hasValue: false, code: 'withheld' },      // NOT informative: does not
      { hasValue: false, code: 'not-assessed' },  // outstanding
    ]);

    expect(c.applicable).toBe(4);
    expect(c.settledAbsent).toBe(2);      // not-evidenced + withheld
    expect(c.informativeAbsent).toBe(1);  // not-evidenced only

    expect(c.silenceRate).toBeCloseTo(1 / 4);
    // The discriminating assertion: the superseded definition gives 2/4 here.
    expect(c.silenceRate).not.toBeCloseTo(c.settledAbsent / c.applicable);
  });

  it('counts contested sources as silence about a settled answer', () => {
    const c = tallyCompleteness([
      { hasValue: false, code: 'not-evidenced' },
      { hasValue: false, code: 'indeterminate' },
      { hasValue: false, code: 'withheld' },
    ]);
    expect(c.informativeAbsent).toBe(2);
    expect(c.silenceRate).toBeCloseTo(2 / 3);
  });

  it('is zero when every blank is about us rather than about the subject', () => {
    const c = tallyCompleteness([
      { hasValue: false, code: 'withheld' },
      { hasValue: false, code: 'deferred' },
      { hasValue: false, code: 'not-assessed' },
    ]);
    expect(c.silenceRate).toBe(0);
    expect(c.settledAbsent).toBe(1); // the withheld cell is still settled work
  });

  it('is unaffected by structural absence, which leaves the denominator', () => {
    const c = tallyCompleteness([
      { hasValue: false, code: 'not-evidenced' },
      { hasValue: false, code: 'not-applicable' }, // informative AND structural
    ]);
    // not-applicable is informative, but structural absence is excluded before
    // any rate is computed, so it can never inflate this number.
    expect(CORE_MISSING_CODES['not-applicable'].informative).toBe(true);
    expect(c.applicable).toBe(1);
    expect(c.informativeAbsent).toBe(1);
    expect(c.silenceRate).toBe(1);
  });
});

describe('declared extensions', () => {
  const declarations: readonly MissingCodeDeclaration[] = [
    // Inherits informative: true from not-evidenced.
    { id: 'no-public-filing', broader: 'not-evidenced', means: 'No public filing exists.', params: {} },
    // Overrides it. A paywall is a fact about our access, not about the subject
    // -- the case that makes inheriting the wrong default dangerous.
    { id: 'source-paywalled', broader: 'not-evidenced', means: 'The source is paywalled.', informative: false, params: {} },
  ];

  it('inherits informative from broader when not stated', () => {
    const r = resolveMissingCode('no-public-filing', declarations);
    expect(r.source).toBe('declared');
    expect(r.facts?.informative).toBe(true);
  });

  it('lets a refinement contradict its parent, because the axes are independent', () => {
    const r = resolveMissingCode('source-paywalled', declarations);
    expect(r.facts?.informative).toBe(false);
    expect(r.facts?.terminal).toBe(true); // still inherited
  });

  it('never degrades a declared code, because its facts travel with it', () => {
    // This is the return on carrying facts in the document rather than in an
    // interpreter: a build that has never heard of `source-paywalled` still
    // classifies it exactly right, so there is nothing to report.
    for (const id of ['no-public-filing', 'source-paywalled']) {
      expect(resolveMissingCode(id, declarations).known).toBe(true);
    }
  });

  it('keeps an overriding extension out of silenceRate', () => {
    const c = tallyCompleteness(
      [
        { hasValue: false, code: 'no-public-filing' },
        { hasValue: false, code: 'source-paywalled' },
      ],
      declarations,
    );
    expect(c.settledAbsent).toBe(2);
    expect(c.informativeAbsent).toBe(1);
    expect(c.silenceRate).toBeCloseTo(1 / 2);
  });

  it('still refuses to resolve an undeclared code rather than guessing', () => {
    // Guessing `informative` for a code nobody declared would put an invention
    // underneath the one metric the honesty claim is measured by.
    const r = resolveMissingCode('invented-by-someone');
    expect(r.known).toBe(false);
    expect(r.source).toBe('undeclared');
    expect(r.facts).toBeUndefined();

    const c = tallyCompleteness([{ hasValue: false, code: 'invented-by-someone' }]);
    expect(c.informativeAbsent).toBe(0);
    expect(c.outstanding).toBe(1);
  });

  it('reports an undeclared code as a degradation, with where it was used', () => {
    // The rate is still computed -- the analysis is not corrupt -- but the
    // caller learns that one cell was counted without anyone knowing what its
    // code meant. Silently counting it as outstanding and saying nothing is how
    // a completeness report becomes confidently wrong.
    const degradations: Degradation[] = [];
    tallyCompleteness(
      [{ hasValue: true }, { hasValue: false, code: 'invented-by-someone' }],
      declarations,
      degradations,
    );
    expect(degradations).toHaveLength(1);
    expect(degradations[0]).toMatchObject({
      axis: 'missing-code',
      id: 'invented-by-someone',
      at: 'cells[1].missing.code',
    });
    expect(degradations[0]!.broader).toBeUndefined();
  });

  it('reports nothing when every code resolves', () => {
    const degradations: Degradation[] = [];
    tallyCompleteness(
      [{ hasValue: false, code: 'withheld' }, { hasValue: false, code: 'source-paywalled' }],
      declarations,
      degradations,
    );
    expect(degradations).toEqual([]);
  });
});
