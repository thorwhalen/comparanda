/**
 * `comparanda build` (#114, ADR-0017 clause 6): one analysis in, one HTML file
 * out, which opens from `file://` and renders the messy fixture completely.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium, type Browser } from 'playwright';

import { buildStandalone, type BuildResult } from '../../src/build/index.js';
import { Analysis } from '../../src/core/schema/analysis.js';
import { ANALYSIS_ELEMENT_ID } from '../../src/standalone/contract.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const relocationJson = JSON.parse(await readFile(join(repo, 'examples', 'relocation.json'), 'utf8'));
const relocation = Analysis.parse(relocationJson);

let dir: string;
let built: BuildResult;
let browser: Browser;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'comparanda-standalone-test-'));
  built = await buildStandalone(relocationJson);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

/** The JSON inlined in a built page, parsed. */
function inlinedAnalysis(html: string): unknown {
  const m = html.match(new RegExp(`<script type="application/json" id="${ANALYSIS_ELEMENT_ID}">([\\s\\S]*?)</script>`));
  expect(m, 'the page carries the analysis element').toBeTruthy();
  return JSON.parse(m![1]!);
}

/** Open a page from file://, and report what it rendered and what it asked the network for. */
async function open(html: string, name: string) {
  const file = join(dir, name);
  await writeFile(file, html);
  const page = await browser.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector('table, [role="alert"]', { timeout: 10_000 });
  const cells = await page.locator('tbody td').allTextContents();
  const alert = await page.locator('[role="alert"]').allTextContents();
  await page.close();
  return { cells, alert, errors, offPage: requests.filter((u) => u !== pathToFileURL(file).href) };
}

