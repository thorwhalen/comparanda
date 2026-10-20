/**
 * The zero-network pre-filter and the policy, in plain Node (#115, ADR-0013).
 * The build's browser check, and the policy enforced on a real page, are in
 * `tests/standalone/network.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { CSP, CSP_DIRECTIVES, CSP_META, staticNetworkFindings } from '../src/build/network.js';

const page = (script: string, extra = '') =>
  `<!doctype html><html><head><meta charset="utf-8">${CSP_META}${extra}</head><body><script type="module">${script}</script></body></html>`;

describe('the policy', () => {
  it('is ADR-0013\'s directive set, with connect-src spelled out', () => {
    expect(CSP_DIRECTIVES).toEqual([
      "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:',
      "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
    ]);
    expect(CSP_META).toContain(`content="${CSP}"`);
  });

  it('does not trip the pre-filter itself', () => {
    expect(staticNetworkFindings(page('console.log(1)'))).toEqual([]);
  });
});

describe('the static pre-filter', () => {
  const hits = (html: string) => staticNetworkFindings(html).map((f) => f.what);

  for (const [code, what] of [
    ['fetch("/x")', 'a fetch() call'],
    ['window.fetch ( u )', 'a fetch() call'],
    ['new XMLHttpRequest()', 'XMLHttpRequest'],
    ['new EventSource(u)', 'EventSource'],
    ['new WebSocket(u)', 'WebSocket'],
    ['n.sendBeacon(u, d)', 'sendBeacon'],
    ['new Worker(u)', 'a worker'],
    ['fetch.call(globalThis, u)', 'a fetch() call'],
    ['globalThis.fetch(u)', 'a fetch() call'],
    ['new RTCPeerConnection(c)', 'a WebRTC connection, which no CSP governs'],
    ['window.open(u)', 'window.open, which no CSP governs'],
    ['location.assign(u)', 'a navigation through location, which no CSP governs'],
    ['window.location.href = u', 'a navigation through location, which no CSP governs'],
    ['window.location=u', 'a navigation through location, which no CSP governs'],
    ['location.href += "#"', 'a navigation through location, which no CSP governs'],
    ['location?.assign(u)', 'a navigation through location, which no CSP governs'],
    ['document.location.replace(u)', 'a navigation through location, which no CSP governs'],
    ['import("./chunk.js")', 'a dynamic import'],
    ['const css = "@import \'x.css\';"', 'a CSS @import'],
    ['const css = "td { background: url(https://example.invalid/x.png) }"', 'a CSS url() naming a remote resource'],
    ['const css = "td { background: url(//example.invalid/x.png) }"', 'a CSS url() naming a remote resource'],
  ] as const) {
    it(`flags ${what} in code: ${code}`, () => {
      expect(hits(page(code))).toContain(what);
    });
  }

  it('flags an attribute naming a URL in the markup', () => {
    expect(hits(page('', '<link rel="stylesheet" href="x.css">'))).toContain('an attribute naming a URL');
    expect(hits(page('', '<img src=https://example.invalid/p.png>'))).toContain('an attribute naming a URL');
    expect(hits(page('', '<div style="background: url(https://example.invalid/p.png)"></div>'))).toContain('a CSS url() naming a remote resource');
  });

  it('passes what is not a request: data: and fragment URLs, the SVG namespace, words in prose', () => {
    const code = [
      'const ns = "http://www.w3.org/2000/svg";',
      'const css = "td { background: url(data:image/png;base64,AAAA); mask: url(#m) }";',
      'const prefetch = 1; refetch(); const fetcher = 2;',
      'cache.fetch(key); if (typeof WebSocket === "undefined") {} x.open("GET", u);',
      'location.hash = "#c3"; if (location.protocol === "file:") {} const here = location.href; allocation = 3;',
      'let location = a; function f(location = 2) {} row.location = 1; a.location.replace(/x/g, "");',
    ].join('\n');
    expect(hits(page(code, '<link rel="icon" href="data:,">'))).toEqual([]);
  });

  it('reads only the page\'s code and markup: a script element\'s body is code, not markup', () => {
    expect(hits(page('el.innerHTML = "<a href=x>"'))).not.toContain('an attribute naming a URL');
  });
});
