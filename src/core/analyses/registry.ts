/**
 * Analyses as data a composition root assembles, never as modules that
 * register themselves (#87, ADR-0015, ADR-0017).
 *
 * Two guarantees, both carried by types rather than by convention:
 *
 * - **Every result states its assumptions, as data.** ADR-0015: an analysis
 *   "states its assumptions in the UI at the point of use, not in documentation
 *   elsewhere", which only holds if they travel *with the result*. Every result
 *   type extends `AnalysisResult`, and `defineAnalysis` accepts only a function
 *   returning one -- so an analysis whose result has no `assumptions` does not
 *   typecheck, and a view has them in hand wherever it has the numbers.
 * - **Nothing registers itself.** Under `"sideEffects": false` a bundler deletes
 *   a module whose only effect is registering, and ships an empty registry with
 *   no error (findings-visualisation §5.2). So `defineAnalysis` only *describes*;
 *   `createAnalysisRegistry` is called by whoever composes the app, with exactly
 *   the analyses it ships. A consumer who wants two analyses ships two, and the
 *   bundle holds those two. The module-scope rule is enforced by
 *   `scripts/boundary-rules.ts`.
 */
import type { Analysis } from '../schema/analysis.js';

/** What every analysis result carries, whatever else it reports. */
export interface AnalysisResult {
  /**
   * The assumptions the result rests on, in words a reader can check -- shown
   * beside the result, never only in documentation.
   */
  readonly assumptions: readonly string[];
  /** Cells a disclosure projection withheld from this reader (ADR-0021). */
  readonly widenedByDisclosure: number;
}

/** An analysis, described: an id, a label, and a function over one document. */
export interface AnalysisDefinition<Options, Result extends AnalysisResult> {
  readonly id: string;
  readonly label: string;
  readonly run: (analysis: Analysis, options: Options) => Result;
}

/**
 * Describe an analysis. Pure: it returns a frozen description and registers
 * nothing. The `Result extends AnalysisResult` bound is the type-level half of
 * "a result without assumptions does not typecheck".
 */
export function defineAnalysis<Options, Result extends AnalysisResult>(
  definition: AnalysisDefinition<Options, Result>,
): AnalysisDefinition<Options, Result> {
  return Object.freeze({ ...definition });
}

/** A lookup over exactly the analyses a composition root chose to ship. */
export interface AnalysisRegistry<D extends AnalysisDefinition<never, AnalysisResult>> {
  readonly ids: readonly D['id'][];
  get(id: string): D | undefined;
}

/**
 * Assemble the analyses an app ships. Call it from the composition root, with
 * the definitions it imports; throws on a duplicate id rather than letting the
 * later one silently win.
 */
export function createAnalysisRegistry<D extends AnalysisDefinition<never, AnalysisResult>>(
  definitions: readonly D[],
): AnalysisRegistry<D> {
  const byId = new Map<string, D>();
  for (const d of definitions) {
    if (byId.has(d.id)) throw new Error(`two analyses share the id "${d.id}"; ids must be unique in a registry`);
    byId.set(d.id, d);
  }
  const ids = Object.freeze([...byId.keys()]);
  return Object.freeze({ ids, get: (id: string) => byId.get(id) });
}
