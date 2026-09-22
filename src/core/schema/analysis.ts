/**
 * The analysis document: the top-level shape, its version, and validation at the
 * boundary.
 *
 * This is the package's principal export and the contract with any producer --
 * a human, an agent, or a script. An analysis is equally valid whichever made
 * it, and `comparanda` must not be able to tell the difference except through
 * the authorship metadata every value carries (ADR-0002).
 */
import * as z from 'zod/mini';
import {
  Alternative, Criterion, Group, InapplicableBlock, RejectedCriterion, Aliases,
  measurementFor,
} from './structure.js';
import {
  Cell, Reduction, ReductionDeclaration, CORE_REDUCTIONS, reduce, isWidenedByDisclosure, type Reduced,
} from './values.js';
import { Author, Procedure, Round } from './provenance.js';
import { Thread, Suggestion } from './annotations.js';
import {
  CORE_MISSING_CODES, MissingCodeDeclaration, NOT_APPLICABLE, NOT_ASSESSED,
  makeVocabulary, resolveMissingCode, tallyCompleteness,
  type Completeness, type MissingnessVocabulary,
} from './missingness.js';
import { degradationOf, type Degradation } from './declarations.js';
import {
  ScaleDeclaration, isOrdered, resolveScale, validateMeasurement, type Measurement,
} from './measurement.js';
import { axisGroups, makeInapplicability } from './groups.js';
import { Rendition, validateEvidence, type EvidenceRuleId } from './evidence.js';

/**
 * The schema version this build reads and writes.
 *
 * Bumped on any change to the stored shape. The migration harness ships *with*
 * version 1 rather than when a migration is first needed (ADR-0006), because a
 * harness retrofitted after the first breaking change has to reconstruct what
 * the old shape was from memory.
 */
export const SCHEMA_VERSION = 1;

/** The question being decided. One per analysis. */
export const Subject = z.object({
  question: z.string(),
  /** What decision this informs, and who is making it. Surfaces the frame. */
  decision: z.optional(z.string()),
  decider: z.optional(z.string()),
  context: z.optional(z.string()),
  /**
   * What is still ambiguous about the question itself.
   *
   * "Adopt -- for the new service only, or everywhere?" is the kind of thing
   * that changes every score in the matrix and is invisible once the scores
   * exist. The producing agent is required to surface ambiguity rather than
   * resolve it silently, and that rule needs somewhere to be *recorded*: an
   * ambiguity raised in a conversation and settled off-document leaves an
   * analysis whose readers cannot tell which reading it was scored under.
   *
   * An **empty array is meaningful** and is not the same as an absent one. It
   * says someone looked and found none; absence says nobody looked.
   */
  ambiguities: z.optional(z.array(z.string())),
});
export type Subject = z.infer<typeof Subject>;

/**
 * Which measures this analysis stores. `score` and `confidence` are the common
 * pair, but nothing is hard-coded: the matrix is a tensor of
 * `alternatives x criteria x measures` and a deployment may store others.
 *
 * Encodings are *not* here. An encoding is derived and belongs to the view
 * (ADR-0003); storing one would mean persisting computed data.
 */
export const MeasureDeclaration = z.object({
  name: z.string(),
  label: z.optional(z.string()),
  description: z.optional(z.string()),
});
export type MeasureDeclaration = z.infer<typeof MeasureDeclaration>;

export const Analysis = z.object({
  schemaVersion: z._default(z.number(), SCHEMA_VERSION),
  id: z.string(),
  subject: Subject,
  title: z.optional(z.string()),
  createdAt: z.optional(z.string()),
  updatedAt: z.optional(z.string()),

  aliases: z.optional(Aliases),
  measures: z._default(z.array(MeasureDeclaration), []),
  /** Default for cells that do not override it. See `Reduction`. */
  defaultReduction: z._default(Reduction, 'single'),

  alternatives: z._default(z.array(Alternative), []),
  criteria: z._default(z.array(Criterion), []),
  groups: z._default(z.array(Group), []),
  inapplicable: z._default(z.array(InapplicableBlock), []),
  rejectedCriteria: z._default(z.array(RejectedCriterion), []),
  /** Version of the criteria set. Assertions record which version they scored. */
  criteriaVersion: z.optional(z.string()),

  cells: z._default(z.array(Cell), []),
  authors: z._default(z.array(Author), []),
  procedures: z._default(z.array(Procedure), []),
  rounds: z._default(z.array(Round), []),

  threads: z._default(z.array(Thread), []),
  suggestions: z._default(z.array(Suggestion), []),

  /** Deployment extensions to the closed core set of missingness codes. */
  missingCodes: z._default(z.array(MissingCodeDeclaration), []),

  /**
   * The named scales this analysis's criteria were authored to.
   *
   * A row per scale, so a reader that has never heard of one still knows what it
   * was and can say so. The measurement itself is on the criterion, as required
   * fields, which is what lets an unknown scale still dominate and still render.
   */
  scales: z._default(z.array(ScaleDeclaration), []),

  /** Deployment extensions to the closed core set of reductions. */
  reductions: z._default(z.array(ReductionDeclaration), []),

  /**
   * The cleaned copies of ingested sources that this analysis's quotes index
   * into, each with the fingerprint of the original it was made from.
   *
   * Travelling with the document is the point: a recipient with no corpus and no
   * resolver can still check every quote.
   */
  renditions: z._default(z.array(Rendition), []),

  /** Whether the analysis accepts direct edits, or only suggestions. */
  locked: z.optional(z.boolean()),
});
export type Analysis = z.infer<typeof Analysis>;

