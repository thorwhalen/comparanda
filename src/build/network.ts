/**
 * Zero network, enforced by the browser and checked by the build (ADR-0013,
 * 2026-08-21 amendment; #115).
 *
 * The page carries a Content-Security-Policy meta tag whose `connect-src
 * 'none'` makes `fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket` and
 * `sendBeacon` fail at run time rather than merely be absent from the source.
 * Then `comparanda build` checks it twice before it writes anything:
 *
 * - **a static pre-filter** over the page's code and markup -- never the
 *   inlined analysis, which is inert data and may quote anything -- so a
 *   failure names the offending string rather than a request that did not
 *   happen;
 * - **a browser check that exercises the view**: the file is opened from
 *   `file://` in Chromium as built and once per encoding the page registers;
 *   every cell is focused, pressed and clicked, the keyboard is used, and a
 *   simulated minute is run on. Any console error, uncaught error, policy
 *   violation, request, navigation, new window or WebRTC connection fails the
 *   build -- the last two because no CSP governs them. Loading the page
 *   alone would miss the bug ADR-0013 names: a `fetch()` inside a cell
 *   renderer fires only when that renderer runs.
 *
 * A check that ran only in CI would not protect the person who builds locally
 * and mails the result, who is the whole reason the build command exists.
 *
 * Node only. The browser is Playwright's Chromium, an optional peer like Vite:
 * when it is missing the build says what to install, or how to ask for the
 * static check alone.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The directive set, exactly as ADR-0013's amendment writes it. `connect-src`
 * is spelled out though `default-src 'none'` implies it, so that relaxing
 * `default-src` later cannot silently reopen the network.
 */
export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
] as const);

/** The policy as one header value. */
export const CSP = CSP_DIRECTIVES.join('; ');

/** The meta tag that delivers it: a `file://` page has no response headers. First in `<head>`, before any script. */
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

/**
 * What the static pre-filter looks for, where, and the words for each. In the
 * page's code (its scripts and stylesheets, which include the matrix's CSS
 * string): the network APIs, by their global names, which minification keeps,
 * and CSS that loads a remote resource. In its markup: any attribute that names
 * a URL other than `data:` or a fragment. URL *strings* in code are not
 * flagged: Preact carries the SVG namespace URI, which is a name, not a request.
 */
