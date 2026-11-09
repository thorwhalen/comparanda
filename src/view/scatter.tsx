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
 * The reader picks what is compared, and the panel says what it picked: a
 * group of alternatives as the scope (ADR-0019's natural scope; only groups
 * with an alternative the matrix shows are offered), and the practical
 * tolerance (a checkbox; unavailable, and saying why, when no criterion
 * declares an indifference threshold). The basis sentence under the caption
 * names both. Every choice is the panel's own, for this session.
 *
 * An `AnalysisPanel` the composition root registers
 * (`mountMatrix(el, props, { panels: [ScatterPanel] })`), like `AgreementPanel`:
 * the matrix never imports it, so the standalone page does not pay for it.
 * Closed by default and computed only once opened. Its styling is SVG
 * presentation attributes in `currentColor`, so it adds nothing to the
 * matrix's stylesheet.
 */
import { useId, useMemo, useState } from 'preact/hooks';

import { scatterCriteria, scatterModel, type DominanceTier, type ScatterAxis, type ScatterModel, type ScatterPoint, type UsableScatterModel } from '../core/analyses/scatter.js';
import { scopeGroups, type ScopeGroup } from '../core/analyses/scope.js';
import type { Analysis } from '../core/schema/analysis.js';
import { aliasesOf, type Aliases } from '../core/schema/structure.js';
import { capitalise } from './words.js';
import type { AnalysisPanelProps } from './agreement.js';
import { hiddenOf, inShownOrder, type Shown } from '../core/layout.js';
import { HiddenNote } from './shown.js';

/** The plot's drawing box, in SVG user units, the margin its tick labels sit in, and a mark's radius. */
const PLOT = Object.freeze({ width: 360, height: 280, margin: 44, mark: 5 });

const TIER_SAID: Readonly<Record<DominanceTier, string>> = {
  'non-dominated': 'non-dominated',
  'possibly-dominated': 'possibly dominated',
  dominated: 'dominated',
};

/** Where a value sits along an axis of `length`, with better always toward the far end. The schema keeps min below max. */
function along(axis: ScatterAxis, value: number, length: number): number {
  const { min, max } = axis.range;
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
  const { min, max } = axis.range;
  return Number.isInteger(min) && Number.isInteger(max) && max - min <= 10
    ? Array.from({ length: max - min + 1 }, (_, i) => min + i)
    : [min, max];
}

export function ScatterPanel({ analysis, measure, shown }: AnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <details class="comparanda-analysis" data-analysis="scatter" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Two criteria against each other, with what is dominated on them</summary>
      {open && <ScatterBody analysis={analysis} measure={measure} shown={shown} />}
    </details>
  );
}

