import { defineConfig } from 'vitest/config';

/**
 * The standalone build (#114, ADR-0017 clause 6): Node tests that run Vite and
 * then open the file it wrote from `file://` in Chromium.
 *
 * Kept out of the core suite because they need the build peers and a browser;
 * CI runs them in the browser job, where Chromium is installed. One file, run
 * serially: a Vite build and a browser are each heavy on a small machine.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/standalone/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