export const NETWORK_PATTERNS: readonly { readonly what: string; readonly in: 'code' | 'markup'; readonly pattern: RegExp }[] = Object.freeze([
  // The global, called or borrowed; not a method of the same name (\`cache.fetch(k)\`).
  { what: 'a fetch() call', in: 'code', pattern: /(?<![\w$.])(?:(?:window|self|globalThis)\.)?fetch\s*(?:\(|\.(?:call|apply|bind)\b)/ },
  // Constructed, not merely named: \`typeof WebSocket\` is feature detection, not a request.
  { what: 'XMLHttpRequest', in: 'code', pattern: /\bnew\s+XMLHttpRequest\b/ },
  { what: 'EventSource', in: 'code', pattern: /\bnew\s+EventSource\b/ },
  { what: 'WebSocket', in: 'code', pattern: /\bnew\s+WebSocket\b/ },
  { what: 'a WebRTC connection, which no CSP governs', in: 'code', pattern: /\b(?:webkit)?RTCPeerConnection\b/ },
  { what: 'window.open, which no CSP governs', in: 'code', pattern: /\bwindow\.open\s*\(/ },
  { what: 'sendBeacon', in: 'code', pattern: /\bsendBeacon\b/ },
  { what: 'importScripts', in: 'code', pattern: /\bimportScripts\b/ },
  { what: 'a worker', in: 'code', pattern: /\bnew\s+(?:Shared)?Worker\s*\(/ },
  { what: 'a service worker', in: 'code', pattern: /\bserviceWorker\b/ },
  { what: 'a dynamic import', in: 'code', pattern: /\bimport\s*\(\s*[^)\s]/ },
  { what: 'a CSS @import', in: 'code', pattern: /@import\b/ },
  { what: 'a CSS url() naming a remote resource', in: 'code', pattern: /\burl\(\s*["']?(?!data:)(?:[a-z][a-z0-9+.-]*:|\/\/)/i },
  { what: 'an attribute naming a URL', in: 'markup', pattern: /\s(?:src|href|xlink:href|action|formaction|poster|srcset|ping|background|manifest)\s*=\s*(?!["']?(?:data:|#))/i },
  { what: 'a CSS url() naming a remote resource', in: 'markup', pattern: /\burl\(\s*["']?(?!data:)(?:[a-z][a-z0-9+.-]*:|\/\/)/i },
]);

/** One hit of the pre-filter: what it is and where. */
export interface NetworkFinding {
  readonly what: string;
  /** The matched text with a little context either side. */
  readonly excerpt: string;
}

/** The bodies of a page's script and style elements, and the markup with them taken out. */
function partsOf(html: string): { code: string; markup: string } {
  const element = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
  const code = [...html.matchAll(element)].map((m) => m[3]!).join('\n');
  return { code, markup: html.replace(element, '$1$4') };
}

/**
 * The static pre-filter over a page shell: the HTML before the analysis is
 * spliced in, so nothing an author wrote in a justification can trip it.
 * Returns every hit; empty means nothing was found, not that the page is
 * proven offline -- that is the browser check's job.
 */
export function staticNetworkFindings(shell: string): NetworkFinding[] {
  const parts = partsOf(shell);
  const findings: NetworkFinding[] = [];
  for (const { what, in: where, pattern } of NETWORK_PATTERNS) {
    const text = parts[where];
    for (const m of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      const at = m.index ?? 0;
      findings.push({ what, excerpt: text.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, ' ') });
    }
  }
  return findings;
}

/** The build refused a page that reaches, or tries to reach, past itself. */
export class NetworkReached extends Error {
  readonly findings: readonly string[];
  constructor(how: string, findings: readonly string[]) {
    super(`no page was built: ${how} (ADR-0013: the standalone page asks the network for nothing):\n${findings.map((f) => `  ${f}`).join('\n')}`);
    this.name = 'NetworkReached';
    this.findings = findings;
  }
}

/** What the browser check is given: the page, and how to open it with a given encoding. */
export interface BrowserCheckOptions {
  /** The page as built. */
  readonly page: string;
  /** The same page, opening with `encoding`. */
  readonly withEncoding: (encoding: string) => string;
  /**
   * The encodings to exercise. Default: every one the page itself registers,
   * read from its matrix. One the page does not register is a failure: its
   * renderer would never run, and a pass that ran nothing is not a check.
   */
  readonly encodings?: readonly string[];
  /** How long a page may take to render the matrix. */
  readonly renderTimeoutMs?: number;
  /**
   * How much time the page is run on for after it has been driven, on a
   * simulated clock, so a request a renderer puts off with a timer is made
   * inside the check. Simulated: it costs milliseconds, not this long.
   */
  readonly settleMs?: number;
}

/** What the browser check found, and which encodings it saw drawn. */
export interface BrowserCheckResult {
  readonly problems: readonly string[];
  /** The encodings that drew the matrix, each one's renderer having run over every cell. */
  readonly drawn: readonly string[];
  /** Registered encodings that could not draw this analysis: prepared, and fallen back to text. */
  readonly couldNotDraw: readonly string[];
}

/** How long a page gets to render the matrix, by default. */
export const RENDER_TIMEOUT_MS = 15_000;

/** Simulated time a page is run on for after it is driven, by default: a minute. */
export const SETTLE_MS = 60_000;

/**
 * Installed before the page's own scripts. Reports, rather than allows, the
 * reaches a Content-Security-Policy does not govern -- a new window, a WebRTC
 * connection -- and records every policy violation as it happens.
 */
const WATCH = `(() => {
  const seen = (window.__comparandaCheck = []);
  document.addEventListener('securitypolicyviolation', (e) => seen.push('policy violation: ' + e.violatedDirective + ' ' + e.blockedURI), true);
  window.open = (url) => { seen.push('window.open(' + url + ')'); return null; };
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
    if (name in window) Object.defineProperty(window, name, { configurable: true, value: function () { seen.push(name + ' constructed'); throw new TypeError(name + ' is refused by the comparanda zero-network check'); } });
  }
})();`;

/**
 * Open the page from `file://` in Chromium, as built and then once per
 * encoding; in each, focus, press and click every cell and header, use the
 * keyboard, and run the clock on. Any console error (how a CSP violation
 * surfaces), uncaught error, policy violation, request, navigation, new
 * window or WebRTC connection is a problem, prefixed with its pass.
 */
export async function exerciseInBrowser(options: BrowserCheckOptions): Promise<BrowserCheckResult> {
  const { page: built, withEncoding, renderTimeoutMs = RENDER_TIMEOUT_MS, settleMs = SETTLE_MS } = options;
  const { chromium } = await playwright();
  const dir = await mkdtemp(join(tmpdir(), 'comparanda-check-'));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw new Error(`comparanda build could not start Chromium for the zero-network check: ${firstLine(error)}. ${INSTALL_HINT}`);
    }
    const problems: string[] = [];
    let passes = 0;
    /** One pass: the page drawn, driven and run on. Returns what its matrix says it drew and could draw. */
    const pass = async (name: string, html: string) => {
      const file = join(dir, `pass-${passes++}.html`);
      await writeFile(file, html);
      const url = pathToFileURL(file).href;
      const said = (what: string) => problems.push(`${name}: ${what}`);
      const context = await browser!.newContext();
      try {
        await context.addInitScript(WATCH);
        await context.clock.install();
        context.on('request', (r) => { if (r.url() !== url && !/^(?:data|blob):/.test(r.url())) said(`request for ${r.url()}`); });
        context.on('console', (m) => { if (m.type() === 'error') said(`console error: ${m.text()}`); });
        const page = await context.newPage();
        // On the context, not the page: any other page in it is a window this one opened.
        context.on('page', (p) => { if (p !== page) said(`opened a window${p.url() && p.url() !== 'about:blank' ? ` at ${p.url()}` : ''}`); });
        page.on('pageerror', (e) => said(`uncaught error: ${e.message}`));
        page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url() !== url) said(`navigated to ${f.url()}`); });
        await page.goto(url);
        await page.waitForSelector('.comparanda-matrix, [role="alert"]', { timeout: renderTimeoutMs });
        const alert = await page.locator('[role="alert"]').allTextContents();
        if (alert.length > 0) said(`the page could not show the comparison: ${alert.join(' ')}`);
        // Every cell and header is focused, pressed and clicked: each one's handlers run.
        await page.evaluate(() => {
          for (const cell of Array.from(document.querySelectorAll<HTMLElement>('[data-cell]'))) {
            cell.focus();
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
              cell.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true }));
            }
          }
        });
        for (const key of ['Control+Home', 'ArrowRight', 'ArrowDown', 'End', 'Home', 'Control+End']) await page.keyboard.press(key);
        await page.clock.runFor(settleMs);
        const seen = await page.evaluate(() => (window as unknown as { __comparandaCheck?: string[] }).__comparandaCheck ?? []);
        for (const what of seen) said(what);
        // Awaited here, inside the try: the context closes in the finally.
        return await page.evaluate(() => {
          const root = document.querySelector('.comparanda-matrix');
          return { drew: root?.getAttribute('data-encoding') ?? undefined, registered: (root?.getAttribute('data-encodings') ?? '').split(' ').filter(Boolean) };
        });
      } catch (error) {
        said(`the check could not drive the page: ${firstLine(error)}`);
        return { drew: undefined, registered: [] as string[] };
      } finally {
        await context.close();
      }
    };

    const asBuilt = await pass('as built', built);
    const registered = new Set(asBuilt.registered);
    const wanted = options.encodings ?? asBuilt.registered;
    const drawn: string[] = [];
    const couldNotDraw: string[] = [];
    for (const encoding of wanted) {
      if (!registered.has(encoding)) {
        problems.push(`encoding "${encoding}": the page does not register it, so its renderer cannot be exercised (it registers ${asBuilt.registered.map((e) => `"${e}"`).join(', ') || 'none'})`);
        continue;
      }
      const { drew } = await pass(`encoding "${encoding}"`, withEncoding(encoding));
      (drew === encoding ? drawn : couldNotDraw).push(encoding);
    }
    return { problems, drawn, couldNotDraw };
  } finally {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const INSTALL_HINT =
  'Install it beside comparanda (npm install --save-dev playwright && npx playwright install chromium), ' +
  'or build with the static check alone (--check static), which still writes the CSP into the page.';

type Playwright = typeof import('playwright');

async function playwright(): Promise<Playwright> {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(`comparanda build needs playwright for the zero-network check, and could not load it: ${firstLine(error)}. ${INSTALL_HINT}`);
  }
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]!.replace(/[.\s]+$/, '');
}
