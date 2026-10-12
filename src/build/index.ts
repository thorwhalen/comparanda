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
 * Out of scope here, each with its own issue: the CSP tag and the build-time
 * zero-network check (#115), the byte budget (#116), the mail-filter warning
 * (#118). What this does already: a disclosure projection, when given, runs
 * before anything is inlined (ADR-0021), because View Source recovers whatever
 * the file carries.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { validateAnalysis, type Analysis } from '../core/schema/analysis.js';
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
}

export interface BuildResult {
  /** The whole page: one file, no external references. */
  html: string;
  /** Its size in bytes, raw and gzipped. */
  bytes: number;
  gzipBytes: number;
  /** Validation warnings the analysis carried (errors refuse the build). */
  warnings: string[];
}

/** What to install when the optional peers are missing. */
export const BUILD_PEERS = ['vite', 'vite-plugin-singlefile'] as const;

/**
 * Build the standalone page for `input` (an analysis, or the parsed JSON of
 * one). Refuses a document with validation errors, naming every one.
 */
export async function buildStandalone(input: unknown, options: BuildOptions = {}): Promise<BuildResult> {
  const { measure = 'score', discloses, entry = defaultEntry() } = options;
  const checked = validateAnalysis(input, { includeCompleteness: false });
  if (!checked.ok) {
    const errors = checked.problems.filter((p) => p.severity === 'error');
    throw new Error(`the analysis is not valid, so no page was built:\n${errors.map((p) => `  ${p.path || '(root)'}: ${p.message}`).join('\n')}`);
  }
  const analysis: Analysis = discloses ? projectForReader(checked.analysis, discloses).analysis : checked.analysis;
  const title = options.title ?? analysis.title ?? analysis.subject.question;
  const settings: StandaloneSettings = { measure };

  const shell = await bundleShell(entry, title);
  const html = inline(shell, analysis, settings);
  return {
    html,
    bytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html).length,
    warnings: checked.problems.filter((p) => p.severity === 'warning').map((p) => `${p.path || '(root)'}: ${p.message}`),
  };
}

/** The page without its data: Vite and the single-file plugin over the entry. */
async function bundleShell(entry: string, title: string): Promise<string> {
  const [vite, singleFile] = await peers();
  const root = await mkdtemp(join(tmpdir(), 'comparanda-build-'));
  try {
    await writeFile(join(root, 'main.js'), `import ${JSON.stringify(pathToFileURL(entry).href)};\n`);
    await writeFile(join(root, 'index.html'), template(title));
    await vite.build({
      root,
      base: './',
      configFile: false,
      envFile: false,
      publicDir: false,
      logLevel: 'error',
      plugins: [singleFile.viteSingleFile()],
      // The matrix is TSX on Preact; this only matters when building from source.
      esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
      build: { outDir: join(root, 'out'), emptyOutDir: true, modulePreload: false, reportCompressedSize: false },
    });
    return await readFile(join(root, 'out', 'index.html'), 'utf8');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function template(title: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    `<main id="${ROOT_ELEMENT_ID}"></main>`,
    `<script type="application/json" id="${ANALYSIS_ELEMENT_ID}"></script>`,
    `<script type="application/json" id="${SETTINGS_ELEMENT_ID}"></script>`,
    '<script type="module" src="./main.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Fill the two empty data elements Vite passed through. Each must be there exactly once. */
function inline(shell: string, analysis: Analysis, settings: StandaloneSettings): string {
  let html = shell;
  for (const [id, value] of [[ANALYSIS_ELEMENT_ID, analysis], [SETTINGS_ELEMENT_ID, settings]] as const) {
    const empty = `<script type="application/json" id="${id}"></script>`;
    const at = html.indexOf(empty);
    if (at < 0 || html.indexOf(empty, at + 1) >= 0) {
      throw new Error(`the bundled page does not carry exactly one empty #${id} element; the build template and the bundler disagree.`);
    }
    // Spliced, not String.replace: a `$&` in the data must stay literal.
    const filled = `<script type="application/json" id="${id}">${scriptSafeJson(value)}</script>`;
    html = html.slice(0, at) + filled + html.slice(at + empty.length);
  }
  return html;
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
    throw new Error(
      `comparanda build needs ${BUILD_PEERS.join(' and ')}, which are optional and not installed here. ` +
        `Install them beside comparanda: npm install --save-dev ${BUILD_PEERS.join(' ')}` +
        ` (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
