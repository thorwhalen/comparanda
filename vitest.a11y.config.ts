import { defineConfig } from 'vitest/config';

import browser from './vitest.browser.config.js';

/**
 * The accessibility merge gate (ADR-0029, #105): the A1-A20 checks, each with a
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
      { ...browser, test: { ...browser.test, name: 'a11y-browser', include: ['tests/a11y/browser.gate.ts'] } },
      {
        test: {
          name: 'a11y-standalone', environment: 'node', include: ['tests/a11y/standalone.gate.ts'],
          testTimeout: 120_000, hookTimeout: 180_000, fileParallelism: false,
        },
      },
    ],
  },
});