/**
 * Which kind of rule a problem came from. **This is the boundary contract.**
 *
 * - `schema`        the document is not a document, or refers to ids that are not
 *                   in it. Always an error.
 * - `honesty`       the document asserts something a reader cannot check: a
 *                   score with no rationale, an assertion by nobody, a blank
 *                   whose code the document never defines, a verdict with no
 *                   date. **Always an error, and it cannot be switched off.**
 * - `completeness`  the document is unfinished. **Always a warning**, because
 *                   "not yet assessed" is a first-class representable state and
 *                   an analysis deliberately full of qualified blanks is a
 *                   legitimate, finished-as-specified document.
 *
 * The split is the whole of the strictness decision: strict on honesty,
 * forgiving on completeness. One global strictness knob cannot express it --
 * turned up, you cannot save work in progress; turned down, "validates against
 * the schema" stops being a claim worth making.
 */
export type RuleFamily = 'schema' | 'honesty' | 'completeness';

/**
 * The ADR each validation rule comes from.
 *
 * A refusal is the product (ADR-0018: the tooling declines an illegal operation
 * "with a specific reason instead of producing a plausible wrong number"), and a
 * reason a reader cannot trace to the decision behind it is a reason they can
 * only take on trust. Every problem `validateAnalysis` reports carries its
 * rule's ADR in `adr` and names both the rule and the ADR in its message (#56).
 *
 * The guarantee is `validateAnalysis`'s. The lower-level validators it composes
 * (`validateEvidence`, `validateMeasurement`, ...) return their bare problems;
 * a caller that wants cited refusals goes through the boundary.
 *
 * One table rather than an ADR number typed into each message, so that a rule
 * cannot be added without one: the helpers inside `validateAnalysis` accept only
 * a `RuleId`, and the `satisfies` clause makes the compiler check that every
 * rule the evidence module can report is listed too.
 */
export const RULE_SOURCES = Object.freeze({
  // Shape and versioning: the schema is the contract, and it is versioned.
  'schema-shape': 'ADR-0004',
  'schema-version-readable': 'ADR-0006',
  // Structural integrity: the document refers to what it contains (the
  // `schema` family, as ADR-0031 defines it).
  'unique-ids': 'ADR-0031',
  'cell-coordinates-exist': 'ADR-0031',
  'cell-measure-declared': 'ADR-0031',
  'group-exists': 'ADR-0008',
  'group-on-its-axis': 'ADR-0008',
  'group-nesting-acyclic': 'ADR-0008',
  // Measurement: level, preference, range, thresholds.
  'criterion-has-a-measurement': 'ADR-0018',
  'measurement-well-formed': 'ADR-0018',
  'substitution-weight-needs-range': 'ADR-0020',
  // Missingness and the extensible vocabularies.
  'no-bare-null': 'ADR-0009',
  'structural-refines-not-applicable': 'ADR-0009',
  'no-redeclaring-core': 'ADR-0009',
  'unique-declarations': 'ADR-0030',
  'blank-is-defined': 'ADR-0030',
  // Multi-rater cells.
  'cells-unique': 'ADR-0011',
  // Honesty and completeness.
  'score-has-a-reason': 'ADR-0031',
  'assertion-attributed': 'ADR-0012',
  'value-has-evidence': 'ADR-0014',
  // Disclosure.
  'disclosure-flag-is-projection-only': 'ADR-0021',
  // Evidence references.
  'cite-a-span': 'ADR-0014',
  'check-dated': 'ADR-0014',
  'check-attributed': 'ADR-0014',
  'inference-names-its-sources': 'ADR-0031',
  'external-support-required': 'ADR-0031',
} as const satisfies Record<EvidenceRuleId, `ADR-${string}`> & Record<string, `ADR-${string}`>);

/** A rule `validateAnalysis` can report. */
export type RuleId = keyof typeof RULE_SOURCES;

/** The suffix every reported message ends with: the rule, and where it was decided. */
function citeRule(message: string, ruleId: RuleId): string {
  return `${message} [rule ${ruleId}; ${RULE_SOURCES[ruleId]}]`;
}

export interface ValidationProblem {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  family: RuleFamily;
  /**
   * A stable id for the rule, so a caller can suppress, count or link one
   * without matching on prose.
   */
  ruleId: string;
  /**
   * The ADR the rule comes from, e.g. `"ADR-0018"`. Also named at the end of
   * `message`, which is where a human reads it; this field is for a caller that
   * wants to link it. See `RULE_SOURCES`.
   */
  adr: `ADR-${string}`;
  /**
   * What would fix it.
   *
   * **Required.** "Names the exact path and what would fix it" is not satisfied
   * by a message that names only the path, and requiring the field is the only
   * way to make that true of a rule nobody has written yet -- an optional `fix`
   * is a field that is present on the rules whose author remembered.
   */
  fix: string;
}

/**
 * What `validateAnalysis` returns: a typed document, or no document at all.
 *
 * A discriminated union rather than an optional `analysis`, because "an invalid
 * document never partially loads" (#56) has to be true of the type, not of the
 * caller's discipline: with `ok: false` there is no `analysis` to reach for, and
 * with `ok: true` TypeScript knows it is there. Warnings -- completeness is a
 * normal working state -- do not withhold the document; errors do.
 */
export type ValidationResult =
  | { ok: true; analysis: Analysis; problems: ValidationProblem[] }
  | { ok: false; analysis?: undefined; problems: ValidationProblem[] };

