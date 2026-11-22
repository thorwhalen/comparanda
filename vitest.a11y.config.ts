import { defineConfig } from 'vitest/config';

import browser from './vitest.browser.config.js';

/**
 * How many browsers share the cross-fixture matrix (#375): it grows with the square of the
 * checks (each fixture against every other check), so it runs in this many shards side by
 * side, each a project of its own (its own browser, so one shard's media emulation cannot
 * reach another's page). Raise it when the gate's step nears its limit.
 */
export const MATRIX_SHARDS = 3;

/**
 * The accessibility merge gate (ADR-0029, #105): the A1-A23 checks, each with a
 * deliberately broken fixture, in the three runtimes their mechanisms need.
 *
 * Kept out of the other suites' globs (`*.gate.ts`, not `*.test.ts`) so a
 * check and its fixtures are not run twice, and CI can name this job as the
 * required status.
 */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'a11y-node', environment: 'node', include: ['tests/a11y/node.gate.ts', 'tests/a11y/manual-pass.gate.ts', 'tests/a11y/spec.gate.ts'] } },
      {
        ...browser,
        test: { ...browser.test, name: 'a11y-browser', include: ['tests/a11y/browser.gate.ts', 'tests/a11y/watch.gate.ts'] },
      },
      ...Array.from({ length: MATRIX_SHARDS }, (_, i) => ({
        ...browser,
        test: {
          ...browser.test, name: `a11y-browser-matrix-${i + 1}`, include: ['tests/a11y/browser-matrix.gate.ts'],
          // Instances of their own: vitest names each instance after its project, in place.
          browser: { ...browser.test!.browser!, instances: browser.test!.browser!.instances!.map((instance) => ({ ...instance })) },
          provide: { a11yMatrixShard: [i + 1, MATRIX_SHARDS] as [number, number] },
        },
      })),
      {
        // The engine-dependent checks again, in Firefox (#213).
        ...browser,
        test: {
          ...browser.test, name: 'a11y-firefox', include: ['tests/a11y/firefox.gate.ts'],
          browser: { ...browser.test!.browser!, instances: [{ browser: 'firefox' as const }] },
        },
      },
      {
        test: {
          name: 'a11y-standalone', environment: 'node', include: ['tests/a11y/standalone.gate.ts'],
          testTimeout: 120_000, hookTimeout: 180_000, fileParallelism: false,
        },
      },
    ],
  },
});
