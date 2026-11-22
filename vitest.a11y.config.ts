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
 * Which part of the gate this run holds (`A11Y_PART`): `all` (the default, every project at
 * once, for a local run), `main` (every project but the matrix shards) or `matrix-<k>` (one
 * shard). CI runs each part on its own runner (`ci.yml`, job `a11y-part`), since six browsers
 * on one runner starve each other into timeouts; the `a11y-gate` job then requires them all.
 */
export const A11Y_PARTS = ['main', ...Array.from({ length: MATRIX_SHARDS }, (_, i) => `matrix-${i + 1}`)] as const;
const PART = process.env['A11Y_PART'] ?? 'all';
if (PART !== 'all' && !(A11Y_PARTS as readonly string[]).includes(PART)) {
  throw new Error(`A11Y_PART is ${JSON.stringify(PART)}; it must be "all" or one of ${A11Y_PARTS.join(', ')}`);
}

const projects = [
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
];

const isShard = (p: (typeof projects)[number]) => /^a11y-browser-matrix-/.test(p.test?.name ?? '');
const chosen = PART === 'all' ? projects : PART === 'main' ? projects.filter((p) => !isShard(p)) : projects.filter((p) => p.test?.name === `a11y-browser-${PART}`);

export default defineConfig({ test: { projects: chosen } });
