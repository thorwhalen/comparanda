/**
 * `mountMatrix(el, props) => { update, destroy }` (#88, ADR-0017 clause 5).
 *
 * Done when mounting, updating and destroying are testable in isolation, and
 * destroy leaves no listeners or timers behind. In a real browser because the
 * contract is about a DOM element; the component itself is a pure function and
 * is observed here through the `component` seam where its props are the point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';

import { Analysis, vocabularyOf } from '../../src/core/schema/analysis.js';
import { inMemoryAnalysisSource, type AnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle, type MatrixViewProps } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const languages = Analysis.parse(languagesJson);

/** A source that counts its live subscriptions: the listeners destroy must leave behind is zero. */
function counted(source: AnalysisSource) {
  let live = 0;
  const wrapped: AnalysisSource = {
    ...source,
    subscribe(listener) {
      live += 1;
      const off = source.subscribe!(listener);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        live -= 1;
        off();
      };
    },
  };
  return { source: wrapped, live: () => live };
}

/** Props as the component last received them. */
function spy() {
  const seen: MatrixViewProps[] = [];
  const component = (p: MatrixViewProps) => {
    seen.push(p);
    return h('p', null, p.analysis.subject.question);
  };
  return { component, last: () => seen.at(-1)!, renders: () => seen.length };
}

let el: HTMLElement;
const handles: MatrixHandle[] = [];
const mount = (...args: Parameters<typeof mountMatrix>) => {
  const handle = mountMatrix(...args);
  handles.push(handle);
  return handle;
};

beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  el.remove();
});

describe('mounting', () => {
  it('renders the messy fixture with every cell saying something', () => {
    mount(el, { analysis: relocation, measure: 'score' });
    expect(el.querySelector('caption')?.textContent).toBe(relocation.subject.question);
    expect(el.querySelectorAll('thead th')).toHaveLength(relocation.criteria.length + 1);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(relocation.alternatives.length);
    const cells = Array.from(el.querySelectorAll("tbody td"));
    expect(cells).toHaveLength(relocation.alternatives.length * relocation.criteria.length);
    for (const td of cells) expect(td.textContent?.trim()).not.toBe('');
  });

  it('reads a blank through the vocabulary, never as a code or nothing', () => {
    mount(el, { analysis: relocation, measure: 'score' });
    const text = el.textContent ?? '';
    const means = vocabularyOf(relocation).means('not-assessed');
    expect(means).toBeTruthy();
    // The messy fixture has blanks; at least one is read as the vocabulary words it.
    const vocab = vocabularyOf(relocation);
    const anyMeans = relocation.criteria.some((c) =>
      vocab.declarationsFor(c.id).some((d) => d.means && text.includes(d.means))) || text.includes(means!);
    expect(anyMeans).toBe(true);
  });

  it('refuses something that is not an element, and props that are not an analysis, by name', () => {
    expect(() => mountMatrix(null as unknown as Element, { analysis: relocation, measure: 'score' }))
      .toThrow(/DOM element/);
    expect(() => mountMatrix(el, { analysis: {} as Analysis, measure: 'score' })).toThrow(/props\.analysis/);
    expect(() => mountMatrix(el, { analysis: relocation, measure: '' })).toThrow(/props\.measure/);
    expect(el.childNodes).toHaveLength(0);
  });

  it('refuses a second matrix on an element that holds one, and allows one after destroy', () => {
    const first = mount(el, { analysis: relocation, measure: 'score' });
    expect(() => mountMatrix(el, { analysis: languages, measure: 'score' })).toThrow(/already holds a matrix/);
    first.destroy();
    mount(el, { analysis: languages, measure: 'score' });
    expect(el.querySelector('caption')?.textContent).toBe(languages.subject.question);
  });

  it('a mount whose first render throws holds nothing: no tree, no subscription, no claim', () => {
    const { source, live } = counted(inMemoryAnalysisSource(relocation));
    const broken = () => { throw new Error('render failed'); };
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'score', source }, { component: broken }))
      .toThrow('render failed');
    expect(live()).toBe(0);
    expect(el.childNodes).toHaveLength(0);
    mount(el, { analysis: relocation, measure: 'score' });
  });

  it('says so when asked for an encoding this build does not register, and still shows the values', () => {
    mount(el, { analysis: relocation, measure: 'score', encoding: 'value' });
    expect(el.querySelector('[role="note"]')?.textContent).toMatch(/"value" encoding is not available/);
    expect(el.querySelectorAll('tbody td').length).toBeGreaterThan(0);
  });
});

