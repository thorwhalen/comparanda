/**
 * The accessibility gate, browser half (ADR-0029, #105): the checks that need
 * a rendered page, each shown to hold on the shipped view and to fail on its
 * own broken fixture. Run by `pnpm test:a11y`.
 */
import { BROWSER_CHECKS } from './browser-checks.js';
import { withBrowserEnv } from './browser-env.js';
import { gateTests } from './gate.js';

gateTests('browser', BROWSER_CHECKS, withBrowserEnv);
