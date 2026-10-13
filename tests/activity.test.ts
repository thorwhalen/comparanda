/**
 * The activity record and the cell detail under an open anonymous round
 * (#107, ADR-0011 clause 7, ADR-0023): what moved and when is legible; who is
 * not, until the round closes; and nothing in what core hands a surface can
 * give the author away, from one enforcement point.
 */
import { describe, expect, it } from 'vitest';

import { activityRecord } from '../src/core/activity.js';
import { editComment, reopenThread, replyToThread } from '../src/core/threads.js';
import { cellDetail } from '../src/core/detail.js';
import { vocabularyOf } from '../src/core/schema/analysis.js';
import { BLIND_SECRETS, blindRound, NOW_CLOSED, NOW_OPEN } from './fixtures/blind-round.js';

const closedRound = (a: ReturnType<typeof blindRound>) => ({ ...a, rounds: a.rounds.map((r) => (r.id === 'r1' ? { ...r, closedAt: '2026-09-20T00:00:00Z' } : r)) });
const gives = (value: unknown) => JSON.stringify(value);
const leaks = (value: unknown) => BLIND_SECRETS.filter((s) => gives(value).includes(s));

describe('the activity record', () => {
  const a = blindRound();

  it('says what moved and when, in time order, with the justification given', () => {
    const entries = activityRecord(closedRound(a), { viewerId: 'cy', now: NOW_CLOSED });
    const times = entries.map((e) => e.at);
    expect(times).toEqual([...times].sort());
    const changed = entries.find((e) => e.kind === 'changed')!;
    expect(changed).toMatchObject({ value: 4, previous: 3, justification: 'Revised after the survey.', criterionId: 'rent', alternativeId: 'x' });
    expect(changed.said).toBe('Ben Rivera (human, unverified) changed Rent for Flat X to 4 (was 3), 2026-09-05T10:00:00Z. Because: Revised after the survey.');
  });

  it('inside an open anonymous round says what moved, and not who', () => {
    const entries = activityRecord(a, { viewerId: 'cy', now: NOW_OPEN });
    const round = entries.filter((e) => e.round === 'Round one');
    expect(round).toHaveLength(4);
    for (const e of round) expect(e).toMatchObject({ whoHidden: true, because: 'round-open' });
    for (const e of round) expect(e.who).toBeUndefined();
    expect(leaks(entries)).toEqual([]);
    const changed = entries.find((e) => e.kind === 'changed')!;
    expect(changed.said).toBe('Someone changed Rent for Flat X to 4 (was 3), 2026-09-05T10:00:00Z. Because: Revised after the survey.');
    // The warm-up round is closed and attributed: still named.
    expect(entries.find((e) => e.round === 'Warm-up')!.who).toMatch(/^Ana Lopez/);
  });

  it('becomes legible as who the moment the round closes', () => {
    const entries = activityRecord(a, { viewerId: 'cy', now: NOW_OPEN });
    const closed = activityRecord(closedRound(a), { viewerId: 'cy', now: NOW_CLOSED });
    expect(entries.some((e) => e.who?.startsWith('Ben Rivera'))).toBe(false);
    expect(closed.filter((e) => e.round === 'Round one').every((e) => !e.whoHidden && e.who !== undefined)).toBe(true);
  });

  it('never hides a viewer\'s own work from them, under any persona of theirs', () => {
    for (const viewerId of ['ben', 'ben-as-buyer']) {
      const entries = activityRecord(a, { viewerId, now: NOW_OPEN });
      expect(entries.filter((e) => e.who?.startsWith('Ben Rivera'))).toHaveLength(2);
    }
  });

  it('under feedback none, keeps the value and the reason hidden too, and says so', () => {
    const entries = activityRecord(blindRound({ feedback: 'none' }), { viewerId: 'cy', now: NOW_OPEN });
    const mine = entries.filter((e) => e.round === 'Round one');
    for (const e of mine) {
      expect(e.value).toBeUndefined();
      expect(e.justification).toBeUndefined();
      expect(e.said).toMatch(/^Someone (recorded|changed) Rent for Flat [XY], a value the round keeps hidden until it closes, /);
    }
    expect(leaks(entries)).toEqual([]);
    // The change is still seen as a change, though not from what to what.
    expect(mine.map((e) => e.kind)).toContain('changed');
    expect(entries.find((e) => e.kind === 'changed')!.previous).toBeUndefined();
  });

  it('under an anonymous summary keeps individual values and reasons from being shown against a rater', () => {
    const entries = activityRecord(blindRound({ feedback: 'anonymous-summary' }), { viewerId: 'cy', now: NOW_OPEN });
    for (const e of entries.filter((x) => x.round === 'Round one')) expect(e.value).toBeUndefined();
  });

  it('lists the discussion with its authors, edits as edits that keep no earlier wording, and the resolution', () => {
    const entries = activityRecord(a, { viewerId: 'cy', now: NOW_OPEN });
    expect(entries.filter((e) => e.threadId === 't1').map((e) => e.kind)).toEqual(['started-thread', 'replied', 'edited-comment', 'resolved']);
    expect(entries.find((e) => e.kind === 'edited-comment')!.said).toMatch(/the earlier wording and the editor are not recorded/);
    expect(entries.find((e) => e.kind === 'resolved')!.who).toMatch(/^Ana Lopez/);
  });

  it('answers what changed since a reading', () => {
    const since = '2026-09-04T00:00:00Z';
    const entries = activityRecord(a, { viewerId: 'cy', now: NOW_OPEN }, { since });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => Date.parse(e.at) > Date.parse(since))).toBe(true);
  });

  it('is the same document read twice: it edits nothing', () => {
    const before = gives(a);
    activityRecord(a, { viewerId: 'cy', now: NOW_OPEN });
    expect(gives(a)).toBe(before);
  });
});

