/**
 * The activity record and the cell detail under an open anonymous round
 * (#107, ADR-0011 clause 7, ADR-0023): what moved and when is legible; who is
 * not, until the round closes; and nothing in what core hands a surface can
 * give the author away, from one enforcement point.
 */
import { describe, expect, it } from 'vitest';

import { activityRecord } from '../src/core/activity.js';
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
    expect(entries.find((e) => e.kind === 'edited-comment')!.said).toMatch(/the earlier wording is not kept/);
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
