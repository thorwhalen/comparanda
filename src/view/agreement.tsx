/**
 * The agreement panel (#253, the view half of #111): the matrix's first
 * analysis panel, drawn below the grid when the composition root registers it.
 *
 * Two readouts, both per criterion and never for the matrix as a whole
 * (ADR-0022 rule 1):
 *
 * - Krippendorff's alpha for each criterion, with its jackknife interval, where
 *   it falls against the conventional bands *and the bands' source*, and
 *   whether it reads as agreement or only as consistency. The bands gate
 *   nothing: no row is hidden, flagged or left out by them.
 * - Group-informed consensus (ADR-0011 clause 8): a person names the camps,
 *   author by author, and the panel lists where the camps share ground and
 *   where they divide. Worded in its own terms ("common ground", "divided"),
 *   never with the cell's disagreement glyph, which is about one cell's raters
 *   and not about camps.
 *
 * An `AnalysisPanel`, registered by the composition root like `arrange`
 * (`mountMatrix(el, props, { panels: [AgreementPanel] })`): the matrix never
 * imports it, so a build that does not name it does not pay for it, which
 * matters against the standalone page's byte budget. Closed by default, and
 * computed only once opened.
 */
import { useId, useState } from 'preact/hooks';

import type { Analysis } from '../core/schema/analysis.js';
import { agreement, type CriterionAgreement } from '../core/analyses/agreement.js';
import { groupInformedConsensus, type Camp, type CellConsensus, type ConsensusResult } from '../core/analyses/consensus.js';
import { attributions, type Vouched } from '../core/identity.js';
import type { ViewerContext } from '../core/schema/redaction.js';

/** What every analysis panel is drawn from: the document and measure shown. */
export interface AnalysisPanelProps {
  analysis: Analysis;
  measure: string;
  /** Which authors' attestations the host performed (#263). */
  vouched?: Vouched | undefined;
  /** Who is looking: what an open anonymous round hides (ADR-0023). */
  viewer?: ViewerContext | undefined;
}

/** The camps as named so far: their labels, and which camp (by index) each author is in. */
interface Naming { labels: string[]; of: Record<string, number> }

const fixed = (n: number) => n.toFixed(2);

function bandSaid(c: CriterionAgreement): string {
  if (!c.band) return 'not placed';
  const { lower, upper } = c.band.edges;
  if (c.band.position === 'at-or-above-upper') return `at or above ${upper}`;
  if (c.band.position === 'below-lower') return `below ${lower}`;
  return `between ${lower} and ${upper}`;
}

function readAs(c: CriterionAgreement): string {
  return c.labelledAs === 'agreement' ? 'agreement between raters' : `consistency only (weakest independence: ${c.weakestIndependence})`;
}

