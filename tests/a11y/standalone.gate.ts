/**
 * The accessibility gate, standalone half (ADR-0029, #105): axe-core and the
 * zero-network rule over the built single file. Run by `pnpm test:a11y`.
 */
import { afterAll } from 'vitest';

import { gateTests } from './gate.js';
import { closeStandalone, STANDALONE_CHECKS, withStandaloneEnv } from './standalone-checks.js';

afterAll(closeStandalone);
gateTests('standalone', STANDALONE_CHECKS, withStandaloneEnv, { timeout: 120_000 });
