/**
 * The schema, as one import: every module under `core/schema/` re-exported.
 *
 * `analysis.ts` is the entry point -- the `Analysis` document, `validateAnalysis`
 * and the rule registry; the others are the parts it is built from (measurement,
 * missingness, provenance, evidence, structure, values, annotations, groups,
 * anchors, redaction, disclosure). Nothing here adds behaviour of its own.
 */
export * from './declarations.js';
export * from './measurement.js';
export * from './missingness.js';
export * from './provenance.js';
export * from './evidence.js';
export * from './structure.js';
export * from './values.js';
export * from './annotations.js';
export * from './analysis.js';
export * from './groups.js';
export * from './anchors.js';
export * from './redaction.js';
export * from './disclosure.js';
