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
 * An `AnalysisPanel` the composition root registers
 * (`mountMatrix(el, props, { panels: [DotPlotsPanel] })`): the matrix never
 * imports it, so the standalone page does not pay for it. Closed by default and
 * computed only once opened. The model is `dotPlot` in core.
 */
import { useState } from 'preact/hooks';

import { dotPlot, type DotPlotRow } from '../core/dot-plot.js';
import { attributions } from '../core/identity.js';
import { aliasesOf } from '../core/schema/structure.js';
import { Glyph, GLYPH_KEYS, type GlyphKey } from './channels.js';
import { capitalise } from './words.js';
import type { AnalysisPanelProps } from './agreement.js';

/** A lane's glyph: its core reason's, or the undeclared one's for anything else. */
const glyphOf = (lane: string): GlyphKey => ((GLYPH_KEYS as readonly string[]).includes(lane) ? lane as GlyphKey : 'undeclared');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DotPlotsPanel({ analysis, measure, vouched, viewer }: AnalysisPanelProps) {
  const [open, setOpen] = useState(false);

  const body = () => {
    const names = attributions(analysis.authors, { vouched });
    const rowWord = capitalise(aliasesOf(analysis).alternative);
    const plots = analysis.criteria.filter((c) => !c.tombstoned).map((c) => dotPlot(analysis, c.id, { measure, viewer }));
    return (
      <>
        <p class="comparanda-panel-hint">
          Each criterion on its own levels, with nothing between them: a filled dot is a rater named to you, a ring a rater who is not.
          An alternative with no value is in the missing lane, under its reason.
        </p>
        {plots.map((p) => (
          <section key={p.criterionId} data-dot-plot={p.criterionId}>
            <h4>{p.label}</h4>
            {!p.usable
              ? <p role="note">{p.reason}</p>
              : (
                <table>
                  <caption>{`${p.label}: one dot per rater, by level${p.lanes.length ? ', then the missing lane' : ''}`}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{rowWord}</th>
                      {p.ticks.map((t) => <th scope="col" key={String(t)} data-tick="">{String(t)}</th>)}
                      {p.lanes.map((lane) => (
                        <th scope="col" key={lane} data-lane={lane}><Glyph reason={glyphOf(lane)} />{` Missing: ${lane.replace(/-/g, ' ')}`}</th>
                      ))}
                      {p.rows.some((r) => r.unseen || r.offTicks) && <th scope="col">Not drawn</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r) => (
                      <tr key={r.alternativeId} data-row={r.alternativeId}>
                        <th scope="row">{r.label}</th>
                        {p.ticks.map((t, i) => <Dots key={String(t)} row={r} tick={i} names={names} />)}
                        {p.lanes.map((lane) => {
                          const here = r.missing.filter((m) => m.lane === lane);
                          return (
                            <td key={lane} data-lane={lane}>
                              {here.map((m) => (
                                <span key={m.means}>
                                  <Glyph reason={glyphOf(lane)} />
                                  {`${m.count > 1 ? ` ×${m.count}` : ''} `}
                                  <span class="comparanda-sr">{`${plural(m.count, 'mark')}: ${m.means}`}</span>
                                </span>
                              ))}
                            </td>
                          );
                        })}
                        {p.rows.some((x) => x.unseen || x.offTicks) && (
                          <td>{[r.unseen && `${r.unseen} not shown to you`, r.offTicks && `${r.offTicks} off the levels`].filter(Boolean).join('; ')}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>
        ))}
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
function Dots({ row, tick, names }: { row: DotPlotRow; tick: number; names: Map<string, string> }) {
  const here = row.dots.filter((d) => d.tick === tick);
  if (here.length === 0) return <td />;
  const named = here.filter((d) => d.authorId !== undefined);
  const who = [
    ...named.map((d) => names.get(d.authorId!) ?? d.authorId!),
    ...(here.length > named.length ? [plural(here.length - named.length, 'rater not named to you', 'raters not named to you')] : []),
  ];
  return (
    <td data-dots={String(here.length)}>
      <span aria-hidden="true">{'●'.repeat(named.length)}{'○'.repeat(here.length - named.length)}</span>
      <span class="comparanda-sr">{`${plural(here.length, 'rater')}: ${who.join(', ')}`}</span>
    </td>
  );
}
