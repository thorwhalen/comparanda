/**
 * Disclosure as a projection (ADR-0021).
 *
 * A measure may be present in the authoring store and withheld from a particular
 * reader. That is a fact about the *reader*, not about the cell, so it is never
 * written into the owner's document: `projectForReader` returns a **new**
 * analysis in which every assertion the reader may not see has been replaced by
 * a `withheld` absence, and leaves the source untouched.
 *
 * Where it runs is part of the decision: wherever the analysis crosses to the
 * reader -- the `AnalysisSource` provider in connected mode, `comparanda build`
 * before the payload is inlined in standalone mode -- and **never in the
 * renderer**, which would ship the withheld values and hide them with CSS.
 *
 * `comparanda` does not decide who may see what (ADR-0012). The host passes its
 * decision in as a predicate, typically over `assertion.disclosure.label`.
 */
import type { Analysis } from './analysis.js';
import { WITHHELD } from './missingness.js';
import { isWidenedByDisclosure, type Assertion, type Cell } from './values.js';

/** The host's disclosure decision: may this reader see this assertion? */
export type DisclosureDecision = (assertion: Assertion, cell: Cell) => boolean;

/** A projected analysis, and how many cells the projection widened. */
export interface Projection {
  analysis: Analysis;
  /** Cells with at least one live assertion projected out. Also countable from `analysis` itself. */
  widenedCells: number;
}

/**
 * Project an analysis for a reader.
 *
 * Every assertion the reader may not see keeps its identity -- id, author, time,
 * version, round, supersession, independence -- because *that* someone assessed
 * the cell is not the secret; *what* they said is. Its value, justification,
 * evidence, perturbation record and any missingness note are dropped, it carries
 * the `withheld` code, and `disclosure.withheldFromReader` marks it so every
 * analysis over the projection can count the cells it widened and say so.
 *
 * Renditions (cleaned source copies) referenced only by projected-out evidence
 * are dropped too: an excerpt index into a source is as good as the value.
 *
 * Not projected here, and the host's to handle until a later pass: free text in
 * annotation threads and the `proposed` payload of suggestions, both of which
 * can quote a value.
 */
export function projectForReader(source: Analysis, discloses: DisclosureDecision): Projection {
  const a = structuredClone(source);
  const droppedRenditions = new Set<string>();

  a.cells.forEach((cell, ci) => {
    const sourceCell = source.cells[ci]!;
    cell.assertions = cell.assertions.map((s, i) => {
      // Decide on the untouched source, so a predicate cannot be confused by
      // anything the projection has already done. Projecting a projection is a
      // no-op for what is already withheld.
      if (s.disclosure?.withheldFromReader || discloses(sourceCell.assertions[i]!, sourceCell)) return s;
      for (const e of s.evidence) if (e.renditionId) droppedRenditions.add(e.renditionId);
      const projected: Assertion = {
        id: s.id,
        authorId: s.authorId,
        at: s.at,
        missing: { code: WITHHELD },
        evidence: [],
        version: s.version,
        disclosure: { ...(s.disclosure?.label !== undefined ? { label: s.disclosure.label } : {}), withheldFromReader: true },
      };
      if (s.independence !== undefined) projected.independence = s.independence;
      if (s.roundId !== undefined) projected.roundId = s.roundId;
      if (s.procedureId !== undefined) projected.procedureId = s.procedureId;
      if (s.criteriaVersion !== undefined) projected.criteriaVersion = s.criteriaVersion;
      if (s.supersededBy !== undefined) projected.supersededBy = s.supersededBy;
      return projected;
    });
  });

  if (droppedRenditions.size > 0) {
    const stillCited = new Set(
      a.cells.flatMap((c) => c.assertions.flatMap((s) => s.evidence.map((e) => e.renditionId))),
    );
    a.renditions = a.renditions.filter((r) => !droppedRenditions.has(r.id) || stillCited.has(r.id));
  }

  return { analysis: a, widenedCells: widenedCellCount(a) };
}

/** Cells in `a` widened by a disclosure projection, optionally for one measure. */
export function widenedCellCount(a: Analysis, { measure }: { measure?: string } = {}): number {
  return a.cells.filter((c) => (measure === undefined || c.measure === measure) && isWidenedByDisclosure(c)).length;
}
