/**
 * No cell is announced as blank (#101, ADR-0009, ADR-0027): every absent cell
 * is heard with its reason code's own declared meaning and with what it says
 * about the work -- `not-applicable` as correctly nothing, `not-assessed` as a
 * gap -- read from the code objects, never from a table in the view or here.
 *
 * Driven by `CORE_MISSING_CODES` and the analysis's declarations: a code added
 * to either is covered without touching this file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  Analysis, absenceStanding, CORE_MISSING_CODES, makeCellReader, vocabularyOf,
} from '../../src/index.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
const UNDECLARED = 'no-such-reason';
/** Declarations an author can write that the view must still word: a blank meaning, and one with no full stop. */
const AWKWARD = [
  { id: 'blank-meaning', broader: 'not-evidenced' as const, means: '   ', params: {} },
  { id: 'no-full-stop', broader: 'not-assessed' as const, means: 'Asked; no reply yet', params: {} },
];

/** Every code in force, each on a cell of its own: core codes, analysis-scope and criterion-scope declarations, one undeclared. */
function everyCode(): { analysis: Analysis; placed: { alt: string; crit: string; code: string }[] } {
  const overlays = relocation.criteria.flatMap((c) => (c.missingCodes ?? []).map((d) => ({ code: d.id, crit: c.id })));
  const plain = relocation.criteria.filter((c) => !(c.missingCodes ?? []).length).map((c) => c.id);
  const declared = [...(relocationJson.missingCodes ?? []), ...AWKWARD];
  const anywhere = [...Object.keys(CORE_MISSING_CODES), ...declared.map((d) => d.id), UNDECLARED];
  const alts = relocation.alternatives.map((a) => a.id);
  const placed = [
    ...overlays.map((o, i) => ({ alt: alts[i % alts.length]!, crit: o.crit, code: o.code })),
    ...anywhere.map((code, i) => ({ alt: alts[i % alts.length]!, crit: plain[Math.floor(i / alts.length)]!, code })),
  ];
  const at = new Set(placed.map((p) => `${p.alt}\u0000${p.crit}`));
  const cells = [
    ...relocationJson.cells.filter((c) => c.measure !== 'score' || !at.has(`${c.alternativeId}\u0000${c.criterionId}`)),
    ...placed.map((p, i) => ({
      alternativeId: p.alt, criterionId: p.crit, measure: 'score',
      assertions: [{ id: `absence-${i}`, authorId: relocationJson.authors[0]!.id, at: '2026-09-01T00:00:00Z', evidence: [], version: 1, missing: { code: p.code } }],
    })),
  ];
  return { analysis: Analysis.parse({ ...relocationJson, missingCodes: declared, cells }), placed };
}

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

/** What a screen reader hears from a cell: its text, without what is hidden from it. */
function heard(td: Element): string {
  const copy = td.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent!.replace(/\s+/g, ' ').trim();
}

/** Each shown cell with the alternative and criterion it stands for, from the grid's own focus ids. */
function cellsOf(analysis: Analysis) {
  const rows = analysis.alternatives.map((a) => a.id);
  const cols = analysis.criteria.map((c) => c.id);
  return Array.from(el.querySelectorAll<HTMLElement>('td[data-cell]')).map((td) => {
    const [r, c] = td.getAttribute('data-cell')!.split(':').map(Number) as [number, number];
    return { td, alt: rows[r - 1]!, crit: cols[c - 1]! };
  });
}

