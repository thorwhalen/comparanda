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
  Analysis, absenceStanding, CORE_MISSING_CODES, coreReasonOf, makeCellReader, vocabularyOf,
} from '../../src/index.js';
import { createEncodingRegistry, mountMatrix, SHIPPED_ENCODINGS, type MatrixHandle } from '../../src/view/index.js';
import relocationJson from '../../examples/relocation.json';
import { everyCode, heard, UNDECLARED } from '../support/every-code.js';

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

  it('a gap keeps its dashed shape whatever its code; an answer its solid frame; every absence its core reason\'s glyph', () => {
    const { analysis, placed } = everyCode();
    const vocabulary = vocabularyOf(analysis);
    handle = mountMatrix(el, { analysis, measure: 'score' });
    const byCell = new Map(cellsOf(analysis).map((x) => [`${x.alt}\u0000${x.crit}`, x.td]));
    const glyphs = new Set<string>();
    for (const { alt, crit, code } of placed) {
      const td = byCell.get(`${alt}\u0000${crit}`)!;
      const facts = vocabulary.resolve(code, crit).facts;
      // Keyed on the core reason the code refines, read from the vocabulary, never from the cell.
      const expected = facts ? coreReasonOf(vocabulary, code, crit) : 'undeclared';
      expect(td.querySelector('svg.comparanda-glyph')?.getAttribute('data-glyph'), code).toBe(expected);
      glyphs.add(expected!);
      const terminal = facts?.terminal ?? false;
      const style = getComputedStyle(td);
      expect(style.outlineStyle, code).toBe(!terminal ? 'dashed' : facts!.structural ? 'none' : 'solid');
      expect(style.borderTopStyle, code).toBe(terminal ? 'solid' : 'dashed');
      expect(style.backgroundImage).toBe('none');
    }
    expect(glyphs).toEqual(new Set([...Object.keys(CORE_MISSING_CODES), 'undeclared']));
  });
});
