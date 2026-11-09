/**
 * The rank-flow panel (#98, ADR-0026, ADR-0015): a slope chart of rank
 * positions under two rankings, joined line by line. It answers one question the
 * matrix cannot: **is the order stable?** -- under a change of weighting, and,
 * as the same component, between two raters on one criterion.
 *
 * **Unreachable unless weighted aggregation is opted into.** There is no
 * `RankFlowPanel` to register: `rankFlowPanel({ weightedSum, sensitivity })`
 * makes one, from core's two opt-in analyses, which the composition root passes
 * the way it passes `arrange` (ADR-0017 clause 4). This module imports neither
 * as a value, so it cannot rank anything it was not handed; called without
 * them it throws, saying why. A document none of whose criteria carries a
 * substitution weight has opted into nothing either, and the panel is absent.
 * Never in the standalone page, which registers no panels: it costs that page's
 * byte budget nothing.
 *
 * What it draws, and refuses to:
 *
 * - **Ranks, never values** (ADR-0026): a line's slope is a change of position,
 *   and no score is drawn anywhere, because angle reads as magnitude.
 * - **A stability caption, never a winner.** The caption is the sensitivity
 *   analysis's own sentence and the rank-flow's count of what moved, both
 *   carried by core results so this view cannot recaption them as an
 *   endorsement; the weighted sum's warnings (the ordinal one first among them)
 *   are shown under it, as they are not suppressible.
 * - **Ranks only the current selection** -- the alternatives the matrix shows --
 *   and refuses above `maxRows` (30), with the reason, before computing anything.
 * - **Never colour alone** (comparanda-dev-a11y-gate): a line that changes place
 *   against the others ranked in both is dashed and one that keeps it solid; every line is named at both ends; a
 *   rank the data cannot settle is a ring, a settled one a dot; a row the
 *   coverage gate did not score is a cross below a dashed rule, never a rank.
 *   All of it in `currentColor`, and all of it in the table beneath, in words.
 * - **A keyboard path for everything**: every control is a native radio,
 *   select or number field. Nothing in the drawing is interactive.
 *
 * Closed by default and computed only once opened, like every analysis panel.
 */
import type { ComponentType } from 'preact';
import { useId, useMemo, useState } from 'preact/hooks';

import {
  firstOrderChange, rankFlow, raterCriteria, raterRanking, RANK_FLOW_MAX_ROWS, tooManyToRank, withSubstitutionWeight,
  type RankColumn, type RankFlow, type RankMove, type RankPlace, type RankScenario, type RowWords, type WeightChange,
} from '../core/analyses/rank-flow.js';
import type { sensitivity } from '../core/analyses/sensitivity.js';
import type { weightedSum } from '../core/analyses/weighted-sum.js';
import type { Analysis } from '../core/schema/analysis.js';
import { aliasesOf } from '../core/schema/structure.js';
import { attributions } from '../core/identity.js';
import { hiddenOf, inShownOrder } from '../core/layout.js';
import type { AnalysisPanelProps } from './agreement.js';
import { HiddenNote } from './shown.js';
import { capitalise } from './words.js';

/**
 * The opt-in: core's weighted sum and its sensitivity analysis, handed over by
 * the composition root. A rank-flow presupposes a ranking, and a ranking
 * presupposes an aggregation, which ADR-0015 refuses to do by default.
 */
export interface WeightingOptIn {
  weightedSum: typeof weightedSum;
  sensitivity: typeof sensitivity;
}

export interface RankFlowPanelOptions {
  /** The most alternatives it ranks; above it, it refuses and says why. Default `RANK_FLOW_MAX_ROWS` (30, ADR-0026). */
  maxRows?: number;
}

/** The drawing's geometry, in SVG user units: row pitch, heading room, column gap, mark radius, the label's estimated glyph width, and padding. */
const PLOT = Object.freeze({ step: 22, top: 44, gap: 200, mark: 4, glyph: 6.6, pad: 12, font: 11 });

/** The dash a line that changes place is drawn with: its shape, not a hue, says it moved. */
const MOVED_DASH = '6 4';

/**
 * Make the rank-flow panel, given the weighted aggregation the composition root
 * opted into: `mountMatrix(el, props, { panels: [rankFlowPanel({ weightedSum, sensitivity })] })`.
 */
