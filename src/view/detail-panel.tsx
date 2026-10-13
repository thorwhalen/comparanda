/**
 * The detail panel (#94, ADR-0027): a non-modal `<aside role="complementary">`
 * beside the matrix, saying everything about the reader's position.
 *
 * A tooltip may never hold focusable content, and evidence links are
 * focusable, so this panel is the one route to the citations and the full
 * record of a cell: every assertion, its author and provenance, its
 * justification and evidence, the absence's reason and note, and how several
 * values fall across the declared levels. On an alternative's header it names
 * the alternative's strongest and weakest criteria (`alternativeStanding`); on
 * a criterion's header, the criterion's definition and scale; on the corner,
 * the subject.
 *
 * It follows the grid's position (`session.focus`) and is opened and closed by
 * `session.detailPanelOpen`, both view state, so a reload restores it. Like the
 * matrix it is a pure function of its props: what it says is `core/detail.ts`'s,
 * and everything here is wording and markup.
 */
import { Fragment } from 'preact';

import { alternativeStanding, cellDetail, type AssertionDetail, type EvidenceDetail, type LevelDistribution } from '../core/detail.js';
import type { Analysis } from '../core/schema/analysis.js';
import type { CheckStanding, CitationCheck } from '../core/schema/evidence.js';
import type { Measurement } from '../core/schema/measurement.js';
import type { MissingnessVocabulary } from '../core/schema/missingness.js';
import { attribution } from '../core/identity.js';
import type { Independence } from '../core/schema/provenance.js';
import { aliasesOf, measurementFor } from '../core/schema/structure.js';
import type { Session } from '../core/view-state.js';
import { capitalise, outOf, STANDING_SAID } from './words.js';
import { Threads, type ThreadWrites } from './threads.js';
import type { Affordances } from '../core/affordances.js';

export interface DetailPanelProps {
  analysis: Analysis;
  measure: string;
  vocabulary: MissingnessVocabulary;
  /** The grid position the panel describes. */
  focus: Session['focus'];
  standing?: ((check: CitationCheck | undefined) => CheckStanding) | undefined;
  /** The close button's action. */
  onClose: () => void;
  /** `Escape` inside the panel: back to the grid, the panel left open. */
  onReturn: () => void;
  /**
   * The heading's id. Given by the matrix rather than drawn from `useId`: a
   * component mounted after its siblings can be handed one of their ids.
   */
  headingId: string;
  /** Asked before any thread write is offered. */
  affordances: Affordances;
  writes?: ThreadWrites | undefined;
}

const INDEPENDENCE_SAID: Readonly<Record<Independence, string>> = {
  independent: 'made independently of the others',
  'shared-context': 'made with context shared with the others',
  resampled: 'a resampled draw of the same source',
  perturbed: 'a perturbed run of the same source',
  consensus: 'a consensus verdict',
};

const SOURCE_SAID: Readonly<Record<EvidenceDetail['ref']['sourceType'], string>> = {
  primary: 'primary source',
  secondary: 'secondary source',
  'agent-summary': 'summary written by the agent',
  'agent-inference': "the agent's own inference",
};

const FRESHNESS_SAID: Readonly<Record<CheckStanding['freshness'], string>> = {
  unchecked: 'not checked',
  current: 'checked by the current checker',
  'older-checker': 'checked by an earlier checker; the current one has not re-run it',
  aged: 'checked, but long enough ago to be re-checked',
};

