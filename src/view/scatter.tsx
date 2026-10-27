/**
 * The two-criterion scatter (#97, ADR-0026): two chosen criteria against each
 * other, each alternative's dominance tier on those two drawn as its mark, and
 * its tier across every criterion as a second mark around it.
 *
 * The front it draws is labelled for what it is: "non-dominated on these two
 * criteria". An alternative on it may be dominated overall, and the outer mark
 * says so, so a screenshot of this view cannot pass for the frontier.
 *
 * Every distinction is a shape, never a colour alone (comparanda-dev-a11y-gate):
 * a filled dot, a ring and a cross for the three tiers here; a square, a dashed
 * square or nothing for the tier overall. Both axes run so that better is up
 * and to the right, whichever way each criterion's preference points, and say
 * so. The table under the plot carries everything the plot does, in words, and
 * lists the alternatives the plot cannot place, with why each value is absent.
 * No line is drawn through the front: between two non-dominated alternatives
 * there is nothing, and a line would draw a continuum the data does not have.
 *
 * An `AnalysisPanel` the composition root registers
 * (`mountMatrix(el, props, { panels: [ScatterPanel] })`), like `AgreementPanel`:
 * the matrix never imports it, so the standalone page does not pay for it.
 * Closed by default and computed only once opened. Its styling is SVG
 * presentation attributes in `currentColor`, so it adds nothing to the
 * matrix's stylesheet.
 */
import { useId, useState } from 'preact/hooks';

import { scatterCriteria, scatterModel, type DominanceTier, type ScatterAxis, type ScatterPoint, type UsableScatterModel } from '../core/analyses/scatter.js';
import { aliasesOf } from '../core/schema/structure.js';
import { capitalise } from './words.js';
import type { AnalysisPanelProps } from './agreement.js';

/** The plot's drawing box, in SVG user units, the margin its tick labels sit in, and a mark's radius. */
const PLOT = Object.freeze({ width: 360, height: 280, margin: 44, mark: 5 });

const TIER_SAID: Readonly<Record<DominanceTier, string>> = {
  'non-dominated': 'non-dominated',
  'possibly-dominated': 'possibly dominated',
  dominated: 'dominated',
};

/** Where a value sits along an axis of `length`, with better always toward the far end. The schema keeps min below max. */
function along(axis: ScatterAxis, value: number, length: number): number {
  const { min, max } = axis.range!;
  const t = (value - min) / (max - min);
  return (axis.preference === 'decreasing' ? 1 - t : t) * length;
}

/** The mark for a point's tier on these two criteria: filled, a ring, a cross. */
function HereMark({ tier, x, y }: { tier: DominanceTier; x: number; y: number }) {
  const r = PLOT.mark;
  if (tier === 'dominated') {
    return <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} stroke="currentColor" stroke-width="1.5" />;
  }
  return <circle cx={x} cy={y} r={r} fill={tier === 'non-dominated' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" />;
}

/** The mark for its tier across every criterion: a square, a dashed square, or nothing when it survives there too. */
function OverallMark({ tier, x, y }: { tier: DominanceTier; x: number; y: number }) {
  if (tier === 'non-dominated') return null;
  const s = PLOT.mark * 2;
  return (
    <rect
      x={x - s} y={y - s} width={s * 2} height={s * 2} fill="none" stroke="currentColor" stroke-width="1"
      stroke-dasharray={tier === 'possibly-dominated' ? '3 2' : undefined}
    />
  );
}

/** The ticks an axis is labelled with: its declared range's ends, and the whole levels between them when there are few. */
function ticksOf(axis: ScatterAxis): number[] {
  const { min, max } = axis.range!;
  return Number.isInteger(min) && Number.isInteger(max) && max - min <= 10
    ? Array.from({ length: max - min + 1 }, (_, i) => min + i)
    : [min, max];
}

export function ScatterPanel({ analysis, measure }: AnalysisPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<[string, string] | undefined>(undefined);

  const body = () => {
    const usable = scatterCriteria(analysis, measure);
    if (usable.length < 2) {
      return <p role="note">{`A two-criterion scatter needs two criteria that admit a dominance comparison; this analysis has ${usable.length}.`}</p>;
    }
    // A choice the document no longer allows (a criterion removed, or no longer comparable) falls back to the first two.
    const [xId, yId] = chosen && chosen.every((c) => usable.includes(c)) ? chosen : [usable[0]!, usable[1]!];
    const label = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
    const picker = (which: 0 | 1, value: string) => (
      <>
        <label for={`${id}-${which}`}>{which === 0 ? 'Across' : 'Up'}</label>{' '}
        <select
          id={`${id}-${which}`} value={value}
          onChange={(e) => {
            const picked = (e.currentTarget as HTMLSelectElement).value;
            const other = which === 0 ? yId : xId;
            // Picking the other axis's criterion swaps the two, rather than asking for the same one twice.
            const next: [string, string] = which === 0 ? [picked, picked === other ? xId : other] : [picked === other ? yId : other, picked];
            setChosen(next);
          }}
        >
          {usable.map((cid) => <option key={cid} value={cid}>{label(cid)}</option>)}
        </select>{' '}
      </>
    );
    const model = scatterModel(analysis, { measure, criteria: [xId, yId] });
    return (
      <>
        <fieldset>
          <legend>The two criteria</legend>
          {picker(0, xId)}
          {picker(1, yId)}
        </fieldset>
        {model.usable ? <Plot model={model} id={id} rowWord={capitalise(aliasesOf(analysis).alternative)} /> : <p role="note">{model.reason}</p>}
      </>
    );
  };

  return (
    <details class="comparanda-analysis" data-analysis="scatter" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Two criteria against each other, with what is dominated on them</summary>
      {open && body()}
    </details>
  );
}

