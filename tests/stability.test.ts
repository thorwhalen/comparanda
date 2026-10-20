/**
 * The between-round stability trace (#112, ADR-0023): churn per criterion per
 * round step, test-retest when the later round gave no feedback, a viewer's
 * hidden values left out, and a quantity that can never read as alpha.
 */
import { describe, it, expect } from 'vitest';

import { Analysis } from '../src/core/schema/analysis.js';
import { agreement, stabilityAnalysis, stabilityTrace } from '../src/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
const human = (id: string, over: Record<string, unknown> = {}) => ({ id, displayName: id, kind: 'human', ...over });
const s = (id: string, authorId: string, value: number, roundId: string, at = '2026-10-01T00:00:00Z') =>
  ({ id, authorId, at, value, justification: 'j', independence: 'independent' as const, roundId });

const delphi = (feedback: 'none' | 'anonymous-summary' = 'anonymous-summary', closedAt = '2026-10-10T00:00:00Z') => Analysis.parse({
  id: 'a', subject: { question: 'q' },
  authors: [human('ana'), human('bo'), human('ana-alt', { principalId: 'ana' })],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
  rounds: [
    { id: 'r2', index: 2, feedback, attribution: 'anonymous', closedAt },
    { id: 'r1', index: 1, feedback: 'none', attribution: 'anonymous', closedAt: '2026-10-05T00:00:00Z' },
  ],
  cells: [
    // Ana moves 1 -> 3 (her persona's later answer counts as hers), Bo stays at 4: spread 3 -> 1, narrowed.
    { alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [
      s('1', 'ana', 1, 'r1'), s('2', 'bo', 4, 'r1'), s('3', 'ana', 2, 'r2'), s('3b', 'ana-alt', 3, 'r2', '2026-10-02T00:00:00Z'), s('4', 'bo', 4, 'r2'),
    ] },
    // Only Bo answered in r2: compared for Bo, unchanged.
    { alternativeId: 'y', criterionId: 'c', measure: 'score', assertions: [s('5', 'ana', 2, 'r1'), s('6', 'bo', 5, 'r1'), s('7', 'bo', 5, 'r2')] },
  ],
});

describe('stabilityTrace', () => {
  it('counts who changed between rounds, and how the spread moved, per criterion', () => {
    const r = stabilityTrace(delphi(), { measure: 'score' });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ fromRoundId: 'r1', toRoundId: 'r2', quantity: 'churn' });
    expect(r.steps[0]!.criteria).toEqual([{ criterionId: 'c', compared: 3, changed: 1, fraction: 1 / 3, spread: { narrowed: 1, widened: 0, unchanged: 1 } }]);
    expect(stabilityAnalysis.id).toBe('stability-trace');
  });

  it('labels a step into a round without feedback as test-retest, not churn', () => {
    expect(stabilityTrace(delphi('none'), { measure: 'score' }).steps[0]!.quantity).toBe('test-retest');
  });

  it('cannot be shown as alpha: its quantity shares no value with agreement\'s label', () => {
    const quantities = new Set(['churn', 'test-retest']);
    const labels = agreement(delphi(), { measure: 'score' }).criteria.map((c) => c.labelledAs);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of [...labels, 'agreement', 'consistency']) expect(quantities.has(l)).toBe(false);
    expect(Object.keys(stabilityTrace(delphi(), { measure: 'score' }).steps[0]!.criteria[0]!)).not.toContain('alpha');
  });

  it('leaves out what a participant may not see in an open round, and says how much', () => {
    const open = delphi('anonymous-summary', '2099-01-01T00:00:00Z');
    const r = stabilityTrace({ ...open, rounds: open.rounds.map((x) => (x.id === 'r2' ? { ...x, feedback: 'none' as const } : x)) },
      { measure: 'score', viewer: { viewerId: 'bo', now: '2026-10-07T00:00:00Z' } });
    expect(r.unseen).toBeGreaterThan(0);
  });
});