/** The open panel: computed once per document, measure and pair, not on every render of the matrix around it. */
function ScatterBody({ analysis, measure, shown }: Pick<AnalysisPanelProps, 'analysis' | 'measure' | 'shown'>) {
  const id = useId();
  const [chosen, setChosen] = useState<[string, string] | undefined>(undefined);
  const comparable = useMemo(() => scatterCriteria(analysis, measure), [analysis, measure]);
  // The axes offered are the criteria the matrix shows, in its order (#292); dominance across every criterion still counts the hidden ones.
  // Keyed on the order's contents: the matrix hands a new array on every render, and the model must not be recomputed for it.
  const order = shown?.criteria.join('\u0000');
  const usable = useMemo(() => inShownOrder(comparable, (c) => c, shown?.criteria).listed, [comparable, order]);
  // A choice the document no longer allows keeps what it still can: each axis falls back to the first criterion the other does not hold.
  const [xId, yId] = useMemo((): [string, string] => {
    const [x, y] = chosen ?? [];
    const keepX = x !== undefined && usable.includes(x) ? x : undefined;
    const keepY = y !== undefined && usable.includes(y) && y !== keepX ? y : undefined;
    const nx = keepX ?? usable.find((c) => c !== keepY) ?? '';
    return [nx, keepY ?? usable.find((c) => c !== nx) ?? ''];
  }, [chosen, usable]);
  // The scope offered: the groups with an alternative the matrix shows (#324). A choice the arrangement no longer offers falls back to every alternative, and says so.
  const altOrder = shown?.alternatives.join('\u0000');
  const groups = useMemo(() => scopeGroups(analysis, { shownAlternatives: shown?.alternatives }), [analysis, altOrder]);
  const [groupChosen, setGroupChosen] = useState<string | undefined>(undefined);
  const groupId = groups.some((g) => g.id === groupChosen) ? groupChosen : undefined;
  const [tolerant, setTolerant] = useState(false);
  const model = useMemo(
    () => (usable.length < 2 ? undefined : scatterModel(analysis, { measure, criteria: [xId, yId], groupId, usePracticalTolerance: tolerant })),
    [analysis, measure, xId, yId, usable.length, groupId, tolerant],
  );
  if (!model) {
    const short = `A two-criterion scatter needs two criteria that admit a dominance comparison; this analysis has ${comparable.length}`;
    return <p role="note">{comparable.length >= 2 ? `${short}, and the matrix shows ${usable.length} of them: show another to compare.` : `${short}.`}</p>;
  }
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
          setChosen(which === 0 ? [picked, picked === other ? xId : other] : [picked === other ? yId : other, picked]);
        }}
      >
        {usable.map((cid) => <option key={cid} value={cid}>{label(cid)}</option>)}
      </select>{' '}
    </>
  );
  return (
    <>
      <fieldset>
        <legend>The two criteria</legend>
        {picker(0, xId)}
        {picker(1, yId)}
      </fieldset>
      <fieldset>
        <legend>What is compared</legend>
        <ScopePicker
          id={`${id}-scope`} analysis={analysis} groups={groups} value={groupId} dropped={groupChosen === groupId ? undefined : groupChosen}
          onPick={setGroupChosen}
        />
        <TolerancePicker id={`${id}-tolerance`} model={model} on={tolerant} onToggle={setTolerant} words={aliasesOf(analysis)} />
      </fieldset>
      {/* In a group's scope, what is not listed for being out of it is not "hidden": only its own hidden members are counted. */}
      <HiddenNote {...hiddenOf({ alternatives: inScopeOf(analysis, model), criteria: analysis.criteria }, shown)} words={aliasesOf(analysis)} />
      {model.usable ? <Plot model={model} id={id} rowWord={capitalise(aliasesOf(analysis).alternative)} shown={shown} /> : <p role="note">{model.reason}</p>}
    </>
  );
}

/** The alternatives the model compared: its points, when it has any; else every one. */
function inScopeOf(analysis: Analysis, model: ScatterModel): Analysis['alternatives'] {
  if (!model.usable) return analysis.alternatives;
  const ids = new Set(model.points.map((p) => p.alternativeId));
  return analysis.alternatives.filter((x) => ids.has(x.id));
}

/**
 * The scope: every alternative, or one group's. A native select, labelled, with
 * the members each option holds; where no group can be offered, a sentence says
 * why in its place, and a choice the arrangement withdrew is named.
 */
