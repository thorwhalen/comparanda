/**
 * Authorship under an open anonymous round, in every surface the view draws
 * (#107, ADR-0023): the detail panel, the matrix around it, and the live
 * regions are read as a browser built them, for a viewer the round hides the
 * authors from, for one of the authors, and after the round closes. The
 * enforcement is core's (`cellDetail`, `activityRecord`); this is the proof that
 * nothing the view adds goes round it.
 */
import { userEvent } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anonymousIdentity } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import { BLIND_SECRETS, blindRound, NOW_CLOSED, NOW_OPEN } from '../fixtures/blind-round.js';

const analysis = blindRound();
const closed = { ...analysis, rounds: analysis.rounds.map((r) => (r.id === 'r1' ? { ...r, closedAt: '2026-09-20T00:00:00Z' } : r)) };

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  el.remove();
});

/** Open the panel on the cell the three raters scored, and return everything the page now shows of it, markup and attributes included. */
async function openCell(props: Parameters<typeof mountMatrix>[1]) {
  handle = mountMatrix(el, props);
  await new Promise((r) => setTimeout(r, 0)); // the identity resolves asynchronously, and redraws
  const cell = el.querySelector<HTMLElement>('td[data-cell="1:1"]')!;
  cell.focus();
  await userEvent.keyboard('{Enter}');
  expect(el.querySelector('[role="complementary"]')).not.toBeNull();
  return el.innerHTML;
}

describe('an open anonymous round, in the panel', () => {
  it('shows what each rater said and when, and no one\'s name, id, persona or procedure', async () => {
    const html = await openCell({ analysis, measure: 'score', viewer: { viewerId: 'cy', now: NOW_OPEN } });
    for (const secret of BLIND_SECRETS) expect(html, secret).not.toContain(secret);
    // Four assertions are listed; three say their author is hidden, the warm-up one is named.
    expect(el.querySelectorAll('[data-assertion]')).toHaveLength(4);
    expect(el.textContent!.match(/Author hidden until the round closes/g)).toHaveLength(3);
    expect(el.textContent).toContain('Ana Lopez');
    expect(el.textContent).toContain('Revised after the survey.');
    expect(el.textContent).toContain('2026-09-05T10:00:00Z');
  });

  it('says who to the author of one, as themselves and as their persona, and to no one else', async () => {
    const own = await openCell({ analysis, measure: 'score', viewer: { viewerId: 'ben-as-buyer', now: NOW_OPEN } });
    expect(own).toContain('Ben Rivera');
    expect(own).not.toContain('Scorer-9');
    expect(el.textContent!.match(/Author hidden until the round closes/g)).toHaveLength(1);
  });

  it('says who to everyone once the round has closed', async () => {
    const html = await openCell({ analysis: closed, measure: 'score', viewer: { viewerId: 'cy', now: NOW_CLOSED } });
    expect(html).toContain('Ben Rivera');
    expect(html).toContain('Scorer-9');
    expect(el.textContent).not.toContain('Author hidden');
  });
});

describe('mountMatrix says who is looking when the host does not', () => {
  it('an outside reader, by default, is not told the authors of an open round', async () => {
    const html = await openCell({ analysis, measure: 'score' });
    for (const secret of BLIND_SECRETS) expect(html, secret).not.toContain(secret);
  });

  it('the identity the host gives is the viewer: its own assertions are shown to it', async () => {
    await openCell({ analysis, measure: 'score', identity: anonymousIdentity({ id: 'ben', displayName: 'Ben Rivera' }) });
    expect(el.textContent).toContain('Ben Rivera');
    expect(el.textContent!.match(/Author hidden until the round closes/g)).toHaveLength(1);
  });

  it('and the host\'s viewer, when it gives one, is the one used', async () => {
    const html = await openCell({ analysis, measure: 'score', identity: anonymousIdentity({ id: 'ben' }), viewer: { viewerId: 'cy', now: NOW_OPEN } });
    expect(html).not.toContain('Ben Rivera');
  });
});

describe('who is looking changes while the panel is open (review of #218)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** An identity that answers when told to: the host's sign-in finishing after the page is up. */
  function laterIdentity(id: string) {
    let resolve!: () => void;
    const answer = new Promise<void>((r) => { resolve = r; });
    const me = anonymousIdentity({ id, displayName: 'Ben Rivera' });
    return { identity: { ...me, current: async () => { await answer; return me.current(); } }, signIn: resolve };
  }

  it('shows the reader their own authorship when their identity arrives after the panel is up, and not before', async () => {
    const { identity, signIn } = laterIdentity('ben');
    const before = await openCell({ analysis, measure: 'score', identity });
    expect(before).not.toContain('Ben Rivera');
    signIn();
    await tick();
    await tick();
    expect(el.innerHTML).toContain('Ben Rivera');
  });

  it('takes their own authorship away again when the identity is swapped for another reader\'s', async () => {
    const own = await openCell({ analysis, measure: 'score', identity: anonymousIdentity({ id: 'ben', displayName: 'Ben Rivera' }) });
    expect(own).toContain('Ben Rivera');
    handle!.update({ identity: anonymousIdentity({ id: 'cy' }) });
    await tick();
    expect(el.innerHTML).not.toContain('Ben Rivera');
    // And to nobody known (the identity cleared), the same.
    handle!.update({ identity: anonymousIdentity({ id: 'ben', displayName: 'Ben Rivera' }) });
    await tick();
    expect(el.innerHTML).toContain('Ben Rivera');
    handle!.update({ identity: anonymousIdentity() });
    await tick();
    expect(el.innerHTML).not.toContain('Ben Rivera');
  });

  it('does not take the anonymous reader for an author who is called anonymous', async () => {
    const odd = { ...analysis, authors: [...analysis.authors, { id: 'anonymous', displayName: 'Anon Author', kind: 'human' as const }], cells: analysis.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => (s.id === 'a-rent-scorer' ? { ...s, authorId: 'anonymous' } : s)) })) } as typeof analysis;
    const html = await openCell({ analysis: odd, measure: 'score' });
    expect(html).not.toContain('Anon Author');
  });
});
