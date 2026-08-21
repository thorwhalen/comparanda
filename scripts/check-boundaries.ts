/**
 * Enforces the module boundaries the ADRs make load-bearing.
 *
 * Three properties, each of which has failed silently in a real project:
 *
 *   1. `core` has no DOM. ADR-0005: "If you need a DOM API in `core`, the design
 *      is wrong." Enforced by lint rule in CI "not by intention".
 *   2. `core` never imports from `view`. The dependency runs one way.
 *   3. Nothing reaches past its adapter. ADR-0013: one stray `fetch()` in a
 *      renderer breaks the standalone bundle, *and only offline* -- so it ships
 *      green and fails at the reader's desk.
 *
 * Run before the build (static) and again after (bundle inputs), because the
 * second is the one that actually proves ADR-0005's stated condition of
 * acceptance: that a core-only consumer gets no view code.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** Globals that only exist in a browser. Their presence in `core` is the bug. */
const DOM_GLOBALS = [
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'HTMLElement', 'Element', 'Node', 'CustomEvent', 'DOMParser',
  'requestAnimationFrame', 'getComputedStyle', 'matchMedia', 'BroadcastChannel',
];

/** Network reach. Legal only behind an adapter in `store/`. */
const NETWORK = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon'];

interface Violation { file: string; line: number; rule: string; text: string }

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

/** Strip comments and string literals so a mention in prose is not a violation. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => ' '.repeat(m.length));
}

function check(): Violation[] {
  const v: Violation[] = [];
  const add = (file: string, i: number, rule: string, text: string) =>
    v.push({ file: relative(ROOT, file), line: i + 1, rule, text: text.trim().slice(0, 100) });

  for (const file of walk(join(SRC, 'core'))) {
    const lines = strip(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const g of DOM_GLOBALS) {
        // Match the global only where it is *used* -- followed by a member
        // access, an index, or a call -- and not where it merely appears as a
        // property name. `{ document: current }` is a field called "document",
        // not the DOM, and flagging it trains people to ignore this check.
        const used = new RegExp(`(?<![.\\w$])${g}\\s*[.\\[(]`);
        const typeofGuard = new RegExp(`typeof\\s+${g}\\b`);
        if (used.test(line) || typeofGuard.test(line)) {
          add(file, i, `core-has-no-dom (${g})`, line);
        }
      }
      if (/from\s+['"][^'"]*\.\.\/view/.test(line) || /from\s+['"]\.\.\/\.\.\/view/.test(line)) {
        add(file, i, 'core-must-not-import-view', line);
      }
    });
  }

  // Network is legal only in store/ -- that is what "nothing reaches past its
  // adapter" means concretely.
  for (const file of [...walk(join(SRC, 'core')), ...walk(join(SRC, 'view'))]) {
    const lines = strip(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const n of NETWORK) {
        if (line.includes(n)) add(file, i, `no-network-outside-store (${n})`, line);
      }
    });
  }

  return v;
}

/**
 * ADR-0005's condition of acceptance, checked against the real build: does the
 * core bundle contain any view input? tsup writes a metafile we can read.
 */
function checkBundle(): Violation[] {
  const meta = join(ROOT, 'dist', 'metafile-esm.json');
  if (!existsSync(meta)) return [];
  const m = JSON.parse(readFileSync(meta, 'utf8')) as {
    outputs: Record<string, { inputs?: Record<string, unknown>; entryPoint?: string }>;
  };
  const v: Violation[] = [];
  for (const [out, info] of Object.entries(m.outputs)) {
    const isCoreEntry = info.entryPoint === 'src/index.ts';
    if (!isCoreEntry) continue;
    for (const input of Object.keys(info.inputs ?? {})) {
      if (input.includes('src/view/')) {
        v.push({ file: out, line: 0, rule: 'core-bundle-contains-view', text: input });
      }
    }
  }
  return v;
}

const violations = [...check(), ...checkBundle()];

if (violations.length === 0) {
  console.log('boundaries ok: core has no DOM, core does not import view, no network outside store');
  process.exit(0);
}

console.error(`\n${violations.length} boundary violation(s):\n`);
for (const x of violations) {
  console.error(`  ${x.file}:${x.line}\n    ${x.rule}\n    ${x.text}\n`);
}
console.error('See ADR-0005 (headless core) and ADR-0013 (nothing reaches past its adapter).\n');
process.exit(1);