function ScopePicker({ id, analysis, groups, value, dropped, onPick }: {
  id: string; analysis: Analysis; groups: readonly ScopeGroup[]; value: string | undefined; dropped: string | undefined;
  onPick: (groupId: string | undefined) => void;
}) {
  const words = aliasesOf(analysis);
  const droppedLabel = dropped === undefined ? undefined : analysis.groups.find((g) => g.id === dropped)?.label ?? dropped;
  const withdrawn = droppedLabel !== undefined && (
    <p class="comparanda-panel-hint" data-scope-dropped="">
      {`The group "${droppedLabel}" is no longer offered: the matrix shows none of its ${words.alternatives}, so every ${words.alternative} is compared.`}
    </p>
  );
  if (groups.length === 0) {
    const declared = analysis.groups.some((g) => g.axis === 'alternatives' && !g.tombstoned);
    return (
      <>
        <p class="comparanda-panel-hint" data-scope-unavailable="">
          {`Every ${words.alternative} is compared: ${declared ? `none of the groups of ${words.alternatives} has one the matrix shows` : `this analysis declares no groups of ${words.alternatives}`}, so there is no group to compare within.`}
        </p>
        {withdrawn}
      </>
    );
  }
  const every = analysis.alternatives.filter((x) => !x.tombstoned).length;
  return (
    <>
      <label for={id}>Compare</label>{' '}
      <select
        id={id} value={value ?? ''} aria-describedby={`${id}-hint`}
        onChange={(e) => { const picked = (e.currentTarget as HTMLSelectElement).value; onPick(picked === '' ? undefined : picked); }}
      >
        <option value="">{`Every ${words.alternative} (${every})`}</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{`${g.label}${g.parentLabel === undefined ? '' : `, in ${g.parentLabel}`} (${g.members.length})`}</option>)}
      </select>
      <p class="comparanda-panel-hint" id={`${id}-hint`}>
        {`Within one group of ${words.alternatives}, a criterion declared not to apply to it applies to none of them alike.`}
      </p>
      {withdrawn}
    </>
  );
}

/** Why the practical tolerance would change nothing, or what it changes; `unavailable` when no criterion declares a threshold. */
function toleranceSaid(model: ScatterModel, words: Aliases): { said: string; unavailable: boolean } {
  const general = `Counts a difference at or below a ${words.criterion}'s declared indifference threshold as none; it is not transitive, so any cycle it makes is reported.`;
  if (!model.usable) return { said: general, unavailable: false };
  const { overall } = model.tolerance;
  if (overall.declared === 0) {
    return {
      said: `Unavailable: none of the ${overall.of} ${overall.of === 1 ? words.criterion : words.criteria} compared declares an indifference threshold, so the practical tolerance would change nothing.`,
      unavailable: true,
    };
  }
  const [ax, ay] = model.axes;
  if (ax.indifference === undefined && ay.indifference === undefined) {
    return {
      said: `Neither ${ax.label} nor ${ay.label} declares an indifference threshold, so here the tolerance changes only the tier across every ${words.criterion} (${overall.declared} of ${overall.of} ${overall.declared === 1 ? 'declares' : 'declare'} one).`,
      unavailable: false,
    };
  }
  return { said: general, unavailable: false };
}

/**
 * The practical tolerance, a labelled checkbox. Where it would change nothing it
 * stays focusable, marked unavailable and saying why, rather than a silent no-op;
 * it can still be turned off, should a document change leave it on.
 */
function TolerancePicker({ id, model, on, onToggle, words }: {
  id: string; model: ScatterModel; on: boolean; onToggle: (on: boolean) => void; words: Aliases;
}) {
  const { said, unavailable } = toleranceSaid(model, words);
  const refused = unavailable && !on;
  return (
    <p>
      <label>
        <input
          type="checkbox" id={id} checked={on} aria-describedby={`${id}-hint`} aria-disabled={refused ? 'true' : undefined}
          // A refused toggle is undone before it lands, by keyboard or pointer alike.
          onClick={refused ? (e) => e.preventDefault() : undefined}
          onChange={(e) => { if (!refused) onToggle((e.currentTarget as HTMLInputElement).checked); }}
        />
        {' Use the practical tolerance'}
      </label>{' '}
      <span class="comparanda-panel-hint" id={`${id}-hint`} data-tolerance-hint="">{said}</span>
    </p>
  );
}

