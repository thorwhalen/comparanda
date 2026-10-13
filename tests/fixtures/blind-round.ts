/**
 * An analysis with an open anonymous round, for the redaction tests (#107,
 * ADR-0023): three raters on one cell, one of whom revised, ids that name the
 * author (as producers mint them), a procedure that names an agent, a closed
 * attributed round for contrast, and a thread. Invented, like every example
 * here (ADR-0033).
 */
import { Analysis } from '../../src/core/schema/analysis.js';

/** Every string that would give an author away, for a test to look for. */
export const BLIND_SECRETS = ['Ben Rivera', 'ben', 'a-rent-ben', 'a-rent-ben-2', 'Scorer-9', 'proc-scorer'] as const;

export const NOW_OPEN = '2026-09-10T00:00:00Z';
export const NOW_CLOSED = '2026-09-30T00:00:00Z';

export function blindRound(overrides: { feedback?: 'none' | 'anonymous-summary' | 'full' } = {}): Analysis {
  return Analysis.parse({
    id: 'blind', title: 'Panel', subject: { question: 'Which flat?' },
    authors: [
      { id: 'ana', displayName: 'Ana Lopez', kind: 'human' },
      { id: 'ben', displayName: 'Ben Rivera', kind: 'human' },
      { id: 'ben-as-buyer', displayName: 'Ben as buyer', kind: 'human', principalId: 'ben' },
      { id: 'scorer', displayName: 'Scorer-9', kind: 'agent', agent: { name: 'rubricator', runId: 'r9' } },
    ],
    alternatives: [{ id: 'x', label: 'Flat X' }, { id: 'y', label: 'Flat Y' }],
    criteria: [{ id: 'rent', label: 'Rent', defaultMeasurement: { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 } } }],
    rounds: [
      { id: 'r0', index: 0, label: 'Warm-up', attribution: 'attributed', feedback: 'full', closedAt: '2026-09-01T00:00:00Z' },
      { id: 'r1', index: 1, label: 'Round one', attribution: 'anonymous', feedback: overrides.feedback ?? 'full' },
    ],
    procedures: [{ id: 'proc-scorer', describedAs: 'the Scorer-9 pipeline' }],
    cells: [
      {
        alternativeId: 'x', criterionId: 'rent', measure: 'score',
        assertions: [
          { id: 'a-rent-ana', authorId: 'ana', at: '2026-08-30T10:00:00Z', value: 2, justification: 'Pricey.', roundId: 'r0' },
          { id: 'a-rent-ben', authorId: 'ben', at: '2026-09-02T10:00:00Z', value: 3, justification: 'Looks fair.', roundId: 'r1', supersededBy: 'a-rent-ben-2' },
          { id: 'a-rent-ben-2', authorId: 'ben', at: '2026-09-05T10:00:00Z', value: 4, justification: 'Revised after the survey.', roundId: 'r1' },
          { id: 'a-rent-scorer', authorId: 'scorer', at: '2026-09-03T10:00:00Z', value: 5, justification: 'Model says so.', roundId: 'r1', procedureId: 'proc-scorer', independence: 'resampled' },
        ],
      },
      { alternativeId: 'y', criterionId: 'rent', measure: 'score', assertions: [{ id: 'a-y-ana', authorId: 'ana', at: '2026-09-04T10:00:00Z', value: 1, roundId: 'r1' }] },
    ],
    threads: [{
      id: 't1', anchor: { scope: 'cell', alternativeId: 'x', criterionId: 'rent' },
      comments: [
        { id: 'c1', authorId: 'ana', at: '2026-09-06T10:00:00Z', body: 'Is this rent with bills?' },
        { id: 'c2', authorId: 'ana', at: '2026-09-07T10:00:00Z', body: 'Checked.', editedAt: '2026-09-08T10:00:00Z' },
      ],
      resolved: true, resolvedBy: 'ana', resolvedAt: '2026-09-09T10:00:00Z',
    }],
  });
}