describe('every absent cell says its reason in words (#101)', () => {
  const encodings = createEncodingRegistry([...SHIPPED_ENCODINGS]);
  for (const encoding of ['text-only', 'missingness', 'value', 'datum']) {
    it(`each code is heard with its own declared meaning and its standing (${encoding})`, () => {
      const { analysis, placed } = everyCode();
      handle = mountMatrix(el, { analysis, measure: 'score', encoding }, { encodings });
      // Drawn with the encoding asked for, not quietly fallen back to text.
      expect(el.querySelector('.comparanda-matrix')!.getAttribute('data-encoding')).toBe(encoding);
      const vocabulary = vocabularyOf(analysis);
      const byCell = new Map(cellsOf(analysis).map((x) => [`${x.alt}\u0000${x.crit}`, x.td]));
      const standings = new Map<string, string>();
      for (const { alt, crit, code } of placed) {
        const td = byCell.get(`${alt}\u0000${crit}`)!;
        const said = heard(td);
        // An encoding's words after an absence are a sentence, not a dangling phrase.
        expect(said, code).not.toMatch(/\.\s*,/);
        const facts = vocabulary.resolve(code, crit).facts;
        // The shown text ends a sentence before anything else is heard after it.
        const shown = td.querySelector('.comparanda-shown')!.textContent!;
        expect(shown.trim(), code).not.toBe('');
        expect(/[.!?\u2026)\]"\u201d\u2019]$/.test(shown) || said.slice(said.indexOf(shown) + shown.length).startsWith('.'), code).toBe(true);
        if (facts && !facts.means.trim()) {
          // A declared but blank meaning is worded from the id, never shown empty.
          expect(said).toContain(code);
          expect(td.getAttribute('data-absence')).toBe(absenceStanding(facts));
        } else if (facts) {
          expect(said, code).toContain(facts.means);
          expect(td.getAttribute('data-absence'), code).toBe(absenceStanding(facts));
          standings.set(absenceStanding(facts), said.slice(said.lastIndexOf('.', said.length - 2) + 1).trim());
        } else {
          // Undeclared: nothing may be guessed, and the id is worded, never shown bare.
          expect(td.getAttribute('data-absence')).toBe('undeclared');
          expect(td.querySelector('.comparanda-shown')!.textContent).not.toBe(code);
          expect(said).toContain(code);
          expect(said).toMatch(/still to be done/i);
        }
      }
      // Correctly nothing, a gap and an answer are three different things to hear.
      expect(standings.size).toBe(3);
      expect(new Set(standings.values()).size).toBe(3);
      // And each is heard the right way round: the structural one as nothing to do, the outstanding one as a gap.
      expect(standings.get('structural')).toMatch(/nothing to record/i);
      expect(standings.get('outstanding')).toMatch(/still to be done/i);
      expect(standings.get('answered')).toMatch(/not work outstanding/i);
    });
  }

  it('over the messy fixture, every unvalued cell is heard with the meaning of the code core reduced it to', () => {
    handle = mountMatrix(el, { analysis: relocation, measure: 'score' });
    const reader = makeCellReader(relocation, 'score');
    const vocabulary = vocabularyOf(relocation);
    const absent = cellsOf(relocation).filter(({ td }) => td.getAttribute('data-absence') !== null);
    expect(absent.length).toBeGreaterThan(0);
    for (const { td, alt, crit } of absent) {
      const recorded = reader.read(alt, crit)?.missing?.code;
      const code = recorded ?? (td.getAttribute('data-state') === 'not-applicable' ? 'not-applicable' : 'not-assessed');
      const facts = vocabulary.resolve(code, crit).facts!;
      expect(heard(td), `${alt} / ${crit}`).toContain(facts.means);
      expect(td.getAttribute('data-absence')).toBe(absenceStanding(facts));
    }
    // And nothing unvalued is silent: every cell without a value has an absence or a refusal.
    for (const td of Array.from(el.querySelectorAll('td[data-cell]:not([data-state="value"])'))) {
      expect(td.getAttribute('data-absence') !== null || td.getAttribute('data-state') === 'refused').toBe(true);
    }
  });

  it('a gap keeps its dashed shape whatever its code; a structural absence its hatch', () => {
    const { analysis } = everyCode();
    handle = mountMatrix(el, { analysis, measure: 'score' });
    for (const td of Array.from(el.querySelectorAll<HTMLElement>('td[data-absence="outstanding"]'))) {
      expect(getComputedStyle(td).outlineStyle).toBe('dashed');
    }
    for (const td of Array.from(el.querySelectorAll<HTMLElement>('td[data-absence="structural"]'))) {
      expect(getComputedStyle(td).backgroundImage).toContain('repeating-linear-gradient');
    }
  });
});
