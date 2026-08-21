/**
 * Evidence references: resolver-backed pointers to *spans*, not documents.
 *
 * "Trust me, I read 1,070 documents" is not a citation, and neither is a link to
 * a 500-page PDF. A reference identifies a span a reader can actually check
 * (ADR-0014). This is the feature that makes an analysis auditable months later
 * and the main reason to prefer this over a spreadsheet.
 *
 * Selectors follow the **W3C Web Annotation Data Model** rather than inventing a
 * locator format. The important property, and the reason the spec is worth
 * adopting wholesale, is that you store *several* selectors for the same target:
 * a position selector is exact but breaks the moment the document is edited,
 * while a quote selector with prefix and suffix survives edits and re-flows. A
 * resolver tries them in order and reports which one hit, so staleness is
 * surfaced rather than silently rendering a dead link.
 */
import * as z from 'zod/mini';

/** Exact text plus enough context to relocate it after an edit. */
export const TextQuoteSelector = z.object({
  type: z.literal('TextQuoteSelector'),
  exact: z.string(),
  prefix: z.optional(z.string()),
  suffix: z.optional(z.string()),
});

/** Character offsets. Exact, and the first thing to break. */
export const TextPositionSelector = z.object({
  type: z.literal('TextPositionSelector'),
  start: z.number(),
  end: z.number(),
});

/** A page and a rectangle, for PDFs and images. */
export const PageRegionSelector = z.object({
  type: z.literal('PageRegionSelector'),
  page: z.number(),
  /** Fractions of page width/height, so the box survives a re-render at another DPI. */
  rect: z.optional(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })),
});

/** A line range, for source code. Line numbers drift, hence `contentHash`. */
export const LineRangeSelector = z.object({
  type: z.literal('LineRangeSelector'),
  startLine: z.number(),
  endLine: z.number(),
  /** Hash of the referenced lines, so drift is detectable rather than silent. */
  contentHash: z.optional(z.string()),
});

/** A time span, for audio and video. Follows Media Fragments. */
export const TimeRangeSelector = z.object({
  type: z.literal('TimeRangeSelector'),
  startSeconds: z.number(),
  endSeconds: z.number(),
});

/** A CSS or XPath path into a structured document. */
export const PathSelector = z.object({
  type: z.literal('PathSelector'),
  syntax: z.enum(['css', 'xpath']),
  value: z.string(),
});

export const Selector = z.discriminatedUnion('type', [
  TextQuoteSelector,
  TextPositionSelector,
  PageRegionSelector,
  LineRangeSelector,
  TimeRangeSelector,
  PathSelector,
]);
export type Selector = z.infer<typeof Selector>;

/**
 * What the source *is*, relative to the claim.
 *
 * ADR-0006 is emphatic here, and for a reason the originating work discovered
 * the hard way: **agent-generated summaries being mistaken for primary
 * authorship was the most damaging error class it encountered.** That is a
 * general hazard, not a local accident. If the schema cannot distinguish a
 * primary source from the agent's own inference, nothing downstream can.
 */
export const SourceType = z.enum([
  /** The thing itself: the document, the measurement, the record. */
  'primary',
  /** Someone else's summary or analysis of a primary source. */
  'secondary',
  /** A summary the producing agent wrote. Never a source for its own claim. */
  'agent-summary',
  /** The producing agent's reasoning, with no external support. */
  'agent-inference',
]);
export type SourceType = z.infer<typeof SourceType>;

/** Whether a source type may be offered as support for a claim at all. */
export function isExternalSupport(t: SourceType): boolean {
  return t === 'primary' || t === 'secondary';
}

/**
 * Which way the evidence cuts.
 *
 * Without this, contradicting evidence is unrepresentable and therefore
 * uncountable -- and "three sources support this, one contradicts it" collapses
 * into "four citations", which is worse than one honest citation.
 */
export const Stance = z.enum(['supports', 'contradicts', 'qualifies', 'context']);
export type Stance = z.infer<typeof Stance>;