/**
 * Validate an analysis at the boundary.
 *
 * Returns *all* problems rather than throwing on the first, because the caller
 * is usually an authoring UI or an agent that wants to fix everything in one
 * pass. Shape errors from the schema come back as `error`; structural problems
 * the schema cannot express -- a cell pointing at a criterion that does not
 * exist, an ordinal criterion with no range -- come back from the checks below.
 */
export function validateAnalysis(
  input: unknown,
  {
    includeCompleteness = true,
  }: {
    /**
     * Whether to report completeness warnings.
     *
     * Note what is **not** here: a way to turn off honesty. That asymmetry is
     * deliberate and is the decision, not an oversight -- an option to skip the
     * honesty family would be reached for on the first inconvenient failure, and
     * the guarantee would erode exactly where it matters. Completeness noise is
     * suppressible because a partially-filled matrix is a normal working state
     * and an authoring UI counting 400 warnings has learned nothing.
     */
    includeCompleteness?: boolean;
  } = {},
): ValidationResult {
  const parsed = Analysis.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: citeRule(i.message, 'schema-shape'),
        severity: 'error' as const,
        family: 'schema' as const,
        ruleId: 'schema-shape',
        adr: RULE_SOURCES['schema-shape'],
        fix: 'correct the value at this path to the type the schema declares.',
      })),
    };
  }

  const a = parsed.data;
  const vocabulary = vocabularyOf(a);
  const problems: ValidationProblem[] = [];

  /** An honesty failure. Always an error; there is no switch. */
  const honesty = (ruleId: RuleId, path: string, message: string, fix: string) =>
    problems.push({
      path, message: citeRule(message, ruleId), severity: 'error', family: 'honesty',
      ruleId, adr: RULE_SOURCES[ruleId], fix,
    });

  /** An unfinished-ness. Always a warning, and suppressible as a set. */
  const incomplete = (ruleId: RuleId, path: string, message: string, fix: string) => {
    if (includeCompleteness) {
      problems.push({
        path, message: citeRule(message, ruleId), severity: 'warning', family: 'completeness',
        ruleId, adr: RULE_SOURCES[ruleId], fix,
      });
    }
  };

  /**
   * A structural failure: the document refers to something that is not in it,
   * or declares something twice. Malformed rather than dishonest.
   *
   * Every call names its own `ruleId`. One shared id across a dozen rules would
   * make a suppression un-auditable -- silencing "duplicate declaration" would
   * silently also silence "unknown alternative" -- which is the whole reason
   * the field is stable.
   */
  const err = (ruleId: RuleId, path: string, message: string, fix: string) =>
    problems.push({
      path, message: citeRule(message, ruleId), severity: 'error', family: 'schema',
      ruleId, adr: RULE_SOURCES[ruleId], fix,
    });

  if (a.schemaVersion > SCHEMA_VERSION) {
    err(
      'schema-version-readable', 'schemaVersion',
      `document is version ${a.schemaVersion}; this build reads up to ${SCHEMA_VERSION}`,
      'upgrade the reader, or ask the producer to emit an earlier schema version.',
    );
  }

  const altIds = new Set(a.alternatives.map((x) => x.id));
  const critIds = new Set(a.criteria.map((x) => x.id));
  const groupIds = new Set(a.groups.map((x) => x.id));
  const authorIds = new Set(a.authors.map((x) => x.id));

  for (const [label, list] of [
    ['alternatives', a.alternatives], ['criteria', a.criteria], ['groups', a.groups],
  ] as const) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) {
        err(
          'unique-ids', label, `duplicate id "${item.id}"`,
          `give one of them a different id; every reference to "${item.id}" is currently ambiguous.`,
        );
      }
      seen.add(item.id);
    }
  }

  a.criteria.forEach((c, i) => {
    const declared = Object.entries(c.measurements);
    if (declared.length === 0 && !c.defaultMeasurement) {
      err(
        'criterion-has-a-measurement', `criteria[${i}]`,
        `criterion "${c.id}" declares no measurement and no default`,
        'add a defaultMeasurement, or a measurement for each measure this criterion carries.',
      );
    }
    for (const [measure, m] of declared) {
      for (const p of validateMeasurement(m, `criteria[${i}].measurements.${measure}`)) {
        err('measurement-well-formed', p.path, p.message, 'see the message: it states the rule.');
      }
    }
    if (c.defaultMeasurement) {
      for (const p of validateMeasurement(c.defaultMeasurement, `criteria[${i}].defaultMeasurement`)) {
        err('measurement-well-formed', p.path, p.message, 'see the message: it states the rule.');
      }
    }
    if (c.weights?.substitution !== undefined) {
      // ADR-0020: a substitution weight is a rate of exchange across a declared
      // swing, and is meaningless without one. The weight does not name the
      // measure it will be applied to, so every measurement it could be applied
      // to must be ordered and carry a range -- one that is not is a weight some
      // aggregation will read as a bare statement of importance.
      //
      // "Could be applied to" is the measurement each of the analysis's declared
      // measures resolves to (so a `defaultMeasurement` every measure overrides
      // is not held against it). With no measures declared, it is everything
      // the criterion declares.
      const candidates: [string, Measurement][] = a.measures.length > 0
        ? a.measures.flatMap(({ name }): [string, Measurement][] => {
          const m = measurementFor(c, name);
          if (!m) return [];
          return [[c.measurements[name] ? `measurements.${name}` : `defaultMeasurement (for "${name}")`, m]];
        })
        : [
          ...declared.map(([measure, m]): [string, Measurement] => [`measurements.${measure}`, m]),
          ...(c.defaultMeasurement ? [['defaultMeasurement', c.defaultMeasurement] as [string, Measurement]] : []),
        ];
      // A range on a nominal level is not a swing: nominal values have no order,
      // so "how much of this criterion's span" has no answer however it is typed.
      const unranged = candidates
        .filter(([, m]) => !(isOrdered(m.level) && m.range))
        .map(([where, m]) => (isOrdered(m.level) ? where : `${where}, which is nominal`));
      if (candidates.length === 0 || unranged.length > 0) {
        err(
          'substitution-weight-needs-range', `criteria[${i}].weights.substitution`,
          `criterion "${c.id}" carries a substitution weight but ` +
            (candidates.length === 0
              ? 'declares no measurement the weight could apply to, so no range'
              : `declares no ordered range on ${unranged.join('; ')}`) +
            '. A substitution weight says how much of this criterion\'s swing buys how much of ' +
            'another\'s; without a declared range there is no swing, and the weight is a bare ' +
            'statement of importance.',
          'declare an ordered level with a range on every measurement of this criterion, or remove ' +
            'weights.substitution. If what you have is stated importance rather than a rate of ' +
            'exchange, it is not a substitution weight.',
        );
      }
    }
    for (const g of c.groupIds) {
      if (!groupIds.has(g)) {
        err('group-exists', `criteria[${i}].groupIds`, `unknown group "${g}"`,
          `add a group with id "${g}", or remove the reference.`);
      }
    }
  });

  a.alternatives.forEach((alt, i) => {
    for (const g of alt.groupIds) {
      if (!groupIds.has(g)) {
        err('group-exists', `alternatives[${i}].groupIds`, `unknown group "${g}"`,
          `add a group with id "${g}", or remove the reference.`);
      }
    }
  });

  a.cells.forEach((cell, i) => {
    const at = `cells[${i}]`;
    if (!altIds.has(cell.alternativeId)) {
      err('cell-coordinates-exist', at, `unknown alternative "${cell.alternativeId}"`,
        'add the alternative, or correct the cell\'s alternativeId.');
    }
    if (!critIds.has(cell.criterionId)) {
      err('cell-coordinates-exist', at, `unknown criterion "${cell.criterionId}"`,
        'add the criterion, or correct the cell\'s criterionId.');
    }
    const criterion = a.criteria.find((c) => c.id === cell.criterionId);
    if (criterion && !measurementFor(criterion, cell.measure)) {
      err(
        'cell-measure-declared', at,
        `criterion "${cell.criterionId}" declares no measurement for measure "${cell.measure}"`,
        `declare a measurement for "${cell.measure}" on that criterion, or on its defaultMeasurement.`,
      );
    }
    cell.assertions.forEach((as, j) => {
      const atA = `${at}.assertions[${j}]`;
      if (!authorIds.has(as.authorId)) {
        honesty(
          'assertion-attributed', atA,
          `unknown author "${as.authorId}". An assertion nobody is named for cannot be weighed, ` +
            'and an agreement statistic over it cannot know how many heads produced it.',
          'add the author to `authors`, or attribute the assertion to an existing one.',
        );
      }
      const hasValue = as.value !== undefined;
      const hasMissing = as.missing !== undefined;
      if (hasValue === hasMissing) {
        err(
          'no-bare-null', atA,
          hasValue
            ? 'an assertion carries a value and a missing reason; exactly one is required'
            : 'an assertion carries neither a value nor a missing reason. No bare nulls: ' +
              'every absence names why.',
          hasValue
            ? 'remove whichever of value/missing is not meant.'
            : 'set a value, or set missing.code to a reason -- "not-assessed" if nobody has looked.',
        );
      }

      // A score with no reason is the thing this tool exists not to produce.
      // The justification is the most-read field in the document and the only
      // part of a cell a reader can argue with.
      if (hasValue && !as.justification?.trim()) {
        honesty(
          'score-has-a-reason', `${atA}.justification`,
          'a value with no justification. The number is unarguable without one, and a reader ' +
            'has nothing to disagree with except taste.',
          'write one line saying what the evidence shows, or record a qualified absence instead.',
        );
      }

      // A blank whose code the document never defines. Distinct from a code
      // this build does not implement: that one degrades honestly through
      // `broader` and is a limitation of the reader. This is a document that
      // does not say what its own blank means, which no reader can repair.
      if (as.missing) {
        const r = vocabulary.resolve(as.missing.code, cell.criterionId);
        if (r.source === 'undeclared') {
          honesty(
            'blank-is-defined', `${atA}.missing.code`,
            `the code "${as.missing.code}" is neither a core code nor declared in this document, ` +
              'so nothing anywhere says what this blank means.',
            'use a core code, or declare this one in `missingCodes` with a `broader` parent and ' +
              'what it means.',
          );
        }
      }

      // `withheldFromReader` is written by the projection, and only on what it
      // emptied. On an assertion that still carries content it is either a
      // producer mistaking it for a request to withhold, or an attempt to
      // inflate the widened-cell count -- and a projection that trusted it
      // would pass the content straight through (ADR-0021).
      if (as.disclosure?.withheldFromReader === true &&
        (hasValue || !!as.justification?.trim() || as.evidence.length > 0 || !!as.missing?.note)) {
        honesty(
          'disclosure-flag-is-projection-only', `${atA}.disclosure.withheldFromReader`,
          'marked as projected out for its reader, but it still carries a value, a justification, ' +
            'a note or evidence. The flag records what a projection removed; it is not a request to ' +
            'withhold, and it cannot be true of an assertion with content.',
          'remove withheldFromReader and let projectForReader decide what this reader sees; to keep ' +
            'the value from every reader, record a `withheld` absence instead.',
        );
      }

      // Not being finished is not a defect.
      if (hasValue && as.evidence.length === 0) {
        incomplete(
          'value-has-evidence', `${atA}.evidence`,
          'a value with no evidence reference. Legitimate for a considered human judgement; ' +
            'worth checking for anything that claims to rest on a source.',
          'cite the span the value rests on, if there is one.',
        );
      }

      for (const p of validateEvidence(as.evidence, `${atA}.evidence`)) {
        // Every rule in that module is an honesty rule. They were reported as
        // warnings, which meant a document whose every supporting reference was
        // the agent's own output validated cleanly -- the exact failure
        // ADR-0006 names, passing the boundary written to catch it.
        honesty(p.ruleId, p.path, p.message, p.fix);
      }
    });
  });

  // Groups belong to one axis, and nest as a tree (ADR-0008, the `labels`
  // profile). A row tagged with the other axis's group, or a block naming one,
  // is silently ignored by every reader -- which is why it is refused here.
  const axisOf = new Map(a.groups.map((g) => [g.id, g.axis]));
  const wrongAxis = (at: string, gid: string, want: 'alternatives' | 'criteria', fix: string) => {
    const got = axisOf.get(gid);
    if (got !== undefined && got !== want) {
      err('group-on-its-axis', at, `group "${gid}" is a group of ${got}, used here on ${want}`, fix);
    }
  };
  a.alternatives.forEach((alt, i) => alt.groupIds.forEach((g) => wrongAxis(
    `alternatives[${i}].groupIds`, g, 'alternatives', `tag this alternative with a group whose axis is "alternatives".`,
  )));
  a.criteria.forEach((c, i) => c.groupIds.forEach((g) => wrongAxis(
    `criteria[${i}].groupIds`, g, 'criteria', `tag this criterion with a group whose axis is "criteria".`,
  )));
  a.groups.forEach((g, i) => {
    if (g.parentId === undefined) return;
    if (!groupIds.has(g.parentId)) {
      err('group-exists', `groups[${i}].parentId`, `unknown group "${g.parentId}"`,
        `add a group with id "${g.parentId}", or remove the parentId.`);
    } else {
      wrongAxis(`groups[${i}].parentId`, g.parentId, g.axis, 'nest a group only under a group on the same axis.');
    }
  });
  for (const axis of ['alternatives', 'criteria'] as const) {
    for (const r of axisGroups(a, axis).refused) {
      // `selfEdge` is the one-group cycle (a group that is its own parent); the
      // library reports it under its own code, and it is the simplest cycle of all.
      if (r.kind === 'nesting' && (r.codes.includes('cycle') || r.codes.includes('selfEdge'))) {
        err(
          'group-nesting-acyclic', `groups[${a.groups.findIndex((g) => g.id === r.childId)}].parentId`,
          `nesting "${r.childId}" under "${r.groupId}" closes a cycle; a group cannot contain itself`,
          `remove one parentId on the cycle through "${r.childId}".`,
        );
      }
    }
  }

  for (const [i, b] of a.inapplicable.entries()) {
    wrongAxis(`inapplicable[${i}].alternativeGroupId`, b.alternativeGroupId, 'alternatives',
      'name a group of alternatives here.');
    wrongAxis(`inapplicable[${i}].criterionGroupId`, b.criterionGroupId, 'criteria',
      'name a group of criteria here.');
    if (!groupIds.has(b.alternativeGroupId)) {
      err('group-exists', `inapplicable[${i}]`, `unknown group "${b.alternativeGroupId}"`,
        'add the group, or remove the inapplicable block.');
    }
    if (!groupIds.has(b.criterionGroupId)) {
      err('group-exists', `inapplicable[${i}]`, `unknown group "${b.criterionGroupId}"`,
        'add the group, or remove the inapplicable block.');
    }
  }

  // The same redeclaration rule, for the two vocabularies that just gained it.
  // Written as a loop over (list, core table, field) rather than three times,
  // because three copies is how the fourth vocabulary gets forgotten.
  const vocabularies: [readonly { id: string }[], Readonly<Record<string, unknown>>, string][] = [
    [a.missingCodes, CORE_MISSING_CODES, 'missingCodes'],
    [a.reductions, CORE_REDUCTIONS, 'reductions'],
    // Criterion overlays take the same rules. Missing them would let a
    // criterion redeclare a core code, which is the one thing the rule stops.
    ...a.criteria.map((c, i): [readonly { id: string }[], Readonly<Record<string, unknown>>, string] =>
      [c.missingCodes, CORE_MISSING_CODES, `criteria[${i}].missingCodes`]),
  ];
  for (const [decls, core, field] of vocabularies) {
    const seen = new Set<string>();
    for (const [i, d] of decls.entries()) {
      // ADR-0009 clause 3: a structural extension must refine `not-applicable`.
      // Structural absence leaves every denominator and drops out of every
      // dominance comparison, so a code that claims it while refining, say,
      // `withheld` would silently remove cells from the matrix that somebody
      // deliberately declined to show. There is exactly one core code that
      // means "there was never a question here", and a structural extension is
      // a refinement of that one or it is a mistake.
      const structural = (d as { structural?: boolean }).structural;
      const broader = (d as { broader?: string }).broader;
      if (structural === true && broader !== NOT_APPLICABLE) {
        err(
          'structural-refines-not-applicable', `${field}[${i}]`,
          `"${d.id}" declares structural: true but refines "${broader}". Structural absence ` +
            'leaves every denominator and every comparison, which only "not-applicable" means.',
          `set broader to "${NOT_APPLICABLE}", or drop structural: true.`,
        );
      }
      if (Object.prototype.hasOwnProperty.call(core, d.id)) {
        err(
          'no-redeclaring-core', `${field}[${i}]`,
          `"${d.id}" is a core member and cannot be redeclared`,
          `use the core member as it is, or give the extension a different id.`,
        );
      }
      if (seen.has(d.id)) {
        err(
          'unique-declarations', `${field}[${i}]`,
          `"${d.id}" is declared more than once; the later one would win silently`,
          'remove the duplicate, or give it a different id.',
        );
      }
      seen.add(d.id);
    }
  }

  // A cell's identity must be unique. Two cells with the same identity is not a
  // merge conflict to be resolved later: it is a document in which two readers
  // of the same coordinates see different values.
  const seenCells = new Map<string, number>();
  for (const [i, c] of a.cells.entries()) {
    const k = cellKey(c.alternativeId, c.criterionId, c.measure);
    const first = seenCells.get(k);
    if (first !== undefined) {
      err(
        'cells-unique', `cells[${i}]`,
        `duplicates the identity of cells[${first}] (${c.alternativeId} x ${c.criterionId} x ` +
          `${c.measure}).`,
        'Merge their assertions into one cell -- a cell is already a set of assertions, so there ' +
          'is nothing a second cell can express that the first cannot.',
      );
    } else {
      seenCells.set(k, i);
    }
  }

  return problems.every((p) => p.severity !== 'error')
    ? { ok: true, analysis: a, problems }
    : { ok: false, problems };
}

