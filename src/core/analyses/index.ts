/**
 * Optional analyses. Every one is opt-in, named, and states its assumptions at
 * the point of use -- never a default presentation, and never a verdict
 * (ADR-0015).
 */
export * from './dominance.js';
export * from './screening.js';
