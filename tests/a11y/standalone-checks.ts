/**
 * The accessibility gate's checks on the built standalone page (ADR-0029,
 * ADR-0013, #105): axe-core over the file a reader is actually handed, and the
 * zero-network rule observed from outside the page.
 *
 * The environment is the page's HTML, which a broken fixture edits before the
 * browser sees it, and a way to open it from `file://` as a reader would.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { buildStandalone } from '../../src/build/index.js';
import { CSP_META, staticNetworkFindings } from '../../src/build/network.js';
import type { Check, WithEnv } from './gate.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMES = ['light', 'dark'] as const;
/**
 * Axe rules the shipped page is known to fail, each with the issue that ends
 * the exception. A1 fails if one of these stops being reported, so an exception
 * cannot outlive its fix.
 */
const KNOWN_AXE_EXCEPTIONS: Readonly<Record<string, string>> = {
  'page-has-heading-one': 'comparanda#211: the standalone shell has no <h1>',
};

/** How long A19 watches after the matrix is up, for a request deferred to a timer. */
const LATE_REQUEST_MS = 500;

export interface StandaloneEnv {
  /** The built page, as a reader gets it. A fixture edits it before the browser opens it. */
  html: string;
  /** Open `html` from file:// under a colour scheme. Pages opened are closed when the run ends. */
  open(options?: { colorScheme?: 'light' | 'dark' }): Promise<{ page: Page; requests: string[]; file: string }>;
}

let shared: Promise<{ browser: Browser; built: string; dir: string }> | undefined;
/** One build and one browser for the whole file: both are heavy, and a check only reads. */
function sharedBuild() {
  shared ??= (async () => {
    const analysis = JSON.parse(await readFile(join(repo, 'examples', 'relocation.json'), 'utf8'));
    const [built, browser, dir] = await Promise.all([buildStandalone(analysis), chromium.launch(), mkdtemp(join(tmpdir(), 'comparanda-a11y-'))]);
    return { browser, built: built.html, dir };
  })();
  return shared;
}

/** Close the browser and remove the scratch directory. */
export async function closeStandalone(): Promise<void> {
  if (!shared) return;
  const { browser, dir } = await shared;
  shared = undefined;
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}

export const withStandaloneEnv: WithEnv<StandaloneEnv> = async (sabotage, use) => {
  const { browser, built, dir } = await sharedBuild();
  const contexts: BrowserContext[] = [];
  let n = 0;
  const env: StandaloneEnv = {
    html: built,
    async open({ colorScheme = 'light' } = {}) {
      const file = join(dir, `page-${n++}.html`);
      await writeFile(file, env.html);
      // axe-core needs a page of its own context, so a scheme is a context's.
      const context = await browser.newContext({ colorScheme });
      contexts.push(context);
      const page = await context.newPage();
      const requests: string[] = [];
      const own = pathToFileURL(file).href;
      // Every request attempted, including the ones the page's own policy then refuses.
      page.on('request', (r) => { if (r.url() !== own && !r.url().startsWith('data:')) requests.push(r.url()); });
      await page.goto(own);
      await page.waitForSelector('table[role="grid"]', { timeout: 15_000 });
      return { page, requests, file };
    },
  };
  try {
    await sabotage?.(env);
    return await use(env);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
};

const a1: Check<StandaloneEnv> = {
  id: 'A1',
  async run(env) {
    const found: string[] = [];
    const seen = new Set<string>();
    for (const scheme of SCHEMES) {
      const { page } = await env.open({ colorScheme: scheme });
      // Once as it opens, and once with the detail panel up: the markup a reader meets after Enter.
      for (const state of ['as opened', 'with the panel open']) {
        if (state !== 'as opened') {
          await page.locator('tbody td').first().focus();
          await page.keyboard.press('Enter');
          await page.waitForSelector('[role="complementary"]');
        }
        const { violations } = await new AxeBuilder({ page }).analyze();
        for (const v of violations) seen.add(v.id);
        for (const v of violations.filter((x) => !(x.id in KNOWN_AXE_EXCEPTIONS))) found.push(`${scheme}, ${state}: ${v.id} (${v.impact}): ${v.help}; ${v.nodes.length} node(s), first ${v.nodes[0]?.target.join(' ')}`);
      }
    }
    for (const rule of Object.keys(KNOWN_AXE_EXCEPTIONS)) {
      if (!seen.has(rule)) found.push(`the exception for ${rule} (${KNOWN_AXE_EXCEPTIONS[rule]}) is no longer needed: remove it`);
    }
    return found;
  },
  broken: {
    what: 'an image with no alternative text',
    sabotage: (env) => { env.html = env.html.replace('</body>', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"></body>'); },
  },
};

const a19: Check<StandaloneEnv> = {
  id: 'A19',
  async run(env) {
    const found = staticNetworkFindings(env.html).map((f) => `the page's source reaches for the network: ${f.what}`);
    const { page, requests } = await env.open();
    // A moment for anything deferred to a timer or an idle callback to be asked for.
    await page.waitForTimeout(LATE_REQUEST_MS);
    found.push(...requests.map((url) => `the page asked for ${url}`));
    return found;
  },
  broken: {
    what: 'the page asks for an image from a script, with no policy to stop it',
    // Caught by watching the requests, which is the half of A19 the static pre-filter does not do.
    mustSay: /the page asked for/,
    sabotage: (env) => {
      env.html = env.html.replace(CSP_META, '').replace('</body>', '<script>new Image().src = ["http:", "", "127.0.0.1:9", "pixel.gif"].join("/");</script></body>');
    },
  },
};

export const STANDALONE_CHECKS: readonly Check<StandaloneEnv>[] = [a1, a19];
