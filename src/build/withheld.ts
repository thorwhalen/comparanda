/**
 * The byte assertion on the emitted payload (ADR-0013's 2026-08-21 amendment, #183).
 *
 * `comparanda build` projects an analysis for its reader before inlining it (ADR-0021),
 * and View Source recovers whatever the file carries, so the check belongs on the bytes
 * of the page, not on the object the build meant to inline. Two reads of the finished
 * HTML:
 *
 * 1. The analysis element, parsed out of the file, equals the projection exactly: no
 *    removed value (a number included, which no text search could tell from a coordinate
 *    on the page) rode along in any field.
 * 2. No text the projection removed appears anywhere in the file, the shell's code,
 *    title and settings included: justifications, evidence excerpts and quoted
 *    selectors, missingness notes, string values. A string the reader is still shown
 *    elsewhere in the analysis is not a leak, and one too short to be told from page
 *    markup is left to the first read.
 *
 * Node only, and run by the build: it adds nothing to the page's bytes. A failure names
 * the assertion and the kind of field, never the text, so a refusal does not copy the
 * secret into a log.
 */
import type { Analysis } from '../core/schema/analysis.js';
import { isProjectedOut } from '../core/schema/disclosure.js';
import { ANALYSIS_ELEMENT_ID, scriptSafeJson } from '../standalone/contract.js';

/** The shortest removed string searched for as text: below it a hit is as likely page markup as a leak. */
export const MIN_DISTINCTIVE_LENGTH = 8;

export interface WithheldLeak {
  /** Where: the assertion that was projected out, or the analysis element as a whole. */
  assertionId: string;
  /** The field it came from, as a path inside the assertion (`justification`, `evidence.0.excerpt`). */
  field: string;
}

/** A page that carries what the projection removed. */
export class WithheldLeaked extends Error {
  constructor(readonly leaks: readonly WithheldLeak[]) {
    super(
      `no page was built: the file carries what the disclosure projection removed (View Source would show it):\n${
        leaks.map((l) => `  ${l.assertionId}: ${l.field}`).join('\n')}`,
    );
    this.name = 'WithheldLeaked';
  }
}

/** Every string leaf of `value` with its path. */
function* strings(value: unknown, path: string[] = []): Generator<[string, string]> {
  if (typeof value === 'string') yield [path.join('.'), value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, [...path, String(i)]);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* strings(v, [...path, k]);
  }
}

/** The element's JSON text out of the page, or undefined. */
function dataElement(html: string, id: string): string | undefined {
  const open = `<script type="application/json" id="${id}">`;
  const at = html.indexOf(open);
  if (at < 0) return undefined;
  const end = html.indexOf('</script>', at + open.length);
  return end < 0 ? undefined : html.slice(at + open.length, end);
}

/**
 * What in `html` the projection from `source` to `projected` was meant to remove.
 * Empty when the page is clean.
 */
export function withheldLeaks(html: string, source: Analysis, projected: Analysis): WithheldLeak[] {
  const leaks: WithheldLeak[] = [];
  const emitted = dataElement(html, ANALYSIS_ELEMENT_ID);
  if (emitted === undefined || emitted !== scriptSafeJson(projected)) {
    leaks.push({ assertionId: '(analysis element)', field: emitted === undefined ? 'missing from the file' : 'differs from the projection' });
  }
  // What the reader is still shown: a removed string that is also one of these is not a leak.
  const shown = new Set([...strings(projected)].map(([, s]) => s));
  source.cells.forEach((cell, ci) => {
    cell.assertions.forEach((s, i) => {
      if (isProjectedOut(s) || !isProjectedOut(projected.cells[ci]!.assertions[i]!)) return;
      for (const [field, text] of strings(s)) {
        if (text.length < MIN_DISTINCTIVE_LENGTH || shown.has(text)) continue;
        if (html.includes(scriptSafeJson(text).slice(1, -1)) || html.includes(text)) leaks.push({ assertionId: s.id, field });
      }
    });
  });
  return leaks;
}