export function rankFlowPanel(optIn: WeightingOptIn, { maxRows = RANK_FLOW_MAX_ROWS }: RankFlowPanelOptions = {}): ComponentType<AnalysisPanelProps> {
  if (typeof optIn?.weightedSum !== 'function' || typeof optIn?.sensitivity !== 'function') {
    throw new TypeError(
      'a rank-flow presupposes a ranking, and a ranking presupposes a weighted aggregation, which is opt-in (ADR-0015, ADR-0026): '
      + 'make the panel with core\'s two opt-in analyses, rankFlowPanel({ weightedSum, sensitivity }).',
    );
  }
  return function RankFlowPanel({ analysis, measure, shown, viewer, vouched }: AnalysisPanelProps) {
    const [open, setOpen] = useState(false);
    // The document's own opt-in: a weight to aggregate by (ADR-0020). Without one there is no ranking to draw.
    if (!analysis.criteria.some((c) => !c.tombstoned && c.weights?.substitution !== undefined)) return null;
    const words = aliasesOf(analysis);
    return (
      <details class="comparanda-analysis" data-analysis="rank-flow" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>{`Whether the order of the ${words.alternatives} holds under a change of weighting, or between two raters`}</summary>
        {open && <RankFlowBody {...{ analysis, measure, shown, viewer, vouched, optIn, maxRows }} />}
      </details>
    );
  };
}

type BodyProps = AnalysisPanelProps & { optIn: WeightingOptIn; maxRows: number };

function RankFlowBody({ analysis, measure, shown, viewer, vouched, optIn, maxRows }: BodyProps) {
  const id = useId();
  const [mode, setMode] = useState<'weighting' | 'raters'>('weighting');
  const words = aliasesOf(analysis);
  const rowWords: RowWords = { alternative: words.alternative, alternatives: words.alternatives };
  const order = shown?.alternatives.join('\u0000');
  // The current selection: the alternatives the matrix shows, in its order.
  const selection = useMemo(
    () => inShownOrder(analysis.alternatives.filter((x) => !x.tombstoned), (x) => x.id, shown?.alternatives).listed.map((x) => x.id),
    [analysis, order],
  );
  const tooMany = tooManyToRank(selection.length, { maxRows, words: rowWords });
  const radio = (value: typeof mode, text: string) => (
    <label>
      <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
      {` ${text}`}
    </label>
  );
  return (
    <>
      <HiddenNote {...hiddenOf(analysis, shown)} words={words} counted={false} />
      <p class="comparanda-panel-hint">
        {`Ranked among the ${selection.length} ${words.alternatives} the matrix shows: hiding one changes the ranks below it, never a score. Every weighted ${words.criterion} is in the sum, shown or not.`}
      </p>
      {tooMany ? <p role="note" data-refused="">{tooMany}</p> : (
        <>
          <fieldset>
            <legend>Compare two rankings</legend>
            {radio('weighting', 'as declared, and under a change of one weight')}{' '}
            {radio('raters', 'of two raters, on one criterion')}
          </fieldset>
          {mode === 'weighting'
            ? <WeightingFlow {...{ analysis, measure, selection, optIn, maxRows, rowWords, id }} />
            : <RaterFlow {...{ analysis, measure, viewer, vouched, shown, selection, maxRows, rowWords, id }} />}
        </>
      )}
    </>
  );
}

/** A weight as a person reads it: at most six decimals, which keeps "just past" visibly past. */
const weightSaid = (w: number) => String(Math.round(w * 1e6) / 1e6);

