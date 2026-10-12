/**
 * `comparanda build`, as a function: one analysis in, one self-contained HTML
 * file out (ADR-0017 clause 6, ADR-0013).
 *
 * Vite with `vite-plugin-singlefile` bundles the standalone page -- Preact,
 * the matrix, its stylesheet -- into the HTML, and the analysis is then
 * inlined as `<script type="application/json">`: no escaping into a JS
 * literal, and readable by anyone who opens the file in an editor. It is
 * inlined *after* Vite has run, so nothing Vite does to an HTML template (its
 * `%ENV%` substitution, say) can touch the data.
 *
 * Node only. `vite` and `vite-plugin-singlefile` are optional peers: a
 * consumer who only renders a matrix never installs them, and one who builds
 * is told exactly what to install.
 *
 * The page is held to a raw-byte budget excluding the analysis (#116,
 * `budget.ts`): over it, the build fails and names the packages the bytes went
 * to. Out of scope here, each with its own issue: the CSP tag and the
 * build-time zero-network check (#115), the mail-filter warning (#118). What
 * this does already: a disclosure projection, when given, runs before anything
 * is inlined (ADR-0021), because View Source recovers whatever the file carries.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { unknownMeasure, validateAnalysis } from '../core/schema/analysis.js';
import { attribute, BudgetExceeded, chargeBudget, STANDALONE_BUDGET, type BudgetReport, type ByteBudget } from './budget.js';
import { projectForReader, type DisclosureDecision } from '../core/schema/disclosure.js';
import {
  ANALYSIS_ELEMENT_ID, ROOT_ELEMENT_ID, SETTINGS_ELEMENT_ID, scriptSafeJson, type StandaloneSettings,
} from '../standalone/contract.js';

export interface BuildOptions {
  /** The measure the cells show. Default: `score`. */
  measure?: string;
  /** The page's `<title>`. Default: the analysis's title, else its question. */
  title?: string;
  /**
   * The reader's disclosure decision (ADR-0021). When given, the analysis is
   * projected for that reader before it is inlined, so nothing withheld from
   * them is in the file at all.
   */
  discloses?: DisclosureDecision;
  /** The standalone entry module. Default: the one shipped beside this module. */
  entry?: string;
  /**
   * The raw-byte budget the page is held to, the analysis excluded. Default:
   * `STANDALONE_BUDGET`. Over it, the build throws `BudgetExceeded`. `false`
   * reports against the default without enforcing it.
   */
  budget?: ByteBudget | false;
}

export interface BuildResult {
  /** The whole page: one file, no external references. */
  html: string;
  /** Its size in bytes, raw and gzipped. */
  bytes: number;
  gzipBytes: number;
  /** The page without the analysis, held against the budget: where its bytes went. */
  budget: BudgetReport;
  /** Validation warnings the analysis carried (errors refuse the build). */
  warnings: string[];
}

export {
  BudgetExceeded, STANDALONE_BUDGET, type BudgetReport, type ByteBudget, type Contribution, type Reservation,
} from './budget.js';

/** What to install when the optional peers are missing. */
export const BUILD_PEERS = ['vite', 'vite-plugin-singlefile'] as const;

/**
 * Build the standalone page for `input` (an analysis, or the parsed JSON of
 * one). Refuses a document with validation errors, naming every one.
 */
export async function buildStandalone(input: unknown, options: BuildOptions = {}): Promise<BuildResult> {
  const { measure = 'score', discloses, entry = defaultEntry(), budget = STANDALONE_BUDGET } = options;
  // Serialised once: what is validated is exactly what is inlined, whatever
  // `toJSON` or non-JSON values the caller's object carried.
  const wire: unknown = JSON.parse(JSON.stringify(input) ?? 'null');
  const checked = validateAnalysis(wire, { includeCompleteness: false });
  if (!checked.ok) {
    const errors = checked.problems.filter((p) => p.severity === 'error');
    throw new Error(`the analysis is not valid, so no page was built:\n${errors.map((p) => `  ${p.path || '(root)'}: ${p.message}`).join('\n')}`);
  }
  const problem = unknownMeasure(checked.analysis, measure);
  if (problem !== undefined) throw new Error(`no page was built: ${problem}.`);
  // Verbatim when nothing is withheld: the document as given, not the parsed
  // copy with its defaults filled in. A projection is a new document.
  const inlined: unknown = discloses ? projectForReader(checked.analysis, discloses).analysis : wire;
  const title = options.title ?? checked.analysis.title ?? checked.analysis.subject.question;
  const settings: StandaloneSettings = { measure };

  const { shell, codeBytes, rendered } = await bundleShell(entry);
  entryIsInlined(shell);
  const shellBytes = Buffer.byteLength(shell);
  const report = chargeBudget(shellBytes, attribute(shellBytes, codeBytes, rendered), budget || STANDALONE_BUDGET);
  if (budget !== false && !report.within) throw new BudgetExceeded(report);
  let html = splice(shell, EMPTY_TITLE, `<title>${escapeHtml(title)}</title>`);
  html = splice(html, emptyData(ANALYSIS_ELEMENT_ID), filledData(ANALYSIS_ELEMENT_ID, inlined));
  html = splice(html, emptyData(SETTINGS_ELEMENT_ID), filledData(SETTINGS_ELEMENT_ID, settings));
  return {
    html,
    bytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html).length,
    budget: report,
    warnings: checked.problems.filter((p) => p.severity === 'warning').map((p) => `${p.path || '(root)'}: ${p.message}`),
  };
}

