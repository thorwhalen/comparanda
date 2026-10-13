/**
 * An analysis that paints every node of one value-suppressing tree (#104).
 *
 * One ordinal criterion of `k` levels, a confidence of `m` levels, and one
 * alternative per (confidence, level) pair, so the rendered matrix has a cell
 * for every colour the tree can take. Invented, like the examples it borrows
 * its shape from (ADR-0033).
 */
import { Analysis } from '../../src/core/schema/analysis.js';
import languagesJson from '../../examples/languages.json';

const levelsOf = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** The id of the alternative showing level `level` (0 the worst) at confidence layer `layer` (0 the least confident). */
export const gridAlternative = (layer: number, level: number) => `c${layer}-v${level}`;

export function vsupGrid(k: number, m: number): Analysis {
  const scoreLevels = levelsOf(k, 'v');
  const confidenceLevels = levelsOf(m, 'c');
  const ordinal = (levels: string[]) => ({ level: 'ordinal', preference: 'increasing', levels });
  const json = structuredClone(languagesJson) as Record<string, any>;
  json['measures'] = [...json['measures'], { name: 'confidence', label: 'Confidence' }];
  json['criteria'] = [{
    id: 'q', label: 'Quality', groupIds: [], defaultMeasurement: ordinal(scoreLevels), measurements: { confidence: ordinal(confidenceLevels) },
  }];
  json['cells'] = [];
  json['alternatives'] = [];
  const assertion = (id: string, value: string) => ({
    id, authorId: 'ana', at: '2026-08-22T09:00:00Z', value, justification: 'an invented grid cell', evidence: [], version: 1, independence: 'independent',
  });
  for (let layer = m - 1; layer >= 0; layer--) {
    for (let level = 0; level < k; level++) {
      const alt = gridAlternative(layer, level);
      json['alternatives'].push({ id: alt, label: alt, groupIds: [] });
      json['cells'].push(
        { alternativeId: alt, criterionId: 'q', measure: 'score', assertions: [assertion(`${alt}-s`, scoreLevels[level]!)] },
        { alternativeId: alt, criterionId: 'q', measure: 'confidence', assertions: [assertion(`${alt}-c`, confidenceLevels[layer]!)] },
      );
    }
  }
  return Analysis.parse(json);
}