function WeightingFlow({ analysis, measure, selection, optIn, maxRows, rowWords, id }: {
  analysis: Analysis; measure: string; selection: string[]; optIn: WeightingOptIn; maxRows: number; rowWords: RowWords; id: string;
}) {
  const key = selection.join('\u0000');
  const sens = useMemo(() => optIn.sensitivity(analysis, { measure, alternativeIds: selection }), [analysis, measure, key]);
  const base = useMemo(() => optIn.weightedSum(analysis, { measure, alternativeIds: selection }), [analysis, measure, key]);
  const [chosen, setChosen] = useState<WeightChange | undefined>(undefined);
  const inSum = (cid: string | undefined) => base.basis.some((b) => b.criterionId === cid);
  const change = chosen && inSum(chosen.criterionId) ? chosen : firstOrderChange(sens);
  const changed = useMemo(
    () => (change ? optIn.weightedSum(withSubstitutionWeight(analysis, change.criterionId, change.weight), { measure, alternativeIds: selection }) : undefined),
    [analysis, measure, key, change?.criterionId, change?.weight],
  );
  if (sens.refused || !change || !changed) {
    return <p role="note" data-refused="">{`No ranking: the weighted sum refused. ${sens.refused?.message ?? ''}`}</p>;
  }
  const label = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
  const declared = base.basis.find((b) => b.criterionId === change.criterionId)!.weight;
  const first = firstOrderChange(sens, { criterionId: change.criterionId });
  const fragile = `a raise of ${Math.round(sens.weightPerturbation.fragileBelow * 100)}% of the total weight (${weightSaid(first!.weight)})`;
  const opening = first!.opening === 'first-change'
    ? `Opens just past the smallest change of this weight that alters the order (${weightSaid(first!.weight)}).`
    : `No change of this weight alone alters the order, short of leaving nothing to rank; opens at ${fragile}, the share ADR-0015 calls fragile.`;
  const extra = (changed.refused ? [] : changed.warnings).filter((w) => !sens.warnings.includes(w));
  const model = changed.refused ? undefined : rankFlow([
    { id: 'declared', label: 'As declared', rows: base.rows },
    { id: 'changed', label: `${label(change.criterionId)} at ${weightSaid(change.weight)}, declared ${weightSaid(declared)}`, rows: changed.rows },
  ], { alternativeIds: selection, maxRows, words: rowWords });
  return (
    <>
      <fieldset>
        <legend>The change of weighting</legend>
        <label for={`${id}-criterion`}>Weight of</label>{' '}
        <select
          id={`${id}-criterion`} value={change.criterionId}
          onChange={(e) => { const cid = (e.currentTarget as HTMLSelectElement).value; setChosen(firstOrderChange(sens, { criterionId: cid })); }}
        >
          {base.basis.map((b) => <option key={b.criterionId} value={b.criterionId}>{`${label(b.criterionId)} (declared ${weightSaid(b.weight)})`}</option>)}
        </select>{' '}
        <label for={`${id}-weight`}>set to</label>{' '}
        <input
          id={`${id}-weight`} type="number" min="0" step="any" value={weightSaid(change.weight)} aria-describedby={`${id}-opening`}
          // Committed on change (Enter or leaving the field), never per keystroke, so the draft is the reader's while typing.
          // A draft that is no number gives way to the weight in force; a negative one is the weighted sum's to refuse, in words.
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const w = input.value.trim() === '' ? Number.NaN : Number(input.value);
            if (Number.isFinite(w)) setChosen({ criterionId: change.criterionId, weight: w });
            else input.value = weightSaid(change.weight);
          }}
        />
        <p class="comparanda-panel-hint" id={`${id}-opening`}>{opening}</p>
      </fieldset>
      {model
        ? <RankFlowFigure model={model} id={id} names={(aid) => analysis.alternatives.find((x) => x.id === aid)?.label ?? aid} rowWords={rowWords} lead={sens.caption} rankOne="Rank 1 is the highest weighted sum." />
        : <p role="note" data-refused="">{`The changed weighting is refused: ${changed.refused!.message}`}</p>}
      <p class="comparanda-panel-hint" data-finding="">{`As declared: ${sens.finding}`}</p>
      {[...sens.warnings, ...extra].map((w) => <p key={w} class="comparanda-panel-hint" role="note" data-warning="">{w}</p>)}
      <ul class="comparanda-panel-hint" aria-label="What this ranking assumes">
        {sens.assumptions.map((a) => <li key={a}>{a}</li>)}
      </ul>
    </>
  );
}