function Plot({ model, id, rowWord }: { model: UsableScatterModel; id: string; rowWord: string }) {
  const { axes: [ax, ay], points, caption, overallBasis, notes, overallNotes, measure } = model;
  const { width, height, margin, mark } = PLOT;
  const placed = points.filter((p): p is ScatterPoint & { x: number; y: number } => p.x !== undefined && p.y !== undefined);
  const unplaced = points.filter((p) => p.x === undefined || p.y === undefined);
  // Points at the same place are drawn side by side under one label: one would otherwise hide the other.
  const spots = new Map<string, (ScatterPoint & { x: number; y: number })[]>();
  for (const p of placed) spots.set(`${p.x}\u0000${p.y}`, [...(spots.get(`${p.x}\u0000${p.y}`) ?? []), p]);
  const front = points.filter((p) => p.here === 'non-dominated').map((p) => (p.x === undefined || p.y === undefined ? `${p.label} (not placed)` : p.label));
  const said = (v: number | undefined, absent: string | undefined) => (v === undefined ? absent ?? '' : String(v));
  return (
    <figure aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`}>
        <strong>{capitalise(caption)}</strong>
        {`: ${front.length > 0 ? front.join(', ') : 'none'}. This is not the frontier across every criterion; the outer mark says where each one stands there. Measure: ${measure}.`}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" style={{ maxWidth: '100%', height: 'auto' }}
        aria-label={`${ax.label} across, ${ay.label} up, better toward the top right. The table below says the same in words.`}
      >
        {ticksOf(ax).map((t) => (
          <text key={`x${t}`} x={margin + along(ax, t, width - 2 * margin)} y={height - margin + 16} text-anchor="middle" font-size="11" fill="currentColor">{String(t)}</text>
        ))}
        {ticksOf(ay).map((t) => (
          <text key={`y${t}`} x={margin - 8} y={height - margin - along(ay, t, height - 2 * margin) + 4} text-anchor="end" font-size="11" fill="currentColor">{String(t)}</text>
        ))}
        <text x={width / 2} y={height - 6} text-anchor="middle" font-size="12" fill="currentColor">{`${ax.label} (better to the right)`}</text>
        <text x={12} y={height / 2} text-anchor="middle" font-size="12" fill="currentColor" transform={`rotate(-90 12 ${height / 2})`}>{`${ay.label} (better up)`}</text>
        {[...spots.values()].map((here) => {
          const cx = margin + along(ax, here[0]!.x, width - 2 * margin);
          const cy = height - margin - along(ay, here[0]!.y, height - 2 * margin);
          const step = mark * 2.6;
          return (
            <g key={here[0]!.alternativeId}>
              {here.map((p, i) => {
                const x = cx + (i - (here.length - 1) / 2) * step;
                return (
                  <g key={p.alternativeId} data-point={p.alternativeId} data-here={p.here} data-overall={p.overall}>
                    <OverallMark tier={p.overall} x={x} y={cy} />
                    <HereMark tier={p.here} x={x} y={cy} />
                  </g>
                );
              })}
              <text x={cx + ((here.length - 1) / 2) * step + mark * 2 + 3} y={cy + 4} font-size="11" fill="currentColor">{here.map((p) => p.label).join(', ')}</text>
            </g>
          );
        })}
      </svg>
      <ul class="comparanda-panel-hint" aria-label="What the marks mean">
        <li>On these two criteria: a filled dot is non-dominated, a ring is possibly dominated (it depends on how the blanks resolve), a cross is dominated.</li>
        <li>{`Across every criterion: no square is non-dominated, a dashed square is possibly dominated, a square is dominated. ${capitalise(overallBasis)}.`}</li>
        <li>Alternatives at the same place are drawn side by side, under one label.</li>
      </ul>
      <table class="comparanda-analysis-table">
        <caption>{`${ax.label} and ${ay.label}, one row each (measure: ${measure})`}</caption>
        <thead>
          <tr>
            <th scope="col">{rowWord}</th><th scope="col">{ax.label}</th><th scope="col">{ay.label}</th>
            <th scope="col">On these two criteria</th><th scope="col">Across every criterion</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.alternativeId} data-row={p.alternativeId}>
              <th scope="row">{p.label}</th>
              <td>{said(p.x, p.xAbsent)}</td>
              <td>{said(p.y, p.yAbsent)}</td>
              <td>{`${TIER_SAID[p.here]}${p.dominatedBy.length > 0 ? ` by ${p.dominatedBy.map((d) => points.find((q) => q.alternativeId === d)?.label ?? d).join(', ')}` : ''}`}</td>
              <td>{TIER_SAID[p.overall]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unplaced.length > 0 && (
        <p class="comparanda-panel-hint">
          {`Not on the plot: ${unplaced.map((p) => `${p.label} (${[p.x === undefined && `${ax.label}: ${p.xAbsent}`, p.y === undefined && `${ay.label}: ${p.yAbsent}`].filter(Boolean).join('; ')})`).join(', ')}. Their tiers are in the table.`}
        </p>
      )}
      {notes.map((n) => <p key={`h${n}`} class="comparanda-panel-hint">{`On these two criteria: ${n}`}</p>)}
      {overallNotes.map((n) => <p key={`o${n}`} class="comparanda-panel-hint">{`Across every criterion: ${n}`}</p>)}
    </figure>
  );
}