/**
 * The identity of a cell, as one string.
 *
 * Exported so that nothing computes it a second time and gets it subtly
 * different.
 *
 * **`JSON.stringify` of the triple, not a separator-joined string**, because a
 * separator-joined key is not injective and a document is untrusted input.
 * With a NUL separator, `cellKey('a\u0000b', 'c', 'd')` and
 * `cellKey('a', 'b\u0000c', 'd')` produce the same key -- so two genuinely
 * different cells collide, one is silently lost from `cellIndex`, and the
 * duplicate check flags a pair that is not a duplicate. "NUL cannot occur in an
 * id" is a belief about producers, and this key does not need to hold it.
 *
 * Length-prefixing would also work. `JSON.stringify` is chosen because it is
 * obviously injective to a reader, and this runs once per cell per index build.
 */
export function cellKey(alternativeId: string, criterionId: string, measure: string): string {
  return JSON.stringify([alternativeId, criterionId, measure]);
}

/**
 * The vocabulary in force for this analysis, including every criterion overlay.
 *
 * **The one way to reach a missingness code's meaning.** Every consumer -- the
 * completeness tally, the view's absence label, the honesty rule that rejects an
 * undefined blank -- goes through this, so that criterion scope is honoured in
 * one place rather than remembered in several.
 */
