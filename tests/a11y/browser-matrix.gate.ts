/**
 * The browser half's cross-fixture matrix (ADR-0029, #105), one shard of it: each check's
 * broken fixture, run against every other check, trips none it does not declare. The shard
 * comes from the project that runs this file (`vitest.a11y.config.ts` provides
 * `a11yMatrixShard`), so the shards run side by side, each in its own browser, and the
 * matrix's square growth (#375) is spread over them rather than added to one run.
 */
import { inject } from 'vitest';

import { BROWSER_CHECKS } from './browser-checks.js';
import { withBrowserEnv } from './browser-env.js';
import { crossFixtureTests, type Shard } from './gate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    a11yMatrixShard: Shard;
  }
}

crossFixtureTests('browser', BROWSER_CHECKS, withBrowserEnv, { shard: inject('a11yMatrixShard') });