describe('cellDetail for a viewer', () => {
  const a = blindRound();
  const detail = (viewerId: string | undefined, now = NOW_OPEN, analysis = a) =>
    cellDetail(analysis, 'x', 'rent', 'score', { vocabulary: vocabularyOf(analysis), ...(viewerId !== undefined || now ? { viewer: { viewerId, now } } : {}) });

  it('anonymises every assertion whose author the round hides, and gives nothing of them away', () => {
    const d = detail('cy');
    expect(leaks(d)).toEqual([]);
    const hidden = d.assertions.filter((x) => x.authorHidden);
    expect(hidden).toHaveLength(3);
    for (const x of hidden) {
      expect(x.author).toBeUndefined();
      expect(x.principal).toBeUndefined();
      expect(x.procedure).toBeUndefined();
      expect(x.assertion.authorId).toBe('');
      expect(x.assertion.procedureId).toBeUndefined();
    }
    // The warm-up assertion is closed and attributed.
    expect(d.assertions.find((x) => !x.authorHidden)!.author?.displayName).toBe('Ana Lopez');
  });

  it('keeps the supersession chain readable under stand-in ids', () => {
    const d = detail('cy');
    const old = d.assertions.find((x) => x.superseded)!;
    expect(old.assertion.supersededBy).toBeDefined();
    expect(d.assertions.find((x) => x.assertion.id === old.assertion.supersededBy)).toBeDefined();
  });

  it('shows a viewer their own, and everything once the round closes', () => {
    expect(detail('ben').assertions.filter((x) => x.authorHidden)).toHaveLength(1);
    const d = detail('cy', NOW_CLOSED, closedRound(a));
    expect(d.assertions.some((x) => x.authorHidden)).toBe(false);
    expect(d.assertions.map((x) => x.author?.displayName)).toContain('Ben Rivera');
  });

  it('hides nothing from a caller that says nothing about who is looking', () => {
    const d = cellDetail(a, 'x', 'rent', 'score', { vocabulary: vocabularyOf(a) });
    expect(d.assertions.some((x) => x.authorHidden)).toBe(false);
  });
});