describe('the built file', () => {
  it('is one file: every script and style inline, nothing referenced by URL', () => {
    expect(built.html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(built.html).not.toMatch(/<link[^>]*\shref=/);
    expect(built.html).not.toMatch(/\b(?:src|href)="(?!data:)[^"#]/);
    expect(built.bytes).toBe(Buffer.byteLength(built.html));
    expect(built.gzipBytes).toBeLessThan(built.bytes);
  });

  it('carries the analysis as readable JSON, verbatim: the document as given, not the parsed copy', () => {
    expect(inlinedAnalysis(built.html)).toEqual(relocationJson);
  });

  it('opens from file:// and renders the messy fixture completely, asking the network for nothing', async () => {
    const { cells, alert, errors, offPage } = await open(built.html, 'relocation.html');
    expect(errors).toEqual([]);
    expect(alert).toEqual([]);
    expect(cells).toHaveLength(relocation.alternatives.length * relocation.criteria.length);
    for (const text of cells) expect(text.trim()).not.toBe('');
    expect(offPage).toEqual([]);
  });

  it('a page whose data is damaged says so, rather than showing nothing', async () => {
    const damaged = built.html.replace(`id="${ANALYSIS_ELEMENT_ID}">{`, `id="${ANALYSIS_ELEMENT_ID}">{oops`);
    const { alert, cells } = await open(damaged, 'damaged.html');
    expect(cells).toHaveLength(0);
    expect(alert.join(' ')).toMatch(/could not be shown/);
  });
});

describe('what goes into the file', () => {
  it('cannot be closed early by a string in the analysis', async () => {
    const hostile = structuredClone(relocationJson);
    hostile.alternatives[0].label = '</script><script>document.title="pwned"</script>';
    const { html } = await buildStandalone(hostile);
    expect(html).not.toContain('</script><script>document.title');
    expect((inlinedAnalysis(html) as { alternatives: { label: string }[] }).alternatives[0]!.label).toBe(hostile.alternatives[0].label);
  });

  it('keeps the title away from Vite\'s HTML transforms', async () => {
    const { html } = await buildStandalone(relocationJson, { title: 'Plans %MODE% & %BASE_URL% <b>' });
    expect(html).toContain('<title>Plans %MODE% &amp; %BASE_URL% &lt;b&gt;</title>');
  });

  it('refuses a measure the analysis does not have, rather than building a page that cannot show it', async () => {
    await expect(buildStandalone(relocationJson, { measure: 'nosuchmeasure' })).rejects.toThrow(/"nosuchmeasure" is not a measure/);
    await expect(buildStandalone(relocationJson, { measure: ' ' })).rejects.toThrow(/measure name is empty/);
  });

  it('refuses a page whose entry the bundler dropped', async () => {
    const entry = join(dir, 'inert.js');
    await writeFile(entry, 'export const nothing = 1;\n');
    await expect(buildStandalone(relocationJson, { entry })).rejects.toThrow(/dropped the standalone entry/);
  });

  it('refuses an analysis with validation errors, naming them', async () => {
    const broken = structuredClone(relocationJson);
    broken.cells[0].criterionId = 'no-such-criterion';
    await expect(buildStandalone(broken)).rejects.toThrow(/not valid[\s\S]*cells/);
  });

  it('projects for the reader before inlining: a withheld value is not in the file at all', async () => {
    const cell = relocation.cells.find((c) => c.assertions.some((s) => typeof s.value === 'number' && s.justification))!;
    const secret = cell.assertions.find((s) => typeof s.value === 'number' && s.justification)!;
    const { html } = await buildStandalone(relocationJson, { discloses: (s) => s.id !== secret.id });
    const inlined = Analysis.parse(inlinedAnalysis(html));
    const projected = inlined.cells.flatMap((c) => c.assertions).find((s) => s.id === secret.id)!;
    expect(projected.value).toBeUndefined();
    expect(html).not.toContain(JSON.stringify(secret.justification).slice(1, -1));
  });
});

describe('the shipped build (dist/), when it has been built', () => {
  const cli = join(repo, 'dist', 'cli.js');
  it.runIf(existsSync(cli))('dist/cli.js writes a page that opens from file:// and renders completely', async () => {
    const out = join(dir, 'from-dist.html');
    await promisify(execFile)(process.execPath, [cli, 'build', join(repo, 'examples', 'relocation.json'), '--out', out], { cwd: dir });
    const { cells, errors, offPage } = await open(await readFile(out, 'utf8'), 'from-dist-opened.html');
    expect(errors).toEqual([]);
    expect(cells).toHaveLength(relocation.alternatives.length * relocation.criteria.length);
    expect(offPage).toEqual([]);
  });

  // The shipped entry is one pre-bundled module; its manifest is what lets the budget see inside it (#116).
  const shippedEntry = join(repo, 'dist', 'standalone', 'main.js');
  it.runIf(existsSync(shippedEntry))('the shipped entry is charged per package, not all to comparanda', async () => {
    expect(existsSync(join(repo, 'dist', 'standalone', 'main.packages.json')), 'tsup wrote the package manifest').toBe(true);
    const { budget } = await buildStandalone(relocationJson, { entry: shippedEntry });
    const packages = budget.contributions.map((c) => c.package);
    expect(packages).toEqual(expect.arrayContaining(['comparanda', 'preact', 'zod']));
    expect(budget.contributions.find((c) => c.package === 'preact')!.bytes).toBeGreaterThan(0);
  });
});

describe('the command', () => {
  it('writes the page and prints its size', async () => {
    const out = join(dir, 'from-cli.html');
    const { stdout } = await promisify(execFile)(
      process.execPath, [join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(repo, 'src', 'cli.ts'),
        'build', join(repo, 'examples', 'relocation.json'), '--out', out],
      { cwd: dir },
    );
    expect(stdout).toMatch(/kB raw, .* kB gzipped/);
    // The shell, then the reservation, then what is charged, against the budget (#116).
    expect(stdout).toMatch(/the page without the analysis: [\d.]+ kB \+ [\d.]+ kB reserved for @atlaskit\/pragmatic-drag-and-drop = [\d.]+ kB, of a 200\.0 kB budget/);
    expect(Analysis.parse(inlinedAnalysis(await readFile(out, 'utf8')))).toEqual(relocation);
  });
});
