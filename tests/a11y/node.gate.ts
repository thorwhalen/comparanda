/**
 * The accessibility gate, plain-Node half (ADR-0029, #105): the announcement
 * of a move and the source-level bans. Run by `pnpm test:a11y`.
 */
import { NODE_CHECKS, withNodeEnv } from './node-checks.js';
import { gateTests } from './gate.js';

gateTests('node', NODE_CHECKS, withNodeEnv);
