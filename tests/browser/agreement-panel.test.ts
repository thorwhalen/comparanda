/**
 * The agreement panel (#253): per-criterion alpha with its interval and the
 * bands' source, no matrix-wide figure, nothing suppressed by a band; camps
 * named author by author, and their common ground and divisions listed in
 * words, apart from the disagreement glyph.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { agreement } from '../../src/core/analyses/agreement.js';
import { AgreementPanel, mountMatrix, type MatrixHandle } from '../../src/view/index.js';
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
});

const panel = () => el.querySelector<HTMLDetailsElement>('details[data-analysis="agreement"]');
const settled = () => new Promise((r) => setTimeout(r, 0));
async function openPanel() {
  await userEvent.click(panel()!.querySelector('summary')!);
  await settled();
}

describe('the agreement panel', () => {
  it('is drawn only when the composition root registers it', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' });
    expect(panel()).toBeNull();
  });

  it('is closed by default, and computes nothing until opened', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [AgreementPanel] });
    expect(panel()!.open).toBe(false);
    expect(panel()!.querySelector('table')).toBeNull();
  });

  it('lists every criterion the analysis computed, with its interval, band and source, and no matrix-wide figure', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [AgreementPanel] });
    await openPanel();
    const expected = agreement(relocation, { measure: 'score' });
    const rows = Array.from(panel()!.querySelectorAll('table[data-agreement] tbody tr'));
    // No band suppresses, warns on or excludes a criterion: every one computed is a row.
    expect(rows.map((r) => r.getAttribute('data-criterion'))).toEqual(expected.criteria.map((c) => c.criterionId));
    expect(panel()!.querySelector('table[data-agreement] tfoot')).toBeNull();
    expect(panel()!.querySelector('[data-band-source]')!.textContent).toMatch(/Krippendorff, Content Analysis/);
    expect(panel()!.textContent).toMatch(/no figure for the matrix as a whole/);
    for (const [i, c] of expected.criteria.entries()) {
      const cells = rows[i]!.querySelectorAll('td');
      expect(cells[0]!.textContent).toBe(c.alpha === undefined ? 'undefined' : c.alpha.toFixed(2));
    }
  });

  it('compares camps a person names, and lists common ground and divisions in words', async () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' }, { panels: [AgreementPanel] });
    await openPanel();
    expect(panel()!.querySelector('[data-consensus]')!.textContent).toMatch(/at least two camps/);
    const selects = Array.from(panel()!.querySelectorAll<HTMLSelectElement>('fieldset select'));
    // Personas are not offered: they count as their principal's camp.
    expect(selects.map((s) => s.id.split('-in-')[1])).not.toContain('ana:the-frugal-one');
    const ofAuthor = (id: string) => selects.find((s) => s.id.endsWith(`-in-${id}`))!;
    await userEvent.selectOptions(ofAuthor('ana'), '0');
    await userEvent.selectOptions(ofAuthor('ben'), '1');
    await settled();
    const consensus = panel()!.querySelector('[data-consensus]')!;
    expect(consensus.querySelector('table caption')!.textContent).toMatch(/criterion by criterion/);
    const sections = Array.from(consensus.querySelectorAll('[data-consensus-status]')).map((s) => s.getAttribute('data-consensus-status'));
    expect(sections.length).toBeGreaterThan(0);
    // Its own words, never the cell's disagreement glyph.
    expect(consensus.querySelector('svg, .comparanda-glyph')).toBeNull();
  });
});