/**
 * The result of a deterministic citation check.
 *
 * Written by a tool, never by a model -- the check is string containment and
 * normalisation, which is reproducible. A model-based faithfulness judgement is
 * a different thing and belongs in an evaluation suite, not in the document.
 *
 * `checkedAt` and `checkerVersion` are here because a check is only meaningful
 * relative to a resolver and a moment: a stale check travelling inside the JSON
 * to a reader with a different corpus would mislead, so the reader is shown when
 * and by what it was made.
 */
export const CitationCheck = z.object({
  status: z.enum(['verified', 'not-found', 'drifted', 'unchecked', 'unresolvable']),
  checkedAt: z.optional(z.string()),
  checkerVersion: z.optional(z.string()),
  /** Which selector resolved, when several were tried. */
  resolvedBy: z.optional(z.string()),
  detail: z.optional(z.string()),
});
export type CitationCheck = z.infer<typeof CitationCheck>;

/**
 * One evidence reference.
 *
 * `target` is opaque to the core -- a URI, an id, whatever the host's resolver
 * understands. The core never assumes documents live anywhere in particular.
 */
export const EvidenceRef = z.object({
  id: z.string(),
  /** Opaque; meaningful only to the host's `EvidenceResolver`. */
  target: z.string(),
  /** Several, deliberately: exact-but-fragile plus robust-but-approximate. */
  selectors: z._default(z.array(Selector), []),
  sourceType: SourceType,
  stance: z._default(Stance, 'supports'),
  /**
   * Text quoted from the target, embedded so the standalone bundle can show
   * supporting text with no network (ADR-0013).
   */
  excerpt: z.optional(z.string()),
  /** Hash of `excerpt`, so a resolver can detect that the target has moved on. */
  quoteHash: z.optional(z.string()),
  /**
   * For `agent-summary` and `agent-inference`: the ids of the references this
   * was derived from. An inference with an empty `derivedFrom` is an assertion
   * with nothing behind it, and the UI should say so.
   */
  derivedFrom: z._default(z.array(z.string()), []),
  check: z.optional(CitationCheck),
  label: z.optional(z.string()),
  retrievedAt: z.optional(z.string()),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export interface EvidenceProblem {
  path: string;
  message: string;
}

/**
 * Structural checks on a reference.
 *
 * The rule worth reading twice: an `agent-summary` or `agent-inference` may not
 * be the *only* thing supporting a value. That is precisely the failure ADR-0006
 * names -- the agent's own output being read as source material. The schema
 * cannot stop a model from reasoning, but it can stop the reasoning from being
 * filed as a citation.
 */
export function validateEvidence(refs: readonly EvidenceRef[], path = 'evidence'): EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];

  refs.forEach((ref, i) => {
    const at = `${path}[${i}]`;
    if (ref.selectors.length === 0 && !ref.excerpt) {
      problems.push({
        path: at,
        message: 'a reference must identify a span: give at least one selector, or an excerpt. ' +
          'Pointing at a whole document is not evidence.',
      });
    }
    if (!isExternalSupport(ref.sourceType) && ref.derivedFrom.length === 0) {
      problems.push({
        path: `${at}.derivedFrom`,
        message: `sourceType "${ref.sourceType}" is the agent's own output, so it must name the ` +
          'references it was derived from. An inference citing nothing is not a citation.',
      });
    }
  });

  const supporting = refs.filter((r) => r.stance === 'supports');
  if (supporting.length > 0 && !supporting.some((r) => isExternalSupport(r.sourceType))) {
    problems.push({
      path,
      message: 'every supporting reference is the agent\'s own summary or inference. ' +
        'Nothing external supports this value; it should carry a qualified absence instead.',
    });
  }

  return problems;
}

/** Split references by stance, so a UI can show that the evidence is contested. */
export function byStance(refs: readonly EvidenceRef[]): Record<Stance, EvidenceRef[]> {
  const out: Record<Stance, EvidenceRef[]> = { supports: [], contradicts: [], qualifies: [], context: [] };
  for (const r of refs) out[r.stance].push(r);
  return out;
}

/** Whether the evidence for a value disagrees with itself. Often the finding. */
export function isContested(refs: readonly EvidenceRef[]): boolean {
  const s = byStance(refs);
  return s.supports.length > 0 && s.contradicts.length > 0;
}