describe('updating', () => {
  it('re-renders with the props changed and keeps the ones not given', () => {
    const s = spy();
    const handle = mount(el, { analysis: relocation, measure: 'score', encoding: 'text-only' }, { component: s.component });
    handle.update({ analysis: languages });
    expect(el.textContent).toBe(languages.subject.question);
    expect(s.last().measure).toBe('score');
    expect(s.last().encoding).toBe('text-only');
  });

  it('clears an optional prop given as undefined, and refuses to clear a required one', () => {
    const s = spy();
    const standing = () => ({ status: 'unchecked' }) as never;
    const handle = mount(el, { analysis: relocation, measure: 'score', standing }, { component: s.component });
    expect(s.last().standing).toBe(standing);
    handle.update({ standing: undefined });
    expect(s.last().standing).toBeUndefined();
    const before = s.renders();
    expect(() => handle.update({ measure: undefined })).toThrow(/props\.measure/);
    expect(() => handle.update({ analysis: undefined })).toThrow(/props\.analysis/);
    // A refused update changes nothing: the next good one still has the old measure.
    expect(s.renders()).toBe(before);
    handle.update({});
    expect(s.last().measure).toBe('score');
  });

  it('refuses an update after destroy', () => {
    const handle = mount(el, { analysis: relocation, measure: 'score' });
    handle.destroy();
    expect(() => handle.update({ measure: 'confidence' })).toThrow(/destroyed/);
    expect(el.childNodes).toHaveLength(0);
  });
});

describe('following a source', () => {
  const retitle = (source: AnalysisSource, question: string) =>
    source.update(relocation.id, { subject: { ...relocation.subject, question } });

  it('re-renders on each write to the analysis', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount(el, { analysis: relocation, measure: 'score', source });
    await retitle(source, 'Where should the team move?');
    expect(el.querySelector('caption')?.textContent).toBe('Where should the team move?');
  });

  it('keeps the document a source delivered across an update that does not name one', async () => {
    const source = inMemoryAnalysisSource(relocation);
    const handle = mount(el, { analysis: relocation, measure: 'score', source });
    await retitle(source, 'Moved?');
    handle.update({ encoding: 'text-only' });
    expect(el.querySelector('caption')?.textContent).toBe('Moved?');
  });

  it('stops hearing a source swapped out by update, and hears the new one', async () => {
    const a = counted(inMemoryAnalysisSource(relocation));
    const b = counted(inMemoryAnalysisSource(relocation));
    const handle = mount(el, { analysis: relocation, measure: 'score', source: a.source });
    handle.update({ source: b.source, analysis: structuredClone(relocation) });
    expect([a.live(), b.live()]).toEqual([0, 1]);
    await retitle(a.source, 'From the old source');
    expect(el.querySelector('caption')?.textContent).toBe(relocation.subject.question);
    await retitle(b.source, 'From the new source');
    expect(el.querySelector('caption')?.textContent).toBe('From the new source');
    handle.update({ source: undefined });
    expect(b.live()).toBe(0);
  });

  it('ignores a write to another document', () => {
    const s = spy();
    let deliver: ((e: never) => void) | undefined;
    const source = { ...inMemoryAnalysisSource(relocation), subscribe: (l: (e: never) => void) => { deliver = l; return () => {}; } };
    mount(el, { analysis: relocation, measure: 'score', source }, { component: s.component });
    const before = s.renders();
    deliver!({ type: 'updated', id: 'another', item: languages } as never);
    expect(s.renders()).toBe(before);
  });
});

