/**
 * `matrixLayout` (#89): order, hiding, banding and orientation, in plain Node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matrixLayout, omittedBlocks } from '../src/core/layout.js';
import { makeInapplicableBlocks, makeInapplicability } from '../src/core/schema/groups.js';
import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState, setGrouping, transpose, type ViewState } from '../src/core/view-state.js';

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

  it('finds every band-by-band block whose every cell is declared inapplicable, with its grid span and reason', () => {
    const blocks = omittedBlocks(matrixLayout(relocation, both()), blockOf);
    expect(blocks.map(at)).toEqual([
      ['g-asia', 'g-eu', { first: 3, last: 4 }, { first: 1, last: 1 }, 2],
      ['g-americas', 'g-eu', { first: 5, last: 5 }, { first: 1, last: 1 }, 1],
    ]);
    expect(blocks[0]!.reason).toBe('not an EU destination, so EU residency rules do not apply');
  });

  it('reads the same blocks, axes swapped, when transposed', () => {
    const blocks = omittedBlocks(matrixLayout(relocation, transpose(both())), blockOf);
    expect(blocks.map(at)).toEqual([
      ['g-eu', 'g-asia', { first: 1, last: 1 }, { first: 3, last: 4 }, 2],
      ['g-eu', 'g-americas', { first: 1, last: 1 }, { first: 5, last: 5 }, 1],
    ]);
  });

  it('omits nothing unless both axes are banded, or when one cell of a block shows anything', () => {
    expect(omittedBlocks(matrixLayout(relocation, setGrouping(initialViewState(relocation), 'alternatives', ['g-asia'])), blockOf)).toEqual([]);
    // Seoul's cell is kept (a value, a thread, its own absence): the whole Asia block is drawn cell by cell.
    const keepSeoul = (alt: string, crit: string) => (alt === 'seoul' ? undefined : blockOf(alt, crit));
    expect(omittedBlocks(matrixLayout(relocation, both()), keepSeoul).map((b) => b.rowBand.groupId)).toEqual(['g-americas']);
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

  it('makeInapplicability is the blocks reader, asked yes or no', () => {
    const yes = makeInapplicability(relocation);
    for (const alt of relocation.alternatives) for (const crit of relocation.criteria) {
      expect(yes(alt.id, crit.id)).toBe(blockOf(alt.id, crit.id) !== undefined);
    }
  });
});
