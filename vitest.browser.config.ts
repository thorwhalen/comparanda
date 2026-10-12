import type { BrowserCommand } from 'vitest/node';
import { defineConfig } from 'vitest/config';

/**
 * Emulate a display mode the page cannot set for itself: forced colors, or the
 * print medium (#102, ADR-0028). Chromium applies forced colors for real under
 * this emulation, so a test reads what such a reader sees, not a stylesheet.
 */
const emulateMedia: BrowserCommand<[{ forcedColors?: 'active' | 'none'; media?: 'print' | 'screen' | null }]> = async (ctx, options) => {
  if (ctx.provider.name !== 'playwright') throw new Error('emulateMedia needs the playwright provider');
  await (ctx as unknown as { page: { emulateMedia(o: object): Promise<void> } }).page.emulateMedia(options);
};

/**
 * The browser suite (#41, ADR-0029): tests that must run in a real browser.
 *
 * Kept apart from `vitest.config.ts` so the core suite stays a plain-Node run
 * with no browser to install (ADR-0005), and so `pnpm check` does not need
 * Chromium. CI runs this in its own job; the accessibility gate (ADR-0029, #105)
 * extends it by adding files under `tests/browser/`, without changing the job.
 */
export default defineConfig({
  // Discovered late, a dependency makes Vite reload mid-run and fail the tests
  // already in flight; name the view's runtime imports up front.
  optimizeDeps: { include: ['preact', 'preact/hooks', 'preact/jsx-runtime'] },
  test: {
    include: ['tests/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
      commands: { emulateMedia },
    },
  },
});
