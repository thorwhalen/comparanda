/**
 * The rater dot strip (#110, ADR-0024), in plain Node: the strip's data, the
 * encoding that marks cells with it, and the requirements the ADR makes
 * structural -- no mark at a mean, a text alternative that is the exact
 * multiset, and non-independent assertions that do not look like raters.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { Analysis, cellIndex, cellKey, makeCellReader, vocabularyOf } from '../src/core/schema/analysis.js';
import { isRaterStrip, raterStrip, raterStripInView, stripLevels } from '../src/core/rater-strip.js';
import { sightingOf, standInIds } from '../src/core/schema/redaction.js';
import { describeAssertionSet } from '../src/core/assertion-set.js';
import { editAffordances, inMemoryAnalysisSource } from '../src/store/index.js';
import { disagreement, STRIP_THRESHOLDS } from '../src/view/encodings/shipped.js';
import type { EncodingContext } from '../src/view/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const relocation = Analysis.parse(JSON.parse(readFileSync(join(here, '..', 'examples', 'relocation.json'), 'utf8')));

function contextOf(a: Analysis, over: Partial<EncodingContext> = {}): EncodingContext {
  const reader = makeCellReader(a, 'score');
  const cells = cellIndex(a);
  const affordances = editAffordances(inMemoryAnalysisSource(a), a);
  return {
    analysis: a, measure: 'score', vocabulary: vocabularyOf(a),
    alternatives: a.alternatives.map((x) => x.id), criteria: a.criteria.map((x) => x.id),
    read: (alt, crit) => reader.read(alt, crit),
    readMeasure: (other, alt, crit) => makeCellReader(a, other).read(alt, crit),
    stripOf: (alt, crit, levels) => {
      const c = cells.get(cellKey(alt, crit, 'score'));
      return c && raterStripInView(a, c, { levels });
    },
    inapplicable: affordances.inapplicable,
    ...over,
  };
}
const marked = (ctx: EncodingContext) => {
  const p = disagreement.prepare(ctx);
  if ('unavailable' in p) throw new Error(p.unavailable);
  return p;
};
const LEVELS = [1, 2, 3, 4, 5];
const AUTHORS = relocation.authors;
const cell = (key: [string, string]) => cellIndex(relocation).get(cellKey(key[0], key[1], 'score'))!;

describe('stripLevels', () => {
  it('takes the declared levels, else the whole numbers of a short range, else nothing', () => {
    const crit = (id: string) => relocation.criteria.find((c) => c.id === id)!.defaultMeasurement!;
    expect(stripLevels(crit('winter-daylight'))).toEqual(LEVELS);
    expect(stripLevels({ ...crit('winter-daylight'), levels: undefined })).toEqual(LEVELS);
    expect(stripLevels(crit('rent'))).toBeUndefined(); // 0..6000
    expect(stripLevels(crit('climate-type'))).toBeUndefined(); // nominal
    expect(stripLevels(crit('winter-daylight'), { maxSlots: 4 })).toBeUndefined();
  });
});

describe('raterStrip', () => {
  it('lays each assertion in its level slot, ties stacked, empty slots kept', () => {
    const s = raterStrip(cell(['berlin', 'winter-daylight']), { authors: AUTHORS, levels: LEVELS })!;
    expect(s.slots.map((x) => x.count)).toEqual([2, 0, 1, 0, 0]);
    expect(s.reading).toBe('raters');
    expect(s.tallest).toBe(2);
    expect(s.label).toBe('3 raters: 1, 1, 3.');
  });

  it('places a mark only at occupied slots and at the bracket ends and modes: nothing at a mean', () => {
    const s = raterStrip(cell(['lisbon', 'school-quality']), { authors: AUTHORS, levels: LEVELS })!; // 3 and 5
    expect(s.slots.map((x) => x.count)).toEqual([0, 0, 1, 0, 1]);
    // The only marked slots are 2 and 4; slot 3, where the mean 4 would be, holds no dot and no mode.
    expect(s.bracket).toEqual({ from: 2, to: 4, modes: [2, 4] });
    expect(s.bracket.modes).not.toContain(3);
  });

  it('keeps one model\'s draws apart from raters, in the data and in the words', () => {
    const s = raterStrip(cell(['seoul', 'school-quality']), { authors: AUTHORS, levels: LEVELS })!;
    expect(s.reading).not.toBe('raters');
    expect(s.label).toBe(describeAssertionSet(cell(['seoul', 'school-quality']), { authors: AUTHORS, levels: LEVELS }).label);
    expect(s.label).not.toMatch(/\braters\b/);
  });

  it('counts a value off the level list instead of dropping it silently', () => {
    const c = { assertions: [...cell(['berlin', 'winter-daylight']).assertions] };
    c.assertions[0] = { ...c.assertions[0]!, value: 9 };
    const s = raterStrip(c, { authors: AUTHORS, levels: LEVELS })!;
    expect(s.unplaced).toBe(1);
    expect(s.slots.reduce((n, x) => n + x.count, 0)).toBe(2);
    expect(s.label).toContain('9');
  });

  it('draws nothing for a single assertion', () => {
    const one = { assertions: cell(['berlin', 'winter-daylight']).assertions.slice(0, 1) };
    expect(raterStrip(one, { authors: AUTHORS, levels: LEVELS })).toBeUndefined();
  });

  it('is recognised as drawable only when it is', () => {
    const s = raterStrip(cell(['berlin', 'winter-daylight']), { authors: AUTHORS, levels: LEVELS })!;
    expect(isRaterStrip(s)).toBe(true);
    expect(isRaterStrip({ ...s, slots: [] })).toBe(false);
    expect(isRaterStrip({ ...s, bracket: { from: 0, to: 99, modes: [] } })).toBe(false);
    expect(isRaterStrip(null)).toBe(false);
  });
});

describe('the disagreement encoding', () => {
  it('marks each multi-assertion cell with its strip and says the exact multiset after the value', () => {
    const p = marked(contextOf(relocation));
    const m = p.mark('berlin', 'winter-daylight');
    expect(m.strip?.slots.map((x) => x.count)).toEqual([2, 0, 1, 0, 0]);
    expect(m.said).toMatch(/^\. 3 raters: 1, 1, 3\. Disagreement \d\.\d\d \(A -?\d\.\d\d, n 3\)\.$/);
    // A cell the strip has nothing to say about is unmarked, and a nominal or ranged criterion is left alone.
    expect(p.mark('berlin', 'rent')).toEqual({});
    expect(p.mark('berlin', 'climate-type')).toEqual({});
  });

  it('declares its widths as a registered parameter, with the bracket above the hidden form', () => {
    const p = marked(contextOf(relocation));
    expect(p.strip).toBe(STRIP_THRESHOLDS);
    expect(STRIP_THRESHOLDS.bracketBelow).toBeGreaterThan(STRIP_THRESHOLDS.hiddenBelow);
  });

  it('keys both dot shapes in its legend, in words', () => {
    const legend = marked(contextOf(relocation)).legend;
    expect(legend.entries.map((e) => e.badge)).toEqual(['●', '○']);
    expect(legend.entries.every((e) => e.label.length > 10)).toBe(true);
    expect(legend.notes.join(' ')).toMatch(/Nothing is drawn at an average/);
  });

  it('says why it cannot draw rather than drawing something else', () => {
    const { stripOf: _omitted, ...withoutCells } = contextOf(relocation);
    const noCells = disagreement.prepare(withoutCells);
    expect('unavailable' in noCells && noCells.unavailable).toMatch(/assertions/);
    const single = Analysis.parse({ ...relocation, cells: relocation.cells.map((c) => ({ ...c, assertions: c.assertions.slice(0, 1) })) });
    const none = disagreement.prepare(contextOf(single));
    expect('unavailable' in none && none.unavailable).toMatch(/more than one live assertion/);
  });
});

describe('redaction (ADR-0023)', () => {
  const rounds = (feedback: string, attribution = 'anonymous') => Analysis.parse({
    ...relocation,
    rounds: [{ id: 'r1', index: 1, attribution, feedback }],
    cells: relocation.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, roundId: 'r1' })) })),
  });
  const viewer = { viewerId: 'ben', now: '2026-01-01T00:00:00Z' };
  const berlin = (a: Analysis) => cellIndex(a).get(cellKey('berlin', 'winter-daylight', 'score'))!;

  it('draws nothing from values the round hides: fewer than two visible is no set', () => {
    const a = rounds('none');
    expect(raterStripInView(a, berlin(a), { levels: LEVELS, viewer })).toBeUndefined(); // ben sees only his own
    const own = raterStripInView(a, berlin(a), { levels: LEVELS });
    expect(own?.unseen).toBe(0); // no viewer, nothing hidden
  });

  it('draws a distribution without saying who rated alike', () => {
    const a = rounds('anonymous-summary');
    const s = raterStripInView(a, berlin(a), { levels: LEVELS, viewer })!;
    expect(s.slots.map((x) => x.count)).toEqual([2, 0, 1, 0, 0]);
    expect(s.reading).not.toBe('raters');
    expect(s.label).not.toMatch(/Ana|Ben|Cleo/);
  });
});

describe('one rule for what a viewer may see (#293)', () => {
  const cellOf = (a: Analysis) => cellIndex(a).get(cellKey('berlin', 'winter-daylight', 'score'))!;

  it('counts a value a projection withheld as not shown, never as an absence, with or without a viewer', () => {
    const projected = Analysis.parse({
      ...relocation,
      cells: relocation.cells.map((c) => (c.alternativeId === 'berlin' && c.criterionId === 'winter-daylight'
        ? { ...c, assertions: c.assertions.map((s, i) => (i === 0 ? { ...s, value: undefined, disclosure: { withheldFromReader: true } } : s)) } : c)),
    });
    const strip = raterStripInView(projected, cellOf(projected), { levels: LEVELS })!;
    expect([strip.unseen, strip.absent]).toEqual([1, 0]);
    expect(strip.slots.map((x) => x.count)).toEqual([1, 0, 1, 0, 0]);
    // With a viewer, in a round that hides nothing: only the projection hides it, and the same holds.
    const open = Analysis.parse({
      ...projected,
      rounds: [{ id: 'r1', index: 1, attribution: 'attributed', feedback: 'full' }],
      cells: projected.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, roundId: 'r1' })) })),
    });
    const seen = raterStripInView(open, cellOf(open), { levels: LEVELS, viewer: { viewerId: 'ben', now: '2026-01-01T00:00:00Z' } })!;
    expect([seen.unseen, seen.absent]).toEqual([1, 0]);
  });

  it('sightingOf: unseen, unnamed or named, as the strip and the dot plots both read it', () => {
    const a = Analysis.parse({
      ...relocation,
      rounds: [{ id: 'r1', index: 1, attribution: 'attributed', feedback: 'anonymous-summary' }],
      cells: relocation.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, roundId: 'r1' })) })),
    });
    const [ana] = cellOf(a).assertions;
    expect(sightingOf(a, ana!, undefined)).toBe('named');
    // Shown only as part of a distribution: drawn, but never with a name, though the round names authors.
    expect(sightingOf(a, ana!, { viewerId: 'ben', now: '2026-01-01T00:00:00Z' })).toBe('unnamed');
    expect(sightingOf(a, { ...ana!, value: undefined, disclosure: { withheldFromReader: true } }, undefined)).toBe('unseen');
  });

  it('standInIds: its own namespace, skipping ids already used', () => {
    const [s1, s2] = cellOf(relocation).assertions;
    const ids = standInIds([{ ...s1!, id: 'hidden-author:1' }, s2!], () => true);
    expect([...ids.values()]).toEqual(['hidden-author:2', 'hidden-author:3']);
  });
});
