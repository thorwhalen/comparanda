/**
 * Reorder (#92, ADR-0008, ADR-0027): the move menu, keyboard grab mode and
 * pointer drag produce identical orders and identical announcements; Escape
 * puts a held item back; focus stays on the moved header; seriation is an
 * action whose provenance is shown.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, type ViewState } from '../../src/core/view-state.js';
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