export function vocabularyOf(a: Analysis): MissingnessVocabulary {
  const overlays = new Map(a.criteria.map((c) => [c.id, c.missingCodes]));
  return makeVocabulary(a.missingCodes, (criterionId) => overlays.get(criterionId) ?? []);
}

/** Index cells for O(1) lookup. Rebuilt rather than stored; it is derived. */
export function cellIndex(a: Analysis): Map<string, Cell> {
  const m = new Map<string, Cell>();
  for (const c of a.cells) m.set(cellKey(c.alternativeId, c.criterionId, c.measure), c);
  return m;
}

/**
 * One cell, by identity.
 *
 * **Delegates to `cellIndex` rather than scanning**, and that is a correctness
 * fix rather than a tidy-up. The scan returned the *first* match and the index
 * keeps the *last*, so on a document carrying two cells with the same identity
 * the two readers disagreed -- `getCell` showing one value and every matrix walk
 * showing another, with nothing anywhere saying so. Duplicates are not
 * hypothetical once contributions from several people are merged into one
 * document, which is what v1 does.
 *
 * The duplicate itself is rejected by `validateAnalysis`. This makes the two
 * readers agree even on a document that has not been validated.
 */
export function getCell(a: Analysis, alternativeId: string, criterionId: string, measure: string): Cell | undefined {
  return cellIndex(a).get(cellKey(alternativeId, criterionId, measure));
}

