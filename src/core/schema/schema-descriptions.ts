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
