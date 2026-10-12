/**
 * What the standalone page and the build that writes it agree on: the ids of
 * the elements the analysis and its settings are inlined into, and the shape
 * of those settings. One module, so the two halves cannot drift.
 *
 * Plain constants and a type; no DOM, no Node, importable from both sides.
 */

/** The `<script type="application/json">` holding the analysis: verbatim, or its projection for the reader (ADR-0017 clause 6). */
export const ANALYSIS_ELEMENT_ID = 'comparanda-analysis';

/** The `<script type="application/json">` holding `StandaloneSettings`. */
export const SETTINGS_ELEMENT_ID = 'comparanda-settings';

/** The element the matrix mounts into. */
export const ROOT_ELEMENT_ID = 'comparanda-root';

/** What the page needs besides the analysis. */
export interface StandaloneSettings {
  /** The measure the cells show. */
  measure: string;
}

/**
 * JSON that is safe inside a `<script>` element: `<` is written as its JSON
 * escape, so no string in the analysis can close the element (`</script>`) or
 * open a comment. Still valid JSON, and `JSON.parse` returns the same value.
 */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