/**
 * A prepared reader over one analysis and one measure.
 *
 * Every analysis that walks the whole matrix -- completeness, dominance,
 * screening -- was otherwise scanning `cells` linearly per lookup, making a full
 * pass quadratic in the number of cells. At a hundred alternatives that is
 * millions of comparisons to answer a question the matrix already knows.
 *
 * Building it also resolves each criterion's measurement once rather than per
 * cell, which was the other repeated lookup.
 */
export interface CellReader {
  measure: string;
  read(alternativeId: string, criterionId: string): Reduced | undefined;
  measurementOf(criterionId: string): Measurement | undefined;
}

export function makeCellReader(
  a: Analysis,
  measure: string,
  /**
   * Appended to when a cell names a reduction this build cannot run.
   *
   * By reference rather than returned, so one list accumulates across a whole
   * matrix walk. Optional so the common call stays two arguments -- but a caller
   * that renders to a human should pass one, because a cell whose reduction was
   * refused shows nothing, and the reason it shows nothing lives here.
   */
  degradations?: Degradation[],
): CellReader {
  const cells = cellIndex(a);
  const measurements = new Map<string, Measurement | undefined>();
  for (const c of a.criteria) measurements.set(c.id, measurementFor(c, measure));

  return {
    measure,
    measurementOf: (criterionId) => measurements.get(criterionId),
    read(alternativeId, criterionId) {
      const cell = cells.get(cellKey(alternativeId, criterionId, measure));
      if (!cell) return undefined;
      const m = measurements.get(criterionId);
      return reduce(cell, {
        defaultReduction: a.defaultReduction,
        reductions: a.reductions,
        authors: a.authors,
        ...(m ? { level: m.level } : {}),
        ...(degradations ? { degradations } : {}),
      });
    },
  };
}

