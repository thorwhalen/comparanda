/**
 * `pickableGroups` (#342): one answer to "which groups can the reader pick",
 * read by the matrix's group controls, its layout's bands and the scatter's
 * scope (`scopeGroups`). A group with no live member is offered by none of them.
 */
import { describe, expect, it } from 'vitest';

import { pickableGroups, scopeGroups } from '../src/core/analyses/scope.js';
import { matrixLayout } from '../src/core/layout.js';
import { Analysis } from '../src/core/schema/analysis.js';
import { initialViewState, setGrouping } from '../src/core/view-state.js';
import relocationJson from '../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

/** Relocation with Montreal tombstoned (the Americas left with no live member), Iberia under Europe, and a criteria group with nothing in it. */
const edited = () => {
  const doc = structuredClone(relocation);
  doc.alternatives.find((a) => a.id === 'montreal')!.tombstoned = true;
  doc.groups.push({ id: 'g-iberia', label: 'Iberia', axis: 'alternatives', parentId: 'g-europe' });
  doc.alternatives.find((a) => a.id === 'lisbon')!.groupIds = ['g-iberia'];
  doc.groups.push({ id: 'g-paperwork', label: 'Paperwork', axis: 'criteria' });
  return Analysis.parse(doc);
};

describe('pickableGroups', () => {
  it('offers each axis\'s live groups with a live member, in document order, with their members', () => {
    expect(pickableGroups(relocation).map((g) => [g.id, g.members])).toEqual([
      ['g-europe', ['lisbon', 'berlin']], ['g-asia', ['taipei', 'seoul']], ['g-americas', ['montreal']],
    ]);
    // The tombstoned criteria group is not offered.
    expect(ids(pickableGroups(relocation, 'criteria'))).toEqual(['g-cost', 'g-climate', 'g-logistics', 'g-eu']);
  });

  it('leaves out a group with no live member, on either axis, and keeps sub-groups unless asked for the top level', () => {
    const doc = edited();
    expect(ids(pickableGroups(doc))).toEqual(['g-europe', 'g-asia', 'g-iberia']);
    expect(ids(pickableGroups(doc, 'alternatives', { topLevel: true }))).toEqual(['g-europe', 'g-asia']);
    expect(ids(pickableGroups(doc, 'criteria', { topLevel: true }))).not.toContain('g-paperwork');
  });

  it('stands a sub-group of a tombstoned parent at the top level, and names no parent for it', () => {
    const doc = edited();
    doc.groups.find((g) => g.id === 'g-europe')!.tombstoned = true;
    const parsed = Analysis.parse(doc);
    expect(ids(pickableGroups(parsed, 'alternatives', { topLevel: true }))).toEqual(['g-asia', 'g-iberia']);
    expect(scopeGroups(parsed).find((g) => g.id === 'g-iberia')).toMatchObject({ parentLabel: undefined, members: ['lisbon'] });
  });

  it('still offers a group whose members are all hidden, which the scatter\'s scope leaves out', () => {
    const doc = edited();
    // Asia's two members hidden: nothing of it to compare, but the matrix can still select it or show it again.
    expect(ids(scopeGroups(doc, { shownAlternatives: ['lisbon', 'berlin'] }))).toEqual(['g-europe', 'g-iberia']);
    expect(ids(pickableGroups(doc))).toEqual(['g-europe', 'g-asia', 'g-iberia']);
  });

  it('is what the layout bands by: a grouping of only groups with no live member draws no bands', () => {
    const doc = edited();
    expect(matrixLayout(doc, setGrouping(initialViewState(doc), 'alternatives', ['g-americas'])).rows.bands).toBeUndefined();
    expect(matrixLayout(doc, setGrouping(initialViewState(doc), 'criteria', ['g-paperwork'])).columns.bands).toBeUndefined();
    // A group with members still bands, as before.
    expect(matrixLayout(doc, setGrouping(initialViewState(doc), 'alternatives', ['g-americas', 'g-asia'])).rows.bands!.map((b) => b.groupId))
      .toEqual(['g-asia', undefined]);
  });
});
