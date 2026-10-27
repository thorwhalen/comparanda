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
 * lists the alternatives the plot cannot place.
 *
 * An `AnalysisPanel` the composition root registers
 * (`mountMatrix(el, props, { panels: [ScatterPanel] })`), like `AgreementPanel`:
 * the matrix never imports it, so the standalone page does not pay for it.
 * Closed by default and computed only once opened. Its styling is SVG
 * presentation attributes in `currentColor`, so it adds nothing to the
 * matrix's stylesheet.
 */
import { useId, useState } from 'preact/hooks';

import { dominance } from '../core/analyses/dominance.js';
import { scatterModel, type DominanceTier, type ScatterAxis, type ScatterPoint } from '../core/analyses/scatter.js';
import { aliasesOf } from '../core/schema/structure.js';
import { capitalise } from './words.js';
import type { AnalysisPanelProps } from './agreement.js';

/** The plot's drawing box, in SVG user units, and the margin its tick labels sit in. */
const PLOT = Object.freeze({ width: 360, height: 280, margin: 44, mark: 5 });

const TIER_SAID: Readonly<Record<DominanceTier, string>> = {
  'non-dominated': 'non-dominated',
  'possibly-dominated': 'possibly dominated',
  dominated: 'dominated',
};

/** Where a value sits along an axis of `length`, with better always toward the far end. */
function along(axis: ScatterAxis, value: number, length: number): number {
  const { min, max } = axis.range ?? { min: 0, max: 1 };
  const t = max === min ? 0.5 : (value - min) / (max - min);
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
  const { min, max } = axis.range ?? { min: 0, max: 1 };
  const span = max - min;
  return Number.isInteger(min) && Number.isInteger(max) && span > 0 && span <= 10
    ? Array.from({ length: span + 1 }, (_, i) => min + i)
    : [min, max];
}

export function ScatterPanel({ analysis, measure }: AnalysisPanelProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<[string, string] | undefined>(undefined);

  const body = () => {
    // The criteria a dominance comparison can use: the only ones a scatter of tiers can be drawn over.
    const usable = dominance(analysis, { measure }).basis;
    if (usable.length < 2) {
      return <p role="note">{`A two-criterion scatter needs two criteria that admit a dominance comparison; this analysis has ${usable.length}.`}</p>;
    }
    const [xId, yId] = chosen ?? [usable[0]!, usable[1]!];
    const label = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
    const picker = (which: 0 | 1, value: string) => (
      <>
        <label for={`${id}-${which}`}>{which === 0 ? 'Across' : 'Up'}</label>{' '}
        <select
          id={`${id}-${which}`} value={value}
          onChange={(e) => {
            const next: [string, string] = [xId, yId];
            next[which] = (e.currentTarget as HTMLSelectElement).value;
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
        {model.usable ? <Plot {...model} id={id} rowWord={capitalise(aliasesOf(analysis).alternative)} /> : <p role="note">{model.reason}</p>}
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

function Plot({ axes, points, caption, overallBasis, notes, id, rowWord }: Extract<ReturnType<typeof scatterModel>, { usable: true }> & { id: string; rowWord: string }) {
  const [ax, ay] = axes;
  const { width, height, margin } = PLOT;
  const placed = points.filter((p): p is ScatterPoint & { x: number; y: number } => p.x !== undefined && p.y !== undefined);
  const unplaced = points.filter((p) => p.x === undefined || p.y === undefined);
  const at = (p: { x: number; y: number }) => ({ x: margin + along(ax, p.x, width - 2 * margin), y: height - margin - along(ay, p.y, height - 2 * margin) });
  const front = placed.filter((p) => p.here === 'non-dominated').map((p) => p.label);
  const valueOf = (v: number | undefined) => (v === undefined ? 'no value' : String(v));
  return (
    <figure aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`}>
        <strong>{capitalise(caption)}</strong>
        {`: ${front.length > 0 ? front.join(', ') : 'none placed'}. This is not the frontier across every criterion; the outer mark says where each one stands there.`}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`${ax.label} across, ${ay.label} up, better toward the top right. The table below says the same in words.`}
      >
        {ticksOf(ax).map((t) => {
          const x = margin + along(ax, t, width - 2 * margin);
          return <text key={`x${t}`} x={x} y={height - margin + 16} text-anchor="middle" font-size="11" fill="currentColor">{String(t)}</text>;
        })}
        {ticksOf(ay).map((t) => {
          const y = height - margin - along(ay, t, height - 2 * margin);
          return <text key={`y${t}`} x={margin - 8} y={y + 4} text-anchor="end" font-size="11" fill="currentColor">{String(t)}</text>;
        })}
        <text x={width / 2} y={height - 6} text-anchor="middle" font-size="12" fill="currentColor">{`${ax.label} (better to the right)`}</text>
        <text x={12} y={height / 2} text-anchor="middle" font-size="12" fill="currentColor" transform={`rotate(-90 12 ${height / 2})`}>{`${ay.label} (better up)`}</text>
        {placed.map((p) => {
          const { x, y } = at(p);
          return (
            <g key={p.alternativeId} data-point={p.alternativeId} data-here={p.here} data-overall={p.overall}>
              <OverallMark tier={p.overall} x={x} y={y} />
              <HereMark tier={p.here} x={x} y={y} />
              <text x={x + PLOT.mark * 2 + 3} y={y + 4} font-size="11" fill="currentColor">{p.label}</text>
            </g>
          );
        })}
      </svg>
      <ul class="comparanda-panel-hint" aria-label="What the marks mean">
        <li>Here, on these two criteria: a filled dot is non-dominated, a ring is possibly dominated (it depends on blanks), a cross is dominated.</li>
        <li>{`Across every criterion: no square is non-dominated, a dashed square is possibly dominated, a square is dominated. ${capitalise(overallBasis)}.`}</li>
      </ul>
      <table class="comparanda-analysis-table">
        <caption>{`${ax.label} and ${ay.label}, one row each`}</caption>
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
              <td>{valueOf(p.x)}</td>
              <td>{valueOf(p.y)}</td>
              <td>{`${TIER_SAID[p.here]}${p.dominatedBy.length > 0 ? ` by ${p.dominatedBy.map((d) => points.find((q) => q.alternativeId === d)?.label ?? d).join(', ')}` : ''}`}</td>
              <td>{TIER_SAID[p.overall]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unplaced.length > 0 && (
        <p class="comparanda-panel-hint">{`Not on the plot, for want of a value on one of the two: ${unplaced.map((p) => p.label).join(', ')}. Their tiers are in the table.`}</p>
      )}
      {notes.map((n) => <p key={n} class="comparanda-panel-hint">{capitalise(n)}</p>)}
    </figure>
  );
}
