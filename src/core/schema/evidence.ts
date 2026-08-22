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
 * A cleaned copy of an ingested source, and the fingerprint of what it was made
 * from.
 *
 * Ingestion normalises -- strips navigation, rejoins hyphenated lines, collapses
 * whitespace -- so a character range indexes the *cleaned* text and not the file
 * a reader opens. Two ways out were live, and we keep the cleaned copy and cite
 * into it (ADR-0014, 2026-08-22). The cost is a second copy of every ingested
 * document; the return is that every quote in an analysis resolves offline,
 * indefinitely, whether or not the original still exists at its locator.
 *
 * `originalSha256` is what makes drift **visible instead of silent**. Three
 * standings follow, and the middle one is the one that will actually occur:
 *
 * | rendition | original hash | what the reader is told |
 * |---|---|---|
 * | resolves | matches | checkable and current |
 * | resolves | **differs** | checkable against what we ingested; the source has moved on |
 * | missing | -- | not resolvable here, and *why* -- never a bare "unverified" |
 */
export const Rendition = z.object({
  id: z.string(),
  /** Where the original came from. Opaque; meaningful to the host's resolver. */
  originalLocator: z.string(),
  /**
   * Hash of the original's bytes **at ingest time**.
   *
   * Not of the rendition: the rendition is ours and does not change under us.
   * This is the thing that can, and detecting that is the entire job.
   */
  originalSha256: z.string(),
  /**
   * Which normaliser produced the cleaned text.
   *
   * Versioned and append-only: changing what a normaliser does silently
   * invalidates every offset recorded against it, so a changed normaliser is a
   * new id rather than a new behaviour under the old one.
   */
  normaliserId: z.string(),
  /** Bytes of the cleaned text, when the bundle carries them inline. */
  text: z.optional(z.string()),
  retrievedAt: z.optional(z.string()),
  /** Human-facing title, for the link a reader follows. */
  label: z.optional(z.string()),
});
export type Rendition = z.infer<typeof Rendition>;

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
/**
 * The graded verdict from re-finding a quote. **One spelling, and this is it.**
 *
 * Three vocabularies were live at once: this file's, rubricator's citation
 * ladder's, and ADR-0014's. ADR-0014 is the accepted decision, so the other two
 * come to it. `verified` is retired -- it read as "someone approved this" when it
 * meant "found verbatim" -- and `drifted` split, because "the document changed
 * and the quote is still there" and "the document changed and the quote is gone"
 * are different answers that a reader must be able to act on differently.
 *
 * The first three are ladder rungs: how *hard* we had to look.
 * The next two are about the document underneath.
 *
 * - `exact`         found verbatim, after whitespace normalisation only.
 * - `normalised`    found once punctuation and case are folded.
 * - `fuzzy`         found by token overlap above the configured threshold. A
 *                   quote reassembled across a line break usually lands here.
 * - `moved`         the document changed and the quote was found elsewhere.
 *                   Re-anchor, and log that it moved.
 * - `stale`         the document changed and the quote is gone. Surface it.
 * - `unresolvable`  the target could not be reached at all.
 * - `unchecked`     no check ran. Not a verdict; the absence of one.
 */
export const CitationVerdict = z.enum([
  'exact', 'normalised', 'fuzzy', 'moved', 'stale', 'unresolvable', 'unchecked',
]);
export type CitationVerdict = z.infer<typeof CitationVerdict>;

/** Verdicts that mean the quoted text was actually located. */
const FOUND: ReadonlySet<CitationVerdict> = new Set<CitationVerdict>(['exact', 'normalised', 'fuzzy', 'moved']);

/** Whether a verdict means the reader can go and look at the quoted span. */
export function verdictFound(v: CitationVerdict): boolean {
  return FOUND.has(v);
}

export const CitationCheck = z.object({
  status: CitationVerdict,
  /**
   * When the check ran. **Required for every status except `unchecked`**, which
   * is the one status that describes the absence of a check and so has no
   * moment to record. The rule is enforced by `validateCitationCheck` rather
   * than by the shape, following this module's convention: zod carries the
   * shape, plain functions carry the rules, and a rule violation comes back as
   * a path and a sentence rather than a parse failure.
   */
  checkedAt: z.optional(z.string()),
  /** What ran it. Same requiredness rule as `checkedAt`. */
  checkerVersion: z.optional(z.string()),
  /** Which selector resolved, when several were tried. */
  resolvedBy: z.optional(z.string()),
  /**
   * True when the original's hash at check time differed from the
   * `originalSha256` its rendition recorded at ingest.
   *
   * Orthogonal to `status`: a quote can be `exact` in our rendition while the
   * source it was taken from has changed underneath. Both facts are true and a
   * reader needs both, so they are two fields rather than one overloaded enum.
   */
  originalDrifted: z.optional(z.boolean()),
  detail: z.optional(z.string()),
});
export type CitationCheck = z.infer<typeof CitationCheck>;

