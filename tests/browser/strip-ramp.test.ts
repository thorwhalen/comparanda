/**
 * The strip and the ramp (#258, ADR-0024): the ramp is the strip's narrowest
 * form, and one key switches between the two encodings, announced and
 * reported to the host.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import type { ViewState } from '../../src/core/view-state.js';
import {
  createEncodingRegistry, disagreement, disagreementSpread, mountMatrix, textOnly, type MatrixHandle,
} from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const encodings = createEncodingRegistry([textOnly, disagreement, disagreementSpread]);

let el: HTMLElement;
let handle: MatrixHandle | undefined;
beforeEach(() => { el = document.createElement('div'); document.body.append(el); });
afterEach(() => { handle?.destroy(); handle = undefined; el.remove(); });

const matrix = () => el.querySelector<HTMLElement>('.comparanda-matrix')!;

describe('the strip and the ramp', () => {
  it('draws the ramp as the strip\'s narrowest form, and says the index with A and n', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', encoding: 'disagreement' }, { encodings });
    const box = el.querySelector<HTMLElement>('.comparanda-strip-box')!;
    const ramp = box.querySelector<HTMLElement>('.comparanda-strip-ramp')!;
    expect(ramp.getAttribute('data-swatch')).toMatch(/^seq-[1-5]$/);
    expect(getComputedStyle(ramp).display).toBe('none');
    box.style.inlineSize = '1em';
    expect(getComputedStyle(ramp).display).toBe('block');
    expect(getComputedStyle(box.querySelector('.comparanda-strip-bracket')!).display).toBe('none');
    expect(box.closest('td')!.textContent).toMatch(/Disagreement \d\.\d\d \(A -?\d\.\d\d, n \d+\)/);
  });

  it('switches between the strip and the ramp with one key, announced, and tells the host', async () => {
    const seen: ViewState[] = [];
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', encoding: 'disagreement', onViewChange: (v) => seen.push(v) }, { encodings });
    expect(el.querySelector('.comparanda-keys')!.textContent).toMatch(/S switches between the rater dot strip and the disagreement ramp/);
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('s');
    expect(matrix().getAttribute('data-encoding')).toBe('disagreement-spread');
    expect(el.querySelector('[data-announce]')!.textContent).toMatch(/Showing disagreement as a ramp/);
    expect(seen.at(-1)!.encoding).toBe('disagreement-spread');
    await userEvent.keyboard('S');
    expect(matrix().getAttribute('data-encoding')).toBe('disagreement');
    expect(el.querySelector('[data-announce]')!.textContent).toMatch(/Showing the rater dot strip/);
  });

  it('offers no switch when the other form is not registered', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', encoding: 'disagreement' }, { encodings: createEncodingRegistry([textOnly, disagreement]) });
    expect(el.querySelector('.comparanda-keys')!.textContent).not.toMatch(/S switches/);
    el.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')!.focus();
    await userEvent.keyboard('s');
    expect(matrix().getAttribute('data-encoding')).toBe('disagreement');
  });
});
