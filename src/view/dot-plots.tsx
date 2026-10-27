/**
 * The small-multiple dot plots (#96, ADR-0026): one panel per criterion, its
 * own levels as discrete ticks, one dot per rater assertion, and a missing
 * lane keyed by reason code beside the ticks.
 *
 * Each panel is a real table: an alternative per row, a level per column and
 * the dots in the cells. A table is the dot plot's own text alternative, keeps
 * the ticks discrete with nothing drawn between them, and reads row by row to
 * a screen reader with every count said. A filled dot is a rater the round
 * names to this reader; a ring is a hand it does not. The missing lane carries
 * the reason's glyph and words (ADR-0028), so absence is told apart without
 * colour, and an alternative with no value on the criterion is in the lane
 * rather than missing from the panel.
 *
 * Its stylesheet is its own, scoped to its tables: the matrix's grid rules (a
 * rule on every cell, sticky headers) would otherwise draw a line through
 * every row of levels, which is the continuous rule ADR-0026 rules out.
 *
 * An `AnalysisPanel` the composition root registers
 * (`mountMatrix(el, props, { panels: [DotPlotsPanel] })`): the matrix never
 * imports it, so the standalone page does not pay for it. Closed by default and
 * computed only once opened. The model is `dotPlot` in core.
 */
import { useState } from 'preact/hooks';

import { dotPlots, type DotPlotRow } from '../core/dot-plot.js';
import { attributions } from '../core/identity.js';
import { aliasesOf } from '../core/schema/structure.js';
import { Glyph, GLYPH_KEYS, type GlyphKey } from './channels.js';
import { capitalise } from './words.js';
import type { AnalysisPanelProps } from './agreement.js';

/** A lane's glyph: its core reason's, or the undeclared one's for anything else. */
const glyphOf = (lane: string): GlyphKey => ((GLYPH_KEYS as readonly string[]).includes(lane) ? lane as GlyphKey : 'undeclared');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The panel's own rules, above the matrix's in every medium: no rule through the levels, nothing sticky.
 * The class twice outranks the matrix's most specific cell rule (`tbody th[scope="row"]`).
 */
const DOT_PLOT_CSS = `
.comparanda-matrix .comparanda-dot-plot.comparanda-dot-plot :is(th, td) { box-shadow: none; border-width: 0; position: static; text-align: center; }
.comparanda-matrix .comparanda-dot-plot.comparanda-dot-plot tbody th { text-align: start; }
`;

export function DotPlotsPanel({ analysis, measure, vouched, viewer }: AnalysisPanelProps) {
  const [open, setOpen] = useState(false);

  const body = () => {
    const names = attributions(analysis.authors, { vouched });
    const rowWord = capitalise(aliasesOf(analysis).alternative);
    return (
      <>
        <style>{DOT_PLOT_CSS}</style>
        <p class="comparanda-panel-hint">
          Each criterion on its own levels, with nothing between them: a filled dot is a rater named to you, a ring a rater who is not.
          An alternative with no value is in the missing lane, under its reason.
        </p>
        {dotPlots(analysis, { measure, viewer }).map((p) => {
          if (!p.usable) {
            return (
              <section key={p.criterionId} data-dot-plot={p.criterionId}>
                <h3>{p.label}</h3>
                <p role="note">{p.reason}</p>
              </section>
            );
          }
          const notDrawn = p.rows.some((r) => r.unseen || r.offTicks);
          return (
            <section key={p.criterionId} data-dot-plot={p.criterionId}>
              <h3>{p.label}</h3>
              <table class="comparanda-dot-plot">
                <caption>{`${p.label}: one dot per rater, by level${p.lanes.length ? ', then the missing lane' : ''}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">{rowWord}</th>
                    {/* By position: two levels may print alike (true and "true"). */}
                    {p.ticks.map((t, i) => <th scope="col" key={i} data-tick="">{String(t)}</th>)}
                    {p.lanes.map((lane) => (
                      <th scope="col" key={lane} data-lane={lane}><Glyph reason={glyphOf(lane)} />{` Missing: ${lane.replace(/-/g, ' ')}`}</th>
                    ))}
                    {notDrawn && <th scope="col">Not drawn</th>}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.alternativeId} data-row={r.alternativeId}>
                      <th scope="row">{r.label}</th>
                      {r.levels.map((level, i) => <Dots key={i} level={level} names={names} />)}
                      {p.lanes.map((lane) => (
                        <td key={lane} data-lane={lane}>
                          {r.missing.filter((m) => m.lane === lane).map((m) => (
                            <span key={`${m.means}\u0000${m.reason ?? ''}`}>
                              <Glyph reason={glyphOf(lane)} />
                              {`${m.count > 1 ? ` ×${m.count}` : ''} `}
                              <span class="comparanda-sr">{`${plural(m.count, 'mark')}: ${m.means}${m.reason ? ` ${capitalise(m.reason)}.` : ''}`}</span>
                            </span>
                          ))}
                        </td>
                      ))}
                      {notDrawn && <td>{[r.unseen && `${r.unseen} not shown to you`, r.offTicks && `${r.offTicks} off the levels`].filter(Boolean).join('; ')}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </>
    );
  };

  return (
    <details class="comparanda-analysis" data-analysis="dot-plots" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Each criterion's values, one dot per rater, with what is missing and why</summary>
      {open && body()}
    </details>
  );
}

/** The dots at one level: seen, and said with who put them there. */
function Dots({ level: { named, unnamed }, names }: { level: DotPlotRow['levels'][number]; names: Map<string, string> }) {
  const n = named.length + unnamed;
  if (n === 0) return <td />;
  const who = [
    ...named.map((id) => names.get(id) ?? id),
    ...(unnamed > 0 ? [plural(unnamed, 'rater not named to you', 'raters not named to you')] : []),
  ];
  return (
    <td data-dots={String(n)}>
      <span aria-hidden="true">{'●'.repeat(named.length)}{'○'.repeat(unnamed)}</span>
      <span class="comparanda-sr">{`${plural(n, 'rater')}: ${who.join(', ')}`}</span>
    </td>
  );
}