export function AgreementPanel({ analysis, measure, vouched, viewer }: AnalysisPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<Naming>({ labels: ['Camp 1', 'Camp 2'], of: {} });
  // Personas count as their principal's camp, so only principals are named.
  const raters = analysis.authors.filter((a) => a.principalId == null || a.principalId === a.id);
  if (raters.length < 2) return null;
  const crit = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
  const alt = (aid: string) => analysis.alternatives.find((x) => x.id === aid)?.label ?? aid;
  const names = attributions(analysis.authors, { vouched });

  const body = () => {
    const result = agreement(analysis, { measure });
    const bandSource = result.criteria.find((c) => c.band)?.band?.source;
    const camps: Camp[] = naming.labels
      .map((label, i) => ({ id: `camp-${i}`, label, authorIds: raters.filter((r) => naming.of[r.id] === i).map((r) => r.id) }))
      .filter((c) => c.authorIds.length > 0);
    let consensus: ConsensusResult | string | undefined;
    if (camps.length >= 2) {
      try { consensus = groupInformedConsensus(analysis, { measure, camps, viewer }); } catch (error) { consensus = error instanceof Error ? error.message : String(error); }
    }
    const campLabel = (cid: string) => camps.find((c) => c.id === cid)?.label ?? cid;
    const cellSaid = (c: CellConsensus) => c.status === 'shared'
      ? `${alt(c.alternativeId)} on ${crit(c.criterionId)}: common ground at ${(c.common ?? []).join(', ')}.`
      : `${alt(c.alternativeId)} on ${crit(c.criterionId)}: ${c.camps.map((k) => `${campLabel(k.campId)} gave ${k.values.join(', ')}`).join('; ')}.`;
    return (
      <>
        <p class="comparanda-panel-hint">
          Krippendorff&apos;s alpha for each criterion, with its 95% interval. There is deliberately no figure for the matrix as a whole. The bands are shown with their source; they hide, flag and exclude nothing.
        </p>
        <table class="comparanda-analysis-table" data-agreement="">
          <caption>{`Agreement on ${measure}, criterion by criterion`}</caption>
          <thead><tr><th scope="col">Criterion</th><th scope="col">Alpha</th><th scope="col">95% interval</th><th scope="col">Against the bands</th><th scope="col">Reads as</th><th scope="col">Alternatives compared</th></tr></thead>
          <tbody>
            {result.criteria.map((c) => (
              <tr key={c.criterionId} data-criterion={c.criterionId}>
                <th scope="row">{crit(c.criterionId)}</th>
                <td>{c.alpha === undefined ? 'undefined' : fixed(c.alpha)}</td>
                <td>{c.interval ? `${fixed(c.interval[0])} to ${fixed(c.interval[1])}` : c.reason ?? 'none'}</td>
                <td>{bandSaid(c)}</td>
                <td>{readAs(c)}</td>
                <td>{String(c.pairableUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bandSource && <p class="comparanda-panel-hint" data-band-source="">{`Bands: ${bandSource}`}</p>}
        {result.skipped.length > 0 && (
          <p class="comparanda-panel-hint">{`Not computed: ${result.skipped.map((s) => `${crit(s.criterionId)} (${s.reason})`).join('; ')}.`}</p>
        )}
        <h3 id={`${id}-camps`}>Camps</h3>
        <p class="comparanda-panel-hint">Name the sides author by author: nothing here groups the raters for you. Personas count as their principal&apos;s camp.</p>
        <fieldset class="comparanda-camps" aria-labelledby={`${id}-camps`}>
          {naming.labels.map((label, i) => (
            <p key={`label-${i}`}>
              <label for={`${id}-label-${i}`}>{`Name of camp ${i + 1}`}</label>{' '}
              <input
                id={`${id}-label-${i}`} type="text" value={label}
                onInput={(e) => { const labels = [...naming.labels]; labels[i] = (e.currentTarget as HTMLInputElement).value; setNaming({ ...naming, labels }); }}
              />
            </p>
          ))}
          <p><button type="button" onClick={() => setNaming({ ...naming, labels: [...naming.labels, `Camp ${naming.labels.length + 1}`] })}>Add a camp</button></p>
          {raters.map((r) => (
            <p key={r.id}>
              <label for={`${id}-in-${r.id}`}>{names.get(r.id) ?? r.id}</label>{' '}
              <select
                id={`${id}-in-${r.id}`} value={naming.of[r.id] === undefined ? '' : String(naming.of[r.id])}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  const of = { ...naming.of };
                  if (v === '') delete of[r.id]; else of[r.id] = Number(v);
                  setNaming({ ...naming, of });
                }}
              >
                <option value="">In no camp</option>
                {naming.labels.map((label, i) => <option key={i} value={String(i)}>{label || `Camp ${i + 1}`}</option>)}
              </select>
            </p>
          ))}
        </fieldset>
        {consensus === undefined && <p class="comparanda-panel-hint" data-consensus="">Put authors in at least two camps to see where the camps share ground and where they divide.</p>}
        {typeof consensus === 'string' && <p class="comparanda-panel-hint" role="note" data-consensus="">{`Not compared: ${consensus}`}</p>}
        {typeof consensus === 'object' && (
          <div data-consensus="">
            <table class="comparanda-analysis-table">
              <caption>Where the camps share ground, criterion by criterion</caption>
              <thead><tr><th scope="col">Criterion</th><th scope="col">Common ground</th><th scope="col">Divided</th><th scope="col">Not compared</th></tr></thead>
              <tbody>
                {consensus.criteria.map((c) => (
                  <tr key={c.criterionId}><th scope="row">{crit(c.criterionId)}</th><td>{String(c.shared)}</td><td>{String(c.divided)}</td><td>{String(c.notCompared)}</td></tr>
                ))}
              </tbody>
            </table>
            {consensus.authorHidden > 0 && (
              <p class="comparanda-panel-hint">{`${consensus.authorHidden} ${consensus.authorHidden === 1 ? 'value is' : 'values are'} in no camp: an open round hides who gave ${consensus.authorHidden === 1 ? 'it' : 'them'} from you.`}</p>
            )}
            {(['shared', 'divided'] as const).map((status) => {
              const cells = (consensus as ConsensusResult).cells.filter((c) => c.status === status);
              return cells.length > 0 && (
                <section key={status} data-consensus-status={status}>
                  <h4>{status === 'shared' ? `Common ground (${cells.length})` : `Divided (${cells.length})`}</h4>
                  <ul>{cells.map((c) => <li key={`${c.alternativeId}:${c.criterionId}`}>{cellSaid(c)}</li>)}</ul>
                </section>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <details class="comparanda-analysis" data-analysis="agreement" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Agreement between raters, and where named camps share ground</summary>
      {open && body()}
    </details>
  );
}
