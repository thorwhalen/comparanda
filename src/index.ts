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
export * from './core/saved-views.js';
export * from './core/reorder.js';
export * from './core/layout.js';
export * from './core/assertion-set.js';
export * from './core/rater-strip.js';
export * from './core/cell-words.js';
export * from './core/detail.js';
export * from './core/activity.js';
export * from './core/threads.js';
export * from './core/orphans.js';
export * from './core/suggestions.js';
export * from './core/suggestion-list.js';
export * from './core/identity.js';
export * from './core/criteria-revision.js';
export * from './core/affordances.js';
export * from './core/revision.js';
export * from './core/annotation-history.js';