describe('what the review of #218 found', () => {
  const a = blindRound();
  const detail = (analysis = a, viewerId: string | undefined = 'cy') =>
    cellDetail(analysis, 'x', 'rent', 'score', { vocabulary: vocabularyOf(analysis), viewer: { viewerId, now: NOW_OPEN } });
  /** `a` with one assertion of cell x/rent changed. */
  const with1 = (id: string, change: Record<string, unknown>) => ({
    ...a, cells: a.cells.map((c) => (c.alternativeId === 'x' ? { ...c, assertions: c.assertions.map((s) => (s.id === id ? { ...s, ...change } : s)) } : c)),
  }) as typeof a;

  it('does not link a hand the viewer may name to one they may not, in the panel or in the record', () => {
    // Ana (named, closed round) is replaced by the hidden scorer: shown as a replacement of nothing in particular.
    const analysis = with1('a-rent-ana', { supersededBy: 'a-rent-scorer' });
    const row = detail(analysis).assertions.find((x) => x.superseded && !x.authorHidden)!;
    expect(row.assertion.supersededBy).toBeUndefined();
    const scorer = activityRecord(analysis, { viewerId: 'cy', now: NOW_OPEN }).find((e) => e.value === 5)!;
    expect(scorer.kind).toBe('asserted');
    expect(scorer.previous).toBeUndefined();
    // And the other way round: a hidden assertion replaced by a named one.
    const back = with1('a-rent-ben-2', { authorId: 'ana', roundId: 'r0' });
    expect(detail(back).assertions.find((x) => x.superseded && x.authorHidden)!.assertion.supersededBy).toBeUndefined();
    expect(activityRecord(back, { viewerId: 'cy', now: NOW_OPEN }).find((e) => e.value === 4)!.kind).toBe('asserted');
  });

  it('does not let the description of the set count a hidden hand as someone already named', () => {
    const analysis = {
      ...with1('a-rent-ben', { authorId: 'ana-persona', supersededBy: undefined }),
      authors: [...a.authors, { id: 'ana-persona', displayName: 'Ana as buyer', kind: 'human' as const, principalId: 'ana' }],
    } as typeof a;
    const { set } = detail(analysis);
    expect(set.label).not.toMatch(/one person/);
    expect(set.principals).toBe(set.n);
    expect(set.independence).toBe('unknown');
    expect(leaks(set)).toEqual([]);
  });

  it('gives a hidden assertion\'s evidence stand-in ids, and drops what it hides', () => {
    const evidence = { id: 'ev-ben-survey', target: 'https://example.com/survey', stance: 'supports', sourceType: 'primary', derivedFrom: [] };
    const analysis = with1('a-rent-scorer', { evidence: [evidence] });
    const d = detail(analysis);
    const row = d.assertions.find((x) => x.assertion.id.startsWith('hidden-author:') && x.evidence.length > 0)!;
    expect(row.evidence[0]!.ref.id).toMatch(/^hidden-author:\d+:evidence-1$/);
    expect(gives(d)).not.toContain('ev-ben-survey');
  });

  it('keeps its stand-in ids apart from ids the document already uses', () => {
    const analysis = with1('a-rent-ana', { id: 'hidden-author:1' });
    const ids = detail(analysis).assertions.map((x) => x.assertion.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads a round\'s closing time with no zone as UTC, so it closes for every reader at once', () => {
    const analysis = { ...a, rounds: a.rounds.map((r) => (r.id === 'r1' ? { ...r, closedAt: '2026-09-20T00:00:00' } : r)) } as typeof a;
    const entries = (now: string) => activityRecord(analysis, { viewerId: 'cy', now }).filter((e) => e.round === 'Round one');
    expect(entries('2026-09-19T23:59:59Z').every((e) => e.whoHidden)).toBe(true);
    expect(entries('2026-09-20T00:00:00Z').every((e) => !e.whoHidden)).toBe(true);
  });

  it('does not take the anonymous reader for an author who is called anonymous', () => {
    // The view passes no viewer id for the anonymous identity; core, given none, hides every author of an open round.
    const withAnon = with1('a-rent-scorer', { authorId: 'anonymous' });
    const d = detail(withAnon, undefined);
    expect(d.assertions.filter((x) => x.authorHidden)).toHaveLength(3);
  });
});

describe('an edit made through editComment (#195)', () => {
  it('is the editor\u2019s edit, once each, and not a reply; an unnoted editedAt stays as the old kind of edit', () => {
    const base = blindRound();
    const editor = base.authors[0]!;
    const a = reopenThread(base, 't1', { id: 'reopen-1', by: editor, at: '2026-09-29T00:00:00Z' });
    const first = a.threads.find((x) => x.id === 't1')!.comments[0]!;
    const edited = editComment(a, 't1', first.id, { body: 'rephrased', id: 'edit-note-1', by: editor, at: '2026-09-30T00:00:00Z' });
    const mine = activityRecord(edited, { viewerId: 'cy', now: NOW_OPEN }).filter((e) => e.threadId === 't1' && e.kind === 'edited-comment');
    const noted = mine.find((e) => e.at === '2026-09-30T00:00:00Z')!;
    expect(noted.said).toMatch(/edited a comment.*quoted in the thread/);
    // A reply that only sounds like a note, or names a comment the thread lacks, is a reply.
    const sounds = replyToThread(a, 't1', { id: 'r2', at: '2026-09-30T00:00:00Z', body: 'Edited comment by mistake, sorry', author: editor });
    const forged = replyToThread(a, 't1', { id: 'r3', at: '2026-09-30T00:00:00Z', body: 'Edited comment "nope" by Dana', author: editor });
    for (const d of [sounds, forged]) {
      const kinds = activityRecord(d, { viewerId: 'cy', now: NOW_OPEN }).filter((e) => e.threadId === 't1' && e.at === '2026-09-30T00:00:00Z').map((e) => e.kind);
      expect(kinds).toEqual(['replied']);
    }
    expect(activityRecord(edited, { viewerId: 'cy', now: NOW_OPEN }).filter((e) => e.threadId === 't1' && e.kind === 'replied').length)
      .toBe(activityRecord(a, { viewerId: 'cy', now: NOW_OPEN }).filter((e) => e.threadId === 't1' && e.kind === 'replied').length);
  });
});
