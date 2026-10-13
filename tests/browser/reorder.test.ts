/**
 * Reorder (#92, ADR-0008, ADR-0027): the move menu, keyboard grab mode and
 * pointer drag produce identical orders and identical announcements; Escape
 * puts a held item back; focus stays on the moved header; seriation is an
 * action whose provenance is shown.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, lockRun, setFilter, setGrouping, type ViewState } from '../../src/core/view-state.js';
import { arrangeToRevealStructure } from '../../src/core/reorder.js';
import { anonymousIdentity } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import languagesJson from '../../examples/languages.json';

const languages = Analysis.parse(languagesJson);
const crits = languages.criteria.map((c) => c.id);

let el: HTMLElement;
const handles: MatrixHandle[] = [];
let views: ViewState[] = [];
const mount = () => {
  views = [];
  handles.push(mountMatrix(el, {
    analysis: languages, measure: 'score', identity: anonymousIdentity({ id: 'dana', displayName: 'Dana' }),
    onViewChange: (v) => views.push(v),
  }, { arrange: arrangeToRevealStructure }));
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  for (const h of handles.splice(0)) h.destroy();
  el.remove();
});

const mountWith = (analysis: Analysis, view: ViewState) => {
  views = [];
  const h = mountMatrix(el, { analysis, measure: 'score', view, onViewChange: (v) => views.push(v) });
  handles.push(h);
  return h;
};
const header = (id: string) => el.querySelector<HTMLElement>(`th[data-entry="${id}"]`)!;
const said = () => el.querySelector('[data-announce]')!.textContent!.replace(/ $/, '');
const order = () => views.at(-1)!.criterionOrder.order;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Move the second criterion one later by each route; return the order and the sentence. */
const routes: Record<string, () => Promise<void>> = {
  'grab mode, arrow': async () => {
    header(crits[1]!).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowRight}');
  },
  'grab mode, Tab': async () => {
    header(crits[1]!).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Tab}');
  },
  'move menu': async () => {
    await userEvent.click(header(crits[1]!).querySelector('.comparanda-handle')!);
    const item = Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((x) => x.textContent === 'Move later')!;
    await userEvent.click(item);
  },
  'pointer drag': async () => {
    const handle = header(crits[1]!).querySelector<HTMLElement>('.comparanda-handle')!;
    // A real pointer is always over the viewport; the test's frame is short, so bring the headers into it.
    header(crits[2]!).scrollIntoView({ block: 'center', inline: 'center' });
    const from = handle.getBoundingClientRect();
    const target = header(crits[2]!).getBoundingClientRect();
    const at = (x: number, y: number) => ({ clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, isPrimary: true });
    handle.dispatchEvent(new PointerEvent('pointerdown', at(from.left + 2, from.top + 2)));
    window.dispatchEvent(new PointerEvent('pointermove', at(target.right - 3, target.top + target.height / 2)));
    window.dispatchEvent(new PointerEvent('pointerup', at(target.right - 3, target.top + target.height / 2)));
  },
};

describe('three routes, one result', () => {
  it('every route moves the same entry to the same place and says the same sentence', async () => {
    const results: Record<string, { order: string[]; said: string; by: unknown }> = {};
    for (const [name, run] of Object.entries(routes)) {
      mount();
      await tick(); // the identity resolves asynchronously; a move made before it would be anonymous
      await run();
      await tick();
      if (views.length === 0) throw new Error(`route ${name} changed nothing`);
      results[name] = { order: [...order()], said: said(), by: (views.at(-1)!.criterionOrder.provenance as { by?: string }).by };
      handles.pop()!.destroy();
    }
    const expected = [crits[0], crits[2], crits[1], ...crits.slice(3)];
    for (const [name, r] of Object.entries(results)) {
      expect(r.order, name).toEqual(expected);
      expect(r.said, name).toBe(results['move menu']!.said);
      expect(r.by, name).toBe('dana');
    }
    expect(results['move menu']!.said).toMatch(/moved to column 3 of \d+, after /);
  });
});

describe('grab mode', () => {
  it('announces the pick-up, keeps focus on the moved header, and puts it down', async () => {
    mount();
    header(crits[0]!).focus();
    await userEvent.keyboard(' ');
    expect(said()).toMatch(/^Picked up /);
    expect(header(crits[0]!).getAttribute('data-grabbed')).toBe('true');
    await userEvent.keyboard('{End}');
    expect(order().at(-1)).toBe(crits[0]);
    expect(document.activeElement).toBe(header(crits[0]!));
    await userEvent.keyboard(' ');
    expect(said()).toMatch(/^Put down: /);
    expect(header(crits[0]!).hasAttribute('data-grabbed')).toBe(false);
  });

  it('Escape restores the order it was picked up from', async () => {
    mount();
    header(crits[1]!).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    expect(order()).not.toEqual(crits);
    await userEvent.keyboard('{Escape}');
    expect(order()).toEqual(crits);
    expect(said()).toMatch(/^Move cancelled: .*where it was\.$/);
    expect(document.activeElement).toBe(header(crits[1]!));
  });

  it('a row header moves with Up and Down', async () => {
    mount();
    const alts = languages.alternatives.map((a) => a.id);
    header(alts[0]!).focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowDown}');
    expect(views.at(-1)!.alternativeOrder.order.slice(0, 2)).toEqual([alts[1], alts[0]]);
    expect(said()).toMatch(/row 2 of/);
  });
});

