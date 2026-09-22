/**
 * Core never branches on a literal missingness reason code.
 *
 * ADR-0009 as amended, and #44: the `structural` / `terminal` / `informative`
 * flags are enough to drive every completeness computation and every rendering
 * decision. That is what makes a deployment's custom code -- which core has
 * never heard of -- unable to break the completeness report: it declares its
 * flags and a `broader` parent, and everything downstream reads the flags.
 *
 * The first `case 'not-evidenced':` in core quietly ends that guarantee, because
 * a custom child of `not-evidenced` will not take the branch. So this file scans
 * `src/core` and fails on:
 *
 *   - `case '<core code>'`
 *   - `=== '<core code>'` / `!==` / `==` / `!=`, either side
 *   - an equality against the named constants for a core code
 *     (`NOT_ASSESSED`, `NOT_APPLICABLE`), which are the same literal by another
 *     name
 *
 * Writing a code (`code: NOT_ASSESSED`) is not branching on one and is not
 * flagged. The single allowed comparison is listed in `ALLOWED` with its reason,
 * and the allowlist is itself checked for staleness.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_MISSING_CODES } from '../src/core/schema/missingness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = join(root, 'src', 'core');

const CODES = Object.keys(CORE_MISSING_CODES);
/** Exported constants whose value is a core code. Kept in step by a test below. */
const CODE_CONSTANTS = ['NOT_ASSESSED', 'NOT_APPLICABLE'];

/**
 * Comparisons that are declaration invariants rather than behaviour keyed on a
 * code. Each entry is a file (relative to the repo) and a fragment of the line.
 */
const ALLOWED: { file: string; fragment: string; why: string }[] = [
  {
    file: 'src/core/schema/analysis.ts',
    fragment: 'structural === true && broader !== NOT_APPLICABLE',
    why: 'ADR-0009 precedence: a code declaring structural: true must have broader ' +
      '"not-applicable". This validates a declaration; it does not branch on a cell\'s code.',
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literal = `(['"\`])(?:${CODES.map(escape).join('|')})\\1`;
const constant = `\\b(?:${CODE_CONSTANTS.join('|')})\\b`;
const eq = '(?:===|!==|==|!=)';
const PATTERNS: RegExp[] = [
  new RegExp(`\\bcase\\s+${literal}`),
  new RegExp(`${eq}\\s*${literal}`),
  new RegExp(`${literal}\\s*${eq}`),
  new RegExp(`\\bcase\\s+${constant}`),
  new RegExp(`${eq}\\s*${constant}`),
  new RegExp(`${constant}\\s*${eq}`),
];

/** Code only: drop `//` comments and lines inside block comments. */
function codeLines(source: string): [number, string][] {
  const out: [number, string][] = [];
  let inBlock = false;
  source.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    line = line.replace(/\/\/.*$/, '');
    out.push([i + 1, line]);
  });
  return out;
}

/** Every line in `source` that branches on a core code. */
function offendingLines(source: string): [number, string][] {
  return codeLines(source).filter(([, line]) => PATTERNS.some((p) => p.test(line)));
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('the detector', () => {
  it('catches a switch, and an equality either way round, on a literal code', () => {
    const offending = [
      "case 'not-evidenced':",
      'case "withheld": return 0;',
      "if (m.code === 'deferred') {",
      "if ('indeterminate' !== code) {",
      'const quiet = code == `not-assessed`;',
      'if (code === NOT_ASSESSED) {',
      'case NOT_APPLICABLE:',
      'return NOT_APPLICABLE !== c;',
    ];
    for (const line of offending) {
      expect(offendingLines(line), `should have flagged: ${line}`).toHaveLength(1);
    }
  });

  it('does not fire on writing a code, a comment, or an unrelated string', () => {
    const innocent = [
      'cells.push({ hasValue: false, code: NOT_ASSESSED });',
      "const fallback = { code: 'not-assessed' };",
      "// case 'withheld': used to be here",
      "if (level === 'nominal') {",
      "if (status === 'deferred-review') {",
      'fix: `set broader to "${NOT_APPLICABLE}"`,',
      "if (facts.terminal === true) {",
    ];
    for (const line of innocent) {
      expect(offendingLines(line), `should NOT have flagged: ${line}`).toEqual([]);
    }
  });

  it('skips a multi-line block comment and resumes after it', () => {
    const src = [
      '/**',
      " * case 'withheld':",
      ' */',
      "if (x === 'withheld') {}",
    ].join('\n');
    expect(offendingLines(src).map(([n]) => n)).toEqual([4]);
  });

  it('knows every constant that names a core code', () => {
    const missingness = readFileSync(join(coreDir, 'schema', 'missingness.ts'), 'utf8');
    const named = [...missingness.matchAll(/export const (\w+) = (['"])([\w-]+)\2 as const/g)]
      .filter((m) => CODES.includes(m[3]!))
      .map((m) => m[1]);
    expect(named.sort()).toEqual([...CODE_CONSTANTS].sort());
  });
});

describe('src/core', () => {
  const files = tsFiles(coreDir);

  it('has files to scan (so a pass means something)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never branches on a literal missingness reason code', () => {
    const found: string[] = [];
    for (const f of files) {
      const rel = relative(root, f).split('\\').join('/');
      for (const [n, line] of offendingLines(readFileSync(f, 'utf8'))) {
        if (ALLOWED.some((a) => a.file === rel && line.includes(a.fragment))) continue;
        found.push(`${rel}:${n}: ${line.trim()}`);
      }
    }
    expect(
      found,
      'core branched on a reason code. Read the code\'s flags (structural / terminal / ' +
        'informative) or resolve it through its `broader` chain instead (ADR-0009):\n' +
        found.join('\n'),
    ).toEqual([]);
  });

  it('has no stale allowlist entry', () => {
    for (const a of ALLOWED) {
      const source = readFileSync(join(root, a.file), 'utf8');
      const hit = offendingLines(source).some(([, line]) => line.includes(a.fragment));
      expect(hit, `ALLOWED entry no longer matches anything: ${a.file}: ${a.fragment}`).toBe(true);
    }
  });
});