describe('edits come only from editAffordances over the source', () => {
  const cell = relocation.cells[0]!;
  const assertHere = (p: MatrixViewProps) => p.affordances.assert(cell.alternativeId, cell.criterionId, cell.measure);

  it('with no source, every write is refused with a reason', () => {
    const s = spy();
    mount(el, { analysis: relocation, measure: 'score' }, { component: s.component });
    const a = assertHere(s.last());
    expect(a.enabled).toBe(false);
    expect(a.reason).toMatch(/does not accept updates/);
    expect(s.last().affordances.comment().enabled).toBe(false);
    // A malformed act is a caller's mistake with or without a source.
    expect(() => s.last().affordances.comment(undefined, 'delete' as never)).toThrow(/start/);
  });

  it('flips with the source capability', () => {
    const s = spy();
    const handle = mount(el, { analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation) }, { component: s.component });
    expect(assertHere(s.last()).enabled).toBe(true);
    handle.update({ source: inMemoryAnalysisSource(relocation, { canUpdate: false }), analysis: structuredClone(relocation) });
    expect(assertHere(s.last())).toMatchObject({ enabled: false, reason: expect.stringMatching(/does not accept updates/) });
  });

  it("consults the host's authorize after the source", () => {
    const s = spy();
    mount(el, {
      analysis: relocation, measure: 'score', source: inMemoryAnalysisSource(relocation),
      authorize: () => ({ enabled: false, reason: 'Only the panel chair may score.' }),
    }, { component: s.component });
    expect(assertHere(s.last())).toEqual({ enabled: false, reason: 'Only the panel chair may score.' });
  });

  it('rebuilds them from the document the source delivers', async () => {
    const s = spy();
    const source = inMemoryAnalysisSource(relocation);
    mount(el, { analysis: relocation, measure: 'score', source }, { component: s.component });
    expect(assertHere(s.last()).enabled).toBe(true);
    await source.update(relocation.id, { locked: true });
    expect(assertHere(s.last()).enabled).toBe(false);
  });
});

describe('destroying', () => {
  it('empties the element, unsubscribes, and is safe to call twice', async () => {
    const { source, live } = counted(inMemoryAnalysisSource(relocation));
    const handle = mount(el, { analysis: relocation, measure: 'score', source });
    expect(live()).toBe(1);
    handle.destroy();
    handle.destroy();
    expect(live()).toBe(0);
    expect(el.childNodes).toHaveLength(0);
    // A write after destroy reaches nobody and renders nothing.
    await source.update(relocation.id, { subject: { ...relocation.subject, question: 'After' } });
    expect(el.childNodes).toHaveLength(0);
  });

  it('leaves no listener or timer behind', async () => {
    const targets = [window, document, el] as const;
    const added = targets.map((t) => vi.spyOn(t, 'addEventListener'));
    const removed = targets.map((t) => vi.spyOn(t, 'removeEventListener'));
    const timers = new Set<unknown>();
    const track = <A extends unknown[]>(set: (...a: A) => unknown) => (...a: A) => { const id = set(...a); timers.add(id); return id; };
    const untrack = <A extends unknown[]>(clear: (id: never, ...a: A) => void) => (id: never, ...a: A) => { timers.delete(id); clear(id, ...a); };
    const original = {
      setTimeout: window.setTimeout, setInterval: window.setInterval, requestAnimationFrame: window.requestAnimationFrame,
      clearTimeout: window.clearTimeout, clearInterval: window.clearInterval, cancelAnimationFrame: window.cancelAnimationFrame,
    };
    const bind = <F extends (...a: never[]) => unknown>(f: F) => f.bind(window) as F;
    Object.assign(window, {
      setTimeout: track(bind(original.setTimeout)), setInterval: track(bind(original.setInterval)),
      requestAnimationFrame: track(bind(original.requestAnimationFrame)),
      clearTimeout: untrack(bind(original.clearTimeout)), clearInterval: untrack(bind(original.clearInterval)),
      cancelAnimationFrame: untrack(bind(original.cancelAnimationFrame)),
    });
    try {
      const { source, live } = counted(inMemoryAnalysisSource(relocation));
      const handle = mountMatrix(el, { analysis: relocation, measure: 'score', source });
      handle.update({ analysis: languages });
      handle.update({ analysis: relocation });
      await source.update(relocation.id, { subject: { ...relocation.subject, question: 'Again?' } });
      handle.destroy();

      expect(live()).toBe(0);
      expect(timers.size).toBe(0);
      targets.forEach((_, i) => {
        const key = (c: unknown[]) => `${String(c[0])}`;
        const adds = added[i]!.mock.calls.map(key).sort();
        const removes = removed[i]!.mock.calls.map(key).sort();
        expect(adds).toEqual(removes);
      });
    } finally {
      Object.assign(window, original);
      [...added, ...removed].forEach((m) => m.mockRestore());
    }
  });
});

