/**
 * The standalone page's entry: read the analysis inlined in the page, and
 * mount the matrix over it. Bundled into the single HTML file by
 * `comparanda build` (ADR-0017 clause 6).
 *
 * Reads nothing but the page itself -- no `fetch`, no URL (ADR-0013) -- and
 * never leaves the reader with a blank page: anything that stops the matrix
 * from rendering is said, in words, where the matrix would have been.
 *
 * The page's ports, as ADR-0013 binds them for standalone: the analysis is
 * frozen (no source, so every annotation control says it is read-only), the
 * arrangement is kept in this browser (`mountPersistedMatrix`), and so are the
 * reader's personal saved views (`localSavedViews`, #117). Shared views and
 * sequences live beside the analysis, and the file carries none (#291): their
 * providers take nothing, so the panel refuses them with that reason rather
 * than keeping them where nobody else would see them.
 */
import { Analysis } from '../core/schema/analysis.js';
import { emptyReadOnlyProvider, localSavedViews, savedViewStore } from '../store/index.js';
import { mountPersistedMatrix } from '../view/persist.js';
import {
  ANALYSIS_ELEMENT_ID, ROOT_ELEMENT_ID, SETTINGS_ELEMENT_ID, type StandaloneSettings,
} from './contract.js';

async function start(): Promise<void> {
  const root = document.getElementById(ROOT_ELEMENT_ID);
  if (!root) throw new Error(`this page has no #${ROOT_ELEMENT_ID} element to show the matrix in.`);
  try {
    const analysis = Analysis.parse(JSON.parse(inlined(ANALYSIS_ELEMENT_ID)));
    const settings = JSON.parse(inlined(SETTINGS_ELEMENT_ID)) as StandaloneSettings;
    const personal = localSavedViews(analysis.id);
    const store = savedViewStore({ personal: personal.provider, shared: emptyReadOnlyProvider(), sequences: emptyReadOnlyProvider() });
    await mountPersistedMatrix(root, {
      analysis, measure: settings.measure, ...(settings.encoding !== undefined ? { encoding: settings.encoding } : {}),
      savedViews: { store, notice: () => personal.status().notice },
    });
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

void start();