/**
 * Every scale name this analysis uses that this build could not interpret.
 *
 * Returned beside the document, never written into it: a degradation is a fact
 * about the reader, and storing one would make one build's gap look like a
 * property of the data.
 *
 * A degraded scale costs the *name*, not the behaviour -- `level`, `preference`
 * and `range` are required fields, so the column still validates, dominates and
 * renders. What the reader loses is the ability to say two analyses were scored
 * to the same scale, which is exactly what the record is for.
 */
export function scaleDegradations(a: Analysis): Degradation[] {
  const out: Degradation[] = [];
  a.criteria.forEach((c, i) => {
    const measurements: [string, Measurement | undefined][] = [
      ['defaultMeasurement', c.defaultMeasurement],
      ...Object.entries(c.measurements ?? {}).map(
        ([k, m]): [string, Measurement | undefined] => [`measurements.${k}`, m],
      ),
    ];
    for (const [where, m] of measurements) {
      if (!m?.scale) continue;
      const d = degradationOf(
        resolveScale(m.scale, a.scales), 'scale', `criteria[${i}].${where}.scale`,
      );
      if (d) out.push(d);
    }
  });
  return out;
}

/**
 * Reduce one cell.
 *
 * Convenient for a single lookup. Anything walking the matrix should build a
 * {@link CellReader} once instead -- this scans `cells` linearly.
 */
export function reducedValue(
  a: Analysis, alternativeId: string, criterionId: string, measure: string,
): Reduced | undefined {
  const cell = getCell(a, alternativeId, criterionId, measure);
  if (!cell) return undefined;
  const criterion = a.criteria.find((c) => c.id === criterionId);
  const m = criterion ? measurementFor(criterion, measure) : undefined;
  return reduce(cell, {
    defaultReduction: a.defaultReduction,
    reductions: a.reductions,
    authors: a.authors,
    ...(m ? { level: m.level } : {}),
  });
}

/** Whether a (alternative, criterion) pair falls in a declared inapplicable block. */
export function isInapplicable(a: Analysis, alternativeId: string, criterionId: string): boolean {
  // Delegates to the group adapter, which reads membership by closure through
  // `@zodal/groups-core`: a block on a group covers its sub-groups' members.
  // A whole-matrix walk should call `makeInapplicability` once instead.
  return makeInapplicability(a)(alternativeId, criterionId);
}

/**
 * Completeness at any scope. "What is left to do here" is a real question and
 * the tool should answer it (ADR-0009).
 */
export function completeness(
  a: Analysis,
  scope: { measure: string; alternativeIds?: readonly string[]; criterionIds?: readonly string[] },
): Completeness {
  const alts = scope.alternativeIds ?? a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id);
  const crits = scope.criterionIds ?? a.criteria.filter((x) => !x.tombstoned).map((x) => x.id);
  const cells: { hasValue: boolean; code?: string; criterionId?: string; widened?: boolean }[] = [];
  const reader = makeCellReader(a, scope.measure);
  const inapplicable = makeInapplicability(a);
  const index = cellIndex(a);

  for (const altId of alts) {
    for (const critId of crits) {
      if (inapplicable(altId, critId)) {
        cells.push({ hasValue: false, code: NOT_APPLICABLE, criterionId: critId });
        continue;
      }
      const cell = index.get(cellKey(altId, critId, scope.measure));
      const widened = cell !== undefined && isWidenedByDisclosure(cell);
      const r = reader.read(altId, critId);
      if (r?.value !== undefined) cells.push({ hasValue: true, criterionId: critId, widened });
      else if (r?.missing) cells.push({ hasValue: false, code: r.missing.code, criterionId: critId, widened });
      else cells.push({ hasValue: false, code: NOT_ASSESSED, criterionId: critId, widened });
    }
  }
  // The facade, not the flat list: each cell carries its criterion, so a
  // column's overlay resolves the way its author meant. Passing only the
  // analysis-level set would treat an overlay code as undeclared -- counting a
  // deliberate, defined blank as outstanding work.
  return tallyCompleteness(cells, vocabularyOf(a));
}

/** A cell that cites contradicting evidence, and which references do. */
export interface ContradictedCell {
  alternativeId: string;
  criterionId: string;
  measure: string;
  /** Ids of the live assertions' references whose stance is `contradicts`. */
  referenceIds: string[];
}

/**
 * Which cells cite evidence that contradicts what they assert.
 *
 * "n cells cite contradicting evidence" is the count the evidence reference's
 * `stance` field exists to make possible (#65, requested by the companion repo;
 * no ADR here decides `stance`): without it, three supporting sources and one
 * contradicting one collapse into "four citations". A contradicting reference is
 * not a defect -- recording it is the honest thing to do -- so this is a report,
 * not a validation rule.
 *
 * Counts only **live** assertions (a superseded one no longer speaks for the
 * cell) and skips tombstoned alternatives and criteria. Unlike `completeness`,
 * it does not rewrite cells inside a declared inapplicable block: a reference
 * that was recorded is reported wherever it sits. A live assertion that records
 * a qualified absence and cites contradicting evidence counts too -- the
 * contradiction is about the evidence, not about whether a value was given.
 * `measure` narrows to one measure; omitted, every cell counts.
 *
 * `referenceIds` is per cell, flattened across its live assertions; with
 * several raters it does not say whose assertion a reference contradicts.
 */
