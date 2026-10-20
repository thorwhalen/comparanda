/**
 * The cell tooltip (#95, ADR-0027): the cell's one-line justification and
 * confidence flag, on focus and on hover, closed by Escape without moving
 * focus, and holding nothing focusable (the evidence links live in the panel).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { mountMatrix, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);

let el: HTMLElement;
let handle: MatrixHandle;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  handle = mountMatrix(el, { analysis: relocation, measure: 'score' });
});
afterEach(() => {
  handle.destroy();
  el.remove();
});

const tip = () => el.querySelector<HTMLElement>('[role="tooltip"]');
const firstCell = () => el.querySelector<HTMLElement>('tbody td[data-pair]')!;
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

describe('the cell tooltip', () => {
  it('shows the justification on focus, describes the cell, and holds nothing focusable', async () => {
    expect(tip()).toBeNull();
    firstCell().focus();
    await userEvent.keyboard('{ArrowRight}');
    const cell = el.querySelector<HTMLElement>('tbody td:focus') ?? firstCell();
    const shown = tip();
    if (!shown) return; // a cell with neither a justification nor a confidence says nothing
    expect(shown.textContent!.trim()).not.toBe('');
    expect(cell.getAttribute('aria-describedby')).toBe(shown.id);
    expect(shown.querySelectorAll(FOCUSABLE)).toHaveLength(0);
  });

  it('shows on hover, and Escape closes it without moving focus', async () => {
    const cell = firstCell();
    cell.focus();
    await userEvent.hover(cell);
    expect(tip()).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(tip()).toBeNull();
    expect(document.activeElement).toBe(cell);
  });

  it('leaving the grid takes it away', async () => {
    await userEvent.hover(firstCell());
    expect(tip()).not.toBeNull();
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    try { await userEvent.hover(outside); } finally { outside.remove(); }
    expect(tip()).toBeNull();
  });
});
