/**
 * `rankShare` inside the rank-flow panel (#343, ADR-0015 "Rank acceptability is `rankShare`, and it renders inside
 * `RankFlow`"): how the ranks spread across every weighting at once. A bar per alternative and rank whose length is
 * the share, inside an outlined cell that is the whole (shape, never colour), and a table that says every share, the
 * share a blank or a tie left open, and the central weighting, in words.
 *
 * The caption is the analysis's own (`RankShareResult.caption`): a stability statement, never which row is first, so
 * this view cannot recaption it as an endorsement. The shares are computed once opened, like every analysis panel.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import type { rankShare, RankShareResult } from '../core/analyses/rank-share.js';
import type { RowWords } from '../core/analyses/rank-flow.js';
import type { Analysis } from '../core/schema/analysis.js';
import { capitalise } from './words.js';

/** A share as a person reads it: whole percent, "under 1%" and "over 99%" where rounding would say none or all. */
export const percentSaid = (x: number): string =>
  x === 0 ? '0%' : x < 0.005 ? 'under 1%' : x >= 1 ? '100%' : x >= 0.995 ? 'over 99%' : `${Math.round(x * 100)}%`;

/** The geometry of the drawing, in SVG user units: a label's estimated glyph width, cell width and height, bar height, padding, type size. */
const SHARE_PLOT = Object.freeze({ glyph: 6.6, cell: 44, row: 22, bar: 10, pad: 8, font: 11 });

export function RankShareFigure({ analysis, measure, id, names, words, selection, run, samples }: {
  analysis: Analysis; measure: string; id: string; names: (alternativeId: string) => string; words: RowWords;
  selection: string[]; run: typeof rankShare; samples: number | undefined;
}) {
  const key = selection.join('\u0000');
  const compute = () => run(analysis, { measure, alternativeIds: selection, words, ...(samples !== undefined ? { samples } : {}) });
  // The first drawing is computed in place; a later change (a new `analysis` identity while the panel is open) is
  // recomputed when the browser is idle, the earlier shares staying up meanwhile: the run costs 55-300 ms (#373).
  const [result, setResult] = useState<RankShareResult>(compute);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const idle = (globalThis as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    const cancel = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
    const run_ = () => setResult(compute());
    if (idle && cancel) { const h = idle(run_); return () => cancel(h); }
    const h = setTimeout(run_, 0);
    return () => clearTimeout(h);
  }, [analysis, measure, key, samples]);
  if (result.refused) return null;
  if (result.rows.length === 0) return <p role="note" data-rank-share-refused="">{`No ranks to spread: no ${words.alternative} is scored at the declared weights.`}</p>;
  const label = (cid: string) => analysis.criteria.find((c) => c.id === cid)?.label ?? cid;
  const { glyph, cell, row, bar, pad, font } = SHARE_PLOT;
  const ranks = Array.from({ length: result.rows.length }, (_, k) => k + 1);
  const labelW = pad * 2 + Math.max(...result.rows.map((r) => names(r.alternativeId).length)) * glyph;
  const width = labelW + ranks.length * cell + pad;
  const height = row * (result.rows.length + 1) + pad;
  return (
    <figure aria-labelledby={`${id}-share-caption`} data-rank-share="">
      <figcaption id={`${id}-share-caption`}><strong>{result.caption}</strong></figcaption>
      <div role="region" tabIndex={0} aria-label="The rank shares drawing; it scrolls sideways where it is wider than the page" style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" fill="currentColor"
          aria-label={`For each ${words.alternative}, a bar at each rank as long as the share of weightings that put it there, in a cell as wide as all of them. The table below says the same in words.`}
        >
          {ranks.map((r) => <text key={`h${r}`} x={labelW + (r - 0.5) * cell} y={row - 6} text-anchor="middle" font-size={font} fill="currentColor">{`Rank ${r}`}</text>)}
          {result.rows.map((r, i) => (
            <g key={r.alternativeId} data-share-row={r.alternativeId}>
              <text x={labelW - pad} y={row * (i + 1) + row / 2 + 4} text-anchor="end" font-size={font} fill="currentColor">{names(r.alternativeId)}</text>
              {r.shares.map((x, k) => (
                <g key={k} data-rank={k + 1}>
                  <rect x={labelW + k * cell + 2} y={row * (i + 1) + (row - bar) / 2} width={cell - 4} height={bar} fill="none" stroke="currentColor" stroke-width="0.5" />
                  {x > 0 && (
                    <rect data-bar="" x={labelW + k * cell + 2} y={row * (i + 1) + (row - bar) / 2} width={Math.max(1, x * (cell - 4))} height={bar} fill="currentColor" stroke="currentColor" />
                  )}
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div role="region" tabIndex={0} aria-label="The rank shares table; it scrolls sideways where it is wider than the page" style={{ overflowX: 'auto' }}>
        <table class="comparanda-analysis-table">
          <caption>{`Share of the weightings that put each ${words.alternative} at each rank, in words. A rank column need not add to 100%: a ${words.alternative} the data leave open spreads its one share over several ranks.`}</caption>
          <thead>
            <tr>
              <th scope="col">{capitalise(words.alternative)}</th>
              {ranks.map((r) => <th key={r} scope="col">{`Rank ${r}`}</th>)}
              <th scope="col">Rank left open by a blank</th>
              <th scope="col">Tied with a complete row</th>
              <th scope="col">Central weighting</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.alternativeId} data-row={r.alternativeId}>
                <th scope="row">{names(r.alternativeId)}</th>
                {r.shares.map((x, k) => <td key={k}>{percentSaid(x)}</td>)}
                <td data-unsettled="">{percentSaid(r.unsettled)}</td>
                <td data-tied="">{percentSaid(r.tied)}</td>
                <td data-central="">
                  {r.centralWeights
                    ? r.centralWeights.map((w) => `${label(w.criterionId)} ${percentSaid(w.weight)}`).join(', ')
                    : 'never settled first'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.unscored.length > 0 && (
        <p class="comparanda-panel-hint" data-unscored="">
          {`Not in these shares, as in the ranking above: ${result.unscored.map((u) => `${names(u.alternativeId)} (${u.label})`).join('; ')}.`}
        </p>
      )}
      <ul class="comparanda-panel-hint" aria-label="What these shares assume">
        {result.assumptions.map((a) => <li key={a}>{a}</li>)}
      </ul>
    </figure>
  );
}