export function contradictedCells(
  a: Analysis,
  { measure }: { measure?: string } = {},
): { count: number; cells: ContradictedCell[] } {
  const liveAlts = new Set(a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id));
  const liveCrits = new Set(a.criteria.filter((x) => !x.tombstoned).map((x) => x.id));
  const cells: ContradictedCell[] = [];
  for (const cell of a.cells) {
    if (measure !== undefined && cell.measure !== measure) continue;
    if (!liveAlts.has(cell.alternativeId) || !liveCrits.has(cell.criterionId)) continue;
    const referenceIds = cell.assertions
      .filter((s) => !s.supersededBy)
      .flatMap((s) => s.evidence.filter((e) => e.stance === 'contradicts').map((e) => e.id));
    if (referenceIds.length > 0) {
      cells.push({
        alternativeId: cell.alternativeId,
        criterionId: cell.criterionId,
        measure: cell.measure,
        referenceIds,
      });
    }
  }
  return { count: cells.length, cells };
}

/**
 * Compare two criteria-set versions, or say they cannot be compared.
 *
 * Versions are opaque strings in the schema, and nothing declares an ordering
 * over them. The one ordering that needs no declaration is the one everybody
 * writes: dotted non-negative integers, optionally prefixed `v` (`"3"`,
 * `"1.2"`, `"v2.0.1"`). Those compare segment by segment, missing segments
 * reading as 0. Anything else -- a date, a hash, a name -- returns `undefined`
 * rather than a guess: sorting `"draft"` against `"final"` alphabetically
 * would invent a history.
 */
export function compareCriteriaVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  // Segments stay strings, compared by length after dropping leading zeros and
  // then lexically: exact at any size, where Number() stops distinguishing
  // integers above 2^53.
  const parse = (v: string) =>
    (/^[vV]?\d+(\.\d+)*$/.test(v) ? v.replace(/^[vV]/, '').split('.').map((d) => d.replace(/^0+(?=\d)/, '')) : undefined);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a === b ? 0 : undefined;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? '0';
    const q = y[i] ?? '0';
    if (p.length !== q.length) return p.length < q.length ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** A cell with live assertions scored against an older definition of its criterion. */
export interface SupersededCell {
  alternativeId: string;
  criterionId: string;
  measure: string;
  /** The version the criterion's current definition dates from. */
  definedInVersion: string;
  /** The live assertions scored against an earlier version, with the version each used. */
  assertions: { id: string; criteriaVersion: string }[];
}

/**
 * Which cells were scored against a superseded criterion definition (#62).
 *
 * An assertion is **superseded** when it records a `criteriaVersion` strictly
 * earlier than its criterion's `definedInVersion` -- the criterion changed
 * meaning after the score was given, so the score answers a question the
 * document no longer asks. A version at or after `definedInVersion` is current:
 * the criteria set moved on, but not this criterion.
 *
 * Two things are reported separately rather than guessed at:
 *
 * - `undetermined`: the versions differ and cannot be ordered (see
 *   `compareCriteriaVersions`). Counting them as superseded would overstate the
 *   problem; counting them as current would hide it.
 * - `unversioned`: live assertions on a versioned criterion that record no
 *   `criteriaVersion`. Nothing says what they were scored against.
 *
 * A criterion with no `definedInVersion` has never recorded a change of meaning
 * and supersedes nothing. Live assertions only; tombstoned rows and columns are
 * skipped, as in `contradictedCells`. `measure` narrows to one measure.
 */
export function supersededCells(
  a: Analysis,
  { measure }: { measure?: string } = {},
): {
  count: number;
  cells: SupersededCell[];
  undetermined: SupersededCell[];
  unversioned: number;
} {
  const liveAlts = new Set(a.alternatives.filter((x) => !x.tombstoned).map((x) => x.id));
  const definedIn = new Map(
    a.criteria.filter((c) => !c.tombstoned && c.definedInVersion !== undefined)
      .map((c) => [c.id, c.definedInVersion!]),
  );
  const cells: SupersededCell[] = [];
  const undetermined: SupersededCell[] = [];
  let unversioned = 0;
  for (const cell of a.cells) {
    if (measure !== undefined && cell.measure !== measure) continue;
    const current = definedIn.get(cell.criterionId);
    if (current === undefined || !liveAlts.has(cell.alternativeId)) continue;
    const older: SupersededCell['assertions'] = [];
    const unknown: SupersededCell['assertions'] = [];
    for (const s of cell.assertions) {
      if (s.supersededBy) continue;
      if (s.criteriaVersion === undefined) { unversioned++; continue; }
      const cmp = compareCriteriaVersions(s.criteriaVersion, current);
      if (cmp === -1) older.push({ id: s.id, criteriaVersion: s.criteriaVersion });
      else if (cmp === undefined) unknown.push({ id: s.id, criteriaVersion: s.criteriaVersion });
    }
    const base = {
      alternativeId: cell.alternativeId, criterionId: cell.criterionId, measure: cell.measure,
      definedInVersion: current,
    };
    if (older.length > 0) cells.push({ ...base, assertions: older });
    if (unknown.length > 0) undetermined.push({ ...base, assertions: unknown });
  }
  return { count: cells.length, cells, undetermined, unversioned };
}