function RaterFlow({ analysis, measure, viewer, vouched, shown, selection, maxRows, rowWords, id }: Pick<AnalysisPanelProps, 'viewer' | 'vouched' | 'shown'> & {
  analysis: Analysis; measure: string; selection: string[]; maxRows: number; rowWords: RowWords; id: string;
}) {
  const critOrder = shown?.criteria.join('\u0000');
  const choices = useMemo(
    () => inShownOrder(raterCriteria(analysis, { measure, viewer }), (c) => c.criterionId, shown?.criteria).listed,
    [analysis, measure, viewer, critOrder],
  );
  const [critChosen, setCritChosen] = useState<string | undefined>(undefined);
  const [pair, setPair] = useState<[string | undefined, string | undefined]>([undefined, undefined]);
  const names = attributions(analysis.authors, { vouched });
  const rc = choices.find((c) => c.criterionId === critChosen) ?? choices[0];
  if (!rc) {
    return <p role="note" data-refused="">No criterion has two raters whose ratings you may see against their names, so there is no rater comparison here.</p>;
  }
  const label = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
  // A choice the criterion no longer allows keeps what it can: each side falls back to the first rater the other does not hold.
  const left = pair[0] !== undefined && rc.raters.includes(pair[0]) ? pair[0] : rc.raters[0]!;
  const right = pair[1] !== undefined && rc.raters.includes(pair[1]) && pair[1] !== left ? pair[1] : rc.raters.find((r) => r !== left)!;
  const nameOf = (aid: string) => names.get(aid) ?? aid;
  const scenarios = [left, right].map((r) => raterRanking(analysis, rc.criterionId, r, { measure, viewer }));
  const refused = scenarios.find((s): s is string => typeof s === 'string');
  const model = refused ? undefined : rankFlow((scenarios as RankScenario[]).map((s, i) => ({ ...s, label: nameOf([left, right][i]!) })), {
    alternativeIds: selection, maxRows, words: rowWords,
  });
  const picker = (side: 0 | 1, value: string) => (
    <>
      <label for={`${id}-rater-${side}`}>{side === 0 ? 'Left' : 'Right'}</label>{' '}
      <select
        id={`${id}-rater-${side}`} value={value}
        onChange={(e) => {
          const picked = (e.currentTarget as HTMLSelectElement).value;
          const other = side === 0 ? right : left;
          // Picking the other side's rater swaps the two, rather than comparing a rater with themself.
          setPair(side === 0 ? [picked, picked === other ? left : other] : [picked === other ? right : other, picked]);
        }}
      >
        {rc.raters.map((r) => <option key={r} value={r}>{nameOf(r)}</option>)}
      </select>{' '}
    </>
  );
  return (
    <>
      <fieldset>
        <legend>The two raters</legend>
        <label for={`${id}-rater-criterion`}>On</label>{' '}
        <select id={`${id}-rater-criterion`} value={rc.criterionId} onChange={(e) => setCritChosen((e.currentTarget as HTMLSelectElement).value)}>
          {choices.map((c) => <option key={c.criterionId} value={c.criterionId}>{label(c.criterionId)}</option>)}
        </select>{' '}
        {picker(0, left)}
        {picker(1, right)}
        {rc.notOffered > 0 && (
          <p class="comparanda-panel-hint" data-not-offered="">
            {`${rc.notOffered} ${rc.notOffered === 1 ? 'rater is' : 'raters are'} not offered: a rating of theirs here is not shown to you against their name.`}
          </p>
        )}
      </fieldset>
      {model
        ? <RankFlowFigure model={model} id={id} names={(aid) => analysis.alternatives.find((x) => x.id === aid)?.label ?? aid} rowWords={rowWords} rankOne={`Rank 1 is each rater's best rating on ${label(rc.criterionId)}, by its direction of preference.`} />
        : <p role="note" data-refused="">{`Not ranked: ${refused}`}</p>}
    </>
  );
}

type Ranked = Extract<RankPlace, { status: 'ranked' }>;

/** A rank, or the ranks an unsettled score could take. */
const ranksSaid = (p: Ranked) => (p.lowest === p.rank ? String(p.rank) : `${p.rank} to ${p.lowest}`);

/** A place in words: a rank, a tie kept as one, rows the data cannot separate, or the ranks an unsettled score could take. */
function placeSaid(p: RankPlace, names: (id: string) => string): string {
  if (p.status === 'unscored') return `not ranked: ${p.label}`;
  const shared = p.sharedWith.map(names).join(', ');
  if (p.lowest === p.rank) return String(p.rank);
  if (p.exact) return `${p.rank}, tied with ${shared}`;
  if (p.lowest - p.rank === p.sharedWith.length) return `${p.rank}, not separable from ${shared} on the data`;
  return `${ranksSaid(p)}, not settled by the data${shared ? `; shares ${p.rank} with ${shared}` : ''}`;
}