export function DetailPanel(props: DetailPanelProps) {
  const { analysis, focus, onClose, onReturn, headingId } = props;
  const words = aliasesOf(analysis);
  const alternative = analysis.alternatives.find((x) => x.id === focus?.alternativeId);
  const criterion = analysis.criteria.find((x) => x.id === focus?.criterionId);
  const title = alternative && criterion
    ? `${criterion.label}, ${alternative.label}`
    : alternative?.label ?? criterion?.label ?? analysis.title ?? analysis.subject.question;
  const kind = alternative && criterion ? 'cell' : alternative ? words.alternative : criterion ? words.criterion : 'analysis';
  return (
    <aside
      class="comparanda-panel" role="complementary" aria-labelledby={headingId} data-panel={kind}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onReturn();
      }}
    >
      <div class="comparanda-panel-head">
        <h2 id={headingId} tabIndex={-1} data-panel-heading="">
          <span class="comparanda-panel-kind">{`${capitalise(kind)}: `}</span>{title}
        </h2>
        <button type="button" class="comparanda-panel-close" onClick={onClose}>Close details</button>
      </div>
      <p class="comparanda-panel-hint">Escape returns to the matrix; the details stay open and follow your position.</p>
      {alternative && criterion
        ? <CellSection {...props} alternativeId={alternative.id} criterionId={criterion.id} />
        : alternative
          ? <AlternativeSection {...props} alternativeId={alternative.id} />
          : criterion
            ? <CriterionSection measurement={measurementFor(criterion, props.measure)} criterion={criterion} />
            : <p>{analysis.subject.question}</p>}
      <Threads
        analysis={analysis} measure={props.measure} affordances={props.affordances} writes={props.writes} idBase={headingId}
        position={{ alternativeId: alternative?.id, criterionId: criterion?.id }}
      />
    </aside>
  );
}

function CellSection({ analysis, measure, vocabulary, standing, alternativeId, criterionId }: DetailPanelProps & { alternativeId: string; criterionId: string }) {
  const d = cellDetail(analysis, alternativeId, criterionId, measure, { vocabulary, standing });
  const { reduced, absence } = d;
  const shown = reduced?.refused !== undefined
    ? reduced.refusedBecause === 'withheld-from-reader'
      ? 'Partly withheld from you; what you can see does not settle this cell.'
      : `No single value: ${reduced.refused}`
    : reduced?.value !== undefined
      ? `${String(reduced.value)}${reduced.withheldFromReader ? '' : outOf(reduced.value, d.measurement)}`
      : undefined;
  const live = d.assertions.filter((x) => !x.superseded);
  const superseded = d.assertions.filter((x) => x.superseded);
  return (
    <>
      <dl class="comparanda-panel-facts">
        <dt>Shows</dt>
        <dd data-detail="shows">
          {shown ?? <Absence absence={absence!} />}
          {reduced?.withheldFromReader ? ` (${reduced.withheldFromReader} withheld from you)` : ''}
        </dd>
        {d.assertions.length > 1 && <><dt>Read as</dt><dd>{`the ${d.reduction} of the live assertions`}</dd></>}
        {d.inapplicable && <><dt>Applies</dt><dd>A declared block says this criterion does not apply here.</dd></>}
      </dl>
      {d.set.n > 1 && <p data-detail="set">{d.set.label}</p>}
      {d.distribution && <Distribution distribution={d.distribution} />}
      <h3>{live.length === 0 ? 'No assertions recorded' : `Assertions (${live.length})`}</h3>
      {live.length > 0 && <ol class="comparanda-assertions">{live.map((x) => <AssertionItem key={x.assertion.id} detail={x} />)}</ol>}
      {superseded.length > 0 && (
        <>
          <h3>{`Superseded (${superseded.length}), kept for the record`}</h3>
          <ol class="comparanda-assertions">{superseded.map((x) => (
            <AssertionItem key={x.assertion.id} detail={x} replacedBy={d.assertions.find((y) => y.assertion.id === x.assertion.supersededBy)} />
          ))}</ol>
        </>
      )}
    </>
  );
}

function Absence({ absence }: { absence: NonNullable<ReturnType<typeof cellDetail>['absence']> }) {
  const means = absence.means ?? `a reason this analysis does not define (“${absence.code}”)`;
  return (
    <>
      {`${capitalise(means.replace(/\.$/, ''))}. ${STANDING_SAID[absence.standing]}`}
      {absence.note && <span class="comparanda-note">{` Note: ${absence.note}`}</span>}
    </>
  );
}

