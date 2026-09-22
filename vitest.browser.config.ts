import { defineConfig } from 'vitest/config';

/**
 * The browser suite (#41, ADR-0029): tests that must run in a real browser.
 *
 * Kept apart from `vitest.config.ts` so the core suite stays a plain-Node run
 * with no browser to install (ADR-0005), and so `pnpm check` does not need
 * Chromium. CI runs this in its own job; the accessibility gate (ADR-0029, #105)
 * extends it by adding files under `tests/browser/`, without changing the job.
 */
export default defineConfig({
  test: {
    include: ['tests/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
