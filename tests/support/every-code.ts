/**
 * A matrix with every reason code in force on a cell of its own, and what a
 * screen reader hears from a cell. Shared by the absence tests (#101) and the
 * accessibility gate (A4, #105), so the gate walks the same set of codes the
 * feature's own tests do.
 */
import { Analysis, CORE_MISSING_CODES } from '../../src/index.js';
import relocationJson from '../../examples/relocation.json';

const relocation = Analysis.parse(relocationJson);
export const UNDECLARED = 'no-such-reason';
/** Declarations an author can write that the view must still word: a blank meaning, and one with no full stop. */
const AWKWARD = [
  { id: 'blank-meaning', broader: 'not-evidenced' as const, means: '   ', params: {} },
  { id: 'no-full-stop', broader: 'not-assessed' as const, means: 'Asked; no reply yet', params: {} },
  // Structural, yet declared open: its border style follows the flag, not the standing (ADR-0028 amendment).
  { id: 'structural-open', broader: 'not-applicable' as const, terminal: false, means: 'Should be empty; nobody has confirmed it.', params: {} },
];

/** Every code in force, each on a cell of its own: core codes, analysis-scope and criterion-scope declarations, one undeclared. */
export function everyCode(): { analysis: Analysis; placed: { alt: string; crit: string; code: string }[] } {
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


/** What a screen reader hears from a cell: its text, without what is hidden from it. */
export function heard(td: Element): string {
  const copy = td.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent!.replace(/\s+/g, ' ').trim();
}