function AssertionItem({ detail, replacedBy }: { detail: AssertionDetail; replacedBy?: AssertionDetail | undefined }) {
  const { assertion: s, author } = detail;
  const who = author
    ? attribution(author, { principal: detail.principal })
    : `An author this analysis does not describe (“${s.authorId}”)`;
  const provenance = [
    s.independence ? INDEPENDENCE_SAID[s.independence] : 'independence not recorded',
    detail.round && `in ${detail.round}`,
    detail.procedure && `by the procedure “${detail.procedure}”`,
    s.criteriaVersion && `scored against criteria version ${s.criteriaVersion}`,
  ].filter(Boolean).join('; ');
  return (
    <li data-assertion={s.id} data-superseded={detail.superseded ? 'true' : undefined}>
      <p class="comparanda-assertion-head">
        {detail.superseded && `Superseded${replacedBy ? ` by ${(replacedBy.author ? attribution(replacedBy.author) : replacedBy.assertion.authorId)}'s ${replacedBy.assertion.value !== undefined && !replacedBy.withheldFromReader ? String(replacedBy.assertion.value) : 'assertion'}` : ''}: `}
        <strong>{detail.withheldFromReader ? 'Withheld from you' : s.value !== undefined ? String(s.value) : 'No value'}</strong>
        {` — ${who}, ${s.at}`}
      </p>
      {detail.absence && <p><Absence absence={detail.absence} /></p>}
      {s.justification && <p class="comparanda-justification">{s.justification}</p>}
      <p class="comparanda-provenance">{`${capitalise(provenance)}.`}</p>
      {detail.evidence.length > 0 && (
        <ul class="comparanda-evidence" aria-label="Evidence">
          {detail.evidence.map((e) => <EvidenceItem key={e.ref.id} evidence={e} />)}
        </ul>
      )}
    </li>
  );
}

/** A target that names a web resource is a link; anything else is opaque to the view, and shown as text. */
const LINKABLE = /^https?:\/\//i;

function EvidenceItem({ evidence: e }: { evidence: EvidenceDetail }) {
  const { ref } = e;
  // Never a bare verdict: what the stored check records, and how far it can be trusted.
  const c = ref.check;
  const check = c && c.status !== 'unchecked'
    ? `Quote check: ${c.status}` +
      `${c.checkedAt ? `, on ${c.checkedAt}` : ''}${c.checkerVersion ? ` by checker ${c.checkerVersion}` : ''}` +
      `${e.check ? `; ${FRESHNESS_SAID[e.check.freshness]}` : '; how current it is was not assessed'}` +
      `${c.originalDrifted || e.check?.sourceChanged ? '; the source has changed since it was read' : ''}.` +
      `${c.detail ? ` ${c.detail}` : ''}`
    : 'Quote not checked.';
  return (
    <li data-evidence={ref.id} data-stance={ref.stance}>
      {LINKABLE.test(ref.target)
        ? <a href={ref.target} target="_blank" rel="noopener noreferrer">{e.label}</a>
        : <span class="comparanda-target">{e.label}{e.label !== ref.target ? ` (${ref.target})` : ''}</span>}
      {` — ${ref.stance}, ${SOURCE_SAID[ref.sourceType]}.`}
      {e.unfounded && <strong>{' Derived from nothing cited: an assertion with nothing behind it.'}</strong>}
      {ref.excerpt && <blockquote>{ref.excerpt}</blockquote>}
      <span class="comparanda-check">{` ${check}`}</span>
    </li>
  );
}

/**
 * How several values fall across the declared levels, as a stacked bar with
 * every segment's level and count in words beside it. In level order, never
 * centred: a diverging bar needs a declared neutral level (ADR-0026), and
 * schema v1 cannot declare one.
 */
function Distribution({ distribution: d }: { distribution: LevelDistribution }) {
  const said = d.levels.filter((l) => l.count > 0).map((l) => `${String(l.level)}: ${l.count}`);
  return (
    <figure class="comparanda-distribution" data-detail="distribution">
      <div class="comparanda-bar" aria-hidden="true">
        {d.levels.filter((l) => l.count > 0).map((l) => (
          <span key={String(l.level)} style={{ flexGrow: l.count }}>{String(l.level)}</span>
        ))}
      </div>
      <figcaption>
        {`${d.n} values by level${d.ordered ? ', lowest first' : ''}: ${said.join('; ')}.`}
        {d.undeclared > 0 && ` ${d.undeclared} not on a declared level.`}
        {' Not centred: this scale declares no neutral level.'}
      </figcaption>
    </figure>
  );
}

function AlternativeSection({ analysis, measure, alternativeId }: DetailPanelProps & { alternativeId: string }) {
  const words = aliasesOf(analysis);
  const s = alternativeStanding(analysis, alternativeId, measure);
  const label = new Map(analysis.criteria.map((c) => [c.id, c.label]));
  const description = analysis.alternatives.find((x) => x.id === alternativeId)?.description;
  const line = (x: (typeof s.standings)[number]) =>
    `${label.get(x.criterionId)}: better than ${x.better} of the ${x.compared} other ${x.compared === 1 ? words.alternative : words.alternatives} with a value there, worse than ${x.worse}.`;
  const why: Record<(typeof s.excluded)[number]['reason'], string> = {
    'no-measurement': 'no measurement is declared for this measure',
    'no-direction': 'no direction of preference, so no value is better than another',
    target: 'it prefers a target value, which this comparison does not read',
    'no-value': 'no value here to compare',
    'nothing-to-compare': `no other ${words.alternative} has a value here`,
  };
  return (
    <>
      {description && <p>{description}</p>}
      <p class="comparanda-panel-hint">
        {`Strongest and weakest relative to the other ${words.alternatives}, criterion by criterion: a count of better and worse, never the values themselves on one scale.`}
      </p>
      {s.strongest.length > 0
        ? (
          <dl class="comparanda-panel-facts" data-detail="standing">
            <dt>Strongest</dt>
            {s.strongest.map((x) => <dd key={x.criterionId} data-strongest={x.criterionId}>{line(x)}</dd>)}
            <dt>Weakest</dt>
            {s.weakest.map((x) => <dd key={x.criterionId} data-weakest={x.criterionId}>{line(x)}</dd>)}
          </dl>
        )
        : <p data-detail="standing">{`No ${words.criterion} stands out: ${s.standings.length < 2 ? `fewer than two ${words.criteria} can be compared` : `it stands alike on every ${words.criterion} compared`}.`}</p>}
      {s.excluded.length > 0 && (
        <>
          <h3>{`Not compared (${s.excluded.length})`}</h3>
          <ul>{s.excluded.map((x) => <li key={x.criterionId}>{`${label.get(x.criterionId)}: ${why[x.reason]}.`}</li>)}</ul>
        </>
      )}
    </>
  );
}

function CriterionSection({ criterion, measurement: m }: { criterion: Analysis['criteria'][number]; measurement: Measurement | undefined }) {
  const def = criterion.definition;
  return (
    <dl class="comparanda-panel-facts">
      {def?.question && <><dt>Asks</dt><dd>{def.question}</dd></>}
      {def?.objective && <><dt>Objective</dt><dd>{def.objective}</dd></>}
      {def?.evidenceRule && <><dt>Evidence rule</dt><dd>{def.evidenceRule}</dd></>}
      <dt>Scale</dt>
      <dd>
        {m
          ? `${capitalise(m.level)}, ${m.preference === 'none' ? 'no direction of preference' : `preference ${m.preference}`}` +
            `${m.range ? `, from ${m.range.min} to ${m.range.max}${m.range.unit ? ` ${m.range.unit}` : ''}` : ''}` +
            `${m.levels ? `; levels ${m.levels.map(String).join(', ')}` : ''}.`
          : 'No measurement is declared for this measure.'}
      </dd>
      {m?.anchors && Object.entries(m.anchors.levels).map(([level, means]) => (
        <Fragment key={level}><dt>{`Level ${level}`}</dt><dd>{means}</dd></Fragment>
      ))}
      {criterion.acceptability && (
        <><dt>Floor</dt><dd>{`${criterion.acceptability.threshold}: ${criterion.acceptability.rationale}`}</dd></>
      )}
    </dl>
  );
}
