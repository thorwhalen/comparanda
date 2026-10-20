/**
 * Suggestion mode's writes (#113): accept writes the proposal into its cell as
 * its proposer's and records the decision; decline records only the decision;
 * bulk decisions step one at a time, so each is undoable before writing, and a
 * refusal anywhere applies none of them.
 */
import { describe, it, expect } from 'vitest';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { revisionProblems } from '../src/core/revision.js';
import { decideSuggestion, decideSuggestions, openSuggestionsBy } from '../src/index.js';

const ORDINAL = { level: 'ordinal', preference: 'increasing', range: { min: 1, max: 5 }, levels: [1, 2, 3, 4, 5] } as const;
const OWNER = { id: 'owner', displayName: 'Owner', kind: 'human' } as const;
const AT = '2026-10-20T00:00:00Z';
const proposal = (id: string, alt: string, value: number, authorId = 'rev') => ({
  id, anchor: { scope: 'cell', alternativeId: alt, criterionId: 'c', measure: 'score' }, authorId, at: AT,
  proposed: { id: `p-${id}`, authorId, at: AT, value, justification: 'j' },
});
const doc = () => Analysis.parse({
  id: 'a', subject: { question: 'q' }, authors: [{ id: 'rev', displayName: 'Rev', kind: 'human' }, { id: 'other', displayName: 'O', kind: 'human' }],
  alternatives: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
  criteria: [{ id: 'c', label: 'C', defaultMeasurement: ORDINAL }],
  cells: [{ alternativeId: 'x', criterionId: 'c', measure: 'score', assertions: [] }],
  suggestions: [proposal('s1', 'x', 4), proposal('s2', 'y', 2), proposal('s3', 'x', 5, 'other')],
});

describe('decideSuggestion', () => {
  it('accepting writes the proposal into its cell as the proposer\'s, records the decider, and passes the write guard', () => {
    const a = doc();
    const b = decideSuggestion(a, 's1', 'accept', { by: OWNER, at: AT, note: 'agreed' });
    expect(b.cells[0]!.assertions).toEqual([expect.objectContaining({ id: 'p-s1', authorId: 'rev', value: 4 })]);
    expect(b.suggestions[0]).toMatchObject({ status: 'accepted', decidedBy: 'owner', decidedAt: AT, decisionNote: 'agreed' });
    expect(b.authors.map((x) => x.id)).toContain('owner');
    expect(revisionProblems(a, b)).toEqual([]);
    expect(validateAnalysis(b).problems.filter((p) => p.severity === 'error').map((p) => p.message)).toEqual([]);
  });

  it('accepting into a cell not yet stored creates it; declining writes no assertion', () => {
    const accepted = decideSuggestion(doc(), 's2', 'accept', { by: OWNER, at: AT });
    expect(accepted.cells.find((c) => c.alternativeId === 'y')!.assertions.map((s) => s.id)).toEqual(['p-s2']);
    const declined = decideSuggestion(doc(), 's2', 'decline', { by: OWNER, at: AT });
    expect(declined.cells).toEqual(doc().cells);
    expect(declined.suggestions[1]!.status).toBe('declined');
  });

  it('refuses what the affordance layer refuses, with its reason: decided twice, or unknown', () => {
    const once = decideSuggestion(doc(), 's1', 'decline', { by: OWNER, at: AT });
    expect(() => decideSuggestion(once, 's1', 'accept', { by: OWNER, at: AT })).toThrow(/already been declined/);
    expect(() => decideSuggestion(doc(), 'nope', 'decline', { by: OWNER, at: AT })).toThrow(/no suggestion "nope"/);
  });
});

describe('an accepted write is one the store will take (review)', () => {
  it('refuses a proposal written under another author, and one the write guard would refuse', () => {
    const a = doc();
    const forged = { ...a, suggestions: [{ ...a.suggestions[0]!, proposed: { ...a.suggestions[0]!.proposed, authorId: 'other' } }] };
    expect(() => decideSuggestion(forged, 's1', 'accept', { by: OWNER, at: AT })).toThrow(/under someone else's name/);
    // A second live assertion in a cell needs its independence recorded.
    const scored = { ...a, cells: [{ ...a.cells[0]!, assertions: [{ id: 'old', authorId: 'other', at: AT, value: 3, justification: 'j', independence: 'independent' as const, version: 1, evidence: [] }] }] };
    expect(() => decideSuggestion(Analysis.parse(scored), 's1', 'accept', { by: OWNER, at: AT })).toThrow(/would write what the document refuses/);
  });
});

describe('decideSuggestions: bulk, each step undoable, never partly applied', () => {
  it('steps one decision at a time, so a caller can keep any prefix', () => {
    const ids = openSuggestionsBy(doc(), 'rev');
    expect(ids).toEqual(['s1', 's2']);
    const { analysis, steps } = decideSuggestions(doc(), ids.map((suggestionId) => ({ suggestionId, decision: 'accept' as const })), { by: OWNER, at: AT });
    expect(steps.map((s) => s.suggestionId)).toEqual(['s1', 's2']);
    expect(steps.at(-1)!.analysis).toBe(analysis);
    // Undo the last: the first step's document has s1 accepted and s2 still open.
    expect(steps[0]!.analysis.suggestions.map((s) => s.status)).toEqual(['accepted', 'open', 'open']);
  });

  it('throws at the first refusal, saying how far it got, and returns nothing to write', () => {
    expect(() => decideSuggestions(doc(), [{ suggestionId: 's1', decision: 'accept' }, { suggestionId: 's1', decision: 'accept' }], { by: OWNER, at: AT }))
      .toThrow(/after 1 of 2 decided; nothing was written/);
  });
});
