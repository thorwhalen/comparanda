/**
 * "Group with…" in the move menu (#279, ADR-0027): an entry joins a group,
 * written through the source and announced; refused, with its reason, where
 * there is no source or the host says no, never simply missing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from '@vitest/browser/context';

import { Analysis } from '../../src/core/schema/analysis.js';
import { initialViewState, setFocus } from '../../src/core/view-state.js';
import { inMemoryAnalysisSource } from '../../src/store/index.js';
import { mountMatrix, type MatrixHandle, type MountMatrixProps } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
let el: HTMLElement;
let handle: MatrixHandle | undefined;
const mount = (props: Partial<MountMatrixProps> = {}) => {
  handle = mountMatrix(el, { analysis: relocation, measure: 'score', view: setFocus(initialViewState(relocation), { alternativeId: 'montreal' }), ...props });
};
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  handle?.destroy();
  el.remove();
});

const openMenu = async () => {
  el.querySelector<HTMLElement>('th[data-entry="montreal"]')!.focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  return Array.from(el.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
};
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('Group with…', () => {
  it('offers the live groups the entry is not in, and joins one through the source, said', async () => {
    const source = inMemoryAnalysisSource(relocation);
    mount({ source });
    const items = await openMenu();
    const groups = items.map((i) => i.textContent).filter((t) => t!.startsWith('Group with'));
    expect(groups).toEqual(['Group with Europe', 'Group with Asia']);
    const europe = items.find((i) => i.textContent === 'Group with Europe')!;
    europe.focus();
    await userEvent.keyboard('{Enter}');
    await settled();
    expect((await source.getOne(relocation.id))!.alternatives.find((a) => a.id === 'montreal')!.groupIds).toEqual(['g-americas', 'g-europe']);
    expect(el.querySelector('[data-announce]')!.textContent!.trim()).toBe('Montreal is now in Europe.');
  });

  it('without a source, says it is not possible here, and why, rather than leaving it out', async () => {
    mount();
    const items = await openMenu();
    const refused = items.find((i) => i.textContent!.startsWith('Group with'))!;
    expect(refused.textContent).toMatch(/^Group with… is not possible here: .+/);
    expect(refused.getAttribute('aria-disabled')).toBe('true');
    // Choosing it does nothing: the menu stays.
    refused.focus();
    await userEvent.keyboard('{Enter}');
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('asks the host, and says its refusal', async () => {
    mount({ source: inMemoryAnalysisSource(relocation), authorize: () => ({ enabled: false, reason: 'only the owner regroups.' }) });
    const items = await openMenu();
    expect(items.find((i) => i.textContent!.startsWith('Group with'))!.textContent).toBe('Group with… is not possible here: only the owner regroups.');
  });
});
