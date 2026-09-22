/**
 * The round redaction rule, in one place (#49, ADR-0023).
 *
 * The author is always stored; what a viewer may see is a projection computed
 * here, never an edit. These tests pin the rule across the policies, the three
 * "see everything" cases, and the property that the analysis is not touched.
 */
import { describe, it, expect } from 'vitest';
import * as z from 'zod/mini';
import { Analysis } from '../src/core/schema/analysis.js';
import { Round } from '../src/core/schema/provenance.js';
import { assertionVisibility, visibilityFor } from '../src/core/schema/redaction.js';

const base = (rounds: unknown[], roundId?: string, extraAuthors: unknown[] = []) => Analysis.parse({
  id: 'r', subject: { question: 'q' },
  authors: [
    { id: 'ana', displayName: 'Ana', kind: 'human' },
    { id: 'ben', displayName: 'Ben', kind: 'human' },
    ...extraAuthors,
  ],
  alternatives: [{ id: 'x', label: 'X' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } }],
  rounds,
  cells: [{
    alternativeId: 'x', criterionId: 'c', measure: 'score',
    assertions: [{
      id: 's-ana', authorId: 'ana', at: '2026-09-01T00:00:00Z', value: 4, justification: 'because',
      ...(roundId ? { roundId } : {}),
    }],
  }],
});
const OPEN = '2026-09-10T00:00:00Z';
const round = (over: Record<string, unknown>) => ({ id: 'r1', index: 1, closedAt: '2026-09-20T00:00:00Z', ...over });
const see = (a: Analysis, viewerId: string | undefined, now = OPEN) =>
  assertionVisibility(a, a.cells[0]!.assertions[0]!, { viewerId, now });

describe('assertionVisibility', () => {
  it('shows everything for an assertion in no round (the implicit single round)', () => {
    expect(see(base([]), 'ben')).toEqual({ author: true, value: 'shown', justification: true, because: 'no-round' });
  });

  it('hides the author of an anonymous round from another participant while it is open', () => {
    const v = see(base([round({ attribution: 'anonymous', feedback: 'full' })], 'r1'), 'ben');
    expect(v).toEqual({ author: false, value: 'shown', justification: true, because: 'round-open' });
  });

  it('reveals everything the moment the round closes', () => {
    const a = base([round({ attribution: 'anonymous', feedback: 'none' })], 'r1');
    expect(see(a, 'ben', '2026-09-20T00:00:00Z').because).toBe('round-closed');
    expect(see(a, 'ben', '2026-09-21T00:00:00Z')).toMatchObject({ author: true, value: 'shown', justification: true });
  });

  it('maps each feedback policy to what others\' assertions reveal', () => {
    const at = (feedback: string) => see(base([round({ feedback })], 'r1'), 'ben');
    expect(at('none')).toMatchObject({ value: 'hidden', justification: false });
    expect(at('anonymous-summary')).toMatchObject({ value: 'distribution-only', justification: false });
    expect(at('full')).toMatchObject({ value: 'shown', justification: true });
  });

  it('defaults a declared round to attributed with no feedback', () => {
    expect(see(base([round({})], 'r1'), 'ben')).toMatchObject({ author: true, value: 'hidden', justification: false });
  });

  it('never redacts a viewer\'s own assertion, including under another persona', () => {
    const a = base(
      [round({ attribution: 'anonymous', feedback: 'none' })], 'r1',
      [{ id: 'ana-as-buyer', displayName: 'Ana (buyer)', kind: 'human', principalId: 'ana' }],
    );
    expect(see(a, 'ana').because).toBe('own-assertion');
    expect(see(a, 'ana-as-buyer').because).toBe('own-assertion');
  });

  it('treats an outside reader as another participant', () => {
    expect(see(base([round({ attribution: 'anonymous' })], 'r1'), undefined)).toMatchObject({ author: false, value: 'hidden' });
  });

  it('treats an undeclared round as open and cautious, not as no round', () => {
    expect(see(base([], 'ghost-round'), 'ben')).toMatchObject({ author: false, value: 'hidden', because: 'round-open' });
  });

  it('treats an unparseable close time as still open', () => {
    expect(see(base([round({ closedAt: 'soon' })], 'r1'), 'ben').because).toBe('round-open');
  });

  it('is a projection: the author stays stored, and the analysis is not touched', () => {
    const a = base([round({ attribution: 'anonymous', feedback: 'none' })], 'r1');
    const before = JSON.stringify(a);
    const m = visibilityFor(a, { viewerId: 'ben', now: OPEN });
    expect(m.get('s-ana')!.author).toBe(false);
    expect(JSON.stringify(a)).toBe(before);
    expect(a.cells[0]!.assertions[0]!.authorId).toBe('ana');
  });
});

describe('round locking needs no migration (#49 item 3)', () => {
  it('a Round extended with optional locking fields reads every v1 round unchanged', () => {
    // The migration that *would* be needed to add locking and deadlines later:
    // new optional fields, nothing renamed, nothing re-typed. It is the
    // identity -- demonstrated by parsing v1 rounds through the extended shape.
    const LockedRound = z.extend(Round, { lockedAt: z.optional(z.string()), deadline: z.optional(z.string()) });
    const migrateLocking = (r: unknown) => r;
    for (const r of [round({}), round({ attribution: 'anonymous', feedback: 'full', openedAt: OPEN })]) {
      const v1 = Round.parse(r);
      expect(LockedRound.parse(migrateLocking(v1))).toEqual(v1);
    }
  });

  it('knows the cost that remains: a reader without locking drops the new fields', () => {
    // "No migration" is about old documents under a new reader. The other
    // direction is not free: zod objects strip unknown keys, so a reader built
    // before locking round-trips a locked round without its lock. That is the
    // version handshake's job (docs/cross-repo-coordination.md §3.3: MINOR is
    // additive, and a producer emits the lowest version that expresses the
    // document), not a migration's -- pinned here so nobody mistakes one for
    // the other.
    const locked = { ...round({}), lockedAt: OPEN };
    expect('lockedAt' in Round.parse(locked)).toBe(false);
  });
});
