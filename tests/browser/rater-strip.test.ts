/**
 * The rater dot strip, painted (#110, ADR-0024): dots only at occupied level
 * slots and none where a mean would be, filled for independent raters and a
 * ring for anything else, the exact multiset in the cell's words, and the
 * cell's width choosing dots, then the range bracket, then text alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Analysis } from '../../src/index.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
let el: HTMLElement;
let handle: MatrixHandle;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  handle = mountMatrix(el, { analysis: relocation, measure: 'score', encoding: 'disagreement' }, { encodings: createEncodingRegistry(SHIPPED_ENCODINGS) });
});
afterEach(() => {
  handle.destroy();
  el.remove();
});

const cellOf = (alt: string, crit: string) => {
  const td = Array.from(el.querySelectorAll<HTMLElement>('td[data-cell]')).find((c) => {
    const words = c.querySelector('.comparanda-sr')!.textContent!;
    return words.includes(label('criteria', crit)) && words.includes(label('alternatives', alt));
  });
  if (!td) throw new Error(`no cell ${alt}/${crit}`);
  return td;
};
const label = (axis: 'criteria' | 'alternatives', id: string) => relocation[axis].find((x) => x.id === id)!.label;
const shown = (node: Element) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none';

describe('the dot strip', () => {
  it('draws a dot at each assertion\'s level slot and nowhere else', () => {
    const svg = cellOf('lisbon', 'school-quality').querySelector<SVGSVGElement>('.comparanda-strip-dots')!; // 3 and 5 of 5 slots
    const slots = svg.viewBox.baseVal.width / 5;
    const at = Array.from(svg.querySelectorAll('circle')).map((c) => Number(c.getAttribute('cx')) / slots - 0.5);
    expect(at).toEqual([2, 4]);
  });

  it('stacks ties, so n is the number of dots', () => {
    const dots = cellOf('berlin', 'winter-daylight').querySelectorAll('.comparanda-strip-dots circle');
    expect(dots).toHaveLength(3);
    const xs = Array.from(dots).map((c) => c.getAttribute('cx'));
    expect(new Set(xs).size).toBe(2);
  });

  it('fills the dots of independent raters and rings the rest, whatever the colours', () => {
    const fill = (td: HTMLElement) => td.querySelector('.comparanda-strip-dots circle')!.getAttribute('fill');
    expect(fill(cellOf('berlin', 'winter-daylight'))).toBe('currentColor');
    expect(fill(cellOf('seoul', 'school-quality'))).toBe('none');
  });

  it('says the exact multiset after the value, and hides the drawing from a screen reader', () => {
    const td = cellOf('berlin', 'winter-daylight');
    expect(td.textContent).toContain('3 raters: 1, 1, 3.');
    expect(td.querySelector('.comparanda-strip-dots')!.getAttribute('aria-hidden')).toBe('true');
    expect(td.querySelector('.comparanda-strip-bracket')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws no strip for a cell with one assertion', () => {
    expect(cellOf('berlin', 'income-tax').querySelector('.comparanda-strip-box')).toBeNull();
  });

  it('gives way to the range bracket, then to the text alone, as the cell narrows', () => {
    const td = cellOf('lisbon', 'school-quality');
    const box = td.querySelector<HTMLElement>('.comparanda-strip-box')!;
    const dots = box.querySelector('.comparanda-strip-dots')!;
    const bracket = box.querySelector('.comparanda-strip-bracket')!;
    expect(shown(dots)).toBe(true);
    expect(shown(bracket)).toBe(false);
    box.style.inlineSize = '2.5em';
    expect([shown(dots), shown(bracket)]).toEqual([false, true]);
    box.style.inlineSize = '1em';
    expect([shown(dots), shown(bracket)]).toEqual([false, false]);
    expect(td.textContent).toContain('2 raters: 3, 5.');
  });

  it('marks the bracket at its ends and its modes, never between', () => {
    const bracket = cellOf('lisbon', 'school-quality').querySelector('.comparanda-strip-bracket')!;
    const triangles = Array.from(bracket.querySelectorAll('path')).filter((p) => p.getAttribute('fill') === 'currentColor');
    expect(triangles).toHaveLength(2); // modes 3 and 5; slot 4, where the mean is, is unmarked
  });
});