describe('the move menu', () => {
  it('Shift+F10 opens it on the first item; Escape closes it back to the header', async () => {
    mount();
    header(crits[2]!).focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    const menu = el.querySelector('[role="menu"]')!;
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    expect(menu.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' '))
      .toBe(`Move ${languages.criteria[2]!.label}`);
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(header(crits[2]!));
  });

  it('offers "before" every other entry, and leaves the grid one tab stop', async () => {
    mount();
    await userEvent.click(header(crits[0]!).querySelector('.comparanda-handle')!);
    const items = Array.from(el.querySelectorAll('[role="menuitem"]')).map((x) => x.textContent);
    expect(items.slice(0, 4)).toEqual(['Move to start', 'Move earlier', 'Move later', 'Move to end']);
    expect(items.filter((t) => t!.startsWith('Move before'))).toHaveLength(crits.length - 2);
    expect(Array.from(el.querySelectorAll<HTMLElement>('[role="grid"] *')).filter((n) => n.tabIndex >= 0)).toHaveLength(1);
  });
});

describe('seriation as an action', () => {
  it('arranges an axis, shows how, announces politely, and leaves focus where it was', async () => {
    mount();
    const line = el.querySelector('[data-order="alternatives"]')!;
    expect(line.textContent).toMatch(/in the order the analysis gives them/);
    const button = line.querySelector('button')!;
    await userEvent.click(button);
    expect(views.at(-1)!.alternativeOrder.provenance.kind).toBe('seriated');
    expect(el.querySelector('[data-order="alternatives"]')!.textContent).toMatch(/arranged to put similar ones next to each other/);
    expect(said()).toMatch(/arranged to reveal structure/);
    expect(el.querySelector('[data-announce]')!.getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(el.querySelector('[data-order="alternatives"] button'));
  });
});

describe('review findings', () => {
  const grabAnd = async (id: string, ...keys: string[]) => {
    header(id).focus();
    await userEvent.keyboard(' ');
    for (const k of keys) await userEvent.keyboard(k);
  };

  it('a locked run steps as one, and an entry steps past a whole run', async () => {
    const locked = lockRun(initialViewState(languages), 'criteria', [crits[1]!, crits[2]!]);
    mountWith(languages, locked);
    await grabAnd(crits[1]!, '{ArrowRight}');
    expect(order().slice(0, 4)).toEqual([crits[0], crits[3], crits[1], crits[2]]);
    expect(said()).not.toMatch(/not moved|cannot/i);
    handles.pop()!.destroy();
    mountWith(languages, locked);
    await grabAnd(crits[0]!, '{ArrowRight}');
    expect(order().slice(0, 3)).toEqual([crits[1], crits[2], crits[0]]);
  });

  it('counts only what is shown: a hidden entry is never named or counted', async () => {
    const hidden = crits.at(-1)!;
    mountWith(languages, setFilter(initialViewState(languages), { hiddenCriteria: [hidden] }));
    await grabAnd(crits[0]!, '{End}');
    expect(said()).toMatch(new RegExp(`column ${crits.length - 1} of ${crits.length - 1}`));
    expect(said()).not.toContain(languages.criteria.at(-1)!.label);
  });

  it('on a banded axis a step stays in its band, and saying "moved" means it moved', async () => {
    const relocation = Analysis.parse((await import('../../examples/relocation.json')).default);
    const groups = relocation.groups.filter((g) => g.axis === 'alternatives').map((g) => g.id);
    mountWith(relocation, setGrouping(initialViewState(relocation), 'alternatives', groups));
    const firstOfSecondBand = el.querySelectorAll<HTMLElement>('tbody')[1]!.querySelector<HTMLElement>('th[data-entry]')!;
    const id = firstOfSecondBand.getAttribute('data-entry')!;
    await grabAnd(id, '{ArrowUp}');
    expect(said()).toMatch(/is already row 1 of/);
    expect(views.filter((v) => v.alternativeOrder.provenance.kind === 'manual')).toHaveLength(0);
  });

  it('Escape restores only the held axis, keeping a host change to the other', async () => {
    const base = initialViewState(languages);
    const h = mountWith(languages, base);
    await grabAnd(crits[0]!, '{ArrowRight}');
    const reversed = [...base.alternativeOrder.order].reverse();
    h.update({ view: { ...views.at(-1)!, alternativeOrder: { ...base.alternativeOrder, order: reversed } } });
    header(crits[0]!).focus();
    await userEvent.keyboard('{Escape}');
    expect(views.at(-1)!.alternativeOrder.order).toEqual(reversed);
  });

  it('focus leaving the grid puts a held header down', async () => {
    mountWith(languages, initialViewState(languages));
    const outside = document.createElement('button');
    document.body.append(outside);
    await grabAnd(crits[0]!);
    outside.focus();
    await tick();
    await tick();
    expect(header(crits[0]!).hasAttribute('data-grabbed')).toBe(false);
    outside.remove();
  });

  it('the menu lets focus go where the reader sent it, and its own handle closes it', async () => {
    mountWith(languages, initialViewState(languages));
    const input = document.createElement('input');
    document.body.append(input);
    const handle = header(crits[0]!).querySelector<HTMLElement>('.comparanda-handle')!;
    await userEvent.click(handle);
    await userEvent.click(input);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    await userEvent.click(handle);
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    await userEvent.click(handle);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    input.remove();
  });
});