/**
 * How much a stored check can still be trusted, at the moment of reading.
 *
 * A check travels inside the document (ADR-0014), which is what lets a bundle
 * sent to someone with no resolver and no corpus show something real. The cost
 * is that it can arrive stale, so a reader is never shown a bare verdict: they
 * are shown the verdict *and* how far it can be trusted.
 *
 * - `unchecked`      no check has run. Not a verdict at all.
 * - `current`        run by the checker version now in use.
 * - `older-checker`  run by an earlier checker. The verdict stands as a record
 *                    of what that checker found; it is not a claim about what
 *                    the current one would find.
 * - `aged`           older than a caller-supplied threshold. Only ever produced
 *                    when a caller supplies one -- see `staleAfterDays`.
 */
export type CheckFreshness = 'unchecked' | 'current' | 'older-checker' | 'aged';

export interface CheckStanding {
  freshness: CheckFreshness;
  /**
   * The source has changed since we ingested it.
   *
   * Independent of `freshness`, which is about *our* check going out of date.
   * This is about the *document* moving on, and it needs a caveat of its own:
   * the quote is still checkable against what we read, and a reader following
   * the original link may not find it.
   */
  sourceChanged: boolean;
  /**
   * Whole days between `checkedAt` and `now`. Absent when there is nothing to
   * measure from -- no check, or a check that failed the requiredness rule.
   *
   * Spelled `| undefined` explicitly because this project runs
   * `exactOptionalPropertyTypes`, under which an optional property does not
   * accept an explicit `undefined` value.
   */
  ageDays?: number | undefined;
  /**
   * True when the reader must be shown a caveat alongside the verdict. Every
   * freshness except `current` requires one; the view contract may not render a
   * non-current check as though it were current.
   */
  needsCaveat: boolean;
}

/**
 * Classify a stored check for display.
 *
 * `now` is a parameter and not a hidden clock, so this stays pure and testable
 * and so a bundle rendered twice from the same inputs renders identically.
 *
 * **There is deliberately no default age threshold.** Expiring a check on an age
 * nobody can justify would blind a shared bundle with no way for its recipient
 * to refresh it, and a visible caveat carries strictly more information than an
 * absence. Age is therefore always *reported* and only *acted on* when a caller
 * has chosen a threshold and owns that choice.
 */
export function checkStanding(
  check: CitationCheck | undefined,
  {
    currentCheckerVersion,
    now,
    staleAfterDays,
  }: { currentCheckerVersion: string; now: Date; staleAfterDays?: number },
): CheckStanding {
  if (!check || check.status === 'unchecked') {
    return { freshness: 'unchecked', sourceChanged: false, needsCaveat: true };
  }

  const sourceChanged = check.originalDrifted === true;

  const ageDays = check.checkedAt
    ? Math.floor((now.getTime() - new Date(check.checkedAt).getTime()) / 86_400_000)
    : undefined;

  // Version first: a check from an older checker is suspect however recent it
  // is, because what changed is the thing doing the checking.
  if (check.checkerVersion !== currentCheckerVersion) {
    return { freshness: 'older-checker', sourceChanged, ageDays, needsCaveat: true };
  }
  if (staleAfterDays !== undefined && ageDays !== undefined && ageDays > staleAfterDays) {
    return { freshness: 'aged', sourceChanged, ageDays, needsCaveat: true };
  }
  // A current check over a source that has moved on still needs a caveat: the
  // verdict is true about what we ingested and may be false about what the
  // reader would open.
  return { freshness: 'current', sourceChanged, ageDays, needsCaveat: sourceChanged };
}

/**
 * The requiredness rule for a stored check.
 *
 * A verdict with no date and no checker is the failure this rule exists to
 * prevent: it reads as current to anyone who opens the document, and there is
 * nothing in it that says otherwise. `unchecked` is exempt because it is the
 * absence of a verdict rather than an undated one.
 */
export function validateCitationCheck(
  check: CitationCheck | undefined,
  path = 'check',
): EvidenceProblem[] {
  if (!check || check.status === 'unchecked') return [];
  const problems: EvidenceProblem[] = [];
  if (!check.checkedAt) {
    problems.push({
      path: `${path}.checkedAt`,
      message: `a check with status "${check.status}" must record when it ran. ` +
        'An undated verdict reads as current forever.',
    });
  }
  if (!check.checkerVersion) {
    problems.push({
      path: `${path}.checkerVersion`,
      message: `a check with status "${check.status}" must record what ran it. ` +
        'Without it a reader cannot tell whether the current checker would still agree.',
    });
  }
  return problems;
}

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
  /**
   * Hash of `excerpt` -- **our** quoted text, so a resolver can tell that the
   * stored excerpt and the stored selectors have fallen out of step.
   *
   * Renamed from `quoteHash`, which read as though it hashed the source. It
   * hashes the excerpt, the source's fingerprint is `Rendition.originalSha256`,
   * and a document that ships both under names that do not distinguish them is a
   * document whose drift detection nobody can reason about.
   */
  excerptHash: z.optional(z.string()),
  /**
   * The rendition this reference's selectors index into.
   *
   * Absent means the selectors index the original directly, which is the
   * un-normalised case and is legal -- a plain text file needs no rendition.
   */
  renditionId: z.optional(z.string()),
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
    problems.push(...validateCitationCheck(ref.check, `${at}.check`));
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
