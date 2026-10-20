/**
 * `describeOpenSuggestions` (#256): the open suggestions in words, with the
 * proposer named only where the round lets this viewer know who proposed it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { Analysis } from '../src/core/schema/analysis.js';
import { describeOpenSuggestions, HIDDEN_PROPOSER } from '../src/index.js';

const relocation = Analysis.parse(JSON.parse(readFileSync(new URL('../examples/relocation.json', import.meta.url), 'utf8')));

describe('describeOpenSuggestions', () => {
  it('says who proposes what on which cell, and why', () => {
    const [s] = describeOpenSuggestions(relocation);
    expect(s).toMatchObject({ id: 'sg-day-tai', proposerId: 'cleo', about: 'the cell Winter daylight, Taipei', proposes: '5' });
    expect(s!.who).toMatch(/^Cleo Marsh/);
    expect(s!.rationale).toMatch(/solstice/);
  });

  it('leaves decided suggestions out', () => {
    const decided = { ...relocation, suggestions: relocation.suggestions.map((s) => ({ ...s, status: 'declined' as const })) };
    expect(describeOpenSuggestions(decided)).toEqual([]);
  });

  it('does not name a proposer an open anonymous round hides from the viewer', () => {
    const doc = Analysis.parse({
      ...relocation,
      rounds: [...relocation.rounds, { id: 'r-open', index: 2, feedback: 'none', attribution: 'anonymous', openedAt: '2026-10-01T00:00:00Z' }],
      suggestions: relocation.suggestions.map((s) => ({ ...s, proposed: { ...s.proposed, roundId: 'r-open' } })),
    });
    const [s] = describeOpenSuggestions(doc, { viewer: { viewerId: 'ana', now: '2026-10-20T00:00:00Z' } });
    expect(s!.proposerId).toBeUndefined();
    expect(s!.who).toBe(HIDDEN_PROPOSER);
    expect(describeOpenSuggestions(doc, { viewer: { viewerId: 'cleo', now: '2026-10-20T00:00:00Z' } })[0]!.proposerId).toBe('cleo');
  });
});
