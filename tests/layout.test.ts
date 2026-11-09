/**
 * `matrixLayout` (#89): order, hiding, banding and orientation, in plain Node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { focusInLayout, hiddenOf, inShownOrder, matrixLayout, omittedBlocks, shownOf } from '../src/core/layout.js';
import { makeInapplicableBlocks, makeInapplicableDeclarations, makeInapplicability } from '../src/core/schema/groups.js';
import { Analysis } from '../src/core/schema/analysis.js';
import { applyOrder, initialViewState, setFilter, setGrouping, transpose, type ViewState } from '../src/core/view-state.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('matrixLayout', () => {
  it('lays out the document order with alternatives as rows by default', () => {
    const l = matrixLayout(relocation, initialViewState(relocation));
    expect(l.transposed).toBe(false);
    expect(l.rows.axis).toBe('alternatives');
    expect(ids(l.rows.entries)).toEqual(ids(relocation.alternatives));
    expect(ids(l.columns.entries)).toEqual(ids(relocation.criteria));
    expect(l.rows.bands).toBeUndefined();
  });

  it('swaps the axes when transposed, and nothing else', () => {
    const v = initialViewState(relocation);
    const l = matrixLayout(relocation, transpose(v));
    const plain = matrixLayout(relocation, v);
    expect(l.transposed).toBe(true);
    expect(l.rows).toEqual(plain.columns);
    expect(l.columns).toEqual(plain.rows);
  });

  it('follows the view order, drops ids the document no longer has, and shows ones the view never heard of', () => {
    const v = initialViewState(relocation);
    const stale: ViewState = { ...v, alternativeOrder: { ...v.alternativeOrder, order: ['seoul', 'gone', 'lisbon', 'seoul'] } };
    expect(ids(matrixLayout(relocation, stale).rows.entries)).toEqual(['seoul', 'lisbon', 'berlin', 'taipei', 'montreal']);
  });

  it('leaves out hidden and tombstoned entities', () => {
    const doc = structuredClone(relocation);
    doc.criteria.find((c) => c.id === 'rent')!.tombstoned = true;
    const v = initialViewState(relocation); // still orders the tombstoned one
    const hidden: ViewState = { ...v, filter: { hiddenAlternatives: ['berlin'], hiddenCriteria: ['climate-type'] } };
    const l = matrixLayout(doc, hidden);
    expect(ids(l.rows.entries)).not.toContain('berlin');
    expect(ids(l.columns.entries)).not.toContain('climate-type');
    expect(ids(l.columns.entries)).not.toContain('rent');
  });

  it('bands an axis by the chosen groups, in the order chosen, keeping axis order inside a band', () => {
    const v = setGrouping(initialViewState(relocation), 'alternatives', ['g-asia', 'g-europe']);
    const { rows } = matrixLayout(relocation, v);
    expect(rows.bands!.map((b) => b.groupId)).toEqual(['g-asia', 'g-europe', undefined]);
    expect(rows.bands!.map((b) => ids(b.entries))).toEqual([['taipei', 'seoul'], ['lisbon', 'berlin'], ['montreal']]);
    expect(rows.bands![0]!.label).toBe(relocation.groups.find((g) => g.id === 'g-asia')!.label);
    expect(rows.bands![2]!.label).toBeUndefined();
    expect(ids(rows.entries)).toEqual(['taipei', 'seoul', 'lisbon', 'berlin', 'montreal']);
  });

  it('puts a multi-homed entity in its first chosen group, and says which others it is in', () => {
    const doc = structuredClone(relocation);
    doc.alternatives.find((a) => a.id === 'berlin')!.groupIds = ['g-europe', 'g-asia'];
    const v = setGrouping(initialViewState(doc), 'alternatives', ['g-asia', 'g-europe']);
    const { rows } = matrixLayout(doc, v);
    const berlin = rows.entries.filter((e) => e.id === 'berlin');
    expect(berlin).toHaveLength(1);
    expect(rows.bands![0]!.entries.map((e) => e.id)).toContain('berlin');
    expect(berlin[0]!.alsoIn).toEqual(['g-europe']);
  });

  it('ignores a chosen group the document does not have, or has tombstoned', () => {
    const doc = structuredClone(relocation);
    doc.groups.find((g) => g.id === 'g-cost')!.tombstoned = true;
    const v = setGrouping(initialViewState(doc), 'criteria', ['g-cost', 'g-nowhere']);
    expect(matrixLayout(doc, v).columns.bands).toBeUndefined();
  });

  it('drops a band with nothing shown in it', () => {
    const v = setGrouping(initialViewState(relocation), 'alternatives', ['g-americas', 'g-asia']);
    const hidden: ViewState = { ...v, filter: { hiddenAlternatives: ['montreal'], hiddenCriteria: [] } };
    expect(matrixLayout(relocation, hidden).rows.bands!.map((b) => b.groupId)).toEqual(['g-asia', undefined]);
  });

  it('an axis with nothing shown has no bands', () => {
    const v = setGrouping(initialViewState(relocation), 'criteria', ['g-cost']);
    const all: ViewState = { ...v, filter: { hiddenAlternatives: [], hiddenCriteria: relocation.criteria.map((c) => c.id) } };
    const { columns } = matrixLayout(relocation, all);
    expect(columns.entries).toEqual([]);
    expect(columns.bands).toBeUndefined();
  });

  it('nested groups: a sub-group\'s members are its parent\'s, and the first chosen wins', () => {
    const doc = structuredClone(relocation);
    doc.groups.push({ id: 'g-iberia', label: 'Iberia', axis: 'alternatives', parentId: 'g-europe' });
    doc.alternatives.find((a) => a.id === 'lisbon')!.groupIds = ['g-iberia'];
    const parentFirst = matrixLayout(doc, setGrouping(initialViewState(doc), 'alternatives', ['g-europe', 'g-iberia'])).rows;
    expect(parentFirst.bands!.map((b) => b.groupId)).toEqual(['g-europe', undefined]);
    expect(parentFirst.entries.find((e) => e.id === 'lisbon')!.alsoIn).toEqual(['g-iberia']);
    const childFirst = matrixLayout(doc, setGrouping(initialViewState(doc), 'alternatives', ['g-iberia', 'g-europe'])).rows;
    expect(childFirst.bands!.map((b) => [b.groupId, ids(b.entries)])).toEqual([
      ['g-iberia', ['lisbon']], ['g-europe', ['berlin']], [undefined, ['taipei', 'seoul', 'montreal']],
    ]);
  });
});

describe('omittedBlocks (#93)', () => {
  const both = (v = initialViewState(relocation)) =>
    setGrouping(setGrouping(v, 'alternatives', ['g-europe', 'g-asia', 'g-americas']), 'criteria', ['g-eu', 'g-cost']);
  const blockOf = makeInapplicableBlocks(relocation);
  const at = (b: ReturnType<typeof omittedBlocks>[number]) => [b.rowBand.groupId, b.columnBand.groupId, b.rows, b.columns, b.cells];

  it('finds every band-by-band block of two cells or more whose every cell is declared inapplicable, with its span and reason', () => {
    const blocks = omittedBlocks(matrixLayout(relocation, both()), blockOf);
    // Spans index the layout's entries. The Americas' block is one cell (Montreal): that cell, not a block.
    expect(blocks.map(at)).toEqual([['g-asia', 'g-eu', { first: 2, last: 3 }, { first: 0, last: 0 }, 2]]);
    expect(blocks[0]!.reason).toBe('not an EU destination, so EU residency rules do not apply');
  });

  it('reads the same blocks, axes swapped, when transposed', () => {
    const blocks = omittedBlocks(matrixLayout(relocation, transpose(both())), blockOf);
    expect(blocks.map(at)).toEqual([['g-eu', 'g-asia', { first: 0, last: 0 }, { first: 2, last: 3 }, 2]]);
  });

  it('omits nothing unless both axes are banded, or when one cell of a block shows anything', () => {
    expect(omittedBlocks(matrixLayout(relocation, setGrouping(initialViewState(relocation), 'alternatives', ['g-asia'])), blockOf)).toEqual([]);
    // Seoul's cell is kept (a value, a thread, its own absence): the whole Asia block is drawn cell by cell.
    const keepSeoul = (alt: string, crit: string) => (alt === 'seoul' ? undefined : blockOf(alt, crit));
    expect(omittedBlocks(matrixLayout(relocation, both()), keepSeoul)).toEqual([]);
  });

  it('gives no reason when the declarations behind one block disagree', () => {
    // One band, "Far", holding Asia and the Americas, whose declarations give different reasons.
    const doc = structuredClone(relocation);
    doc.inapplicable[1]!.reason = 'another reason';
    doc.groups.push({ ...structuredClone(doc.groups.find((g) => g.id === 'g-asia')!), id: 'g-far', label: 'Far' });
    for (const alt of doc.alternatives) if (['taipei', 'seoul', 'montreal'].includes(alt.id)) alt.groupIds = [...alt.groupIds, 'g-far'];
    const v = setGrouping(setGrouping(initialViewState(doc), 'alternatives', ['g-far']), 'criteria', ['g-eu']);
    const [far] = omittedBlocks(matrixLayout(doc, v), makeInapplicableBlocks(doc));
    expect([far!.rowBand.groupId, far!.cells, far!.reason]).toEqual(['g-far', 3, undefined]);
  });

  it('gives the block its group pair, and none when the declarations behind it name different pairs (#303)', () => {
    expect(omittedBlocks(matrixLayout(relocation, both()), blockOf)[0]!.pair).toEqual(['g-asia', 'g-eu']);
    // A remainder band holding Asia and the Americas, each declared against EU, with the same reason: one reason, no one pair.
    const v = setGrouping(setGrouping(initialViewState(relocation), 'alternatives', ['g-europe']), 'criteria', ['g-eu']);
    const merged = omittedBlocks(matrixLayout(relocation, v), blockOf).find((b) => b.rowBand.groupId === undefined)!;
    expect([merged.cells, merged.reason, merged.pair]).toEqual([3, 'not an EU destination, so EU residency rules do not apply', undefined]);
    // Transposed, the same: the pair is the declarations', whichever axis the rows are.
    const t = omittedBlocks(matrixLayout(relocation, transpose(both())), blockOf)[0]!;
    expect(t.pair).toEqual(['g-asia', 'g-eu']);
  });

  it('takes the pair and reason of the declaration that covers the whole block, though groups overlap (#323)', () => {
    // Taipei is also an island, and "island x EU" is declared before "Asia x EU" with another reason: the first match differs by cell.
    const doc = structuredClone(relocation);
    doc.groups.push({ id: 'g-island', label: 'Islands', axis: 'alternatives' } as (typeof doc.groups)[number]);
    doc.alternatives.find((a) => a.id === 'taipei')!.groupIds.push('g-island');
    doc.inapplicable.unshift({ alternativeGroupId: 'g-island', criterionGroupId: 'g-eu', reason: 'islands have their own residency regime' });
    const layout = matrixLayout(doc, both(initialViewState(doc)));
    const asia = (blocks: ReturnType<typeof omittedBlocks>) => blocks.find((b) => b.rowBand.groupId === 'g-asia')!;

    // Without the list of declarations, the cells disagree: no pair, no reason.
    const first = asia(omittedBlocks(layout, makeInapplicableBlocks(doc)));
    expect([first.pair, first.reason]).toEqual([undefined, undefined]);

    // With them, the block is exactly the declaration that covers every cell of it.
    const covered = asia(omittedBlocks(layout, makeInapplicableBlocks(doc), { declarationsOf: makeInapplicableDeclarations(doc) }));
    expect([covered.pair, covered.reason]).toEqual([['g-asia', 'g-eu'], 'not an EU destination, so EU residency rules do not apply']);
    // Declaration order does not decide: listed the other way round, the same block reads the same.
    doc.inapplicable.reverse();
    const reversed = asia(omittedBlocks(matrixLayout(doc, both(initialViewState(doc))), makeInapplicableBlocks(doc), { declarationsOf: makeInapplicableDeclarations(doc) }));
    expect([reversed.pair, reversed.reason]).toEqual([covered.pair, covered.reason]);
  });

  it('makeInapplicability is the blocks reader, asked yes or no', () => {
    const yes = makeInapplicability(relocation);
    for (const alt of relocation.alternatives) for (const crit of relocation.criteria) {
      expect(yes(alt.id, crit.id)).toBe(blockOf(alt.id, crit.id) !== undefined);
    }
  });
});

describe('focusInLayout (#283)', () => {
  const hidden: ViewState = { ...initialViewState(relocation), filter: { hiddenAlternatives: ['seoul'], hiddenCriteria: ['rent'] } };
  const layout = matrixLayout(relocation, hidden);
  it('keeps what is shown, and drops what is not: a hidden row\'s cell becomes its column\'s header', () => {
    expect(focusInLayout(layout, { alternativeId: 'lisbon', criterionId: 'income-tax' })).toEqual({ alternativeId: 'lisbon', criterionId: 'income-tax' });
    expect(focusInLayout(layout, { alternativeId: 'seoul', criterionId: 'income-tax' })).toEqual({ criterionId: 'income-tax' });
    expect(focusInLayout(layout, { alternativeId: 'seoul', criterionId: 'rent' })).toBeUndefined();
    expect(focusInLayout(layout, undefined)).toBeUndefined();
  });
  it('reads the axes the same way transposed', () => {
    expect(focusInLayout(matrixLayout(relocation, transpose(hidden)), { alternativeId: 'seoul', criterionId: 'income-tax' })).toEqual({ criterionId: 'income-tax' });
  });
});

describe('shownOf, inShownOrder, hiddenOf (#292)', () => {
  const v = setFilter(applyOrder(initialViewState(relocation), 'alternatives', ['seoul', 'lisbon', 'berlin', 'taipei', 'montreal'], { kind: 'manual', by: 'ana' }), { hiddenAlternatives: ['berlin'], hiddenCriteria: ['rent'] });
  it('reads what a layout shows by axis, transposed or not', () => {
    const shown = shownOf(matrixLayout(relocation, v));
    expect(shown.alternatives).toEqual(['seoul', 'lisbon', 'taipei', 'montreal']);
    expect(shown.criteria).not.toContain('rent');
    expect(shownOf(matrixLayout(relocation, transpose(v)))).toEqual(shown);
  });
  it('orders and filters by it, and counts what it left out; without one, everything as given', () => {
    const shown = shownOf(matrixLayout(relocation, v));
    expect(inShownOrder(relocation.alternatives, (a) => a.id, shown.alternatives)).toMatchObject({ hidden: 1, listed: shown.alternatives.map((id) => expect.objectContaining({ id })) });
    expect(inShownOrder(['b', 'a'], (x) => x, undefined)).toEqual({ listed: ['b', 'a'], hidden: 0 });
    expect(hiddenOf(relocation, shown)).toEqual({ alternatives: 1, criteria: 1 });
    expect(hiddenOf(relocation, undefined)).toEqual({ alternatives: 0, criteria: 0 });
  });
});