describe('the adversarial review of #88', () => {
  const retitle = (source: AnalysisSource, question: string) =>
    source.update(relocation.id, { subject: { ...relocation.subject, question } });

  it('re-passing the same props (a wrapper re-rendering) keeps what the source wrote', async () => {
    const s = spy();
    const source = inMemoryAnalysisSource(relocation);
    const props = { analysis: relocation, measure: 'score', source };
    const handle = mount(el, props, { component: s.component });
    await source.update(relocation.id, { locked: true });
    handle.update(props, { replace: true });
    expect(s.last().analysis.locked).toBe(true);
    expect(s.last().affordances.assert('lisbon', 'rent', 'score').enabled).toBe(false);
  });

  it('replace clears every prop not given, including the source', () => {
    const { source, live } = counted(inMemoryAnalysisSource(relocation));
    const s = spy();
    const handle = mount(el, { analysis: relocation, measure: 'score', source, encoding: 'value' }, { component: s.component });
    handle.update({ analysis: relocation, measure: 'score' }, { replace: true });
    expect(live()).toBe(0);
    expect(s.last().encoding).toBe('text-only');
    expect(s.last().affordances.assert('lisbon', 'rent', 'score').enabled).toBe(false);
  });

  it('refuses a source it cannot follow', () => {
    const { subscribe: _, ...blind } = inMemoryAnalysisSource(relocation);
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'score', source: blind as AnalysisSource }))
      .toThrow(/subscribe/);
    expect(el.childNodes).toHaveLength(0);
  });

  it('an update whose render throws changes nothing: props, document and subscription come back', async () => {
    // Fails on the props it is given, as a real render does, so the rollback's render succeeds.
    const component = (p: MatrixViewProps) => {
      if (p.encoding === 'boom') throw new Error('render failed');
      return h('p', null, p.analysis.subject.question);
    };
    const a = counted(inMemoryAnalysisSource(relocation));
    const b = counted(inMemoryAnalysisSource(relocation));
    const handle = mount(el, { analysis: relocation, measure: 'score', source: a.source }, { component });
    expect(() => handle.update({ source: b.source, analysis: structuredClone(relocation), encoding: 'boom' }))
      .toThrow('render failed');
    expect([a.live(), b.live()]).toEqual([1, 0]);
    expect(el.textContent).toBe(relocation.subject.question);
    await retitle(a.source, 'Still following a');
    expect(el.textContent).toBe('Still following a');
    handle.update({});
  });

  it('a new source needs its document in the same update', async () => {
    const a = inMemoryAnalysisSource(relocation);
    const b = inMemoryAnalysisSource(relocation);
    const handle = mount(el, { analysis: relocation, measure: 'score', source: a });
    await retitle(a, 'Only in source a');
    expect(() => handle.update({ source: b })).toThrow(/in the same update/);
    expect(() => handle.update({ source: b, analysis: relocation })).toThrow(/in the same update/);
    handle.update({ source: b, analysis: await b.getOne(relocation.id) });
    expect(el.querySelector('caption')?.textContent).toBe(relocation.subject.question);
  });

  it('dropping the source keeps the document it delivered, read-only', async () => {
    const s = spy();
    const source = inMemoryAnalysisSource(relocation);
    const handle = mount(el, { analysis: relocation, measure: 'score', source }, { component: s.component });
    await retitle(source, 'Last known');
    handle.update({ source: undefined });
    expect(s.last().analysis.subject.question).toBe('Last known');
    expect(s.last().affordances.comment().enabled).toBe(false);
  });

  it('refuses a measure the analysis neither declares nor records', () => {
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'scroe' })).toThrow(/declares "score"/);
  });

  it('refuses a prop it does not know, at mount and on update', () => {
    expect(() => mountMatrix(el, { analysis: relocation, measure: 'score', measrue: 'x' } as never)).toThrow(/"measrue"/);
    const handle = mount(el, { analysis: relocation, measure: 'score' });
    expect(() => handle.update({ measrue: 'score' } as never)).toThrow(/"measrue"/);
  });

  it('a cell partly withheld from this reader says so, not that raters disagree', () => {
    const cell = relocation.cells.find((c) => c.assertions.length > 1 && c.assertions.some((x) => x.value !== undefined))!;
    const withheld = structuredClone(relocation);
    const target = withheld.cells.find((c) => c.alternativeId === cell.alternativeId && c.criterionId === cell.criterionId && c.measure === cell.measure)!;
    const first = target.assertions[0]!;
    delete (first as { value?: unknown }).value;
    Object.assign(first, { missing: { code: 'withheld' }, disclosure: { ...(first.disclosure ?? {}), withheldFromReader: true } });
    mount(el, { analysis: withheld, measure: cell.measure });
    expect(el.textContent).not.toMatch(/assertions disagree about whether a value exists/);
    expect(el.textContent).toMatch(/Partly withheld from you/);
  });
});