/**
 * The page without its data: Vite and the single-file plugin over the entry.
 * Also what the bundle's code came to, and each module's rendered length, read
 * before the single-file plugin inlines the chunks and drops their record.
 */
async function bundleShell(entry: string): Promise<{ shell: string; codeBytes: number; rendered: Map<string, number> }> {
  const [vite, singleFile] = await peers();
  const rendered = new Map<string, number>();
  let codeBytes = 0;
  const measure: import('vite').Plugin = {
    name: 'comparanda-byte-budget',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        codeBytes += Buffer.byteLength(out.code);
        for (const [id, m] of Object.entries(out.modules)) rendered.set(id, (rendered.get(id) ?? 0) + m.renderedLength);
      }
    },
  };
  const root = await mkdtemp(join(tmpdir(), 'comparanda-build-'));
  try {
    await writeFile(join(root, 'main.js'), `import ${JSON.stringify(pathToFileURL(entry).href)};\n`);
    await writeFile(join(root, 'index.html'), TEMPLATE);
    await vite.build({
      root,
      base: './',
      configFile: false,
      envFile: false,
      publicDir: false,
      logLevel: 'error',
      plugins: [measure, singleFile.viteSingleFile()],
      // The matrix is TSX on Preact; this only matters when building from source.
      esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
      build: { outDir: join(root, 'out'), emptyOutDir: true, modulePreload: false, reportCompressedSize: false },
    });
    return { shell: await readFile(join(root, 'out', 'index.html'), 'utf8'), codeBytes, rendered };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The page Vite bundles. Everything that comes from the analysis -- the title
 * as much as the data -- is left empty here and spliced in afterwards, so no
 * Vite HTML transform (its `%MODE%`-style substitution) ever sees it.
 */
const EMPTY_TITLE = '<title></title>';
const emptyData = (id: string) => `<script type="application/json" id="${id}"></script>`;
const filledData = (id: string, value: unknown) =>
  `<script type="application/json" id="${id}">${scriptSafeJson(value)}</script>`;
const TEMPLATE = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  EMPTY_TITLE,
  '</head>',
  '<body>',
  `<main id="${ROOT_ELEMENT_ID}"></main>`,
  emptyData(ANALYSIS_ELEMENT_ID),
  emptyData(SETTINGS_ELEMENT_ID),
  '<script type="module" src="./main.js"></script>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** Replace the one occurrence of `empty` in `html`. Spliced, not String.replace: a `$&` in the data stays literal. */
function splice(html: string, empty: string, filled: string): string {
  const at = html.indexOf(empty);
  if (at < 0 || html.indexOf(empty, at + 1) >= 0) {
    throw new Error(`the bundled page does not carry exactly one ${empty}; the build template and the bundler disagree.`);
  }
  return html.slice(0, at) + filled + html.slice(at + empty.length);
}

/**
 * Refuse a page whose entry did not survive bundling. A bundler that reads the
 * entry as side-effect-free drops it whole and still writes a valid-looking
 * page with no matrix in it; the entry names the data element, so its absence
 * from every inline module is the tell.
 */
function entryIsInlined(html: string): void {
  const modules = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  if (!modules.some((code) => code.includes(ANALYSIS_ELEMENT_ID) && code.includes(ROOT_ELEMENT_ID))) {
    throw new Error('the bundled page has no inline module that reads the analysis: the bundler dropped the standalone entry, so no page was built.');
  }
}

/**
 * The standalone entry shipped beside this module: built (`dist/build/` and
 * `dist/cli.js`, which bundles this module one level up) or source (`src/`).
 */
function defaultEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of ['../standalone/main.js', './standalone/main.js', '../standalone/main.ts']) {
    const path = resolve(here, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`no standalone entry next to ${here}; this installation of comparanda is incomplete.`);
}

type Vite = typeof import('vite');
type SingleFile = typeof import('vite-plugin-singlefile');

async function peers(): Promise<[Vite, SingleFile]> {
  try {
    return await Promise.all([import('vite'), import('vite-plugin-singlefile')]);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    // Not installed is one failure; installed and refusing to load (an older
    // Node than Vite supports, say) is another, and says so.
    if ((error as { code?: string } | null)?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `comparanda build needs ${BUILD_PEERS.join(' and ')}, which are optional and not installed here. ` +
          `Install them beside comparanda: npm install --save-dev ${BUILD_PEERS.join(' ')} (${why})`,
      );
    }
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const old = major < 20 || (major === 20 && minor < 19);
    throw new Error(`comparanda build could not load ${BUILD_PEERS.join(' or ')}: ${why}${old ? ` (Vite 7 needs Node 20.19 or later; this is ${process.versions.node})` : ''}.`);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
