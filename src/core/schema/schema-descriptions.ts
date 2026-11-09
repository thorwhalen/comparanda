/**
 * What the emitted JSON Schema says about a field that zod's own shape cannot carry cheaply.
 *
 * The standalone page bundles the zod schema and has a byte budget (ADR-0017): a description string written into
 * the schema is shipped to every reader of a mailed file. These are read by `scripts/emit-json-schema.ts` only, and
 * applied to the artifact wherever a property's `enum` is exactly the coded set, so the definition still travels with
 * the field for a producer in another language.
 */
import { REJECT_REASON_CODES, type RejectReasonCode } from './structure.js';

export const REJECT_REASON_GLOSSES: Readonly<Record<RejectReasonCode, string>> = Object.freeze({
  redundant: 'says what another criterion already says.',
  'not-discriminating': 'was found not to separate the alternatives: they would score alike.',
  'out-of-scope': 'is outside the question being decided.',
  'not-assessable': 'cannot be assessed with the evidence available.',
  merged: 'was folded into another criterion (mergedIntoId).',
  'means-objective': 'is a means to an objective already scored, not a goal of its own.',
  'not-controllable': 'is not something the decider can influence.',
  'no-discrimination-expected': 'the decider cares, but nothing suggests, before any scoring, that the alternatives could differ on it.',
  'user-rejected': 'the person deciding rejected it.',
  other: 'none of the above; the reason says why.',
});

/** A coded set and the description its field carries in the artifact. */
export interface EnumDescription { codes: readonly string[]; description: string }

export const ENUM_DESCRIPTIONS: readonly EnumDescription[] = Object.freeze([
  {
    codes: REJECT_REASON_CODES,
    description: 'Why it was rejected. ' + REJECT_REASON_CODES.map((c) => `${c}: ${REJECT_REASON_GLOSSES[c]}`).join(' '),
  },
]);

/**
 * A property's description in the artifact, by its name, wherever an object carries it and says nothing yet. Only
 * for names that mean one thing in the whole schema.
 */
export const PROPERTY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  neutral:
    'The level a diverging bar is centred on: a declared neutral, never inferred (a range midpoint is the undeclared midpoint ADR-0010 forbids). '
    + 'Ordinal measurements only, and one of their levels. Absent means none is declared, and the bar is not centred.',
  mergedIntoId:
    'The criterion a rejected criterion was folded into. Required when reasonCode is merged; optional otherwise. '
    + 'Must be the id of a criterion in this document (a tombstoned one counts). '
    + 'Checked by validateAnalysis (rule merged-into-resolves), not by this schema.',
});
