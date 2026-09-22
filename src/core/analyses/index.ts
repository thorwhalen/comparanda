/**
 * Optional analyses. Every one is opt-in, named, and states its assumptions at
 * the point of use -- never a default presentation, and never a verdict
 * (ADR-0015).
 */
export * from './dominance.js';
export * from './screening.js';
export * from './non-discriminating.js';
export * from './pugh.js';
export * from './agreement.js';
export * from './registry.js';
export * from './definitions.js';
