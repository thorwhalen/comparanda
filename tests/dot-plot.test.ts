/**
 * The small-multiple dot plot's model (#96, ADR-0026): the criterion's own
 * levels as ticks, one dot per assertion, a missing lane keyed by reason, and
 * redaction decided in core.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Analysis } from '../src/core/schema/analysis.js';
import { dotPlot, type DotPlot } from '../src/core/dot-plot.js';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const relocation = Analysis.parse(JSON.parse(readFileSync(join(examples, 'relocation.json'), 'utf8')));
const usable = (p: DotPlot) => {
  if (!p.usable) throw new Error(p.reason);
  return p;
};
const row = (p: DotPlot, id: string) => usable(p).rows.find((r) => r.alternativeId === id)!;

describe('dotPlot', () => {
  it('puts an alternative with no value in the missing lane, under its reason, rather than leaving it out', () => {
    const p = usable(dotPlot(relocation, 'income-tax', { measure: 'score' }));
    expect(p.rows.map((r) => r.alternativeId)).toEqual(relocation.alternatives.map((a) => a.id));
    // Berlin's rater recorded "not evidenced"; nobody has looked at Montreal.
    expect(row(p, 'berlin')).toMatchObject({ dots: [], missing: [{ lane: 'not-evidenced', count: 1 }] });
    expect(row(p, 'montreal').missing).toEqual([{ lane: 'not-assessed', means: 'Nobody has looked yet.', count: 1 }]);
    // Lanes in the core reasons' order, the same in every panel.
    expect(p.lanes).toEqual(['not-assessed', 'not-evidenced', 'withheld']);
  });

  it('reads a declared block as not applicable, though nobody asserted it', () => {
    const p = dotPlot(relocation, 'eu-residency-path', { measure: 'score' });
    expect(row(p, 'taipei').missing).toEqual([{ lane: 'not-applicable', means: 'This criterion does not apply to this alternative.', count: 1 }]);
  });

  it('draws one dot per assertion at its level, on the criterion\'s own levels', () => {
    const daylight = usable(dotPlot(relocation, 'winter-daylight', { measure: 'score' }));
    expect(daylight.ticks).toEqual([1, 2, 3, 4, 5]);
    // Three raters on Berlin: two at 1, one at 3. Disagreement is a gap, not an average.
    expect(row(daylight, 'berlin').dots.map((d) => d.tick)).toEqual([0, 2, 0]);
    // A nominal criterion's declared levels are its ticks, names and all.
    expect(usable(dotPlot(relocation, 'climate-type', { measure: 'score' })).ticks).toEqual(['Mediterranean', 'Continental', 'Subtropical']);
  });

  it('draws nothing between levels: a continuous range has no dot plot here, and says why', () => {
    const rent = dotPlot(relocation, 'rent', { measure: 'score' });
    expect(rent.usable).toBe(false);
    expect(!rent.usable && rent.reason).toMatch(/continuous range \(0 to 6000\).*only levels/);
    const off = Analysis.parse({
      ...relocation,
      cells: relocation.cells.map((c) => (c.alternativeId === 'lisbon' && c.criterionId === 'winter-daylight'
        ? { ...c, assertions: c.assertions.map((s) => ({ ...s, value: 2.5 })) } : c)),
    });
    expect(row(dotPlot(off, 'winter-daylight', { measure: 'score' }), 'lisbon')).toMatchObject({ dots: [], offTicks: 1 });
  });

  describe('redaction (ADR-0023)', () => {
    const rounds = (feedback: string) => Analysis.parse({
      ...relocation,
      rounds: [{ id: 'r1', index: 1, attribution: 'anonymous', feedback }],
      cells: relocation.cells.map((c) => ({ ...c, assertions: c.assertions.map((s) => ({ ...s, roundId: 'r1' })) })),
    });
    const viewer = { viewerId: 'ben', now: '2026-01-01T00:00:00Z' };

    it('counts what the round hides and never draws it', () => {
      const berlin = row(dotPlot(rounds('none'), 'winter-daylight', { measure: 'score', viewer }), 'berlin');
      expect(berlin.unseen + berlin.dots.length).toBe(3);
      expect(berlin.unseen).toBeGreaterThan(0);
    });

    it('draws a hidden author\'s dot without naming them', () => {
      const berlin = row(dotPlot(rounds('anonymous-summary'), 'winter-daylight', { measure: 'score', viewer }), 'berlin');
      expect(berlin.dots).toHaveLength(3);
      // Ben is named his own dot; the other two are hands the round does not name to him.
      expect(berlin.dots.map((d) => d.authorId)).toEqual([undefined, 'ben', undefined]);
      // Without a viewer nothing is hidden.
      expect(row(dotPlot(rounds('anonymous-summary'), 'winter-daylight', { measure: 'score' }), 'berlin').dots.every((d) => d.authorId)).toBe(true);
    });
  });
});
