/**
 * The core test suite runs where there is no DOM (#38, ADR-0005).
 *
 * `vitest.config.ts` sets `environment: 'node'`, so touching `document` or
 * `window` in core throws. That holds only while nothing installs them: a
 * per-file environment pragma (vitest's `@` + `vitest-environment` comment), or a setup file that polyfills a global,
 * would make core tests pass against an API core must not use. This file fails
 * if either has happened to the suite it runs in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));

describe('the core test environment', () => {
  it('has no document and no window', () => {
    // Not `navigator`: Node >= 21 defines a minimal one with no DOM on it.
    for (const name of ['document', 'window', 'HTMLElement', 'localStorage']) {
      expect(name in globalThis, `${name} exists in the core test environment`).toBe(false);
    }
  });

  it('throws when core-style code touches the DOM', () => {
    expect(() => (globalThis as unknown as { document: { title: string } }).document.title).toThrow();
  });

  it('is not switched to a DOM environment by any core test file', () => {
    // Tests that need a DOM belong under tests/view/, which opts in on purpose.
    // Built from parts so this file does not itself carry the pragma.
    const pragma = new RegExp('@' + 'vitest-environment\\s+(?!node\\b)\\w+');
    const offenders = readdirSync(testsDir)
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => pragma.test(readFileSync(join(testsDir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
