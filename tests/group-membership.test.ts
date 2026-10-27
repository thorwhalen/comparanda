/**
 * `joinGroup` (#279): the document write behind "Group with…".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis, validateAnalysis } from '../src/core/schema/analysis.js';
import { joinGroup } from '../src/core/group-membership.js';

const relocation = Analysis.parse(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'relocation.json'), 'utf8')));

describe('joinGroup', () => {
  it('adds the group to the entity\'s groupIds, and leaves the document valid and the input untouched', () => {
    const a = joinGroup(relocation, 'alternatives', 'montreal', 'g-europe');
    expect(a.alternatives.find((x) => x.id === 'montreal')!.groupIds).toEqual(['g-americas', 'g-europe']);
    expect(relocation.alternatives.find((x) => x.id === 'montreal')!.groupIds).toEqual(['g-americas']);
    expect(validateAnalysis(a).problems.filter((p) => p.family === 'schema')).toEqual([]);
    expect(joinGroup(relocation, 'criteria', 'rent', 'g-climate').criteria.find((x) => x.id === 'rent')!.groupIds).toEqual(['g-cost', 'g-climate']);
  });

  it('changes nothing for a group the entity is in already, directly or through a sub-group', () => {
    expect(joinGroup(relocation, 'alternatives', 'lisbon', 'g-europe')).toBe(relocation);
    const nested = structuredClone(relocation);
    nested.groups.push({ ...structuredClone(nested.groups.find((g) => g.id === 'g-europe')!), id: 'g-iberia', label: 'Iberia', parentId: 'g-europe' });
    nested.alternatives.find((x) => x.id === 'lisbon')!.groupIds = ['g-iberia'];
    expect(joinGroup(nested, 'alternatives', 'lisbon', 'g-europe')).toBe(nested);
  });

  it('refuses what would be ignored or wrong, saying why', () => {
    expect(() => joinGroup(relocation, 'alternatives', 'nope', 'g-europe')).toThrow(/not a live alternative/);
    expect(() => joinGroup(relocation, 'alternatives', 'lisbon', 'g-cost')).toThrow(/not a group of alternatives/);
    expect(() => joinGroup(relocation, 'criteria', 'rent', 'g-lifestyle')).toThrow(/tombstoned: a tombstoned group groups nothing/);
  });
});
