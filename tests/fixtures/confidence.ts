/**
 * The languages example with a three-level confidence recorded beside most
 * scores, for the value-suppressing encoding (#91). Invented, like the example
 * it extends (ADR-0033). `go`'s cells carry no confidence, so the encoding's
 * "left uncoloured" path is exercised too.
 */
import { Analysis } from '../../src/core/schema/analysis.js';
import languagesJson from '../../examples/languages.json';

const CONFIDENCE_MEASUREMENT = { level: 'ordinal', preference: 'increasing', levels: ['low', 'medium', 'high'] } as const;

/** Confidence per alternative, in criterion order: ecosystem, performance, hiring, learning-curve, tooling. */
const CONFIDENCE: Record<string, readonly ('low' | 'medium' | 'high')[]> = {
  rust: ['high', 'high', 'low', 'medium', 'high'],
  python: ['low', 'medium', 'high', 'high', 'low'],
  typescript: ['medium', 'low', 'high', 'medium', 'high'],
};

export function languagesWithConfidence(
  { measurement = CONFIDENCE_MEASUREMENT }: { measurement?: Record<string, unknown> } = {},
): Analysis {
  const json = structuredClone(languagesJson) as Record<string, any>;
  json['measures'] = [...json['measures'], { name: 'confidence', label: 'Confidence' }];
  for (const c of json['criteria']) c.measurements = { ...c.measurements, confidence: measurement };
  const criteria = json['criteria'].map((c: { id: string }) => c.id);
  for (const [alt, levels] of Object.entries(CONFIDENCE)) {
    levels.forEach((value, i) => json['cells'].push({
      alternativeId: alt, criterionId: criteria[i], measure: 'confidence',
      assertions: [{
        id: `${alt}-${criteria[i]}-confidence`, authorId: 'ana', at: '2026-08-22T09:00:00Z', value,
        justification: 'how much of the evidence we could check', evidence: [], version: 1, independence: 'independent',
      }],
    }));
  }
  return Analysis.parse(json);
}