describe('the second review pass', () => {
  it('checks the measure against the document shown, which the source may have moved on to', async () => {
    const s = spy();
    const source = inMemoryAnalysisSource(relocation);
    const props = { analysis: relocation, measure: 'score', source };
    const handle = mount(el, props, { component: s.component });
    await source.update(relocation.id, { measures: [...relocation.measures, { name: 'confidence', label: 'Confidence' }] });
    handle.update({ ...props, measure: 'confidence' }, { replace: true });
    expect(s.last().measure).toBe('confidence');
  });

  it('a render that throws part-way through child components does not poison later renders', async () => {
    const Row = ({ i, encoding }: { i: number; encoding: string }) => {
      if (i === 2 && encoding === 'value') throw new Error('row failed');
      return h('li', null, String(i));
    };
    const component = (p: MatrixViewProps) =>
      h('ul', null, [0, 1, 2, 3].map((i) => h(Row, { i, encoding: p.encoding, key: `${p.encoding}-${i}` })));
    const source = inMemoryAnalysisSource(relocation);
    const handle = mount(el, { analysis: relocation, measure: 'score', source }, { component });
    expect(() => handle.update({ encoding: 'value' })).toThrow('row failed');
    expect(el.querySelectorAll('li')).toHaveLength(4);
    handle.update({ encoding: 'later' });
    expect(el.querySelectorAll('li')).toHaveLength(4);
    await source.update(relocation.id, { subject: { ...relocation.subject, question: 'Still renders?' } });
    expect(el.querySelectorAll('li')).toHaveLength(4);
  });
});

describe('the third review pass', () => {
  it('a rollback whose own render fails leaves a clean, empty element the next good render fills', () => {
    let broken = false;
    const Row = ({ i }: { i: number }) => {
      if (i === 2 && broken) throw new Error('row failed');
      return h('li', null, String(i));
    };
    const component = (p: MatrixViewProps) =>
      h('ul', null, [0, 1, 2, 3].map((i) => h(Row, { i, key: `${p.encoding}-${i}` })));
    const handle = mount(el, { analysis: relocation, measure: 'score' }, { component });
    broken = true; // something outside the props: old and new props both fail
    expect(() => handle.update({ encoding: 'value' })).toThrow('row failed');
    broken = false;
    handle.update({ encoding: 'later' });
    expect(el.querySelectorAll('li')).toHaveLength(4);
  });

  it('a source that drops the shown measure does not refuse re-renders of unchanged props', async () => {
    const two = { ...relocation, measures: [...relocation.measures, { name: 'confidence', label: 'Confidence' }] };
    const source = inMemoryAnalysisSource(two);
    const props = { analysis: two, measure: 'confidence', source };
    const handle = mount(el, props);
    await source.update(two.id, { measures: relocation.measures });
    expect(() => handle.update(props, { replace: true })).not.toThrow();
    expect(() => handle.update({ ...props, measure: 'scroe' }, { replace: true })).toThrow(/not a measure/);
  });
});
