/**
 * comparanda -- headless core.
 *
 * A schema for a structured comparison, plus the logic over it. No DOM, no
 * framework, testable in plain Node. The view lives behind `comparanda/view`
 * and persistence adapters behind `comparanda/store`; neither is imported here.
 */
export * from './core/schema/index.js';
export * from './core/migrations.js';
export * from './core/analyses/index.js';
export * from './core/view-state.js';
export * from './core/reorder.js';
