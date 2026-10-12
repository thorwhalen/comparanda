/**
 * `matrixLayout` (#89): order, hiding, banding and orientation, in plain Node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matrixLayout } from '../src/core/layout.js';
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
});
