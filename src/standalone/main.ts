/**
 * The standalone page's entry: read the analysis inlined in the page, and
 * mount the matrix over it. Bundled into the single HTML file by
 * `comparanda build` (ADR-0017 clause 6).
 *
 * Reads nothing but the page itself -- no `fetch`, no URL (ADR-0013) -- and
 * never leaves the reader with a blank page: anything that stops the matrix
 * from rendering is said, in words, where the matrix would have been.
 */
import { Analysis } from '../core/schema/analysis.js';
import { mountMatrix } from '../view/mount.js';
import {
  ANALYSIS_ELEMENT_ID, ROOT_ELEMENT_ID, SETTINGS_ELEMENT_ID, type StandaloneSettings,
} from './contract.js';

function start(): void {
  const root = document.getElementById(ROOT_ELEMENT_ID);
  if (!root) throw new Error(`this page has no #${ROOT_ELEMENT_ID} element to show the matrix in.`);
  try {
    const analysis = Analysis.parse(JSON.parse(inlined(ANALYSIS_ELEMENT_ID)));
    const settings = JSON.parse(inlined(SETTINGS_ELEMENT_ID)) as StandaloneSettings;
    mountMatrix(root, { analysis, measure: settings.measure, ...(settings.encoding !== undefined ? { encoding: settings.encoding } : {}) });
  } catch (error) {
    const p = document.createElement('p');
    p.setAttribute('role', 'alert');
    p.textContent = `This comparison could not be shown: ${error instanceof Error ? error.message : String(error)}`;
    root.replaceChildren(p);
  }
}

function inlined(id: string): string {
  const text = document.getElementById(id)?.textContent;
  if (!text) throw new Error(`the page carries no #${id} data; it was not written by comparanda build.`);
  return text;
}

start();