function Plot({ model, id, rowWord, shown }: { model: UsableScatterModel; id: string; rowWord: string; shown: Shown | undefined }) {
  const { axes: [ax, ay], caption, overallBasis, notes, overallNotes, measure } = model;
  // Drawn and listed: the alternatives the matrix shows, in its order. A hidden one may still dominate one drawn, and is named as doing so.
  const points = inShownOrder(model.points, (p) => p.alternativeId, shown?.alternatives).listed;
  const { width, height, margin, mark } = PLOT;
  const placed = points.filter((p): p is ScatterPoint & { x: number; y: number } => p.x !== undefined && p.y !== undefined);
  const unplaced = points.filter((p) => p.x === undefined || p.y === undefined);
  // Points at the same place are drawn side by side under one label: one would otherwise hide the other.
  const spots = new Map<string, (ScatterPoint & { x: number; y: number })[]>();
  for (const p of placed) spots.set(`${p.x}\u0000${p.y}`, [...(spots.get(`${p.x}\u0000${p.y}`) ?? []), p]);
  const front = points.filter((p) => p.here === 'non-dominated').map((p) => (p.x === undefined || p.y === undefined ? `${p.label} (not placed)` : p.label));
  // The front is the document's: a member the reader hid is counted, never dropped, or "none" could be said of a front that has one.
  const hiddenFront = model.points.filter((p) => p.here === 'non-dominated').length - points.filter((p) => p.here === 'non-dominated').length;
  if (hiddenFront > 0) front.push(`${hiddenFront} hidden in the matrix`);
  return (
    <figure aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`}>
        <strong>{capitalise(caption)}</strong>
        {`: ${front.length > 0 ? front.join(', ') : 'none'}. This is not the frontier across every criterion; the outer mark says where each one stands there. Measure: ${measure}.`}
      </figcaption>
      {/* The scope and tolerance both comparisons used, under the caption, so a reading of the front carries them (ADR-0019). */}
      <p class="comparanda-panel-hint" data-basis="">{capitalise(model.basis)}</p>
      <svg
        viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" style={{ maxWidth: '100%', height: 'auto' }}
        // The ink the marks are drawn in, declared on the drawing: left to the default it is black, whatever the theme (#292).
        fill="currentColor"
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
              {/* Past the middle, the label goes on the left of its marks, so the plot's edge never clips it. */}
              {cx > width / 2
                ? <text x={cx - ((here.length - 1) / 2) * step - mark * 2 - 3} y={cy + 4} text-anchor="end" font-size="11" fill="currentColor">{here.map((p) => p.label).join(', ')}</text>
                : <text x={cx + ((here.length - 1) / 2) * step + mark * 2 + 3} y={cy + 4} font-size="11" fill="currentColor">{here.map((p) => p.label).join(', ')}</text>}
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
              <td>{p.xWords}</td>
              <td>{p.yWords}</td>
              <td>{`${TIER_SAID[p.here]}${p.dominatedBy.length > 0 ? ` by ${p.dominatedBy.map((d) => model.points.find((q) => q.alternativeId === d)?.label ?? d).join(', ')}` : ''}`}</td>
              <td>{TIER_SAID[p.overall]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unplaced.length > 0 && (
        <p class="comparanda-panel-hint">
          {`Not on the plot: ${unplaced.map((p) => `${p.label} (${[p.x === undefined && `${ax.label}: ${p.xWords}`, p.y === undefined && `${ay.label}: ${p.yWords}`].filter(Boolean).join('; ')})`).join(', ')}. Their tiers are in the table.`}
        </p>
      )}
      {/* A note both comparisons make is said once. */}
      {notes.filter((n) => !overallNotes.includes(n)).map((n) => <p key={`h${n}`} class="comparanda-panel-hint">{`On these two criteria: ${n}`}</p>)}
      {overallNotes.map((n) => <p key={`o${n}`} class="comparanda-panel-hint">{`${notes.includes(n) ? 'On both' : 'Across every criterion'}: ${n}`}</p>)}
    </figure>
  );
}
