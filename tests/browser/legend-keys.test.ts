/**
 * The legend's lines are keyed by sample and words, never by words alone (#208).
 *
 * An encoding may say one label for two colours -- a third party's, or a
 * shipped one before its labels name their criteria -- and lines keyed by the
 * label alone collide in Preact's diff. `preact/debug` reports a colliding key
 * as a console error, so this file loads it and fails on one.
 */
import 'preact/debug';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Analysis } from '../../src/core/schema/analysis.js';
import { createEncodingRegistry, defineEncoding, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);

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
  vi.restoreAllMocks();
});

describe('legend lines', () => {
  it('two colours under one label are two lines, with no key collision', () => {
    const twice = defineEncoding({
      id: 'one-label-two-colours', label: 'One label, two colours', texture: { channel: 'none', because: 'a test.' },
      prepare: () => ({
        legend: { title: 'Twice', entries: [{ swatch: 'seq-1', label: 'Same words' }, { swatch: 'seq-5', label: 'Same words' }], notes: [] },
        mark: () => ({}),
      }),
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = mountMatrix(el, { analysis: relocation, measure: 'score', encoding: twice.id }, { encodings: createEncodingRegistry([...SHIPPED_ENCODINGS, twice]) });
    // Re-render over the same lines, which is where colliding keys mis-diff.
    handle.update({ encoding: 'text-only' });
    handle.update({ encoding: twice.id });
    const collisions = errors.mock.calls.map((c) => String(c[0])).filter((m) => /same key/.test(m));
    expect(collisions).toEqual([]);
    const samples = Array.from(el.querySelectorAll<HTMLElement>('.comparanda-legend li .comparanda-swatch')).map((s) => s.dataset['swatch']);
    expect(samples).toEqual(['seq-1', 'seq-5']);
  });
});