/** What happened to a row between two rankings, in words: its place against the others ranked in both, then its ranks in each. */
function moveSaid(move: RankMove, from: RankColumn, to: RankColumn, a: RankPlace, b: RankPlace): string {
  const at = (p: RankPlace) => (p.status === 'ranked' ? ranksSaid(p) : '');
  const ranks = `${at(a)}, then ${at(b)}`;
  switch (move) {
    case 'held': return at(a) === at(b) ? `keeps ${at(a)}` : `keeps its place (${ranks})`;
    case 'rose': return `rises (${ranks})`;
    case 'fell': return `falls (${ranks})`;
    case 'entered': return `ranked only under "${to.label}"`;
    case 'left': return `ranked only under "${from.label}"`;
    default: return 'ranked under neither';
  }
}

/** The drawing and its table, from any rank-flow model: the same component for weightings and for raters. A refused model says why. */
function RankFlowFigure({ model, id, names, rowWords, lead, rankOne }: {
  model: RankFlow; id: string; names: (id: string) => string; rowWords: RowWords; lead?: string; rankOne: string;
}) {
  if (!model.usable) return <p role="note" data-refused="">{model.reason}</p>;
  const { columns, steps, alternatives } = model;
  const rankedIn = (c: RankColumn) => c.places.filter((p): p is Ranked => p.status === 'ranked');
  /** One end label per distinct rank in a column: the rows at it, and the rank in words. */
  const endLabels = (c: RankColumn) => {
    const byRank = new Map<number, Ranked[]>();
    for (const p of rankedIn(c)) byRank.set(p.rank, [...(byRank.get(p.rank) ?? []), p]);
    return [...byRank].map(([rank, ps]) => {
      const lowest = Math.max(...ps.map((p) => p.lowest));
      return { rank, exact: ps.every((p) => p.exact), text: `${ps.map((p) => names(p.alternativeId)).join(', ')} (${lowest === rank || ps.every((p) => p.exact) ? rank : `${rank} to ${lowest}`})` };
    });
  };
  const unrankedIn = (c: RankColumn) => c.places.filter((p) => p.status === 'unscored').map((p) => `${names(p.alternativeId)} (not ranked)`);
  const ends = [columns[0]!, columns[columns.length - 1]!];
  const longest = Math.max(
    ...ends.flatMap((c) => [...endLabels(c).map((l) => l.text), ...unrankedIn(c), c.label]).map((t) => t.length),
  );
  const { step, top, gap, mark, glyph, pad, font } = PLOT;
  const side = pad + mark * 2 + longest * glyph;
  const xOf = (i: number) => side + i * gap;
  const width = side * 2 + (columns.length - 1) * gap;
  const maxRank = Math.max(1, ...columns.flatMap((c) => rankedIn(c).map((p) => p.rank)));
  const yOf = (rank: number) => top + (rank - 1) * step;
  const lane = Math.max(0, ...columns.map((c) => unrankedIn(c).length));
  const rule = yOf(maxRank) + step;
  const height = lane > 0 ? rule + lane * step + pad : yOf(maxRank) + pad * 2;
  const anchorOf = (i: number) => (i === 0 ? 'end' : i === columns.length - 1 ? 'start' : 'middle');
  const labelX = (i: number) => (i === 0 ? xOf(i) - mark * 2 - 2 : xOf(i) + mark * 2 + 2);
  const said = (aid: string, c: RankColumn) => placeSaid(c.places[model.alternatives.indexOf(aid)]!, names);
  return (
    <figure aria-labelledby={`${id}-flow-caption`} data-rank-flow="">
      <figcaption id={`${id}-flow-caption`}>
        {lead && <strong>{lead}</strong>}
        {`${lead ? ' ' : ''}${model.caption}`}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" style={{ maxWidth: '100%', height: 'auto' }}
        // The ink every mark and label is drawn in, declared on the drawing so no shape falls back to black in a dark theme.
        fill="currentColor"
        aria-label={`Ranks under "${columns[0]!.label}" on the left and "${columns[columns.length - 1]!.label}" on the right, rank 1 at the top. The table below says the same in words.`}
      >
        {columns.map((c, i) => (
          <text key={`h${c.id}`} x={i === 0 ? xOf(i) + mark : i === columns.length - 1 ? xOf(i) - mark : xOf(i)} y={top - 22} text-anchor={anchorOf(i)} font-size={font + 1} fill="currentColor">{c.label}</text>
        ))}
        {steps.map((s, i) => s.moves.map(({ alternativeId, move }) => {
          if (move !== 'held' && move !== 'rose' && move !== 'fell') return null;
          const a = columns[i]!.places[alternatives.indexOf(alternativeId)] as Ranked;
          const b = columns[i + 1]!.places[alternatives.indexOf(alternativeId)] as Ranked;
          return (
            <path
              key={`${s.from}${alternativeId}`} data-flow={alternativeId} data-move={move}
              d={`M${xOf(i)} ${yOf(a.rank)}L${xOf(i + 1)} ${yOf(b.rank)}`}
              fill="none" stroke="currentColor" stroke-width={move === 'held' ? 1.5 : 2} stroke-dasharray={move === 'held' ? undefined : MOVED_DASH}
            />
          );
        }))}
        {columns.map((c, i) => (
          <g key={`m${c.id}`} data-column={c.id}>
            {endLabels(c).map((l) => (
              <g key={l.rank} data-rank={l.rank}>
                <circle cx={xOf(i)} cy={yOf(l.rank)} r={mark} fill={l.exact ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" />
                {(i === 0 || i === columns.length - 1) && (
                  <text data-end-label="" x={labelX(i)} y={yOf(l.rank) + 4} text-anchor={anchorOf(i)} font-size={font} fill="currentColor">{l.text}</text>
                )}
              </g>
            ))}
            {unrankedIn(c).map((t, k) => {
              const x = xOf(i);
              const y = rule + (k + 0.5) * step;
              return (
                <g key={t} data-unranked="">
                  <path d={`M${x - mark} ${y - mark}L${x + mark} ${y + mark}M${x - mark} ${y + mark}L${x + mark} ${y - mark}`} fill="none" stroke="currentColor" stroke-width="1.5" />
                  {(i === 0 || i === columns.length - 1) && <text x={labelX(i)} y={y + 4} text-anchor={anchorOf(i)} font-size={font} fill="currentColor">{t}</text>}
                </g>
              );
            })}
          </g>
        ))}
        {lane > 0 && <path data-unranked-rule="" d={`M${pad} ${rule}H${width - pad}`} fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" />}
      </svg>
      <ul class="comparanda-panel-hint" aria-label="What the marks mean">
        <li>{`${rankOne} Each line joins one ${rowWords.alternative}'s rank in the two rankings, and is named at both ends: ranks, not scores, so a line's slope is not a size.`}</li>
        <li>A dashed line changes place against the others ranked in both; a solid one keeps it, even where a row ranked in one only shifts its number.</li>
        <li>A filled dot is a rank the data settle, shared when tied; a ring is one they leave open, because a score is an interval that overlaps another's.</li>
        <li>A cross below the dashed rule is not ranked in that ranking; the table says why.</li>
      </ul>
      <table class="comparanda-analysis-table">
        <caption>{`Each ${rowWords.alternative}'s rank in both rankings, in words`}</caption>
        <thead>
          <tr>
            <th scope="col">{capitalise(rowWords.alternative)}</th>
            {columns.map((c) => <th key={c.id} scope="col">{c.label}</th>)}
            <th scope="col">Between them</th>
          </tr>
        </thead>
        <tbody>
          {alternatives.map((aid) => (
            <tr key={aid} data-row={aid}>
              <th scope="row">{names(aid)}</th>
              {columns.map((c) => <td key={c.id}>{said(aid, c)}</td>)}
              <td data-move-said="">
                {steps.map((s, i) => {
                  const k = alternatives.indexOf(aid);
                  return moveSaid(s.moves[k]!.move, columns[i]!, columns[i + 1]!, columns[i]!.places[k]!, columns[i + 1]!.places[k]!);
                }).join('; ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {steps.some((s) => s.passed.length > 0) && (
        <p class="comparanda-panel-hint" data-passed="">
          {`Pass each other: ${steps.flatMap((s) => s.passed.map((p) => `${names(p.first)} and ${names(p.second)}`)).join('; ')}.`}
        </p>
      )}
    </figure>
  );
}
